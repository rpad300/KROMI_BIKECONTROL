-- Performance indexes informed by pg_stat_statements audit (2026-04-08).
--
-- debug_logs: 36k rows, queries doing ORDER BY created_at DESC LIMIT
-- were measured at 131ms mean — full seq scan + sort. Adding a descending
-- index on created_at eliminates the sort.
--
-- bike_fits / rescue_responses: had only PK. RLS EXISTS joins benefit from
-- explicit indexes on the FK columns they filter on.

CREATE INDEX IF NOT EXISTS debug_logs_created_at_idx
  ON public.debug_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS debug_logs_level_idx
  ON public.debug_logs (level) WHERE level IN ('error', 'warn');

CREATE INDEX IF NOT EXISTS bike_fits_user_id_idx
  ON public.bike_fits (user_id);

CREATE INDEX IF NOT EXISTS rescue_responses_request_id_idx
  ON public.rescue_responses (request_id);

CREATE INDEX IF NOT EXISTS rescue_responses_responder_user_id_idx
  ON public.rescue_responses (responder_user_id);
