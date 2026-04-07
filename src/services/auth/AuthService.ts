import { supaInvokeFunction } from '../../lib/supaFetch';

/** Get or create a persistent device ID (survives cache clears via localStorage) */
export function getDeviceId(): string {
  const key = 'bikecontrol-device-id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  is_super_admin?: boolean;
}

export interface LoginResult {
  success: boolean;
  user?: AuthUser;
  /** Opaque session token (kept for admin RPCs that call resolve_session_user_id). */
  session_token?: string;
  /** PostgREST-compatible JWT — the primary auth credential for all REST calls. */
  jwt?: string;
  jwt_expires_at?: string;
  expires_at?: string;
  error?: string;
}

/** Send OTP code to email */
export async function sendOTP(email: string): Promise<{ success: boolean; error?: string }> {
  try {
    const data = await supaInvokeFunction<{ success?: boolean; error?: string }>(
      'send-otp',
      { email },
      { anonOnly: true },
    );
    if (!data?.success) return { success: false, error: data?.error ?? 'unknown' };
    return { success: true };
  } catch (err) {
    // SupaFetchError carries the parsed error body
    const msg = err instanceof Error ? err.message : 'Falha na ligacao';
    return { success: false, error: msg };
  }
}

/** Verify OTP code and get session + JWT */
export async function verifyOTP(email: string, code: string): Promise<LoginResult> {
  try {
    const data = await supaInvokeFunction<{
      success?: boolean;
      user?: AuthUser;
      session_token?: string;
      jwt?: string;
      jwt_expires_at?: string;
      expires_at?: string;
      error?: string;
    }>('verify-otp', { email, code }, { anonOnly: true });

    if (!data?.success) return { success: false, error: data?.error ?? 'invalid' };

    return {
      success: true,
      user: data.user,
      session_token: data.session_token,
      jwt: data.jwt,
      jwt_expires_at: data.jwt_expires_at,
      expires_at: data.expires_at,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Falha na ligacao';
    return { success: false, error: msg };
  }
}

/**
 * Try auto-login via device ID. Before Session 18 this used to read
 * the `device_tokens` table directly via REST with the anon key; now
 * that the table is RLS-locked, we go through the dedicated
 * `login-by-device` edge function which validates the device and
 * mints a fresh JWT.
 */
export async function loginByDevice(): Promise<LoginResult> {
  const deviceId = getDeviceId();
  try {
    const data = await supaInvokeFunction<{
      success?: boolean;
      user?: AuthUser;
      session_token?: string;
      jwt?: string;
      jwt_expires_at?: string;
      expires_at?: string;
      error?: string;
    }>('login-by-device', { device_id: deviceId }, { anonOnly: true });

    if (!data?.success || !data.user) {
      return { success: false, error: data?.error ?? 'Device nao registado' };
    }

    return {
      success: true,
      user: data.user,
      session_token: data.session_token,
      jwt: data.jwt,
      jwt_expires_at: data.jwt_expires_at,
      expires_at: data.expires_at ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { success: false, error: msg };
  }
}

/**
 * Register the current device after a successful OTP login. This is
 * the ONLY place device_tokens is written to from the client, and it
 * needs a valid JWT so RLS on device_tokens can check `user_id =
 * auth.uid()`. The caller must pass a fresh jwt (e.g. from the
 * verify-otp result) because authStore may not yet be updated when
 * this runs.
 */
export async function registerDevice(user: AuthUser, jwt: string): Promise<void> {
  const deviceId = getDeviceId();
  const SB_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!SB_URL || !SB_KEY) return;
  try {
    await fetch(`${SB_URL}/rest/v1/device_tokens`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal,resolution=merge-duplicates',
      },
      body: JSON.stringify({
        device_id: deviceId,
        user_id: user.id,
        user_email: user.email,
        user_name: user.name,
      }),
    });
    console.log('[Auth] Device registered:', deviceId.slice(0, 8));
  } catch (err) {
    console.warn('[Auth] Device register failed:', err);
  }
}

/** Verify current session is still valid. Returns a fresh JWT if so. */
export async function verifySession(token: string): Promise<{
  user: AuthUser;
  jwt: string;
  jwt_expires_at: string;
} | null> {
  const SB_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!SB_URL) return null;
  try {
    // verify-session reads the opaque session_token from the
    // Authorization header (NOT the JWT — on boot we may still only
    // have the opaque token from a pre-JWT persisted session).
    const res = await fetch(`${SB_URL}/functions/v1/verify-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: SB_KEY ?? '',
      },
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (!data.user || !data.jwt) return null;
    return {
      user: data.user,
      jwt: data.jwt,
      jwt_expires_at: data.jwt_expires_at,
    };
  } catch {
    return null;
  }
}
