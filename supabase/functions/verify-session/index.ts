import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mintKromiJwt } from "../_shared/jwt.ts";

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
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Token obrigatorio" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Two accepted token formats:
    //   1. "device:{deviceId}" — auto-login via registered device
    //   2. plain UUID session token (from verify-otp) — hashed lookup
    let userId: string | null = null;

    if (token.startsWith("device:")) {
      const deviceId = token.slice(7);
      const { data: dev } = await supabase
        .from("device_tokens")
        .select("user_id")
        .eq("device_id", deviceId)
        .maybeSingle();
      userId = dev?.user_id ?? null;
      if (userId) {
        // Best-effort last-seen bump
        await supabase
          .from("device_tokens")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("device_id", deviceId);
      }
    } else {
      const encoder = new TextEncoder();
      const data = encoder.encode(token);
      const hash = await crypto.subtle.digest("SHA-256", data);
      const tokenHash = Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const { data: session } = await supabase
        .from("user_sessions")
        .select("id, user_id, expires_at")
        .eq("token_hash", tokenHash)
        .gte("expires_at", new Date().toISOString())
        .maybeSingle();

      if (session) {
        userId = session.user_id;
        await supabase
          .from("user_sessions")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", session.id);
      }
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Sessao invalida ou expirada" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load user row
    const { data: user } = await supabase
      .from("app_users")
      .select("id, email, name, is_super_admin, suspended_at")
      .eq("id", userId)
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

    // Mint a fresh JWT on every verification. Super admins get a
    // shorter TTL (1h) — the frontend calls verify-session on app
    // bootstrap so the token auto-refreshes naturally. Normal users
    // keep 30d to avoid forcing re-login.
    const minted = await mintKromiJwt(user.id, { isSuperAdmin: !!user.is_super_admin });
    const jwt = minted?.jwt ?? null;
    const jwtExpiresAt = minted?.expires_at ?? null;

    return new Response(
      JSON.stringify({
        valid: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          is_super_admin: user.is_super_admin ?? false,
        },
        jwt,
        jwt_expires_at: jwtExpiresAt,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("verify-session error:", err);
    return new Response(JSON.stringify({ error: "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
