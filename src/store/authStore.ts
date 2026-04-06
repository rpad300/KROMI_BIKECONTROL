import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser } from '../services/auth/AuthService';
import { verifySession, loginByDevice } from '../services/auth/AuthService';
import {
  logImpersonationStart,
  logImpersonationEnd,
} from '../services/rbac/RBACService';

interface AuthState {
  /** The actual logged-in user (the admin during impersonation). */
  realUser: AuthUser | null;
  /** When impersonating, this is the target user. Null otherwise. */
  impersonatedUser: AuthUser | null;
  /** Active impersonation log row id (for logging end). */
  impersonationLogId: string | null;
  /** When impersonating, the UI is locked to read-only mode. */
  impersonationReadOnly: boolean;

  sessionToken: string | null;
  expiresAt: string | null;
  loading: boolean;

  /** The "viewer" — what the rest of the app sees as the current user. */
  user: AuthUser | null;

  setSession: (user: AuthUser, token: string, expiresAt: string) => void;
  logout: () => void;
  checkSession: () => Promise<boolean>;
  isLoggedIn: () => boolean;
  getUserId: () => string | null;

  /** Begin impersonation. Only super admins can call this. */
  beginImpersonation: (target: AuthUser, reason?: string) => Promise<void>;
  /** End impersonation and restore the real admin user. */
  endImpersonation: () => Promise<void>;
  /** True if currently impersonating someone. */
  isImpersonating: () => boolean;
}

/**
 * Recompute the "viewer" — the user the app should treat as current.
 * During impersonation this is the target; otherwise it's the realUser.
 */
function viewerOf(real: AuthUser | null, imp: AuthUser | null): AuthUser | null {
  return imp ?? real;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      realUser: null,
      impersonatedUser: null,
      impersonationLogId: null,
      impersonationReadOnly: true,
      sessionToken: null,
      expiresAt: null,
      loading: true,
      user: null,

      setSession: (user, token, expiresAt) =>
        set({
          realUser: user,
          user,
          sessionToken: token,
          expiresAt,
          loading: false,
          impersonatedUser: null,
          impersonationLogId: null,
        }),

      logout: () =>
        set({
          realUser: null,
          impersonatedUser: null,
          impersonationLogId: null,
          user: null,
          sessionToken: null,
          expiresAt: null,
          loading: false,
        }),

      checkSession: async () => {
        const { realUser: localUser, sessionToken, expiresAt } = get();

        if (!sessionToken || !expiresAt) {
          // No local session — try device auto-login
          const deviceResult = await loginByDevice();
          if (deviceResult.success && deviceResult.user) {
            set({
              realUser: deviceResult.user,
              user: deviceResult.user,
              sessionToken: deviceResult.session_token!,
              expiresAt: deviceResult.expires_at!,
              loading: false,
            });
            return true;
          }
          set({ loading: false });
          return false;
        }

        // If we have a local user from persist, trust it immediately
        if (localUser) {
          // Restore viewer (consider any persisted impersonation)
          set((s) => ({ user: viewerOf(localUser, s.impersonatedUser), loading: false }));

          // Background verify — only logout if server explicitly rejects
          try {
            const serverUser = await verifySession(sessionToken);
            if (serverUser) {
              set((s) => ({
                realUser: serverUser,
                user: viewerOf(serverUser, s.impersonatedUser),
              }));
            }
          } catch {
            // Network error — keep local session (offline-first)
          }
          return true;
        }

        // No local user — must verify with server
        const user = await verifySession(sessionToken);
        if (user) {
          set({ realUser: user, user, loading: false });
          return true;
        }

        set({
          realUser: null,
          impersonatedUser: null,
          user: null,
          sessionToken: null,
          expiresAt: null,
          loading: false,
        });
        return false;
      },

      isLoggedIn: () => {
        const { realUser, sessionToken } = get();
        return !!realUser && !!sessionToken;
      },

      getUserId: () => get().user?.id ?? null,

      beginImpersonation: async (target, reason) => {
        const { realUser } = get();
        if (!realUser?.is_super_admin) {
          throw new Error('Only super admins can impersonate');
        }
        if (target.id === realUser.id) {
          throw new Error('Cannot impersonate yourself');
        }
        const logId = await logImpersonationStart(realUser.id, target.id, reason);
        set({
          impersonatedUser: target,
          impersonationLogId: logId,
          impersonationReadOnly: true,
          user: target,
        });
      },

      endImpersonation: async () => {
        const { impersonationLogId, realUser } = get();
        if (impersonationLogId) {
          try {
            await logImpersonationEnd(impersonationLogId);
          } catch {
            // best effort
          }
        }
        set({
          impersonatedUser: null,
          impersonationLogId: null,
          user: realUser,
        });
      },

      isImpersonating: () => !!get().impersonatedUser,
    }),
    {
      name: 'bikecontrol-auth',
      // Don't persist impersonation state — re-login starts fresh
      partialize: (state) => ({
        realUser: state.realUser,
        sessionToken: state.sessionToken,
        expiresAt: state.expiresAt,
      }),
    }
  )
);
