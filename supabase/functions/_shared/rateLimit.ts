// ───────────────────────────────────────────────────────────────
// Shared rate-limit helper for KROMI edge functions.
//
// Backed by the SECURITY DEFINER RPC `public.check_rate_limit()`
// which implements a simple token bucket in the
// `edge_function_rate_limits` table. Every caller should fail
// OPEN (allow the request) if the RPC itself errors — the rate
// limiter should never be a single point of failure for auth.
// ───────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  current: number;
}

export async function checkRateLimit(
  functionName: string,
  identifier: string,
  windowSecs: number,
  maxCalls: number,
): Promise<RateLimitResult> {
  const SB_URL = Deno.env.get("SUPABASE_URL");
  const SB_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!SB_URL || !SB_KEY) return { allowed: true, current: 0 };
  try {
    const res = await fetch(`${SB_URL}/rest/v1/rpc/check_rate_limit`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        "Content-Type": "application/json",
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
    return {
      allowed: !!row?.allowed,
      current: row?.current_count ?? 0,
    };
  } catch {
    return { allowed: true, current: 0 };
  }
}

/** Best-effort client IP extraction from common proxy headers. */
export function clientIdentifier(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "anonymous"
  );
}
