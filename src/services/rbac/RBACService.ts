// ═══════════════════════════════════════════════════════════
// RBACService — roles, permissions, feature flags (REST direct)
// ═══════════════════════════════════════════════════════════
//
// All KROMI users have:
//   - zero or more roles → grant permissions via role_permissions
//   - optional per-user feature_flags that override (allow/deny)
//   - core permissions are always granted (cannot be revoked)
//
// The single source of truth is the `effective_user_permissions` view
// in Postgres. The frontend just queries it.

const SB_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function headers(extra: Record<string, string> = {}): HeadersInit {
  return {
    apikey: SB_KEY ?? '',
    Authorization: `Bearer ${SB_KEY ?? ''}`,
    ...extra,
  };
}

/**
 * Lazy-resolve the active KROMI session token from the auth store.
 * Used by admin RPC calls so the SECURITY DEFINER functions in Postgres
 * can verify the caller is a super admin (the anon key alone tells the
 * DB nothing — RLS is now restrictive on writes to sensitive tables).
 *
 * Uses a dynamic import to avoid an import cycle with authStore (which
 * already imports from this file for impersonation log + notification).
 */
async function getSessionToken(): Promise<string | null> {
  try {
    const mod = await import('../../store/authStore');
    return mod.useAuthStore.getState().sessionToken;
  } catch {
    return null;
  }
}

/**
 * Call a Postgres RPC via PostgREST. Adds the session token as a body
 * parameter (`p_session_token`) for admin RPCs that need it.
 */
async function rpc<T = unknown>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (!SB_URL || !SB_KEY) throw new Error('supabase not configured');
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    let detail = await res.text();
    try {
      const parsed = JSON.parse(detail);
      detail = parsed.message ?? parsed.error ?? detail;
    } catch { /* not json */ }
    throw new Error(`${fn}: ${detail}`);
  }
  return (await res.json()) as T;
}

// ─── Types ───────────────────────────────────────────────────
export interface Permission {
  key: string;
  category: 'core' | 'features' | 'admin';
  label: string;
  description: string | null;
  is_core: boolean;
}

export interface Role {
  id: string;
  key: string;
  label: string;
  description: string | null;
  is_system: boolean;
  sort_order: number;
}

export interface UserRole {
  user_id: string;
  role_id: string;
  granted_at: string;
}

export type FeatureFlagMode = 'allow' | 'deny';

export interface UserFeatureFlag {
  user_id: string;
  permission_key: string;
  mode: FeatureFlagMode;
  reason: string | null;
  set_at: string;
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  is_super_admin: boolean;
  suspended_at: string | null;
  suspended_reason: string | null;
  created_at: string;
  last_login_at: string | null;
}

// ─── Catalog queries (cached client-side, rarely change) ─────
let permissionsCache: Permission[] | null = null;
let rolesCache: Role[] | null = null;

export async function listPermissions(): Promise<Permission[]> {
  if (permissionsCache) return permissionsCache;
  if (!SB_URL || !SB_KEY) return [];
  const res = await fetch(`${SB_URL}/rest/v1/permissions?select=*&order=category,key`, {
    headers: headers(),
  });
  permissionsCache = await res.json();
  return permissionsCache ?? [];
}

export async function listRoles(): Promise<Role[]> {
  if (rolesCache) return rolesCache;
  if (!SB_URL || !SB_KEY) return [];
  const res = await fetch(`${SB_URL}/rest/v1/roles?select=*&order=sort_order`, {
    headers: headers(),
  });
  rolesCache = await res.json();
  return rolesCache ?? [];
}

export function clearRBACCache(): void {
  permissionsCache = null;
  rolesCache = null;
}

// ─── Effective permissions ───────────────────────────────────
export async function getEffectivePermissions(userId: string): Promise<string[]> {
  if (!SB_URL || !SB_KEY) return [];
  const res = await fetch(
    `${SB_URL}/rest/v1/effective_user_permissions?user_id=eq.${userId}&select=permission_key`,
    { headers: headers() },
  );
  const rows = (await res.json()) as { permission_key: string }[];
  return rows.map((r) => r.permission_key);
}

