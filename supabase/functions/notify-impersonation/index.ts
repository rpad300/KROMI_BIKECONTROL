// ═══════════════════════════════════════════════════════════
// notify-impersonation — emails an alert when an admin impersonates
// ═══════════════════════════════════════════════════════════
//
// Triggered from the frontend (`beginImpersonation` in authStore) right
// after an `impersonation_log` row is created. Sends a transactional
// email via Resend so the platform owner has an immediate audit trail
// outside the database.
//
// Required Edge Function secrets:
//   RESEND_API_KEY    — Resend API token (https://resend.com/api-keys)
//   KROMI_NOTIFY_TO   — comma-separated emails to notify (e.g. owner)
//   KROMI_NOTIFY_FROM — verified sender ("KROMI <noreply@kromi.pt>")
//
// Fail-soft behaviour:
//   If any secret is missing, returns 200 + skipped=true so the
//   impersonation flow is never blocked by missing config.
//
// Deploy: `mcp__claude_ai_Supabase__deploy_edge_function` or `supabase
// functions deploy notify-impersonation`. verify_jwt is on (frontend
// already includes the anon key in the Authorization header).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-kromi-session',
};

// ─── Rate-limiting helper ────────────────────────────────────
// Calls the check_rate_limit() Postgres function via PostgREST RPC.
// Fail-open: if the call errors (network, missing service role) we
// allow the request rather than block legitimate traffic.
async function checkRateLimit(
  functionName: string,
  identifier: string,
  windowSecs: number,
  maxCalls: number,
): Promise<{ allowed: boolean; current: number }> {
  const SB_URL = Deno.env.get('SUPABASE_URL');
  const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY');
  if (!SB_URL || !SB_KEY) return { allowed: true, current: 0 };
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/check_rate_limit`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_function: functionName,
        p_identifier: identifier,
        p_window_secs: windowSecs,
        p_max: maxCalls,
      }),
    });
    if (!res.ok) return { allowed: true, current: 0 };
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return { allowed: !!row?.allowed, current: row?.current_count ?? 0 };
  } catch {
    return { allowed: true, current: 0 };
  }
}

function clientIdentifier(req: Request): string {
  // Cloudflare/Vercel/Supabase forwarded IP, fall back to anonymous bucket
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'anonymous'
  );
}

interface Payload {
  admin_email: string;
  admin_name?: string | null;
  target_email: string;
  target_name?: string | null;
  reason?: string | null;
  log_id?: string | null;
  user_agent?: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHtml(p: Payload): string {
  const adminLine = p.admin_name ? `${p.admin_name} (${p.admin_email})` : p.admin_email;
  const targetLine = p.target_name ? `${p.target_name} (${p.target_email})` : p.target_email;
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; padding: 16px; background: #0e0e0e; color: #adaaaa;">
      <h2 style="color: #ff9f43; font-size: 16px; margin: 0 0 12px;">⚠ Impersonation iniciada na KROMI</h2>
      <p style="font-size: 13px; line-height: 1.5;">
        <strong style="color: #fbbf24;">${adminLine}</strong>
        está agora a ver a plataforma como
        <strong style="color: #3fff8b;">${targetLine}</strong>.
      </p>
      ${p.reason ? `<p style="font-size: 12px; color: #777575; font-style: italic;">"${escapeHtml(p.reason)}"</p>` : ''}
      <hr style="border: none; border-top: 1px solid #262626; margin: 12px 0;" />
      <p style="font-size: 11px; color: #494847;">
        ${p.log_id ? `Log ID: <code>${p.log_id}</code><br/>` : ''}
        ${p.user_agent ? `UA: ${escapeHtml(p.user_agent.slice(0, 120))}<br/>` : ''}
        ${new Date().toISOString()}
      </p>
    </div>
  `;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Rate limit: max 10 impersonation alerts per IP per 60s. A super admin
  // doesn't legitimately need more than this, and a malicious caller would
  // hit the cap immediately.
  const ip = clientIdentifier(req);
  const rl = await checkRateLimit('notify-impersonation', ip, 60, 10);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: 'rate_limited', current: rl.current }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const NOTIFY_TO = Deno.env.get('KROMI_NOTIFY_TO');
  const NOTIFY_FROM = Deno.env.get('KROMI_NOTIFY_FROM') ?? 'KROMI <onboarding@resend.dev>';

  if (!RESEND_API_KEY || !NOTIFY_TO) {
    return new Response(
      JSON.stringify({ ok: true, skipped: true, reason: 'email config missing (RESEND_API_KEY/KROMI_NOTIFY_TO)' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!payload.admin_email || !payload.target_email) {
    return new Response(JSON.stringify({ error: 'admin_email + target_email required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const recipients = NOTIFY_TO.split(',').map((s: string) => s.trim()).filter(Boolean);

  // Fail-soft on Resend errors. Notification is fire-and-forget audit:
  // we never want a Resend rejection (unverified domain, free-tier
  // recipient restriction, network blip) to surface as a 502 in the
  // browser console. Always return 200 — the response body indicates
  // whether the send actually happened.
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: NOTIFY_FROM,
        to: recipients,
        subject: `[KROMI] Impersonation: ${payload.admin_email} → ${payload.target_email}`,
        html: buildHtml(payload),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn('[notify-impersonation] resend error:', res.status, text);
      return new Response(
        JSON.stringify({ ok: false, skipped: true, reason: 'resend_error', status: res.status }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const data = await res.json();
    return new Response(JSON.stringify({ ok: true, id: data.id }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.warn('[notify-impersonation] network error:', (err as Error).message);
    return new Response(
      JSON.stringify({ ok: false, skipped: true, reason: 'network_error' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
