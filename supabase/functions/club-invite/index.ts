// ═══════════════════════════════════════════════════════════
// club-invite — Club email invite + code validation
// ═══════════════════════════════════════════════════════════
// Actions:
//   send_invite    → build invite link + send email via Resend
//   validate_code  → look up code in club_invites, return status
//
// Required env:
//   SUPABASE_URL              — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected
//   RESEND_API_KEY            — optional; email skipped if absent
// ═══════════════════════════════════════════════════════════

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { checkRateLimit, clientIdentifier } from '../_shared/rateLimit.ts';

// ─── Config ──────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const FROM_ADDRESS = 'KROMI <noreply@kromi.online>';
const APP_BASE_URL = 'https://www.kromi.online';

// ─── CORS ────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-kromi-session, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// ─── Auth: validate KROMI session ────────────────────────────
async function authenticate(req: Request): Promise<{ user_id: string } | null> {
  const sessionToken = req.headers.get('x-kromi-session');
  if (!sessionToken) return null;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  if (sessionToken.startsWith('device:')) {
    const deviceId = sessionToken.slice(7);
    const { data } = await sb
      .from('device_tokens')
      .select('user_id')
      .eq('device_id', deviceId)
      .maybeSingle();
    return data ? { user_id: data.user_id as string } : null;
  }

  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionToken));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const { data } = await sb
    .from('user_sessions')
    .select('user_id, expires_at')
    .eq('token_hash', hex)
    .maybeSingle();
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  return { user_id: data.user_id as string };
}

// ─── Email template ──────────────────────────────────────────
function buildInviteEmail(clubName: string, inviteLink: string, inviteCode: string): string {
  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Convite para ${clubName} — KROMI BikeControl</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0f;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="padding-bottom:32px;text-align:center;">
              <span style="font-size:28px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">
                K<span style="color:#22d3ee;">ROMI</span>
              </span>
              <span style="font-size:13px;color:#6b7280;margin-left:8px;vertical-align:middle;">BikeControl</span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:#111827;border:1px solid #1f2937;border-radius:16px;padding:40px 36px;">

              <!-- Invite icon -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding-bottom:24px;">
                    <div style="display:inline-block;background:linear-gradient(135deg,#0891b2,#0e7490);border-radius:50%;width:64px;height:64px;line-height:64px;text-align:center;font-size:28px;">
                      🚵
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Heading -->
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f9fafb;text-align:center;line-height:1.3;">
                Foste convidado para
              </h1>
              <h2 style="margin:0 0 24px;font-size:26px;font-weight:800;color:#22d3ee;text-align:center;line-height:1.2;">
                ${clubName}
              </h2>

              <p style="margin:0 0 32px;font-size:15px;color:#9ca3af;text-align:center;line-height:1.6;">
                Junta-te ao clube no KROMI BikeControl e partilha rotas,<br/>pedaladas e conquistas com a tua equipa.
              </p>

              <!-- CTA button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding-bottom:28px;">
                    <a href="${inviteLink}"
                       style="display:inline-block;background:linear-gradient(135deg,#0891b2,#0e7490);color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:16px 40px;border-radius:12px;letter-spacing:0.3px;">
                      Entrar no Clube
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #1f2937;margin:0 0 24px;" />

              <!-- Code fallback -->
              <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-align:center;">
                Ou usa o código de convite manualmente:
              </p>
              <p style="margin:0 0 28px;font-size:20px;font-weight:700;color:#f9fafb;text-align:center;letter-spacing:4px;font-family:monospace;">
                ${inviteCode.toUpperCase()}
              </p>

              <!-- Link fallback -->
              <p style="margin:0;font-size:12px;color:#4b5563;text-align:center;word-break:break-all;">
                Link directo: <a href="${inviteLink}" style="color:#22d3ee;text-decoration:none;">${inviteLink}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#374151;">
                Este convite expira em 7 dias. Se não esperavas este email, podes ignorá-lo.
              </p>
              <p style="margin:8px 0 0;font-size:11px;color:#1f2937;">
                KROMI BikeControl © ${new Date().getFullYear()}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Action: send_invite ─────────────────────────────────────
interface SendInviteParams {
  club_id: string;
  invite_code: string;
  email: string;
  club_name: string;
  club_slug: string;
}

async function handleSendInvite(params: SendInviteParams) {
  const { club_id, invite_code, email, club_name, club_slug } = params;

  if (!club_id || !invite_code || !email || !club_name || !club_slug) {
    return json({ error: 'missing_params', required: ['club_id', 'invite_code', 'email', 'club_name', 'club_slug'] }, 400);
  }

  if (!email.includes('@')) {
    return json({ error: 'invalid_email' }, 400);
  }

  const link = `${APP_BASE_URL}/club.html?s=${encodeURIComponent(club_slug)}&invite=${encodeURIComponent(invite_code)}`;

  // Send via Resend if key is configured
  let email_sent = false;
  let email_error: string | null = null;

  if (RESEND_API_KEY) {
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          to: [email],
          subject: `Convite para ${club_name} — KROMI BikeControl`,
          html: buildInviteEmail(club_name, link, invite_code),
        }),
      });

      if (res.ok) {
        email_sent = true;
      } else {
        const errText = await res.text();
        email_error = `Resend ${res.status}: ${errText}`;
        console.error('[club-invite] Resend error:', email_error);
      }
    } catch (err) {
      email_error = (err as Error).message;
      console.error('[club-invite] Resend fetch failed:', email_error);
    }
  } else {
    // No Resend key — link-only mode (useful in staging)
    email_error = 'RESEND_API_KEY not configured';
  }

  return json({
    ok: true,
    link,
    email_sent,
    email_error,
  });
}

