-- GDPR soft-delete with a 30-day grace window (S19).
-- Replaces the immediate hard delete with a schedule + cancel pattern.
-- A daily pg_cron job executes scheduled deletions when the grace
-- period expires.

ALTER TABLE public.account_deletion_log
  ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'deleted',
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_deletion_log_action_check') THEN
    ALTER TABLE public.account_deletion_log DROP CONSTRAINT account_deletion_log_action_check;
  END IF;
  ALTER TABLE public.account_deletion_log
    ADD CONSTRAINT account_deletion_log_action_check
    CHECK (action IN ('deleted', 'scheduled', 'cancelled', 'executed'));
END $$;

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS scheduled_deletion_at timestamptz;

CREATE INDEX IF NOT EXISTS app_users_scheduled_deletion_idx
  ON public.app_users (scheduled_deletion_at) WHERE scheduled_deletion_at IS NOT NULL;

ALTER FUNCTION public.kromi_delete_my_account(text, text)
  RENAME TO _kromi_hard_delete_account_internal;

REVOKE ALL ON FUNCTION public._kromi_hard_delete_account_internal(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public._kromi_hard_delete_account_internal(text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.kromi_schedule_my_account_deletion(
  p_session_token text,
  p_confirmation_email text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_scheduled_at timestamptz;
BEGIN
  v_user_id := public.resolve_session_user_id(p_session_token);
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_user_email FROM public.app_users WHERE id = v_user_id;
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = '22023';
  END IF;

  IF p_confirmation_email IS NULL
     OR lower(trim(p_confirmation_email)) <> lower(trim(v_user_email)) THEN
    RAISE EXCEPTION 'confirmation email mismatch' USING ERRCODE = '22023';
  END IF;

  v_scheduled_at := now() + interval '30 days';

  UPDATE public.app_users SET scheduled_deletion_at = v_scheduled_at WHERE id = v_user_id;

  INSERT INTO public.account_deletion_log (user_id, email_at_deletion, action, scheduled_at, initiated_by, reason)
  VALUES (v_user_id, v_user_email, 'scheduled', v_scheduled_at, v_user_id, 'gdpr_self_service');

  RETURN v_scheduled_at;
END;
$$;

REVOKE ALL ON FUNCTION public.kromi_schedule_my_account_deletion(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.kromi_schedule_my_account_deletion(text, text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.kromi_cancel_my_account_deletion(
  p_session_token text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_user_email text;
BEGIN
  v_user_id := public.resolve_session_user_id(p_session_token);
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_user_email FROM public.app_users WHERE id = v_user_id;

  UPDATE public.app_users SET scheduled_deletion_at = NULL WHERE id = v_user_id;

  INSERT INTO public.account_deletion_log (user_id, email_at_deletion, action, initiated_by, reason)
  VALUES (v_user_id, v_user_email, 'cancelled', v_user_id, 'gdpr_self_service');
END;
$$;

REVOKE ALL ON FUNCTION public.kromi_cancel_my_account_deletion(text) FROM public;
GRANT EXECUTE ON FUNCTION public.kromi_cancel_my_account_deletion(text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.kromi_execute_scheduled_deletions_cron()
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
    SELECT id, email
      FROM public.app_users
     WHERE scheduled_deletion_at IS NOT NULL
       AND scheduled_deletion_at <= now()
       AND deleted_at IS NULL
  LOOP
    DELETE FROM public.kromi_files WHERE owner_user_id = r.id;
    DELETE FROM public.ride_snapshots WHERE session_id IN (SELECT id FROM public.ride_sessions WHERE user_id = r.id);
    DELETE FROM public.ride_sessions WHERE user_id = r.id;
    DELETE FROM public.ride_summaries WHERE athlete_id IN (SELECT id FROM public.athlete_profiles WHERE user_id = r.id);
    DELETE FROM public.athlete_profiles WHERE user_id = r.id;
    DELETE FROM public.bike_fit_changes WHERE fit_id IN (SELECT id FROM public.bike_fits WHERE user_id = r.id);
    DELETE FROM public.bike_fits WHERE user_id = r.id;
    DELETE FROM public.bike_components WHERE bike_id IN (SELECT id FROM public.bike_configs WHERE user_id = r.id);
    DELETE FROM public.bike_configs WHERE user_id = r.id;
    DELETE FROM public.service_comments WHERE request_id IN (SELECT id FROM public.service_requests WHERE bike_id IN (SELECT id FROM public.bike_configs WHERE user_id = r.id));
    DELETE FROM public.service_items WHERE request_id IN (SELECT id FROM public.service_requests WHERE bike_id IN (SELECT id FROM public.bike_configs WHERE user_id = r.id));
    DELETE FROM public.service_requests WHERE bike_id IN (SELECT id FROM public.bike_configs WHERE user_id = r.id);
    DELETE FROM public.emergency_profiles WHERE user_id = r.id;
    DELETE FROM public.user_settings WHERE user_id = r.id;
    DELETE FROM public.device_tokens WHERE user_id = r.id;
    DELETE FROM public.user_sessions WHERE user_id = r.id;
    DELETE FROM public.otp_codes WHERE email = r.email;
    DELETE FROM public.club_members WHERE user_id = r.id;
    DELETE FROM public.user_roles WHERE user_id = r.id;
    DELETE FROM public.user_feature_flags WHERE user_id = r.id;

    UPDATE public.app_users
       SET email = 'deleted-' || r.id::text || '@deleted.local',
           name = NULL,
           deleted_at = now(),
           suspended_at = now(),
           suspended_reason = 'gdpr_deleted',
           scheduled_deletion_at = NULL
     WHERE id = r.id;

    INSERT INTO public.account_deletion_log (user_id, email_at_deletion, action, reason)
    VALUES (r.id, r.email, 'executed', 'gdpr_cron_worker');

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.kromi_execute_scheduled_deletions_cron() FROM public;
GRANT EXECUTE ON FUNCTION public.kromi_execute_scheduled_deletions_cron() TO service_role;

DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'kromi_execute_scheduled_deletions'
  LOOP PERFORM cron.unschedule(j.jobid); END LOOP;
END $$;

SELECT cron.schedule(
  'kromi_execute_scheduled_deletions',
  '0 3 * * *',
  $$SELECT public.kromi_execute_scheduled_deletions_cron();$$
);
