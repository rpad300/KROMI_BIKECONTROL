import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser } from '../services/auth/AuthService';
import { verifySession, loginByDevice } from '../services/auth/AuthService';

interface AuthState {
  user: AuthUser | null;
  sessionToken: string | null;
  expiresAt: string | null;
  loading: boolean;

  setSession: (user: AuthUser, token: string, expiresAt: string) => void;
  logout: () => void;
  checkSession: () => Promise<boolean>;
  isLoggedIn: () => boolean;
  getUserId: () => string | null;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      sessionToken: null,
      expiresAt: null,
      loading: true,

      setSession: (user, token, expiresAt) =>
        set({ user, sessionToken: token, expiresAt, loading: false }),

      logout: () =>
        set({ user: null, sessionToken: null, expiresAt: null, loading: false }),

      checkSession: async () => {
        const { user: localUser, sessionToken, expiresAt } = get();

        if (!sessionToken || !expiresAt) {
          // No local session — try device auto-login
          const deviceResult = await loginByDevice();
          if (deviceResult.success && deviceResult.user) {
            set({
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
        // (don't block on server verification — user gets in fast)
        if (localUser) {
          set({ loading: false });

          // Background verify — only logout if server explicitly rejects
          // (network errors or offline = keep local session)
          try {
            const serverUser = await verifySession(sessionToken);
            if (serverUser) {
              set({ user: serverUser }); // refresh user data
            }
            // If serverUser is null but we have localUser, keep local
            // (token might be expired but we still want offline access)
          } catch {
            // Network error — keep local session (offline-first)
          }
          return true;
        }

        // No local user — must verify with server
        const user = await verifySession(sessionToken);
        if (user) {
          set({ user, loading: false });
          return true;
        }

        set({ user: null, sessionToken: null, expiresAt: null, loading: false });
        return false;
      },

      isLoggedIn: () => {
        const { user, sessionToken } = get();
        return !!user && !!sessionToken;
      },

      getUserId: () => get().user?.id ?? null,
    }),
    {
      name: 'bikecontrol-auth',
    }
  )
);
