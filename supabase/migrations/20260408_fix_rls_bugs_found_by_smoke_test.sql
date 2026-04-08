-- Fixes for 4 real RLS bugs caught by tests/rls-smoke.mjs on its first run
-- after the S19 CI pipeline landed.
--
-- Note: bike_components was also flagged but it's a shared components catalog
-- (Scott/Orbea/Fox/etc. brands+models+specs) — SHOULD be publicly readable.
-- It gets removed from LOCKDOWN_TABLES in the smoke test instead.

-- ── 1. is_club_member helper + club_members_sel (recursion fix) ──
CREATE OR REPLACE FUNCTION public.is_club_member(p_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_members
    WHERE club_id = p_club_id
      AND user_id = public.kromi_uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_club_member(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_club_member(uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS club_members_sel ON public.club_members;
CREATE POLICY club_members_sel ON public.club_members FOR SELECT USING (
  public.is_super_admin_jwt()
  OR user_id = public.kromi_uid()
  OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_members.club_id AND c.created_by = public.kromi_uid())
);

-- ── 2. club_rides + club_ride_participants use the helper ──
DROP POLICY IF EXISTS club_rides_sel ON public.club_rides;
CREATE POLICY club_rides_sel ON public.club_rides FOR SELECT USING (
  public.is_super_admin_jwt() OR public.is_club_member(club_id)
);

DROP POLICY IF EXISTS club_ride_participants_sel ON public.club_ride_participants;
CREATE POLICY club_ride_participants_sel ON public.club_ride_participants FOR SELECT USING (
  public.is_super_admin_jwt()
  OR user_id = public.kromi_uid()
  OR EXISTS (
    SELECT 1 FROM public.club_rides cr
    WHERE cr.id = club_ride_participants.session_id
      AND public.is_club_member(cr.club_id)
  )
);

-- ── 3. impersonation_log — super admin only (was USING(true)!) ──
DROP POLICY IF EXISTS rbac_impersonation_log_all ON public.impersonation_log;
CREATE POLICY impersonation_log_sel ON public.impersonation_log FOR SELECT USING (
  public.is_super_admin_jwt()
);
CREATE POLICY impersonation_log_ins ON public.impersonation_log FOR INSERT WITH CHECK (
  public.is_super_admin_jwt()
);
DROP POLICY IF EXISTS imp_log_block_update ON public.impersonation_log;
CREATE POLICY imp_log_block_update ON public.impersonation_log AS RESTRICTIVE FOR UPDATE USING (false);
