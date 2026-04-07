-- Autonomous scheduled unsuspend via pg_cron.
--
-- The HTTP-callable kromi_expire_due_suspensions(p_session_token) stays in
-- place as a manual/fallback trigger (still called on admin panel mount).
-- This migration adds a cron-safe sibling that skips the session token auth
-- check (it runs as the postgres role, not an end user) and schedules it to
-- run every 15 minutes.

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.kromi_expire_due_suspensions_cron()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT id, suspended_until
      FROM public.app_users
     WHERE suspended_at IS NOT NULL
       AND suspended_until IS NOT NULL
       AND suspended_until <= now()
  LOOP
    UPDATE public.app_users
       SET suspended_at = NULL,
           suspended_reason = NULL,
           suspended_until = NULL
     WHERE id = r.id;

    INSERT INTO public.user_suspensions (user_id, action, reason, performed_by, expires_at)
    VALUES (r.id, 'unsuspend', 'automatic expiry (cron)', NULL, NULL);

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.kromi_expire_due_suspensions_cron() FROM public;
-- Only the cron job / service_role may invoke this. No GRANT to anon/authenticated.
GRANT EXECUTE ON FUNCTION public.kromi_expire_due_suspensions_cron() TO service_role;

-- Unschedule any previous version before re-scheduling (idempotent migrations)
DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'kromi_expire_due_suspensions'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

-- Run every 15 minutes
SELECT cron.schedule(
  'kromi_expire_due_suspensions',
  '*/15 * * * *',
  $$SELECT public.kromi_expire_due_suspensions_cron();$$
);