// ─── Role assignment ─────────────────────────────────────────
export async function getUserRoles(userId: string): Promise<string[]> {
  if (!SB_URL || !SB_KEY) return [];
  const res = await fetch(
    `${SB_URL}/rest/v1/user_roles?user_id=eq.${userId}&select=role_id`,
    { headers: headers() },
  );
  const rows = (await res.json()) as { role_id: string }[];
  return rows.map((r) => r.role_id);
}

export async function setUserRoles(
  userId: string,
  roleIds: string[],
  // grantedBy is preserved for API stability but the DB derives the
  // actor from the session token now (admin_set_user_roles).
  _grantedBy: string,
): Promise<void> {
  void _grantedBy;
  const token = await getSessionToken();
  if (!token) throw new Error('not authenticated');
  await rpc('admin_set_user_roles', {
    p_session_token: token,
    p_target_user_id: userId,
    p_role_ids: roleIds,
  });
}

// ─── Role → permission management ────────────────────────────
export async function getRolePermissions(roleId: string): Promise<string[]> {
  if (!SB_URL || !SB_KEY) return [];
  const res = await fetch(
    `${SB_URL}/rest/v1/role_permissions?role_id=eq.${roleId}&select=permission_key`,
    { headers: headers() },
  );
  const rows = (await res.json()) as { permission_key: string }[];
  return rows.map((r) => r.permission_key);
}

export async function setRolePermissions(roleId: string, permKeys: string[]): Promise<void> {
  const token = await getSessionToken();
  if (!token) throw new Error('not authenticated');
  await rpc('admin_set_role_permissions', {
    p_session_token: token,
    p_role_id: roleId,
    p_permission_keys: permKeys,
  });
}

// ─── Role CRUD (custom roles) ────────────────────────────────
export interface RoleInput {
  key: string;
  label: string;
  description?: string | null;
  sort_order?: number;
}

/** Create a new (non-system) role via the admin RPC. */
export async function createRole(input: RoleInput): Promise<Role | null> {
  const token = await getSessionToken();
  if (!token) throw new Error('not authenticated');
  const id = await rpc<string>('admin_create_role', {
    p_session_token: token,
    p_key: input.key,
    p_label: input.label,
    p_description: input.description ?? null,
    p_sort_order: input.sort_order ?? 100,
  });
  if (!id) return null;
  // Re-fetch the row so consumers get the full object
  if (!SB_URL || !SB_KEY) return null;
  const res = await fetch(`${SB_URL}/rest/v1/roles?id=eq.${id}&select=*&limit=1`, { headers: headers() });
  const rows = (await res.json()) as Role[];
  return rows[0] ?? null;
}

/** Update label / description / sort_order. System roles are blocked by the RPC. */
export async function updateRole(
  roleId: string,
  patch: Partial<Pick<Role, 'label' | 'description' | 'sort_order'>>,
): Promise<void> {
  const token = await getSessionToken();
  if (!token) throw new Error('not authenticated');
  await rpc('admin_update_role', {
    p_session_token: token,
    p_role_id: roleId,
    p_label: patch.label ?? '',
    p_description: patch.description ?? null,
    p_sort_order: patch.sort_order ?? null,
  });
}

/** Delete a custom role. The RPC blocks system roles + cascades cleanly. */
export async function deleteRole(roleId: string): Promise<void> {
  const token = await getSessionToken();
  if (!token) throw new Error('not authenticated');
  await rpc('admin_delete_role', {
    p_session_token: token,
    p_role_id: roleId,
  });
}

