const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function getBaseUrl(): string {
  return SUPABASE_URL ?? '';
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
