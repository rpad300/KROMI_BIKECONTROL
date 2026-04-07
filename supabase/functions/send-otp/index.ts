// ───────────────────────────────────────────────────────────────
// send-otp — sends a 6-digit OTP via Resend.
//
// Two layers of rate limit:
//   1. Per-email: max 3 OTPs per email per 15 minutes (existing)
//   2. Per-IP:    max 5 requests per IP per 60 seconds (new, S19)
//
// The IP layer prevents a single attacker from rotating through
// thousands of emails to warm up a target list. Both layers must
// pass for the OTP to be sent. If either check fails we return
// 429; the check_rate_limit RPC itself fails open (see
// _shared/rateLimit.ts comment).
// ───────────────────────────────────────────────────────────────

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, clientIdentifier } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // IP-level rate limit — check BEFORE parsing the body so a
    // malicious script can't burn CPU on JSON parsing.
    const ip = clientIdentifier(req);
    const rl = await checkRateLimit("send-otp", ip, 60, 5);
    if (!rl.allowed) {
      return new Response(
        JSON.stringify({ error: "Demasiados pedidos. Aguarda um minuto.", rate_limited: true }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { email } = await req.json();
    if (!email || !email.includes("@")) {
      return new Response(JSON.stringify({ error: "Email invalido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Per-email rate limit: max 3 OTPs per email per 15 minutes
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("otp_codes")
      .select("*", { count: "exact", head: true })
      .eq("email", email.toLowerCase())
      .gte("created_at", fifteenMinAgo);

    if (count !== null && count >= 3) {
      return new Response(JSON.stringify({ error: "Demasiados pedidos. Aguarda 15 minutos." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase.from("otp_codes").insert({
      email: email.toLowerCase(),
      code,
      expires_at: expiresAt,
    });

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(JSON.stringify({ error: "Email service not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const emailFrom = Deno.env.get("EMAIL_FROM") || "BikeControl <noreply@kromi.online>";

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: emailFrom,
        to: [email],
        subject: `BikeControl - Codigo de acesso: ${code}`,
        html: `<div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;"><h2 style="color: #3b82f6;">Giant eBike Command Center</h2><p>O teu codigo de acesso:</p><div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 20px; background: #111827; color: white; border-radius: 12px; margin: 20px 0;">${code}</div><p style="color: #666; font-size: 14px;">Valido por 10 minutos. Se nao pediste este codigo, ignora este email.</p></div>`,
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      console.error("Resend error:", errBody);
      return new Response(JSON.stringify({ error: "Falha ao enviar email: " + errBody }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, message: "Codigo enviado para " + email }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("send-otp error:", err);
    return new Response(JSON.stringify({ error: "Erro interno: " + String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
