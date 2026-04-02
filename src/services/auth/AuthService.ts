const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function getBaseUrl(): string {
  return SUPABASE_URL ?? '';
}

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
}

export interface LoginResult {
  success: boolean;
  user?: AuthUser;
  session_token?: string;
  expires_at?: string;
  error?: string;
}

/** Send OTP code to email */
export async function sendOTP(email: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl()}/functions/v1/send-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY ?? '',
      },
      body: JSON.stringify({ email }),
    });

    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error };
    return { success: true };
  } catch (err) {
    return { success: false, error: 'Falha na ligacao' };
  }
}

/** Verify OTP code and get session */
export async function verifyOTP(email: string, code: string): Promise<LoginResult> {
  try {
    const res = await fetch(`${getBaseUrl()}/functions/v1/verify-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY ?? '',
      },
      body: JSON.stringify({ email, code }),
    });

    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error };

    return {
      success: true,
      user: data.user,
      session_token: data.session_token,
      expires_at: data.expires_at,
    };
  } catch (err) {
    return { success: false, error: 'Falha na ligacao' };
  }
}

/** Try auto-login via device ID (no OTP needed after first login) */
export async function loginByDevice(): Promise<LoginResult> {
  const deviceId = getDeviceId();
  try {
    const res = await fetch(
      `${getBaseUrl()}/rest/v1/device_tokens?device_id=eq.${deviceId}&select=user_id,user_email,user_name&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY ?? '' } }
    );
    if (!res.ok) return { success: false, error: 'Device lookup failed' };
    const rows = await res.json();
    if (rows.length === 0) return { success: false, error: 'Device not registered' };

    const row = rows[0];
    // Update last_seen
    fetch(`${getBaseUrl()}/rest/v1/device_tokens?device_id=eq.${deviceId}`, {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_KEY ?? '', 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
    }).catch(() => {});

    return {
      success: true,
      user: { id: row.user_id, email: row.user_email ?? '', name: row.user_name },
      session_token: `device:${deviceId}`,
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
    };
  } catch {
    return { success: false, error: 'Network error' };
  }
}

/** Register device after successful OTP login */
export async function registerDevice(user: AuthUser): Promise<void> {
  const deviceId = getDeviceId();
  try {
    await fetch(`${getBaseUrl()}/rest/v1/device_tokens`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY ?? '',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal,resolution=merge-duplicates',
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

/** Verify current session is still valid */
export async function verifySession(token: string): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${getBaseUrl()}/functions/v1/verify-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_KEY ?? '',
      },
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.user ?? null;
  } catch {
    return null;
  }
}
