// ═══════════════════════════════════════════════════════════
// permissionStore — effective permissions for the current viewer
// ═══════════════════════════════════════════════════════════
//
// "Viewer" = the user whose permissions are currently in effect.
// In normal operation this is the logged-in user. During admin
// impersonation, the viewer is the impersonated user (so the UI
// renders as that user would see it). Super admin always sees the
// admin panel regardless of impersonation.

import { create } from 'zustand';
import { getEffectivePermissions } from '../services/rbac/RBACService';

interface PermissionState {
  /** User whose permissions are loaded. */
  loadedFor: string | null;
  /** Effective permission keys for the loaded user. */
  permissions: Set<string>;
  loading: boolean;
  error: string | null;

  /** Load permissions for a user. Idempotent — re-running for the same user is a no-op. */
  loadFor: (userId: string) => Promise<void>;
  /** Force re-fetch (after role/flag changes by admin). */
  refresh: () => Promise<void>;
  /** Synchronous check. */
  has: (key: string) => boolean;
  /** Reset on logout. */
  clear: () => void;
}

export const usePermissionStore = create<PermissionState>()((set, get) => ({
  loadedFor: null,
  permissions: new Set(),
  loading: false,
  error: null,

  loadFor: async (userId: string) => {
    if (get().loadedFor === userId && get().permissions.size > 0) return;
    set({ loading: true, error: null });
    try {
      const keys = await getEffectivePermissions(userId);
      set({ loadedFor: userId, permissions: new Set(keys), loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  refresh: async () => {
    const userId = get().loadedFor;
    if (!userId) return;
    set({ loading: true, error: null });
    try {
      const keys = await getEffectivePermissions(userId);
      set({ permissions: new Set(keys), loading: false });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  has: (key: string) => get().permissions.has(key),

  clear: () => set({ loadedFor: null, permissions: new Set(), error: null }),
}));