// ─── Per-user feature flags (overrides) ──────────────────────
export async function getUserFeatureFlags(userId: string): Promise<UserFeatureFlag[]> {
  if (!SB_URL || !SB_KEY) return [];
  const res = await fetch(
    `${SB_URL}/rest/v1/user_feature_flags?user_id=eq.${userId}&select=*`,
    { headers: headers() },
  );
  return await res.json();
}

export async function setUserFeatureFlag(
  userId: string,
  permissionKey: string,
  mode: FeatureFlagMode,
  // setBy is now derived from the session token in the RPC
  _setBy: string,
  reason?: string,
): Promise<void> {
  void _setBy;
  const token = await getSessionToken();
  if (!token) throw new Error('not authenticated');
  await rpc('admin_set_user_feature_flag', {
    p_session_token: token,
    p_target_user_id: userId,
    p_permission_key: permissionKey,
    p_mode: mode,
    p_reason: reason ?? null,
  });
}

export async function clearUserFeatureFlag(userId: string, permissionKey: string): Promise<void> {
  const token = await getSessionToken();
  if (!token) throw new Error('not authenticated');
  await rpc('admin_clear_user_feature_flag', {
    p_session_token: token,
    p_target_user_id: userId,
    p_permission_key: permissionKey,
  });
}

// ─── User management (admin) ─────────────────────────────────
export async function listAllUsers(): Promise<AdminUserRow[]> {
  if (!SB_URL || !SB_KEY) return [];
  const res = await fetch(
    `${SB_URL}/rest/v1/app_users?select=id,email,name,is_super_admin,suspended_at,suspended_reason,created_at,last_login_at&order=created_at.desc`,
    { headers: headers() },
  );
  return await res.json();
}

export async function getUserById(userId: string): Promise<AdminUserRow | null> {
  if (!SB_URL || !SB_KEY) return null;
  const res = await fetch(
    `${SB_URL}/rest/v1/app_users?id=eq.${userId}&select=id,email,name,is_super_admin,suspended_at,suspended_reason,created_at,last_login_at&limit=1`,
    { headers: headers() },
  );
  const rows = await res.json();
  return rows[0] ?? null;
}

// Suspension write happens server-side via admin_set_suspended, which both
// updates app_users and inserts the user_suspensions audit row in one call.

export async function suspendUser(userId: string, reason: string, _performedBy?: string | null): Promise<void> {
  void _performedBy;
  const token = await getSessionToken();
  if (!token) throw new Error('not authenticated');
  await rpc('admin_set_suspended', {
    p_session_token: token,
    p_target_user_id: userId,
    p_suspend: true,
    p_reason: reason,
  });
}

export async function unsuspendUser(userId: string, _performedBy?: string | null): Promise<void> {
  void _performedBy;
  const token = await getSessionToken();
  if (!token) throw new Error('not authenticated');
  await rpc('admin_set_suspended', {
    p_session_token: token,
    p_target_user_id: userId,
    p_suspend: false,
    p_reason: null,
  });
}

export interface UserSuspensionEvent {
  id: string;
  user_id: string;
  action: 'suspend' | 'unsuspend';
  reason: string | null;
  performed_by: string | null;
  performed_at: string;
  /** Joined display field, resolved client-side. */
  performed_by_email?: string | null;
}

/** Fetch a user's suspension/unsuspension history (newest first). */
export async function listUserSuspensions(userId: string, limit = 50): Promise<UserSuspensionEvent[]> {
  if (!SB_URL || !SB_KEY) return [];
  const res = await fetch(
    `${SB_URL}/rest/v1/user_suspensions?user_id=eq.${userId}&select=*&order=performed_at.desc&limit=${limit}`,
    { headers: headers() }
  );
  const rows = (await res.json()) as UserSuspensionEvent[];
  if (!Array.isArray(rows) || rows.length === 0) return [];

  // Resolve performer emails
  const performerIds = Array.from(
    new Set(rows.map((r) => r.performed_by).filter((id): id is string => !!id))
  );
  if (performerIds.length === 0) return rows;

  const inList = performerIds.map((id) => `"${id}"`).join(',');
  const usersRes = await fetch(
    `${SB_URL}/rest/v1/app_users?select=id,email&id=in.(${inList})`,
    { headers: headers() }
  );
  const users = (await usersRes.json()) as Array<{ id: string; email: string }>;
  const byId = new Map(users.map((u) => [u.id, u.email]));
  return rows.map((r) => ({
    ...r,
    performed_by_email: r.performed_by ? byId.get(r.performed_by) ?? null : null,
  }));
}

