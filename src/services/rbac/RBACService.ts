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

export async function logImpersonationEnd(logId: string): Promise<void> {
  if (!SB_URL || !SB_KEY) return;
  await fetch(`${SB_URL}/rest/v1/impersonation_log?id=eq.${logId}`, {
    method: 'PATCH',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ ended_at: new Date().toISOString() }),
  });
}
