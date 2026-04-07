-- Fix infinite recursion in shop_members RLS policies.
--
-- Root cause: shop_members_sel did EXISTS(SELECT FROM shop_members ...) which
-- re-invoked the same SELECT policy on itself. Postgres raised 42P17 on any
-- query that touched the table (directly or via JOIN/EXISTS from
-- service_requests, shop_calendar, etc.).
--
-- Fix: introduce a SECURITY DEFINER helper (is_shop_member) that bypasses RLS,
-- then rewrite every policy that referenced shop_members via EXISTS to use the
-- helper. This is more consistent than fixing just the one broken policy and
-- prevents the bug from sneaking back in when new policies get written.

CREATE OR REPLACE FUNCTION public.is_shop_member(p_shop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shop_members
    WHERE shop_id = p_shop_id
      AND user_id = public.kromi_uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_shop_member(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_shop_member(uuid) TO anon, authenticated, service_role;

-- shop_members: members see their own row, shop owners see all members,
-- super admin sees all. No self-reference → no recursion.
DROP POLICY IF EXISTS shop_members_sel ON public.shop_members;
CREATE POLICY shop_members_sel ON public.shop_members FOR SELECT USING (
  public.is_super_admin_jwt()
  OR user_id = public.kromi_uid()
  OR EXISTS (SELECT 1 FROM public.shops s WHERE s.id = shop_members.shop_id AND s.created_by = public.kromi_uid())
);

-- shops
DROP POLICY IF EXISTS shops_upd ON public.shops;
CREATE POLICY shops_upd ON public.shops FOR UPDATE
  USING (created_by = public.kromi_uid() OR public.is_super_admin_jwt() OR public.is_shop_member(id))
  WITH CHECK (created_by = public.kromi_uid() OR public.is_super_admin_jwt() OR public.is_shop_member(id));

-- shop_calendar
DROP POLICY IF EXISTS shop_calendar_sel ON public.shop_calendar;
CREATE POLICY shop_calendar_sel ON public.shop_calendar FOR SELECT USING (
  public.is_super_admin_jwt() OR public.is_shop_member(shop_id)
);
DROP POLICY IF EXISTS shop_calendar_mod ON public.shop_calendar;
CREATE POLICY shop_calendar_mod ON public.shop_calendar FOR ALL
  USING (public.is_super_admin_jwt() OR public.is_shop_member(shop_id))
  WITH CHECK (public.is_super_admin_jwt() OR public.is_shop_member(shop_id));

-- shop_calendar_shares
DROP POLICY IF EXISTS shop_calendar_shares_sel ON public.shop_calendar_shares;
CREATE POLICY shop_calendar_shares_sel ON public.shop_calendar_shares FOR SELECT USING (
  public.is_super_admin_jwt() OR public.is_shop_member(shop_id)
);
DROP POLICY IF EXISTS shop_calendar_shares_mod ON public.shop_calendar_shares;
CREATE POLICY shop_calendar_shares_mod ON public.shop_calendar_shares FOR ALL
  USING (public.is_super_admin_jwt() OR public.is_shop_member(shop_id))
  WITH CHECK (public.is_super_admin_jwt() OR public.is_shop_member(shop_id));

-- shop_hours
DROP POLICY IF EXISTS shop_hours_mod ON public.shop_hours;
CREATE POLICY shop_hours_mod ON public.shop_hours FOR ALL
  USING (public.is_super_admin_jwt() OR public.is_shop_member(shop_id))
  WITH CHECK (public.is_super_admin_jwt() OR public.is_shop_member(shop_id));

-- shop_services
DROP POLICY IF EXISTS shop_services_mod ON public.shop_services;
CREATE POLICY shop_services_mod ON public.shop_services FOR ALL
  USING (public.is_super_admin_jwt() OR public.is_shop_member(shop_id))
  WITH CHECK (public.is_super_admin_jwt() OR public.is_shop_member(shop_id));

-- service_requests: owner of the bike OR member of the target shop
DROP POLICY IF EXISTS service_requests_sel ON public.service_requests;
CREATE POLICY service_requests_sel ON public.service_requests FOR SELECT USING (
  public.is_super_admin_jwt()
  OR EXISTS (SELECT 1 FROM public.bike_configs b WHERE b.id = service_requests.bike_id AND b.user_id = public.kromi_uid())
  OR public.is_shop_member(shop_id)
);
DROP POLICY IF EXISTS service_requests_upd ON public.service_requests;
CREATE POLICY service_requests_upd ON public.service_requests FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.bike_configs b WHERE b.id = service_requests.bike_id AND b.user_id = public.kromi_uid())
    OR public.is_shop_member(shop_id)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.bike_configs b WHERE b.id = service_requests.bike_id AND b.user_id = public.kromi_uid())
    OR public.is_shop_member(shop_id)
  );
