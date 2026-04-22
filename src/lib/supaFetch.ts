// ═══════════════════════════════════════════════════════════════
// supaFetch — centralised REST/RPC client for Supabase PostgREST
// ═══════════════════════════════════════════════════════════════
//
// The rest of the KROMI codebase USED TO build fetch calls by hand,
// each one with its own copy of `apikey` + `Authorization: Bearer
// <anon_key>`. That was fine while RLS was effectively cosmetic
// (every policy was `qual = true`), but it is the very thing that
// blocked the Session 18 RLS lockdown: PostgREST saw every request
// as role=anon with no way to identify the caller.
//
// Session 18 introduces a custom KROMI JWT (HS256, minted by the
// verify-otp / verify-session / login-by-device edge functions,
// signed with the project JWT secret so PostgREST verifies it
// natively). This helper is the single place that:
//
//   1. Resolves the current JWT from authStore at call time
//   2. Injects `Authorization: Bearer <jwt>` on every request
//   3. Falls back to the anon key when there is no logged-in
//      session (public endpoints, bootstrap, etc.)
//   4. Provides a consistent error surface so callers don't have
//      to remember to parse error bodies
//
// The functions here intentionally do NOT know anything about
// types or tables — callers bring their own typing. The goal is
// to be a drop-in replacement for the previous bespoke fetch
// calls, not to reimplement supabase-js.
// ═══════════════════════════════════════════════════════════════

const SB_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SB_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Returns the best available bearer token for the current session.
 * Prefers the freshly minted KROMI JWT; falls back to the anon key
 * when the user is logged out or the JWT is missing (e.g. old
 * persisted session from before Session 18).
 *
 * Uses a dynamic import to avoid an import cycle with authStore,
 * which itself imports from auth services that use supaFetch.
 */
async function resolveBearerToken(): Promise<string> {
  try {
    const mod = await import('../store/authStore');
    const state = mod.useAuthStore.getState();

    // Check if JWT is about to expire (within 2 minutes) — proactive refresh
    if (state.jwt && state.jwtExpiresAt) {
      const expiresAt = new Date(state.jwtExpiresAt).getTime();
      const twoMinFromNow = Date.now() + 2 * 60 * 1000;
      if (expiresAt < twoMinFromNow && state.sessionToken) {
        // JWT expired or about to — try to refresh in background
        refreshJwtIfNeeded(state.sessionToken).catch(() => {});
      }
    }

    if (state.jwt) return state.jwt;
  } catch {
    // authStore unavailable during very early bootstrap — fall through
  }
  return SB_ANON_KEY ?? '';
}

/** Mutex to prevent multiple simultaneous refresh attempts */
let _refreshing: Promise<string | null> | null = null;

/**
 * Refresh the JWT by calling verifySession. Returns the new JWT or null.
 * Uses a mutex so concurrent callers share the same refresh request.
 */
async function refreshJwtIfNeeded(sessionToken: string): Promise<string | null> {
  if (_refreshing) return _refreshing;

  _refreshing = (async () => {
    try {
      const { verifySession } = await import('../services/auth/AuthService');
      const result = await verifySession(sessionToken);
      if (result?.jwt) {
        const { useAuthStore } = await import('../store/authStore');
        // Update both the store and the global JWT reference
        useAuthStore.setState({
          jwt: result.jwt,
          jwtExpiresAt: result.jwt_expires_at,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).__KROMI_AUTH_JWT__ = result.jwt;
        console.info('[supaFetch] JWT refreshed');
        return result.jwt;
      }
      return null;
    } catch {
      return null;
    } finally {
      _refreshing = null;
    }
  })();

  return _refreshing;
}

/**
 * Build the standard header bag for PostgREST calls. The `apikey`
 * header is ALWAYS the anon key (required by Supabase's API gateway
 * even when the JWT is set — they serve different purposes: apikey
 * identifies the project, Authorization identifies the user).
 */
export async function buildSupaHeaders(
  extra: Record<string, string> = {},
): Promise<HeadersInit> {
  const bearer = await resolveBearerToken();
  return {
    apikey: SB_ANON_KEY ?? '',
    Authorization: `Bearer ${bearer}`,
    ...extra,
  };
}

/**
 * Synchronous variant used only where the call site cannot `await`
 * the headers (very rare — prefer the async form). Reads the JWT
 * from the authStore module if it has already been imported.
 */
export function buildSupaHeadersSync(
  extra: Record<string, string> = {},
): HeadersInit {
  let bearer: string = SB_ANON_KEY ?? '';
  try {
    // Static imports at the top would create a cycle — the auth
    // store transitively pulls RBACService which now uses supaFetch.
    // Instead we read via the global singleton that Zustand writes
    // to when the store is created.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = (globalThis as any).__KROMI_AUTH_JWT__;
    if (typeof w === 'string' && w.length > 0) bearer = w;
  } catch {
    // ignore
  }
  return {
    apikey: SB_ANON_KEY ?? '',
    Authorization: `Bearer ${bearer}`,
    ...extra,
  };
}

/**
 * Error thrown by supaFetch / supaRpc when the server returns a
 * non-2xx response. The `status` field lets callers distinguish
 * 401/403 (auth) from 4xx (client) from 5xx (server).
 */
export class SupaFetchError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, url: string) {
    super(`supaFetch ${status} @ ${url}: ${body.slice(0, 200)}`);
    this.name = 'SupaFetchError';
    this.status = status;
    this.body = body;
  }
}

