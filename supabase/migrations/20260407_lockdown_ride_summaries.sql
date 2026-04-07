-- ride_summaries was left permissive in S18 because the prompt flagged
-- athlete_id as ambiguous (user_id vs athlete_profiles.id). Data audit
-- on 2026-04-07 confirmed all 10 rows resolve via athlete_profiles.id — no
-- app_users.id collisions — so we can safely lock down via an EXISTS join.

DROP POLICY IF EXISTS anon_all ON public.ride_summaries;

ALTER TABLE public.ride_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY ride_summaries_sel ON public.ride_summaries FOR SELECT USING (
  public.is_super_admin_jwt()
  OR EXISTS (
    SELECT 1 FROM public.athlete_profiles ap
    WHERE ap.id = ride_summaries.athlete_id
      AND ap.user_id = public.kromi_uid()
  )
);

CREATE POLICY ride_summaries_ins ON public.ride_summaries FOR INSERT WITH CHECK (
  public.is_super_admin_jwt()
  OR EXISTS (
    SELECT 1 FROM public.athlete_profiles ap
    WHERE ap.id = ride_summaries.athlete_id
      AND ap.user_id = public.kromi_uid()
  )
);

CREATE POLICY ride_summaries_upd ON public.ride_summaries FOR UPDATE
  USING (
    public.is_super_admin_jwt()
    OR EXISTS (
      SELECT 1 FROM public.athlete_profiles ap
      WHERE ap.id = ride_summaries.athlete_id
        AND ap.user_id = public.kromi_uid()
    )
  )
  WITH CHECK (
    public.is_super_admin_jwt()
    OR EXISTS (
      SELECT 1 FROM public.athlete_profiles ap
      WHERE ap.id = ride_summaries.athlete_id
        AND ap.user_id = public.kromi_uid()
    )
  );

CREATE POLICY ride_summaries_del ON public.ride_summaries FOR DELETE USING (
  public.is_super_admin_jwt()
  OR EXISTS (
    SELECT 1 FROM public.athlete_profiles ap
    WHERE ap.id = ride_summaries.athlete_id
      AND ap.user_id = public.kromi_uid()
  )
);
