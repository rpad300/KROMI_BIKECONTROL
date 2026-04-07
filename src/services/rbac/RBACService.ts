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
  grantedBy: string,
): Promise<void> {
  if (!SB_URL || !SB_KEY) return;
  // Replace strategy: delete all, insert new
  await fetch(`${SB_URL}/rest/v1/user_roles?user_id=eq.${userId}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (roleIds.length === 0) return;
  await fetch(`${SB_URL}/rest/v1/user_roles`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(
      roleIds.map((role_id) => ({ user_id: userId, role_id, granted_by: grantedBy })),
    ),
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
  if (!SB_URL || !SB_KEY) return;
  await fetch(`${SB_URL}/rest/v1/role_permissions?role_id=eq.${roleId}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (permKeys.length === 0) return;
  await fetch(`${SB_URL}/rest/v1/role_permissions`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(permKeys.map((permission_key) => ({ role_id: roleId, permission_key }))),
  });
}

// ─── Role CRUD (custom roles) ────────────────────────────────
export interface RoleInput {
  key: string;
  label: string;
  description?: string | null;
  sort_order?: number;
}

/** Create a new (non-system) role. The DB enforces unique `key`. */
export async function createRole(input: RoleInput): Promise<Role | null> {
  if (!SB_URL || !SB_KEY) return null;
  const res = await fetch(`${SB_URL}/rest/v1/roles`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({
      key: input.key,
      label: input.label,
      description: input.description ?? null,
      sort_order: input.sort_order ?? 100,
      is_system: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Falha ao criar role: ${text}`);
  }
  const rows = (await res.json()) as Role[];
  return rows[0] ?? null;
}

/** Update label / description / sort_order. Cannot rename `key` for safety. */
export async function updateRole(
  roleId: string,
  patch: Partial<Pick<Role, 'label' | 'description' | 'sort_order'>>,
): Promise<void> {
  if (!SB_URL || !SB_KEY) return;
  const res = await fetch(`${SB_URL}/rest/v1/roles?id=eq.${roleId}`, {
    method: 'PATCH',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Falha ao atualizar role: ${await res.text()}`);
}

/** Delete a custom role. System roles are protected by a CHECK / our pre-check. */
export async function deleteRole(roleId: string): Promise<void> {
  if (!SB_URL || !SB_KEY) return;
  // 1. Cascade delete role_permissions + user_roles first to avoid FK errors
  await fetch(`${SB_URL}/rest/v1/role_permissions?role_id=eq.${roleId}`, {
    method: 'DELETE', headers: headers(),
  });
  await fetch(`${SB_URL}/rest/v1/user_roles?role_id=eq.${roleId}`, {
    method: 'DELETE', headers: headers(),
  });
  const res = await fetch(`${SB_URL}/rest/v1/roles?id=eq.${roleId}&is_system=eq.false`, {
    method: 'DELETE', headers: headers({ Prefer: 'return=minimal' }),
  });
  if (!res.ok) throw new Error(`Falha ao apagar role: ${await res.text()}`);
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
  setBy: string,
  reason?: string,
): Promise<void> {
  if (!SB_URL || !SB_KEY) return;
  await fetch(`${SB_URL}/rest/v1/user_feature_flags`, {
    method: 'POST',
    headers: headers({
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=merge-duplicates',
    }),
    body: JSON.stringify({
      user_id: userId,
      permission_key: permissionKey,
      mode,
      set_by: setBy,
      reason: reason ?? null,
    }),
  });
}

export async function clearUserFeatureFlag(userId: string, permissionKey: string): Promise<void> {
  if (!SB_URL || !SB_KEY) return;
  await fetch(
    `${SB_URL}/rest/v1/user_feature_flags?user_id=eq.${userId}&permission_key=eq.${permissionKey}`,
    { method: 'DELETE', headers: headers() },
  );
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

export async function suspendUser(userId: string, reason: string): Promise<void> {
  if (!SB_URL || !SB_KEY) return;
  await fetch(`${SB_URL}/rest/v1/app_users?id=eq.${userId}`, {
    method: 'PATCH',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ suspended_at: new Date().toISOString(), suspended_reason: reason }),
  });
}

export async function unsuspendUser(userId: string): Promise<void> {
  if (!SB_URL || !SB_KEY) return;
  await fetch(`${SB_URL}/rest/v1/app_users?id=eq.${userId}`, {
    method: 'PATCH',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ suspended_at: null, suspended_reason: null }),
  });
}

export async function setUserSuperAdmin(userId: string, isSuper: boolean): Promise<void> {
  if (!SB_URL || !SB_KEY) return;
  await fetch(`${SB_URL}/rest/v1/app_users?id=eq.${userId}`, {
    method: 'PATCH',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ is_super_admin: isSuper }),
  });
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

/** Fetch the most recent impersonation log entries. */
export async function listImpersonationLog(limit = 50): Promise<ImpersonationLogEntry[]> {
  if (!SB_URL || !SB_KEY) return [];
  const res = await fetch(
    `${SB_URL}/rest/v1/impersonation_log?select=*&order=started_at.desc&limit=${limit}`,
    { headers: headers() }
  );
  const rows = (await res.json()) as ImpersonationLogEntry[];
  if (!Array.isArray(rows) || rows.length === 0) return [];

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

  return rows.map((r) => ({
    ...r,
    admin_email: byId.get(r.admin_user_id)?.email,
    admin_name: byId.get(r.admin_user_id)?.name ?? null,
    target_email: byId.get(r.impersonated_user_id)?.email,
    target_name: byId.get(r.impersonated_user_id)?.name ?? null,
  }));
}

// ─── Per-user enrichment stats for admin user detail ────────
export interface UserEnrichmentStats {
  rides_count: number;
  files_count: number;
  storage_bytes: number;
  last_ride_at: string | null;
  last_upload_at: string | null;
}

/**
 * Aggregates ride_sessions + kromi_files for one user.
 *
 * Note: bikes live in IndexedDB / settings (not a Postgres table), so we
 * can't count them server-side. We deliberately omit a bikes count rather
 * than show a misleading zero.
 */
export async function getUserEnrichmentStats(userId: string): Promise<UserEnrichmentStats> {
  const empty: UserEnrichmentStats = {
    rides_count: 0, files_count: 0, storage_bytes: 0,
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

  const [ridesCount, lastRideRows, filesRows] = await Promise.all([
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
  ]);

  const files = Array.isArray(filesRows) ? filesRows : [];
  const storage_bytes = files.reduce((acc, f) => acc + (f.size_bytes ?? 0), 0);

  return {
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