export interface SupaFetchInit extends Omit<RequestInit, 'headers'> {
  /** Extra headers merged on top of the default auth headers. */
  headers?: Record<string, string>;
  /**
   * Skip authentication entirely and use only the anon key. Useful
   * for the auth edge functions themselves (send-otp, verify-otp)
   * which shouldn't require a JWT.
   */
  anonOnly?: boolean;
}

/**
 * Low-level fetch wrapper for PostgREST and edge function calls.
 * Accepts either a full URL or a path-relative string that will be
 * appended to VITE_SUPABASE_URL.
 *
 * Throws `SupaFetchError` on non-2xx responses. Returns the raw
 * `Response` so callers can pick between `.json()`, `.text()`, or
 * the response headers (needed for content-range pagination).
 */
export async function supaFetch(
  pathOrUrl: string,
  init: SupaFetchInit = {},
): Promise<Response> {
  if (!SB_URL) throw new Error('VITE_SUPABASE_URL not configured');
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${SB_URL}${pathOrUrl}`;

  const baseHeaders: HeadersInit = init.anonOnly
    ? {
        apikey: SB_ANON_KEY ?? '',
        Authorization: `Bearer ${SB_ANON_KEY ?? ''}`,
      }
    : await buildSupaHeaders();

  const headers: Record<string, string> = {
    ...(baseHeaders as Record<string, string>),
    ...(init.headers ?? {}),
  };

  let res = await fetch(url, { ...init, headers });

  // Auto-refresh on JWT expired — retry once with fresh token
  if (res.status === 401 && !init.anonOnly) {
    const body401 = await res.text().catch(() => '');
    if (body401.includes('JWT expired') || body401.includes('PGRST303')) {
      try {
        const mod = await import('../store/authStore');
        const token = mod.useAuthStore.getState().sessionToken;
        if (token) {
          const newJwt = await refreshJwtIfNeeded(token);
          if (newJwt) {
            // Retry with fresh JWT
            headers.Authorization = `Bearer ${newJwt}`;
            res = await fetch(url, { ...init, headers });
          }
        }
      } catch {
        // Refresh failed — throw original 401
      }
    }
    if (!res.ok) {
      const body = res.status === 401 ? body401 : await res.text().catch(() => '');
      throw new SupaFetchError(res.status, body, url);
    }
    return res;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new SupaFetchError(res.status, body, url);
  }
  return res;
}

/** Shortcut for GET + .json() */
export async function supaGet<T = unknown>(
  path: string,
  init: SupaFetchInit = {},
): Promise<T> {
  const res = await supaFetch(path, { ...init, method: 'GET' });
  return res.json() as Promise<T>;
}

/**
 * PostgREST RPC call. Serialises args as JSON body and returns the
 * parsed result. Empty responses are returned as `null`.
 */
export async function supaRpc<T = unknown>(
  fn: string,
  args: Record<string, unknown> = {},
  init: SupaFetchInit = {},
): Promise<T> {
  const res = await supaFetch(`/rest/v1/rpc/${fn}`, {
    ...init,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/**
 * Invoke an edge function (`/functions/v1/<name>`). Same auth rules
 * as supaFetch — the JWT is injected unless `anonOnly` is set.
 */
export async function supaInvokeFunction<T = unknown>(
  name: string,
  body: unknown,
  init: SupaFetchInit = {},
): Promise<T> {
  const res = await supaFetch(`/functions/v1/${name}`, {
    ...init,
    method: init.method ?? 'POST',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export const SUPABASE_URL = SB_URL ?? '';
export const SUPABASE_ANON_KEY = SB_ANON_KEY ?? '';
