import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mintKromiJwt } from "../_shared/jwt.ts";
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
    // IP rate limit — generous (10/60s) because legit users may retry
    // a typo once or twice, but hard cap on brute-force attempts.
    const ip = clientIdentifier(req);
    const rl = await checkRateLimit("verify-otp", ip, 60, 10);
    if (!rl.allowed) {
      return new Response(
        JSON.stringify({ error: "Demasiados pedidos. Aguarda um minuto.", rate_limited: true }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { email, code } = await req.json();
    if (!email || !code) {
      return new Response(JSON.stringify({ error: "Email e codigo obrigatorios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Find valid OTP
    const { data: otpRows } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("email", email.toLowerCase())
      .eq("code", code)
      .eq("used", false)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);

    if (!otpRows || otpRows.length === 0) {
      return new Response(JSON.stringify({ error: "Codigo invalido ou expirado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark OTP as used
    await supabase.from("otp_codes").update({ used: true }).eq("id", otpRows[0].id);

    // Get or create user
    const emailLower = email.toLowerCase();
    let { data: user } = await supabase
      .from("app_users")
      .select("*")
      .eq("email", emailLower)
      .single();

    if (!user) {
      const { data: newUser } = await supabase
        .from("app_users")
        .insert({ email: emailLower })
        .select()
        .single();
      user = newUser;
    }

    if (!user) {
      return new Response(JSON.stringify({ error: "Erro ao criar utilizador" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update last login
    await supabase
      .from("app_users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", user.id);

    // Create session token (opaque — kept for backwards compat with admin RPCs
    // that still use resolve_session_user_id(p_session_token))
    const sessionToken = crypto.randomUUID();
    const tokenHash = await hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

    await supabase.from("user_sessions").insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

    // Mint PostgREST-compatible JWT (the new primary auth mechanism).
    // Super admins get a shorter TTL (1h) to reduce blast radius of
    // token theft; normal users keep 30d.
    const minted = await mintKromiJwt(user.id, { isSuperAdmin: !!user.is_super_admin });
    const jwt = minted?.jwt ?? null;
    const jwtExpiresAt = minted?.expires_at ?? null;

    // Ensure athlete profile exists for this user
    const { data: profile } = await supabase
      .from("athlete_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!profile) {
      await supabase.from("athlete_profiles").insert({
        user_id: user.id,
        device_id: `user_${user.id}`,
        profile_data: {},
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          is_super_admin: user.is_super_admin ?? false,
        },
        session_token: sessionToken,
        jwt,
        jwt_expires_at: jwtExpiresAt,
        expires_at: expiresAt,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("verify-otp error:", err);
    return new Response(JSON.stringify({ error: "Erro interno: " + String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
