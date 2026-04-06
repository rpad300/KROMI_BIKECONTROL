// ═══════════════════════════════════════════════════════════
// usePermission — RBAC integration for components
// ═══════════════════════════════════════════════════════════

import { useEffect } from 'react';
import { usePermissionStore } from '../store/permissionStore';
import { useAuthStore } from '../store/authStore';

/**
 * Returns true if the current viewer has the given permission key.
 * Super admins implicitly have ALL permissions (short-circuit).
 *
 * Usage:
 *   const canManageShop = usePermission('features.shop_management');
 *   if (!canManageShop) return null;
 */
export function usePermission(key: string): boolean {
  const user = useAuthStore((s) => s.user);
  const has = usePermissionStore((s) => s.has);
  const loadedFor = usePermissionStore((s) => s.loadedFor);
  const loadFor = usePermissionStore((s) => s.loadFor);

  // Lazy load on first call (idempotent)
  useEffect(() => {
    if (user && loadedFor !== user.id) {
      void loadFor(user.id);
    }
  }, [user, loadedFor, loadFor]);

  if (!user) return false;
  if (user.is_super_admin) return true;
  return has(key);
}

/** Returns true if the current user is a super admin. */
export function useIsSuperAdmin(): boolean {
  return useAuthStore((s) => !!s.user?.is_super_admin);
}

/**
 * Hook variant that takes multiple keys and returns a record of
 * key → bool. Useful when checking many permissions in one component.
 */
export function usePermissions<K extends string>(keys: K[]): Record<K, boolean> {
  const user = useAuthStore((s) => s.user);
  const has = usePermissionStore((s) => s.has);
  const loadedFor = usePermissionStore((s) => s.loadedFor);
  const loadFor = usePermissionStore((s) => s.loadFor);

  useEffect(() => {
    if (user && loadedFor !== user.id) void loadFor(user.id);
  }, [user, loadedFor, loadFor]);

  const result = {} as Record<K, boolean>;
  const isSuper = !!user?.is_super_admin;
  for (const key of keys) {
    result[key] = isSuper || has(key);
  }
  return result;
}
