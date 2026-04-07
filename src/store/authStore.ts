import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser } from '../services/auth/AuthService';
import { verifySession, loginByDevice } from '../services/auth/AuthService';
import {
  logImpersonationStart,
  logImpersonationEnd,
  notifyImpersonationStart,
  getUserById,
} from '../services/rbac/RBACService';

/** Detect whether this tab was opened as an impersonation session. */
function isImpersonationTab(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).has('as');
  } catch {
    return false;
  }
}

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
  /** PostgREST-compatible JWT — the Bearer credential for REST calls. */
  jwt: string | null;
  jwtExpiresAt: string | null;
  expiresAt: string | null;
  loading: boolean;

  /** The "viewer" — what the rest of the app sees as the current user. */
  user: AuthUser | null;

  setSession: (
    user: AuthUser,
    token: string,
    expiresAt: string,
    jwt?: string | null,
    jwtExpiresAt?: string | null,
  ) => void;
  logout: () => void;
  checkSession: () => Promise<boolean>;
  isLoggedIn: () => boolean;
  getUserId: () => string | null;

  /** Begin impersonation. Opens a new browser tab scoped to the target user. */
  beginImpersonation: (target: AuthUser, reason?: string) => Promise<void>;
  /**
   * Apply an impersonation intent from URL params (?as=<uuid>&log=<id>).
   * Runs in the new tab during bootstrap. Mutates state AND reloads the
   * target user's settings from the DB.
   */
  applyImpersonationFromUrl: () => Promise<boolean>;
  /** End impersonation. In an impersonation tab this closes the window. */
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

/**
 * Mirror the active JWT onto a global so buildSupaHeadersSync (used
 * by the very few call sites that can't await) can pick it up without
 * reaching back into the store. Zustand subscribers call this
 * whenever `jwt` changes.
 */
