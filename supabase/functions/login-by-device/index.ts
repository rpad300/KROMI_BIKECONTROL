import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mintKromiJwt } from "../_shared/jwt.ts";

// ─────────────────────────────────────────────────────────────────
// login-by-device
//
// Replaces the direct REST read that used to happen in the frontend
// (see src/services/auth/AuthService.ts :: loginByDevice). With the
// RLS lockdown landing in Session 18, device_tokens will no longer
// be publicly queryable — this edge function is the only legal way
// to exchange a device_id for a fresh session + JWT.
//
// The function is intentionally stateless about who is calling: if
// the device is registered, we mint. That's the same trust level as
// before (device_id in localStorage is the secret).
// ─────────────────────────────────────────────────────────────────

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
    const { device_id } = await req.json().catch(() => ({}));
    if (!device_id || typeof device_id !== "string") {
      return new Response(JSON.stringify({ error: "device_id obrigatorio" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Look up the device registration
    const { data: dev } = await supabase
      .from("device_tokens")
      .select("user_id, user_email, user_name")
      .eq("device_id", device_id)
      .maybeSingle();

    if (!dev) {
      return new Response(JSON.stringify({ error: "Device nao registado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load the full user row (device_tokens cache may be stale for
    // is_super_admin / suspended_at)
    const { data: user } = await supabase
      .from("app_users")
      .select("id, email, name, is_super_admin, suspended_at")
      .eq("id", dev.user_id)
      .single();

    if (!user) {
      return new Response(JSON.stringify({ error: "Utilizador nao encontrado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (user.suspended_at) {
      return new Response(JSON.stringify({ error: "Conta suspensa" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Bump last_seen
    await supabase
      .from("device_tokens")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("device_id", device_id);

    // Mint a fresh user_sessions row so the opaque token path keeps
    // working for admin RPCs (they resolve via user_sessions).
    const sessionToken = crypto.randomUUID();
    const tokenHash = await hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("user_sessions").insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

    // Mint the PostgREST JWT. Null during the S18 migration window.
    const minted = await mintKromiJwt(user.id, { isSuperAdmin: !!user.is_super_admin });
    const jwt = minted?.jwt ?? null;
    const jwtExpiresAt = minted?.expires_at ?? null;

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
    console.error("login-by-device error:", err);
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
