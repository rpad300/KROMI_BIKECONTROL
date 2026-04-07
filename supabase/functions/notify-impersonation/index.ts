// notify-impersonation — fail-soft alert (email + Slack) when an admin impersonates
//
// Triggered from the frontend (`beginImpersonation` in authStore) right after
// the impersonation_log row is written. Two independent channels run in
// parallel via Promise.all — each is individually fail-soft, so a browser
// click never sees a 502 even if Resend/Slack are down.
//
// Env vars:
//   KROMI_JWT_SECRET           (optional, not read here but required by auth)
//   RESEND_API_KEY             + KROMI_NOTIFY_TO  → enables email channel
//   KROMI_NOTIFY_FROM          optional (defaults to onboarding@resend.dev)
//   KROMI_SLACK_WEBHOOK_URL    → enables Slack channel
//
// Rate limited: 10 calls / 60s / IP via check_rate_limit RPC.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-kromi-session',
};

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

// Slack Block Kit payload — https://api.slack.com/block-kit
function buildSlackBlocks(p: Payload) {
  const adminLine = p.admin_name ? `${p.admin_name} (${p.admin_email})` : p.admin_email;
  const targetLine = p.target_name ? `${p.target_name} (${p.target_email})` : p.target_email;
  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: '⚠ KROMI Impersonation iniciada', emoji: true } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Admin:*\n${adminLine}` },
        { type: 'mrkdwn', text: `*Target:*\n${targetLine}` },
      ],
    },
  ];
  if (p.reason) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Motivo:* _${p.reason}_` } });
  }
  const contextElements: unknown[] = [];
  if (p.log_id) contextElements.push({ type: 'mrkdwn', text: `Log: \`${p.log_id}\`` });
  contextElements.push({ type: 'mrkdwn', text: new Date().toISOString() });
  if (p.user_agent) contextElements.push({ type: 'mrkdwn', text: `UA: ${p.user_agent.slice(0, 100)}` });
  blocks.push({ type: 'context', elements: contextElements });
  return { text: `KROMI Impersonation: ${p.admin_email} -> ${p.target_email}`, blocks };
}

async function sendEmail(p: Payload) {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const NOTIFY_TO = Deno.env.get('KROMI_NOTIFY_TO');
  const NOTIFY_FROM = Deno.env.get('KROMI_NOTIFY_FROM') ?? 'KROMI <onboarding@resend.dev>';
  if (!RESEND_API_KEY || !NOTIFY_TO) {
    return { channel: 'email', ok: true, skipped: true, reason: 'email_not_configured' };
  }
  const recipients = NOTIFY_TO.split(',').map((s: string) => s.trim()).filter(Boolean);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: NOTIFY_FROM,
        to: recipients,
        subject: `[KROMI] Impersonation: ${p.admin_email} -> ${p.target_email}`,
        html: buildHtml(p),
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn('[notify-impersonation] resend error:', res.status, text);
      return { channel: 'email', ok: false, skipped: true, reason: 'resend_error', status: res.status };
    }
    const data = await res.json();
    return { channel: 'email', ok: true, id: data.id };
  } catch (err) {
    console.warn('[notify-impersonation] email network error:', (err as Error).message);
    return { channel: 'email', ok: false, skipped: true, reason: 'network_error' };
  }
}

async function sendSlack(p: Payload) {
  const SLACK_URL = Deno.env.get('KROMI_SLACK_WEBHOOK_URL');
  if (!SLACK_URL) {
    return { channel: 'slack', ok: true, skipped: true, reason: 'slack_not_configured' };
  }
  try {
    const res = await fetch(SLACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSlackBlocks(p)),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn('[notify-impersonation] slack error:', res.status, text);
      return { channel: 'slack', ok: false, skipped: true, reason: 'slack_error', status: res.status };
    }
    return { channel: 'slack', ok: true };
  } catch (err) {
    console.warn('[notify-impersonation] slack network error:', (err as Error).message);
    return { channel: 'slack', ok: false, skipped: true, reason: 'network_error' };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const ip = clientIdentifier(req);
  const rl = await checkRateLimit('notify-impersonation', ip, 60, 10);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: 'rate_limited', current: rl.current }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
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

  // Fire both channels in parallel. Each is independently fail-soft;
  // we always return 200 so a browser click never sees a 502.
  const results = await Promise.all([sendEmail(payload), sendSlack(payload)]);

  return new Response(
    JSON.stringify({ ok: true, channels: results }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