export async function setUserSuperAdmin(userId: string, isSuper: boolean): Promise<void> {
  const token = await getSessionToken();
  if (!token) throw new Error('not authenticated');
  await rpc('admin_set_super_admin', {
    p_session_token: token,
    p_target_user_id: userId,
    p_is_super: isSuper,
  });
  return;
}

// ─── Impersonation log ───────────────────────────────────────
export async function logImpersonationStart(
  adminUserId: string,
  targetUserId: string,
  reason?: string,
): Promise<string | null> {
  if (!SB_URL || !SB_KEY) return null;
  const res = await fetch(`${SB_URL}/rest/v1/impersonation_log`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({
      admin_user_id: adminUserId,
      impersonated_user_id: targetUserId,
      reason: reason ?? null,
      user_agent: navigator.userAgent,
    }),
  });
  const rows = await res.json();
  return rows[0]?.id ?? null;
}

/**
 * Best-effort notification ping to the notify-impersonation edge function.
 * Never throws — impersonation should not be blocked by mail issues.
 */
export async function notifyImpersonationStart(payload: {
  admin_email: string;
  admin_name?: string | null;
  target_email: string;
  target_name?: string | null;
  reason?: string | null;
  log_id?: string | null;
}): Promise<void> {
  if (!SB_URL || !SB_KEY) return;
  try {
    await fetch(`${SB_URL}/functions/v1/notify-impersonation`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...payload,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      }),
    });
  } catch {
    // Silent: missing config / network error must not block impersonation
  }
}

export async function logImpersonationEnd(logId: string): Promise<void> {
  if (!SB_URL || !SB_KEY) return;
  await fetch(`${SB_URL}/rest/v1/impersonation_log?id=eq.${logId}`, {
    method: 'PATCH',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ ended_at: new Date().toISOString() }),
  });
}

export interface ImpersonationLogEntry {
  id: string;
  admin_user_id: string;
  impersonated_user_id: string;
  started_at: string;
  ended_at: string | null;
  reason: string | null;
  user_agent: string | null;
  /** Joined display fields (resolved client-side from app_users). */
  admin_email?: string;
  admin_name?: string | null;
  target_email?: string;
  target_name?: string | null;
}

export interface ImpersonationLogFilter {
  admin_user_id?: string;
  target_user_id?: string;
  /** ISO date — only entries started >= since */
  since?: string;
  /** ISO date — only entries started <= until */
  until?: string;
  /** Only show currently active sessions (no ended_at). */
  active_only?: boolean;
}

export interface ImpersonationLogPage {
  rows: ImpersonationLogEntry[];
  /** Server total matching the filter (only present on first page). */
  total: number | null;
  /** Returns true while there are more rows to fetch with the next offset. */
  has_more: boolean;
}

/**
 * Cursor-style pagination via offset (PostgREST `Range` header).
 *
 * Why offset rather than keyset? The dataset is small enough that offset
 * is fine (admins look at recent rows; pagination is hundreds, not millions),
 * and the UI wants a simple "load more" button, which offset handles
 * trivially without exposing started_at boundaries.
 */
