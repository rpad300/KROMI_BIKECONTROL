-- Cron job monitoring (2026-04-08) — captures every pg_cron run with
-- duration, status, and error. Replaces "silent failure" with visibility
-- in the admin panel.
--
-- Design:
--  1. cron_job_runs log table (super admin SELECT, all writes blocked)
--  2. Wrapper helpers around each cron worker that trap errors and
--     insert a log row per run.
--  3. pg_cron schedules are rewritten to invoke the wrapped variants.
--  4. kromi_cron_job_status() read RPC for the admin panel summary.

CREATE TABLE IF NOT EXISTS public.cron_job_runs (
  id          bigserial PRIMARY KEY,
  job_name    text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status      text NOT NULL CHECK (status IN ('running', 'ok', 'error')),
  result_int  integer,
  error_text  text
);

CREATE INDEX IF NOT EXISTS cron_job_runs_job_name_started_idx
  ON public.cron_job_runs (job_name, started_at DESC);

ALTER TABLE public.cron_job_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cron_job_runs_sel ON public.cron_job_runs;
CREATE POLICY cron_job_runs_sel ON public.cron_job_runs FOR SELECT USING (
  public.is_super_admin_jwt()
);
DROP POLICY IF EXISTS cron_job_runs_block_ins ON public.cron_job_runs;
CREATE POLICY cron_job_runs_block_ins ON public.cron_job_runs AS RESTRICTIVE FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS cron_job_runs_block_upd ON public.cron_job_runs;
CREATE POLICY cron_job_runs_block_upd ON public.cron_job_runs AS RESTRICTIVE FOR UPDATE USING (false);
DROP POLICY IF EXISTS cron_job_runs_block_del ON public.cron_job_runs;
CREATE POLICY cron_job_runs_block_del ON public.cron_job_runs AS RESTRICTIVE FOR DELETE USING (false);

CREATE OR REPLACE FUNCTION public.kromi_expire_due_suspensions_cron_wrapped()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id bigint;
  v_result integer;
BEGIN
  INSERT INTO public.cron_job_runs (job_name, status)
  VALUES ('kromi_expire_due_suspensions', 'running')
  RETURNING id INTO v_run_id;

  BEGIN
    v_result := public.kromi_expire_due_suspensions_cron();
    UPDATE public.cron_job_runs
       SET finished_at = now(), status = 'ok', result_int = v_result
     WHERE id = v_run_id;
    RETURN v_result;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.cron_job_runs
       SET finished_at = now(), status = 'error', error_text = SQLERRM
     WHERE id = v_run_id;
    RAISE;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.kromi_expire_due_suspensions_cron_wrapped() FROM public;
GRANT EXECUTE ON FUNCTION public.kromi_expire_due_suspensions_cron_wrapped() TO service_role;

CREATE OR REPLACE FUNCTION public.kromi_execute_scheduled_deletions_cron_wrapped()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id bigint;
  v_result integer;
BEGIN
  INSERT INTO public.cron_job_runs (job_name, status)
  VALUES ('kromi_execute_scheduled_deletions', 'running')
  RETURNING id INTO v_run_id;

  BEGIN
    v_result := public.kromi_execute_scheduled_deletions_cron();
    UPDATE public.cron_job_runs
       SET finished_at = now(), status = 'ok', result_int = v_result
     WHERE id = v_run_id;
    RETURN v_result;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.cron_job_runs
       SET finished_at = now(), status = 'error', error_text = SQLERRM
     WHERE id = v_run_id;
    RAISE;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.kromi_execute_scheduled_deletions_cron_wrapped() FROM public;
GRANT EXECUTE ON FUNCTION public.kromi_execute_scheduled_deletions_cron_wrapped() TO service_role;

DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'kromi_expire_due_suspensions'
  LOOP PERFORM cron.unschedule(j.jobid); END LOOP;
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'kromi_execute_scheduled_deletions'
  LOOP PERFORM cron.unschedule(j.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'kromi_expire_due_suspensions',
  '*/15 * * * *',
  $$SELECT public.kromi_expire_due_suspensions_cron_wrapped();$$
);

SELECT cron.schedule(
  'kromi_execute_scheduled_deletions',
  '0 3 * * *',
  $$SELECT public.kromi_execute_scheduled_deletions_cron_wrapped();$$
);

CREATE OR REPLACE FUNCTION public.kromi_cron_job_status()
RETURNS TABLE (
  job_name text,
  last_run_at timestamptz,
  last_status text,
  last_result integer,
  last_error text,
  last_duration_ms integer,
  runs_24h integer,
  errors_24h integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (job_name)
      job_name,
      started_at,
      finished_at,
      status,
      result_int,
      error_text,
      CASE WHEN finished_at IS NOT NULL
        THEN extract(milliseconds FROM finished_at - started_at)::integer
        ELSE NULL
      END AS duration_ms
    FROM public.cron_job_runs
    ORDER BY job_name, started_at DESC
  ),
  totals AS (
    SELECT
      job_name,
      count(*)::integer AS total_24h,
      count(*) FILTER (WHERE status = 'error')::integer AS err_24h
    FROM public.cron_job_runs
    WHERE started_at > now() - interval '24 hours'
    GROUP BY job_name
  )
  SELECT
    l.job_name,
    l.started_at AS last_run_at,
    l.status AS last_status,
    l.result_int AS last_result,
    l.error_text AS last_error,
    l.duration_ms AS last_duration_ms,
    COALESCE(t.total_24h, 0) AS runs_24h,
    COALESCE(t.err_24h, 0) AS errors_24h
  FROM latest l
  LEFT JOIN totals t USING (job_name)
  WHERE public.is_super_admin_jwt();
$$;

REVOKE ALL ON FUNCTION public.kromi_cron_job_status() FROM public;
GRANT EXECUTE ON FUNCTION public.kromi_cron_job_status() TO anon, authenticated, service_role;
