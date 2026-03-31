import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser } from '../services/auth/AuthService';
import { verifySession } from '../services/auth/AuthService';

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
        const { sessionToken, expiresAt } = get();

        if (!sessionToken || !expiresAt) {
          set({ loading: false });
          return false;
        }

        // Check if expired locally first
        if (new Date(expiresAt) < new Date()) {
          set({ user: null, sessionToken: null, expiresAt: null, loading: false });
          return false;
        }

        // Verify with server
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
