-- Allow anon reads on club_rides for public clubs (landing page needs this)
DROP POLICY IF EXISTS "club_rides_sel" ON public.club_rides;
CREATE POLICY "club_rides_sel" ON public.club_rides
  FOR SELECT USING (
    public.is_super_admin_jwt()
    OR EXISTS (
      SELECT 1 FROM public.club_members m
      WHERE m.club_id = club_rides.club_id AND m.user_id = public.kromi_uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.clubs c
      WHERE c.id = club_rides.club_id AND c.visibility = 'public'
    )
  );
