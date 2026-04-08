-- Full policy audit (2026-04-08) — fix 4 more leaks the smoke test
-- originally didn't cover because the tables weren't in LOCKDOWN_TABLES.
-- Added to the smoke test in the same commit so regressions are caught.
--
-- Leaks fixed:
--   1. app_users SELECT — anon could list all emails + is_super_admin
--   2. user_suspensions — full CRUD open (qual:true, no restrictive block)
--   3. user_roles SELECT — anon could list who has what role (privilege recon)
--   4. permissions — full CRUD open, no block on INSERT of new permissions
--
-- Intentionally left open (documented so future audits don't re-flag):
--   - rescue_requests / rescue_responses — public BY DESIGN (emergency feature)
--   - shops_sel / shop_hours / shop_services / shop_reviews — customer discovery
--   - shop_services_templates — shared template catalog
--   - elevation_cache — shared map cache, no PII
--   - bike_components — shared components catalog
--   - debug_logs INSERT — anonymous telemetry (SELECT is super admin only)

DROP POLICY IF EXISTS anon_all ON public.app_users;
CREATE POLICY app_users_sel ON public.app_users FOR SELECT USING (
  id = public.kromi_uid() OR public.is_super_admin_jwt()
);
DROP POLICY IF EXISTS app_users_block_insert ON public.app_users;
CREATE POLICY app_users_block_insert ON public.app_users AS RESTRICTIVE FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS user_suspensions_all ON public.user_suspensions;
CREATE POLICY user_suspensions_sel ON public.user_suspensions FOR SELECT USING (
  public.is_super_admin_jwt() OR user_id = public.kromi_uid()
);
DROP POLICY IF EXISTS user_suspensions_block_ins ON public.user_suspensions;
CREATE POLICY user_suspensions_block_ins ON public.user_suspensions AS RESTRICTIVE FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS user_suspensions_block_upd ON public.user_suspensions;
CREATE POLICY user_suspensions_block_upd ON public.user_suspensions AS RESTRICTIVE FOR UPDATE USING (false);
DROP POLICY IF EXISTS user_suspensions_block_del ON public.user_suspensions;
CREATE POLICY user_suspensions_block_del ON public.user_suspensions AS RESTRICTIVE FOR DELETE USING (false);

DROP POLICY IF EXISTS rbac_user_roles_all ON public.user_roles;
CREATE POLICY user_roles_sel ON public.user_roles FOR SELECT USING (
  user_id = public.kromi_uid() OR public.is_super_admin_jwt()
);

DROP POLICY IF EXISTS rbac_user_feature_flags_all ON public.user_feature_flags;
CREATE POLICY user_feature_flags_sel ON public.user_feature_flags FOR SELECT USING (
  user_id = public.kromi_uid() OR public.is_super_admin_jwt()
);

DROP POLICY IF EXISTS rbac_permissions_all ON public.permissions;
CREATE POLICY permissions_sel ON public.permissions FOR SELECT USING (true);
DROP POLICY IF EXISTS permissions_block_ins ON public.permissions;
CREATE POLICY permissions_block_ins ON public.permissions AS RESTRICTIVE FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS permissions_block_upd ON public.permissions;
CREATE POLICY permissions_block_upd ON public.permissions AS RESTRICTIVE FOR UPDATE USING (false);
DROP POLICY IF EXISTS permissions_block_del ON public.permissions;
CREATE POLICY permissions_block_del ON public.permissions AS RESTRICTIVE FOR DELETE USING (false);

DROP POLICY IF EXISTS rbac_roles_all ON public.roles;
CREATE POLICY roles_sel ON public.roles FOR SELECT USING (true);

DROP POLICY IF EXISTS rbac_role_permissions_all ON public.role_permissions;
CREATE POLICY role_permissions_sel ON public.role_permissions FOR SELECT USING (true);
