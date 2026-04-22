-- Fix: club_members_sel policy self-references club_members → infinite recursion (500)
-- Solution: SECURITY DEFINER helper that reads club_members without RLS

CREATE OR REPLACE FUNCTION public.is_club_member(p_club_id uuid, p_user_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_members
    WHERE club_id = p_club_id AND user_id = p_user_id
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = 'public';

DROP POLICY IF EXISTS "club_members_sel" ON public.club_members;
CREATE POLICY "club_members_sel" ON public.club_members
  FOR SELECT USING (
    public.is_super_admin_jwt()
    OR user_id = public.kromi_uid()
    OR public.is_club_member(club_members.club_id, public.kromi_uid())
    OR EXISTS (
      SELECT 1 FROM public.clubs c
      WHERE c.id = club_members.club_id AND c.visibility = 'public'
    )
  );