// ─── Action: validate_code ───────────────────────────────────
interface ValidateCodeParams {
  code: string;
}

async function handleValidateCode(params: ValidateCodeParams) {
  const { code } = params;

  if (!code) {
    return json({ error: 'missing_params', required: ['code'] }, 400);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data, error } = await sb
    .from('club_invites')
    .select(`
      id,
      club_id,
      code,
      email,
      max_uses,
      used_count,
      expires_at,
      created_at,
      clubs (
        id,
        name,
        slug,
        visibility,
        avatar_url,
        member_count
      )
    `)
    .eq('code', code.toLowerCase())
    .maybeSingle();

  if (error) {
    console.error('[club-invite] validate_code query error:', error);
    return json({ error: 'db_error', detail: error.message }, 500);
  }

  if (!data) {
    return json({ valid: false, expired: false, exhausted: false, error: 'not_found' });
  }

  const now = new Date();
  const expired = new Date(data.expires_at) < now;
  const exhausted = data.max_uses > 0 && data.used_count >= data.max_uses;
  const valid = !expired && !exhausted;

  return json({
    valid,
    expired,
    exhausted,
    invite: {
      id: data.id,
      club_id: data.club_id,
      code: data.code,
      email: data.email,
      max_uses: data.max_uses,
      used_count: data.used_count,
      expires_at: data.expires_at,
      created_at: data.created_at,
    },
    club: data.clubs ?? null,
  });
}

// ─── Main handler ─────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  // Rate limit: 20 calls / 60s per IP
  const ip = clientIdentifier(req);
  const rl = await checkRateLimit('club-invite', ip, 60, 20);
  if (!rl.allowed) {
    return json({ error: 'rate_limited', current: rl.current }, 429);
  }

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return json({ error: 'edge_function_misconfigured' }, 500);
    }

    // validate_code is unauthenticated — needed for the public landing page
    // to show club info before the user logs in.
    const url = new URL(req.url);
    const action = url.searchParams.get('action') ?? '';

    if (action === 'validate_code') {
      const body = await req.json() as ValidateCodeParams;
      return await handleValidateCode(body);
    }

    // All other actions require a KROMI session
    const auth = await authenticate(req);
    if (!auth) return json({ error: 'unauthorized' }, 401);

    switch (action) {
      case 'send_invite': {
        const body = await req.json() as SendInviteParams;
        return await handleSendInvite(body);
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error('[club-invite] unhandled error:', err);
    return json({ error: (err as Error).message }, 500);
  }
});