export async function listImpersonationLog(
  filter: ImpersonationLogFilter = {},
  pagination: { limit?: number; offset?: number } = {},
): Promise<ImpersonationLogPage> {
  if (!SB_URL || !SB_KEY) return { rows: [], total: null, has_more: false };

  const limit = pagination.limit ?? 50;
  const offset = pagination.offset ?? 0;

  const params: string[] = ['select=*', 'order=started_at.desc'];
  if (filter.admin_user_id) params.push(`admin_user_id=eq.${filter.admin_user_id}`);
  if (filter.target_user_id) params.push(`impersonated_user_id=eq.${filter.target_user_id}`);
  if (filter.since) params.push(`started_at=gte.${encodeURIComponent(filter.since)}`);
  if (filter.until) params.push(`started_at=lte.${encodeURIComponent(filter.until)}`);
  if (filter.active_only) params.push('ended_at=is.null');

  const url = `${SB_URL}/rest/v1/impersonation_log?${params.join('&')}`;
  const res = await fetch(url, {
    headers: headers({
      Prefer: offset === 0 ? 'count=exact' : '',
      Range: `${offset}-${offset + limit - 1}`,
      'Range-Unit': 'items',
    }),
  });
  const rows = (await res.json()) as ImpersonationLogEntry[];

  // Parse content-range header: "0-49/237"
  let total: number | null = null;
  const range = res.headers.get('content-range') ?? '';
  const totalMatch = /\/(\d+|\*)$/.exec(range);
  if (totalMatch && totalMatch[1] !== '*') {
    total = parseInt(totalMatch[1] ?? '0', 10);
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return { rows: [], total, has_more: false };
  }

  // Resolve user emails/names in one batched query
  const userIds = Array.from(
    new Set(rows.flatMap((r) => [r.admin_user_id, r.impersonated_user_id]))
  );
  const inList = userIds.map((id) => `"${id}"`).join(',');
  const usersRes = await fetch(
    `${SB_URL}/rest/v1/app_users?select=id,email,name&id=in.(${inList})`,
    { headers: headers() }
  );
  const users = (await usersRes.json()) as Array<{ id: string; email: string; name: string | null }>;
  const byId = new Map(users.map((u) => [u.id, u]));

  const enriched: ImpersonationLogEntry[] = rows.map((r) => ({
    ...r,
    admin_email: byId.get(r.admin_user_id)?.email,
    admin_name: byId.get(r.admin_user_id)?.name ?? null,
    target_email: byId.get(r.impersonated_user_id)?.email,
    target_name: byId.get(r.impersonated_user_id)?.name ?? null,
  }));

  return {
    rows: enriched,
    total,
    has_more: total !== null ? offset + rows.length < total : rows.length === limit,
  };
}

// ─── Per-user enrichment stats for admin user detail ────────
export interface UserEnrichmentStats {
  bikes_count: number;
  rides_count: number;
  files_count: number;
  storage_bytes: number;
  last_ride_at: string | null;
  last_upload_at: string | null;
}

/**
 * Aggregates ride_sessions + kromi_files + user_settings.bikes for one user.
 *
 * The bikes array on user_settings is a slim mirror written by SettingsSyncService
 * — the canonical full BikeConfig still lives in IndexedDB on the client.
 */
