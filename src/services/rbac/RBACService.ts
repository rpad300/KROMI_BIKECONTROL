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

import { supaFetch, supaGet, supaRpc, supaInvokeFunction, SupaFetchError } from '../../lib/supaFetch';

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
 * Call a Postgres RPC via supaFetch. Wraps `supaRpc` and unwraps any
 * structured error so the caller sees the same `${fn}: ${detail}` shape
 * as before.
 */
async function rpc<T = unknown>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  try {
    return await supaRpc<T>(fn, args);
  } catch (err) {
    if (err instanceof SupaFetchError) {
      let detail = err.body;
      try {
        const parsed = JSON.parse(detail);
        detail = parsed.message ?? parsed.error ?? detail;
      } catch { /* not json */ }
      throw new Error(`${fn}: ${detail}`);
    }
    throw err;
  }
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
  try {
    permissionsCache = await supaGet<Permission[]>('/rest/v1/permissions?select=*&order=category,key');
    return permissionsCache ?? [];
  } catch {
    return [];
  }
}

export async function listRoles(): Promise<Role[]> {
  if (rolesCache) return rolesCache;
  try {
    rolesCache = await supaGet<Role[]>('/rest/v1/roles?select=*&order=sort_order');
    return rolesCache ?? [];
  } catch {
    return [];
  }
}

export function clearRBACCache(): void {
  permissionsCache = null;
  rolesCache = null;
}

// ─── Effective permissions ───────────────────────────────────
export async function getEffectivePermissions(userId: string): Promise<string[]> {
  try {
    const rows = await supaGet<{ permission_key: string }[]>(
      `/rest/v1/effective_user_permissions?user_id=eq.${userId}&select=permission_key`,
    );
    return rows.map((r) => r.permission_key);
  } catch {
    return [];
  }
}