function publishJwtGlobal(jwt: string | null): void {
  if (typeof globalThis === 'undefined') return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__KROMI_AUTH_JWT__ = jwt ?? null;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      realUser: null,
      impersonatedUser: null,
      impersonationLogId: null,
      impersonationReadOnly: true,
      sessionToken: null,
      jwt: null,
      jwtExpiresAt: null,
      expiresAt: null,
      loading: true,
      user: null,

      setSession: (user, token, expiresAt, jwt, jwtExpiresAt) => {
        publishJwtGlobal(jwt ?? null);
        set({
          realUser: user,
          user,
          sessionToken: token,
          jwt: jwt ?? null,
          jwtExpiresAt: jwtExpiresAt ?? null,
          expiresAt,
          loading: false,
          impersonatedUser: null,
          impersonationLogId: null,
        });
      },

      logout: () => {
        publishJwtGlobal(null);
        set({
          realUser: null,
          impersonatedUser: null,
          impersonationLogId: null,
          user: null,
          sessionToken: null,
          jwt: null,
          jwtExpiresAt: null,
          expiresAt: null,
          loading: false,
        });
      },

      checkSession: async () => {
        const { realUser: localUser, sessionToken, expiresAt, jwt: persistedJwt } = get();

        // Re-publish the persisted JWT so supaFetch sees it BEFORE any
        // background verification runs. Without this, the first REST
        // calls after boot would go out with the anon key.
        if (persistedJwt) publishJwtGlobal(persistedJwt);

        if (!sessionToken || !expiresAt) {
          // No local session — try device auto-login (mints a fresh JWT)
          const deviceResult = await loginByDevice();
          if (deviceResult.success && deviceResult.user) {
            publishJwtGlobal(deviceResult.jwt ?? null);
            set({
              realUser: deviceResult.user,
              user: deviceResult.user,
              sessionToken: deviceResult.session_token!,
              jwt: deviceResult.jwt ?? null,
              jwtExpiresAt: deviceResult.jwt_expires_at ?? null,
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

          // Background verify — refreshes the JWT so the next REST call
          // has a full TTL window. Only logout if server explicitly rejects.
          try {
            const verified = await verifySession(sessionToken);
            if (verified) {
              publishJwtGlobal(verified.jwt);
              set((s) => ({
                realUser: verified.user,
                jwt: verified.jwt,
                jwtExpiresAt: verified.jwt_expires_at,
                user: viewerOf(verified.user, s.impersonatedUser),
              }));
            }
          } catch {
            // Network error — keep local session (offline-first)
          }
          return true;
        }

        // No local user — must verify with server
        const verified = await verifySession(sessionToken);
        if (verified) {
          publishJwtGlobal(verified.jwt);
          set({
            realUser: verified.user,
            user: verified.user,
            jwt: verified.jwt,
            jwtExpiresAt: verified.jwt_expires_at,
            loading: false,
          });
          return true;
        }

        publishJwtGlobal(null);
        set({
          realUser: null,
          impersonatedUser: null,
          user: null,
          sessionToken: null,
          jwt: null,
          jwtExpiresAt: null,
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
        // Log the audit row now (so the audit trail exists even if the
        // user closes the new tab before it finishes loading) and send
        // the alert email. Both are fire-and-forget w.r.t. UI flow.
        const logId = await logImpersonationStart(realUser.id, target.id, reason);
        void notifyImpersonationStart({
          admin_email: realUser.email,
          admin_name: realUser.name ?? null,
          target_email: target.email,
          target_name: target.name ?? null,
          reason: reason ?? null,
          log_id: logId,
        });

        // Open the impersonation session in a NEW tab. We deliberately do
        // NOT mutate the current tab's state — the admin continues to see
        // their own data, and the impersonated view is visually scoped to
        // a separate window. Closing the tab = exiting impersonation.
        const params = new URLSearchParams();
        params.set('as', target.id);
        if (logId) params.set('log', logId);
        if (reason) params.set('reason', reason);
        const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
        window.open(url, '_blank', 'noopener=no,noreferrer=no');
      },

      applyImpersonationFromUrl: async () => {
        if (typeof window === 'undefined') return false;
        const params = new URLSearchParams(window.location.search);
        const targetId = params.get('as');
        if (!targetId) return false;

        const { realUser } = get();
        if (!realUser?.is_super_admin) {
          // Non-admin landed on an impersonation URL — ignore and clean
          window.history.replaceState({}, '', window.location.pathname);
          return false;
        }
        if (targetId === realUser.id) {
          window.history.replaceState({}, '', window.location.pathname);
          return false;
        }

        const target = await getUserById(targetId);
        if (!target) {
          window.history.replaceState({}, '', window.location.pathname);
          return false;
        }

        const authTarget: AuthUser = {
          id: target.id,
          email: target.email,
          name: target.name ?? null,
          is_super_admin: target.is_super_admin ?? false,
        };
        set({
          impersonatedUser: authTarget,
          impersonationLogId: params.get('log'),
          impersonationReadOnly: true,
          user: authTarget,
        });

        // Clean the URL so a refresh doesn't re-trigger the apply logic
        // against stale state. The sessionStorage-backed settingsStore
        // will persist the target data across refreshes within this tab.
        window.history.replaceState({}, '', window.location.pathname);
        return true;
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
        // If this tab was opened as an impersonation window, close it.
        // Otherwise (legacy same-tab path) fall back to restoring realUser.
        if (isImpersonationTab() && typeof window !== 'undefined') {
          try {
            window.close();
          } catch {
            // window.close() may silently fail if the tab wasn't script-opened
          }
          return;
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
        jwt: state.jwt,
        jwtExpiresAt: state.jwtExpiresAt,
        expiresAt: state.expiresAt,
      }),
      onRehydrateStorage: () => (state) => {
        // Mirror JWT to the global immediately after rehydrate so the
        // very first fetch after page load uses the stored credential.
        if (state?.jwt) publishJwtGlobal(state.jwt);
      },
    }
  )
);