export async function getUserEnrichmentStats(userId: string): Promise<UserEnrichmentStats> {
  const empty: UserEnrichmentStats = {
    bikes_count: 0, rides_count: 0, files_count: 0, storage_bytes: 0,
    last_ride_at: null, last_upload_at: null,
  };
  if (!SB_URL || !SB_KEY) return empty;

  const countHeaders = headers({ Prefer: 'count=exact', Range: '0-0' });
  const countOf = async (path: string): Promise<number> => {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, { method: 'GET', headers: countHeaders });
    const range = res.headers.get('content-range') ?? '';
    const m = /\/(\d+|\*)$/.exec(range);
    if (!m || m[1] === '*') return 0;
    return parseInt(m[1] ?? '0', 10);
  };

  const [ridesCount, lastRideRows, filesRows, settingsRows] = await Promise.all([
    countOf(`ride_sessions?user_id=eq.${userId}&select=id`).catch(() => 0),
    fetch(
      `${SB_URL}/rest/v1/ride_sessions?user_id=eq.${userId}&select=started_at&order=started_at.desc&limit=1`,
      { headers: headers() }
    )
      .then((r) => r.json() as Promise<Array<{ started_at: string }>>)
      .catch(() => []),
    fetch(
      `${SB_URL}/rest/v1/kromi_files?owner_user_id=eq.${userId}&select=size_bytes,created_at&order=created_at.desc`,
      { headers: headers() }
    )
      .then((r) => r.json() as Promise<Array<{ size_bytes: number | null; created_at: string }>>)
      .catch(() => []),
    fetch(
      `${SB_URL}/rest/v1/user_settings?user_id=eq.${userId}&select=bikes&limit=1`,
      { headers: headers() }
    )
      .then((r) => r.json() as Promise<Array<{ bikes: unknown }>>)
      .catch(() => []),
  ]);

  const files = Array.isArray(filesRows) ? filesRows : [];
  const storage_bytes = files.reduce((acc, f) => acc + (f.size_bytes ?? 0), 0);

  // bikes is a jsonb array; defensive against null / wrong shape
  const bikesField = Array.isArray(settingsRows) && settingsRows[0] ? settingsRows[0].bikes : null;
  const bikes_count = Array.isArray(bikesField) ? bikesField.length : 0;

  return {
    bikes_count,
    rides_count: ridesCount,
    files_count: files.length,
    storage_bytes,
    last_ride_at: Array.isArray(lastRideRows) && lastRideRows[0]?.started_at ? lastRideRows[0].started_at : null,
    last_upload_at: files[0]?.created_at ?? null,
  };
}

// ─── Storage usage stats (kromi_files) ───────────────────────
export interface StorageUsageRow {
  user_id: string | null;
  email: string | null;
  files: number;
  bytes: number;
}

export interface StorageStats {
  total_files: number;
  total_bytes: number;
  by_user: StorageUsageRow[];
}

/**
 * Aggregates kromi_files per owner. Done client-side because we want
 * a single round-trip without adding a SQL view. The volume is small
 * (one row per file in admin context).
 */
export async function getStorageStats(topN = 10): Promise<StorageStats> {
  if (!SB_URL || !SB_KEY) return { total_files: 0, total_bytes: 0, by_user: [] };
  const res = await fetch(
    `${SB_URL}/rest/v1/kromi_files?select=owner_user_id,size_bytes&limit=10000`,
    { headers: headers() }
  );
  const rows = (await res.json()) as Array<{ owner_user_id: string | null; size_bytes: number | null }>;
  if (!Array.isArray(rows)) return { total_files: 0, total_bytes: 0, by_user: [] };

  const byOwner = new Map<string, { files: number; bytes: number }>();
  let total_files = 0;
  let total_bytes = 0;
  for (const r of rows) {
    total_files += 1;
    const b = r.size_bytes ?? 0;
    total_bytes += b;
    const key = r.owner_user_id ?? '__null__';
    const cur = byOwner.get(key) ?? { files: 0, bytes: 0 };
    cur.files += 1;
    cur.bytes += b;
    byOwner.set(key, cur);
  }

  // Resolve emails for the top N owners
  const sorted = Array.from(byOwner.entries())
    .filter(([id]) => id !== '__null__')
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, topN);
  const ids = sorted.map(([id]) => id);
  let users: Array<{ id: string; email: string }> = [];
  if (ids.length > 0) {
    const inList = ids.map((id) => `"${id}"`).join(',');
    const ures = await fetch(
      `${SB_URL}/rest/v1/app_users?select=id,email&id=in.(${inList})`,
      { headers: headers() }
    );
    users = (await ures.json()) as Array<{ id: string; email: string }>;
  }
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  return {
    total_files,
    total_bytes,
    by_user: sorted.map(([id, stats]) => ({
      user_id: id,
      email: emailById.get(id) ?? null,
      files: stats.files,
      bytes: stats.bytes,
    })),
  };
}
