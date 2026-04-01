/**
 * LoginTracker — records every login with full device details.
 * Called after successful authentication.
 */

import { useAuthStore } from '../../store/authStore';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function parseUserAgent(ua: string): { browser: string; os: string; deviceType: string } {
  let browser = 'unknown';
  let os = 'unknown';
  let deviceType = 'unknown';

  // Browser
  if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  else if (ua.includes('Edg')) browser = 'Edge';

  // OS
  if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';

  // Device type
  if (/android|iphone|mobile/i.test(ua)) deviceType = 'mobile';
  else if (/ipad|tablet/i.test(ua)) deviceType = 'tablet';
  else deviceType = 'desktop';

  return { browser, os, deviceType };
}

export async function trackLogin(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;

  try {
    const ua = navigator.userAgent;
    const { browser, os, deviceType } = parseUserAgent(ua);
    const platform = /android|iphone|mobile/i.test(ua) ? 'mobile' : 'desktop';

    await fetch(`${SUPABASE_URL}/rest/v1/login_history`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        user_id: userId,
        platform,
        user_agent: ua,
        screen_width: window.screen.width,
        screen_height: window.screen.height,
        language: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        device_type: deviceType,
        browser,
        os,
      }),
    });

    console.log('[Login] Tracked:', { platform, browser, os, deviceType });
  } catch (err) {
    console.warn('[Login] Track failed:', err);
  }
}