// ─── Role assignment ─────────────────────────────────────────
export async function getUserRoles(userId: string): Promise<string[]> {
  try {
    const rows = await supaGet<{ role_id: string }[]>(
      `/rest/v1/user_roles?user_id=eq.${userId}&select=role_id`,
    );
    return rows.map((r) => r.role_id);
  } catch {
    return [];
  }
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
  try {
    const rows = await supaGet<{ permission_key: string }[]>(
      `/rest/v1/role_permissions?role_id=eq.${roleId}&select=permission_key`,
    );
    return rows.map((r) => r.permission_key);
  } catch {
    return [];
  }
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
  try {
    const rows = await supaGet<Role[]>(`/rest/v1/roles?id=eq.${id}&select=*&limit=1`);
    return rows[0] ?? null;
  } catch {
    return null;
  }
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

/**
 * Delete a custom role. The RPC blocks system roles + cascades cleanly.
 * Step-up (S19): caller must type the role name as confirmation.
 */
export async function deleteRole(roleId: string, confirmationName: string): Promise<void> {
  const token = await getSessionToken();
  if (!token) throw new Error('not authenticated');
  await rpc('admin_delete_role', {
    p_session_token: token,
    p_role_id: roleId,
    p_confirmation_name: confirmationName,
  });
}

// ─── Per-user feature flags (overrides) ──────────────────────
export async function getUserFeatureFlags(userId: string): Promise<UserFeatureFlag[]> {
  try {
    return await supaGet<UserFeatureFlag[]>(
      `/rest/v1/user_feature_flags?user_id=eq.${userId}&select=*`,
    );
  } catch {
    return [];
  }
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
  try {
    return await supaGet<AdminUserRow[]>(
      '/rest/v1/app_users?select=id,email,name,is_super_admin,suspended_at,suspended_reason,created_at,last_login_at&order=created_at.desc',
    );
  } catch {
    return [];
  }
}

export async function getUserById(userId: string): Promise<AdminUserRow | null> {
  try {
    const rows = await supaGet<AdminUserRow[]>(
      `/rest/v1/app_users?id=eq.${userId}&select=id,email,name,is_super_admin,suspended_at,suspended_reason,created_at,last_login_at&limit=1`,
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

// Suspension write happens server-side via admin_set_suspended, which both
// updates app_users and inserts the user_suspensions audit row in one call.

export async function suspendUser(
  userId: string,
  reason: string,
  _performedBy?: string | null,
  expiresAt?: string | null,
): Promise<void> {
  void _performedBy;
  const token = await getSessionToken();
  if (!token) throw new Error('not authenticated');
  await rpc('admin_set_suspended', {
    p_session_token: token,
    p_target_user_id: userId,
    p_suspend: true,
    p_reason: reason,
    p_expires_at: expiresAt ?? null,
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
    p_expires_at: null,
  });
}

/**
 * Session 18 scheduled unsuspend — sweep suspensions whose
 * `expires_at` is in the past and auto-unsuspend them. The
 * AdminPanel calls this fire-and-forget on mount so the sweep
 * runs at least once per admin visit; no external cron needed.
 */
export async function expireDueSuspensions(): Promise<number> {
  const token = await getSessionToken();
  if (!token) return 0;
  try {
    return await rpc<number>('kromi_expire_due_suspensions', { p_session_token: token });
  } catch {
    return 0;
  }
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
  let rows: UserSuspensionEvent[];
  try {
    rows = await supaGet<UserSuspensionEvent[]>(
      `/rest/v1/user_suspensions?user_id=eq.${userId}&select=*&order=performed_at.desc&limit=${limit}`,
    );
  } catch {
    return [];
  }
  if (!Array.isArray(rows) || rows.length === 0) return [];

  // Resolve performer emails
  const performerIds = Array.from(
    new Set(rows.map((r) => r.performed_by).filter((id): id is string => !!id))
  );
  if (performerIds.length === 0) return rows;

  const inList = performerIds.map((id) => `"${id}"`).join(',');
  let users: Array<{ id: string; email: string }> = [];
  try {
    users = await supaGet<Array<{ id: string; email: string }>>(
      `/rest/v1/app_users?select=id,email&id=in.(${inList})`,
    );
  } catch {
    users = [];
  }
  const byId = new Map(users.map((u) => [u.id, u.email]));
  return rows.map((r) => ({
    ...r,
    performed_by_email: r.performed_by ? byId.get(r.performed_by) ?? null : null,
  }));
}

/**
 * Toggle the super-admin flag on a target user.
 * Step-up (S19): caller must type the target's email as confirmation.
 */
export async function setUserSuperAdmin(
  userId: string,
  isSuper: boolean,
  confirmationEmail: string,
): Promise<void> {
  const token = await getSessionToken();
  if (!token) throw new Error('not authenticated');
  await rpc('admin_set_super_admin', {
    p_session_token: token,
    p_target_user_id: userId,
    p_is_super: isSuper,
    p_confirmation_email: confirmationEmail,
  });
  return;
}

// ─── Impersonation log ───────────────────────────────────────
export async function logImpersonationStart(
  adminUserId: string,
  targetUserId: string,
  reason?: string,
): Promise<string | null> {
  try {
    const res = await supaFetch('/rest/v1/impersonation_log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        admin_user_id: adminUserId,
        impersonated_user_id: targetUserId,
        reason: reason ?? null,
        user_agent: navigator.userAgent,
      }),
    });
    const rows = await res.json();
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
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
  try {
    await supaInvokeFunction('notify-impersonation', {
      ...payload,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    });
  } catch {
    // Silent: missing config / network error must not block impersonation
  }
}

export async function logImpersonationEnd(logId: string): Promise<void> {
  try {
    await supaFetch(`/rest/v1/impersonation_log?id=eq.${logId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ ended_at: new Date().toISOString() }),
    });
  } catch {
    // best-effort — never block sign-out
  }
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
  const limit = pagination.limit ?? 50;
  const offset = pagination.offset ?? 0;

  const params: string[] = ['select=*', 'order=started_at.desc'];
  if (filter.admin_user_id) params.push(`admin_user_id=eq.${filter.admin_user_id}`);
  if (filter.target_user_id) params.push(`impersonated_user_id=eq.${filter.target_user_id}`);
  if (filter.since) params.push(`started_at=gte.${encodeURIComponent(filter.since)}`);
  if (filter.until) params.push(`started_at=lte.${encodeURIComponent(filter.until)}`);
  if (filter.active_only) params.push('ended_at=is.null');

  let res: Response;
  try {
    res = await supaFetch(`/rest/v1/impersonation_log?${params.join('&')}`, {
      headers: {
        Prefer: offset === 0 ? 'count=exact' : '',
        Range: `${offset}-${offset + limit - 1}`,
        'Range-Unit': 'items',
      },
    });
  } catch {
    return { rows: [], total: null, has_more: false };
  }
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
  let users: Array<{ id: string; email: string; name: string | null }> = [];
  try {
    users = await supaGet<Array<{ id: string; email: string; name: string | null }>>(
      `/rest/v1/app_users?select=id,email,name&id=in.(${inList})`,
    );
  } catch {
    users = [];
  }
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
  const countOf = async (path: string): Promise<number> => {
    try {
      const res = await supaFetch(`/rest/v1/${path}`, {
        method: 'GET',
        headers: { Prefer: 'count=exact', Range: '0-0' },
      });
      const range = res.headers.get('content-range') ?? '';
      const m = /\/(\d+|\*)$/.exec(range);
      if (!m || m[1] === '*') return 0;
      return parseInt(m[1] ?? '0', 10);
    } catch {
      return 0;
    }
  };

  const [ridesCount, lastRideRows, filesRows, settingsRows] = await Promise.all([
    countOf(`ride_sessions?user_id=eq.${userId}&select=id`),
    supaGet<Array<{ started_at: string }>>(
      `/rest/v1/ride_sessions?user_id=eq.${userId}&select=started_at&order=started_at.desc&limit=1`,
    ).catch(() => [] as Array<{ started_at: string }>),
    supaGet<Array<{ size_bytes: number | null; created_at: string }>>(
      `/rest/v1/kromi_files?owner_user_id=eq.${userId}&select=size_bytes,created_at&order=created_at.desc`,
    ).catch(() => [] as Array<{ size_bytes: number | null; created_at: string }>),
    supaGet<Array<{ bikes: unknown }>>(
      `/rest/v1/user_settings?user_id=eq.${userId}&select=bikes&limit=1`,
    ).catch(() => [] as Array<{ bikes: unknown }>),
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
  let rows: Array<{ owner_user_id: string | null; size_bytes: number | null }>;
  try {
    rows = await supaGet<Array<{ owner_user_id: string | null; size_bytes: number | null }>>(
      '/rest/v1/kromi_files?select=owner_user_id,size_bytes&limit=10000',
    );
  } catch {
    return { total_files: 0, total_bytes: 0, by_user: [] };
  }
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
    try {
      users = await supaGet<Array<{ id: string; email: string }>>(
        `/rest/v1/app_users?select=id,email&id=in.(${inList})`,
      );
    } catch {
      users = [];
    }
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
