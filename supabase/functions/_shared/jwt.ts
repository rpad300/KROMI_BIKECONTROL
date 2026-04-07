// ───────────────────────────────────────────────────────────────
// Shared JWT helper for KROMI edge functions.
//
// Mints HS256 tokens signed with KROMI_JWT_SECRET — which MUST be set
// to the project's Supabase JWT secret (Dashboard → Settings → API →
// JWT Settings → JWT Secret). PostgREST uses that exact secret to
// verify the incoming Authorization header; if we sign with the same
// value, our tokens are accepted transparently and `auth.uid()` in
// RLS policies resolves to the `sub` claim — which we set to
// app_users.id. That is what makes `auth.uid() = user_id` policies
// work without ever touching the native `auth.users` table.
//
// Why not SUPABASE_JWT_SECRET? Supabase does NOT auto-inject it into
// edge function runtimes (only the URL, ANON_KEY, SERVICE_ROLE_KEY,
// and DB_URL are default secrets). And custom secrets starting with
// `SUPABASE_` are rejected by the CLI, so we use `KROMI_` prefix.
// ───────────────────────────────────────────────────────────────

import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

/** 30 days — default for normal users, matches the opaque session_token lifetime. */
export const KROMI_JWT_TTL_SECONDS = 30 * 24 * 60 * 60;
/** 1 hour — tighter TTL for super admins to reduce blast radius of token theft. */
export const KROMI_JWT_TTL_SUPER_ADMIN_SECONDS = 60 * 60;

let cachedKey: CryptoKey | null = null;

/**
 * True when KROMI_JWT_SECRET is configured. During the Session 18
 * migration window this may be `false` (the user hasn't set the
 * secret yet). Callers should treat JWT minting as best-effort and
 * return null instead of crashing the login flow.
 */
export function isJwtConfigured(): boolean {
  return !!Deno.env.get("KROMI_JWT_SECRET");
}

async function getJwtKey(): Promise<CryptoKey | null> {
  if (cachedKey) return cachedKey;
  const secret = Deno.env.get("KROMI_JWT_SECRET");
  if (!secret) return null;
  cachedKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return cachedKey;
}

/**
 * Mint a PostgREST-compatible JWT for the given KROMI user id.
 * The `sub` claim is the app_users.id (UUID) — this becomes
 * `auth.uid()` in RLS policies. Returns `null` when the project
 * JWT secret has not been configured yet (see isJwtConfigured).
 *
 * Pass `{ isSuperAdmin: true }` to auto-pick the shorter TTL
 * (1h instead of 30d) — this reduces the blast radius of a
 * stolen super-admin token. Normal users keep 30d.
 */
export async function mintKromiJwt(
  userId: string,
  optsOrTtl?: number | { ttlSeconds?: number; isSuperAdmin?: boolean },
): Promise<{ jwt: string; expires_at: string } | null> {
  let ttlSeconds: number;
  if (typeof optsOrTtl === "number") {
    ttlSeconds = optsOrTtl;
  } else if (optsOrTtl?.ttlSeconds !== undefined) {
    ttlSeconds = optsOrTtl.ttlSeconds;
  } else if (optsOrTtl?.isSuperAdmin) {
    ttlSeconds = KROMI_JWT_TTL_SUPER_ADMIN_SECONDS;
  } else {
    ttlSeconds = KROMI_JWT_TTL_SECONDS;
  }
  const key = await getJwtKey();
  if (!key) {
    console.warn(
      "[kromi-jwt] KROMI_JWT_SECRET not set — skipping JWT mint. " +
        "Set it in Edge Function Secrets to the project's Supabase " +
        "JWT Secret to enable RLS-scoped REST calls.",
    );
    return null;
  }
  const exp = getNumericDate(ttlSeconds);
  const jwt = await create(
    { alg: "HS256", typ: "JWT" },
    {
      sub: userId,
      role: "authenticated",
      aud: "authenticated",
      iss: "kromi-bikecontrol",
      exp,
      iat: getNumericDate(0),
    },
    key,
  );
  const expiresAt = new Date(exp * 1000).toISOString();
  return { jwt, expires_at: expiresAt };
}
