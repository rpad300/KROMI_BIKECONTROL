-- ═══════════════════════════════════════════════════════════════
-- Session 18 — User-data RLS lockdown
--
-- ⚠️ DO NOT APPLY UNTIL THE KROMI JWT AUTH FLOW IS LIVE ⚠️
--
-- Pre-flight checklist (must ALL be green before running this file):
--   [ ] KROMI_JWT_SECRET is set as an edge function secret (Dashboard →
--       Edge Functions → Secrets → Add KROMI_JWT_SECRET=<project JWT secret>)
--   [ ] verify-otp  v14 deployed (mints JWT)
--   [ ] verify-session v14 deployed (mints + refreshes JWT)
--   [ ] login-by-device v1 deployed (new function)
--   [ ] Frontend in production has the Session 18 build (authStore
--       persists `jwt`, supaFetch.ts exists, services migrated)
--   [ ] At least one super admin test round-trip confirms that the
--       Bearer JWT reaches PostgREST (smoke test below)
--
-- Smoke test (run in Studio SQL editor, authenticated as super admin):
--   SET LOCAL request.jwt.claims TO '{"sub":"<your-admin-uuid>","role":"authenticated"}';
--   SELECT public.kromi_uid();  -- should return your uuid
--   SELECT public.is_super_admin_jwt();  -- should return true
--
-- This migration rebuilds every RLS policy on the user-data tables.
-- After it lands:
--   • SELECT: owner-only (super admin sees all)
--   • INSERT: must set user_id/owner_user_id = caller
--   • UPDATE: owner-only
--   • DELETE: owner-only (super admin can delete any)
--
-- Tables handled: ride_sessions, ride_snapshots, ride_override_events,
--   bike_configs, bike_components (read-only catalog), bike_fits,
--   bike_fit_changes, bike_qr_codes, athlete_profiles, emergency_profiles,
--   user_settings, kromi_files, maintenance_schedules, clubs, club_members,
--   club_rides, club_ride_participants, service_requests, service_items,
--   service_comments, service_photos, shops, shop_reviews, shop_members,
--   shop_calendar, shop_hours, shop_services, shop_calendar_shares,
--   rescue_requests, rescue_responses, rider_presence, device_tokens,
--   user_sessions, login_history, debug_logs, elevation_cache, otp_codes,
--   edge_function_rate_limits.
--
-- Tables intentionally NOT handled here (covered by Session 17 or
-- require schema work first):
--   • app_users, roles, role_permissions, user_roles, user_feature_flags,
--     impersonation_log, user_suspensions — already locked down in S17
--   • ride_summaries — `athlete_id` column semantics are ambiguous
--     (FK not declared; mixes athlete_profiles.id with user_id). Left
--     permissive until a dedicated migration normalizes the column.
-- ═══════════════════════════════════════════════════════════════

-- ── Helper: drop all policies on a table cleanly ──────────────
DO $$
DECLARE
  t text;
  p record;
  target_tables text[] := ARRAY[
    'ride_sessions','ride_snapshots','ride_override_events',
    'bike_configs','bike_components','bike_fits','bike_fit_changes','bike_qr_codes',
    'athlete_profiles','emergency_profiles','user_settings',
    'kromi_files','maintenance_schedules',
    'clubs','club_members','club_rides','club_ride_participants',
    'service_requests','service_items','service_comments','service_photos',
    'shops','shop_reviews','shop_members','shop_calendar','shop_hours','shop_services','shop_calendar_shares',
    'rescue_requests','rescue_responses','rider_presence',
    'device_tokens','user_sessions','login_history',
    'debug_logs','elevation_cache','otp_codes','edge_function_rate_limits'
  ];
BEGIN
  FOREACH t IN ARRAY target_tables LOOP
    FOR p IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- Make sure RLS is on everywhere we care about.
ALTER TABLE public.ride_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_override_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bike_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bike_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bike_fits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bike_fit_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bike_qr_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kromi_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_ride_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_calendar_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rescue_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rescue_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debug_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elevation_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edge_function_rate_limits ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- TIER 1 — User-owned tables (user_id column)
-- ═══════════════════════════════════════════════════════════════

-- ride_sessions ─────────────────────────────────────────────────
CREATE POLICY "ride_sessions_sel" ON public.ride_sessions
  FOR SELECT USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());
CREATE POLICY "ride_sessions_ins" ON public.ride_sessions
  FOR INSERT WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "ride_sessions_upd" ON public.ride_sessions
  FOR UPDATE USING (user_id = public.kromi_uid())
             WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "ride_sessions_del" ON public.ride_sessions
  FOR DELETE USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());

-- bike_configs ──────────────────────────────────────────────────
CREATE POLICY "bike_configs_sel" ON public.bike_configs
  FOR SELECT USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());
CREATE POLICY "bike_configs_ins" ON public.bike_configs
  FOR INSERT WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "bike_configs_upd" ON public.bike_configs
  FOR UPDATE USING (user_id = public.kromi_uid())
             WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "bike_configs_del" ON public.bike_configs
  FOR DELETE USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());

-- bike_fits ─────────────────────────────────────────────────────
CREATE POLICY "bike_fits_sel" ON public.bike_fits
  FOR SELECT USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());
CREATE POLICY "bike_fits_ins" ON public.bike_fits
  FOR INSERT WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "bike_fits_upd" ON public.bike_fits
  FOR UPDATE USING (user_id = public.kromi_uid())
             WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "bike_fits_del" ON public.bike_fits
  FOR DELETE USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());

-- bike_qr_codes ─────────────────────────────────────────────────
CREATE POLICY "bike_qr_codes_sel" ON public.bike_qr_codes
  FOR SELECT USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());
CREATE POLICY "bike_qr_codes_ins" ON public.bike_qr_codes
  FOR INSERT WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "bike_qr_codes_upd" ON public.bike_qr_codes
  FOR UPDATE USING (user_id = public.kromi_uid())
             WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "bike_qr_codes_del" ON public.bike_qr_codes
  FOR DELETE USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());

-- athlete_profiles ──────────────────────────────────────────────
CREATE POLICY "athlete_profiles_sel" ON public.athlete_profiles
  FOR SELECT USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());
CREATE POLICY "athlete_profiles_ins" ON public.athlete_profiles
  FOR INSERT WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "athlete_profiles_upd" ON public.athlete_profiles
  FOR UPDATE USING (user_id = public.kromi_uid())
             WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "athlete_profiles_del" ON public.athlete_profiles
  FOR DELETE USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());

-- emergency_profiles ────────────────────────────────────────────
CREATE POLICY "emergency_profiles_sel" ON public.emergency_profiles
  FOR SELECT USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());
CREATE POLICY "emergency_profiles_ins" ON public.emergency_profiles
  FOR INSERT WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "emergency_profiles_upd" ON public.emergency_profiles
  FOR UPDATE USING (user_id = public.kromi_uid())
             WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "emergency_profiles_del" ON public.emergency_profiles
  FOR DELETE USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());

-- user_settings ─────────────────────────────────────────────────
CREATE POLICY "user_settings_sel" ON public.user_settings
  FOR SELECT USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());
CREATE POLICY "user_settings_ins" ON public.user_settings
  FOR INSERT WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "user_settings_upd" ON public.user_settings
  FOR UPDATE USING (user_id = public.kromi_uid())
             WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "user_settings_del" ON public.user_settings
  FOR DELETE USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());

-- maintenance_schedules ─────────────────────────────────────────
CREATE POLICY "maintenance_schedules_sel" ON public.maintenance_schedules
  FOR SELECT USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());
CREATE POLICY "maintenance_schedules_ins" ON public.maintenance_schedules
  FOR INSERT WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "maintenance_schedules_upd" ON public.maintenance_schedules
  FOR UPDATE USING (user_id = public.kromi_uid())
             WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "maintenance_schedules_del" ON public.maintenance_schedules
  FOR DELETE USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());

-- rider_presence ────────────────────────────────────────────────
-- Anyone authenticated can READ (community rescue visibility),
-- but you can only insert/update/delete your own row.
CREATE POLICY "rider_presence_sel" ON public.rider_presence
  FOR SELECT USING (public.kromi_uid() IS NOT NULL OR public.is_super_admin_jwt());
CREATE POLICY "rider_presence_ins" ON public.rider_presence
  FOR INSERT WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "rider_presence_upd" ON public.rider_presence
  FOR UPDATE USING (user_id = public.kromi_uid())
             WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "rider_presence_del" ON public.rider_presence
  FOR DELETE USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());

-- ═══════════════════════════════════════════════════════════════
-- TIER 2 — owner_user_id column
-- ═══════════════════════════════════════════════════════════════

-- kromi_files ───────────────────────────────────────────────────
CREATE POLICY "kromi_files_sel" ON public.kromi_files
  FOR SELECT USING (owner_user_id = public.kromi_uid() OR public.is_super_admin_jwt());
CREATE POLICY "kromi_files_ins" ON public.kromi_files
  FOR INSERT WITH CHECK (owner_user_id = public.kromi_uid());
CREATE POLICY "kromi_files_upd" ON public.kromi_files
  FOR UPDATE USING (owner_user_id = public.kromi_uid())
             WITH CHECK (owner_user_id = public.kromi_uid());
CREATE POLICY "kromi_files_del" ON public.kromi_files
  FOR DELETE USING (owner_user_id = public.kromi_uid() OR public.is_super_admin_jwt());

-- ═══════════════════════════════════════════════════════════════
-- TIER 3 — Child tables (join to parent via FK)
-- ═══════════════════════════════════════════════════════════════

-- ride_snapshots → ride_sessions ────────────────────────────────
CREATE POLICY "ride_snapshots_sel" ON public.ride_snapshots
  FOR SELECT USING (
    public.is_super_admin_jwt() OR EXISTS (
      SELECT 1 FROM public.ride_sessions s
      WHERE s.id = ride_snapshots.session_id AND s.user_id = public.kromi_uid()
    )
  );
CREATE POLICY "ride_snapshots_ins" ON public.ride_snapshots
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ride_sessions s
      WHERE s.id = ride_snapshots.session_id AND s.user_id = public.kromi_uid()
    )
  );
CREATE POLICY "ride_snapshots_del" ON public.ride_snapshots
  FOR DELETE USING (
    public.is_super_admin_jwt() OR EXISTS (
      SELECT 1 FROM public.ride_sessions s
      WHERE s.id = ride_snapshots.session_id AND s.user_id = public.kromi_uid()
    )
  );

-- ride_override_events → ride_sessions ──────────────────────────
CREATE POLICY "ride_override_events_sel" ON public.ride_override_events
  FOR SELECT USING (
    public.is_super_admin_jwt() OR EXISTS (
      SELECT 1 FROM public.ride_sessions s
      WHERE s.id = ride_override_events.session_id AND s.user_id = public.kromi_uid()
    )
  );
CREATE POLICY "ride_override_events_ins" ON public.ride_override_events
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ride_sessions s
      WHERE s.id = ride_override_events.session_id AND s.user_id = public.kromi_uid()
    )
  );

-- bike_fit_changes → bike_fits ──────────────────────────────────
CREATE POLICY "bike_fit_changes_sel" ON public.bike_fit_changes
  FOR SELECT USING (
    public.is_super_admin_jwt() OR EXISTS (
      SELECT 1 FROM public.bike_fits f
      WHERE f.id = bike_fit_changes.bike_fit_id AND f.user_id = public.kromi_uid()
    )
  );
CREATE POLICY "bike_fit_changes_ins" ON public.bike_fit_changes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bike_fits f
      WHERE f.id = bike_fit_changes.bike_fit_id AND f.user_id = public.kromi_uid()
    )
  );

-- service_requests → bike_configs (bike owner is the requester) ─
CREATE POLICY "service_requests_sel" ON public.service_requests
  FOR SELECT USING (
    public.is_super_admin_jwt() OR EXISTS (
      SELECT 1 FROM public.bike_configs b
      WHERE b.id::text = service_requests.bike_id AND b.user_id = public.kromi_uid()
    )
    -- Shop members can also see requests routed to their shop
    OR EXISTS (
      SELECT 1 FROM public.shop_members m
      WHERE m.shop_id = service_requests.shop_id AND m.user_id = public.kromi_uid()
    )
  );
CREATE POLICY "service_requests_ins" ON public.service_requests
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bike_configs b
      WHERE b.id::text = service_requests.bike_id AND b.user_id = public.kromi_uid()
    )
  );
CREATE POLICY "service_requests_upd" ON public.service_requests
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.bike_configs b
      WHERE b.id::text = service_requests.bike_id AND b.user_id = public.kromi_uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.shop_members m
      WHERE m.shop_id = service_requests.shop_id AND m.user_id = public.kromi_uid()
    )
  );
CREATE POLICY "service_requests_del" ON public.service_requests
  FOR DELETE USING (
    public.is_super_admin_jwt() OR EXISTS (
      SELECT 1 FROM public.bike_configs b
      WHERE b.id::text = service_requests.bike_id AND b.user_id = public.kromi_uid()
    )
  );

-- service_items / service_comments / service_photos → service_requests
-- (Same access rules: requester + shop_members of the shop + super admin.)
CREATE OR REPLACE FUNCTION public.can_access_service(p_service_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_super_admin_jwt()
      OR EXISTS (
        SELECT 1 FROM public.service_requests sr
        JOIN public.bike_configs b ON b.id::text = sr.bike_id
        WHERE sr.id = p_service_id AND b.user_id = public.kromi_uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.service_requests sr
        JOIN public.shop_members m ON m.shop_id = sr.shop_id
        WHERE sr.id = p_service_id AND m.user_id = public.kromi_uid()
      );
$$;
GRANT EXECUTE ON FUNCTION public.can_access_service(uuid) TO anon, authenticated;

CREATE POLICY "service_items_all" ON public.service_items
  FOR ALL
  USING (public.can_access_service(service_id))
  WITH CHECK (public.can_access_service(service_id));
CREATE POLICY "service_comments_all" ON public.service_comments
  FOR ALL
  USING (public.can_access_service(service_id))
  WITH CHECK (public.can_access_service(service_id));
CREATE POLICY "service_photos_all" ON public.service_photos
  FOR ALL
  USING (public.can_access_service(service_id))
  WITH CHECK (public.can_access_service(service_id));

-- ═══════════════════════════════════════════════════════════════
-- TIER 4 — Shared / social tables
-- ═══════════════════════════════════════════════════════════════

-- clubs — all authenticated users can read; only creator can modify.
CREATE POLICY "clubs_sel" ON public.clubs
  FOR SELECT USING (public.kromi_uid() IS NOT NULL OR public.is_super_admin_jwt());
CREATE POLICY "clubs_ins" ON public.clubs
  FOR INSERT WITH CHECK (created_by = public.kromi_uid());
CREATE POLICY "clubs_upd" ON public.clubs
  FOR UPDATE USING (created_by = public.kromi_uid() OR public.is_super_admin_jwt());
CREATE POLICY "clubs_del" ON public.clubs
  FOR DELETE USING (created_by = public.kromi_uid() OR public.is_super_admin_jwt());

-- club_members — read by members of the same club; self-insert/delete.
CREATE POLICY "club_members_sel" ON public.club_members
  FOR SELECT USING (
    public.is_super_admin_jwt()
    OR user_id = public.kromi_uid()
    OR EXISTS (
      SELECT 1 FROM public.club_members me
      WHERE me.club_id = club_members.club_id AND me.user_id = public.kromi_uid()
    )
  );
CREATE POLICY "club_members_ins" ON public.club_members
  FOR INSERT WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "club_members_del" ON public.club_members
  FOR DELETE USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());

-- club_rides — visible to members of the owning club.
CREATE POLICY "club_rides_sel" ON public.club_rides
  FOR SELECT USING (
    public.is_super_admin_jwt() OR EXISTS (
      SELECT 1 FROM public.club_members m
      WHERE m.club_id = club_rides.club_id AND m.user_id = public.kromi_uid()
    )
  );
CREATE POLICY "club_rides_ins" ON public.club_rides
  FOR INSERT WITH CHECK (created_by = public.kromi_uid());
CREATE POLICY "club_rides_upd" ON public.club_rides
  FOR UPDATE USING (created_by = public.kromi_uid() OR public.is_super_admin_jwt());
CREATE POLICY "club_rides_del" ON public.club_rides
  FOR DELETE USING (created_by = public.kromi_uid() OR public.is_super_admin_jwt());

-- club_ride_participants
CREATE POLICY "club_ride_participants_sel" ON public.club_ride_participants
  FOR SELECT USING (
    public.is_super_admin_jwt()
    OR user_id = public.kromi_uid()
    OR EXISTS (
      SELECT 1 FROM public.club_rides cr
      JOIN public.club_members m ON m.club_id = cr.club_id
      WHERE cr.id = club_ride_participants.session_id AND m.user_id = public.kromi_uid()
    )
  );
CREATE POLICY "club_ride_participants_ins" ON public.club_ride_participants
  FOR INSERT WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "club_ride_participants_del" ON public.club_ride_participants
  FOR DELETE USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());

-- shops — public read; writes by creator + shop_members + super admin.
CREATE POLICY "shops_sel" ON public.shops
  FOR SELECT USING (true); -- browsing shops is public
CREATE POLICY "shops_ins" ON public.shops
  FOR INSERT WITH CHECK (created_by = public.kromi_uid());
CREATE POLICY "shops_upd" ON public.shops
  FOR UPDATE USING (
    created_by = public.kromi_uid()
    OR public.is_super_admin_jwt()
    OR EXISTS (
      SELECT 1 FROM public.shop_members m
      WHERE m.shop_id = shops.id AND m.user_id = public.kromi_uid()
    )
  );
CREATE POLICY "shops_del" ON public.shops
  FOR DELETE USING (created_by = public.kromi_uid() OR public.is_super_admin_jwt());

-- shop_members — visible to other members of same shop.
CREATE POLICY "shop_members_sel" ON public.shop_members
  FOR SELECT USING (
    public.is_super_admin_jwt()
    OR user_id = public.kromi_uid()
    OR EXISTS (
      SELECT 1 FROM public.shop_members me
      WHERE me.shop_id = shop_members.shop_id AND me.user_id = public.kromi_uid()
    )
  );
CREATE POLICY "shop_members_mod" ON public.shop_members
  FOR ALL USING (
    public.is_super_admin_jwt()
    OR EXISTS (SELECT 1 FROM public.shops s WHERE s.id = shop_members.shop_id AND s.created_by = public.kromi_uid())
  ) WITH CHECK (
    public.is_super_admin_jwt()
    OR EXISTS (SELECT 1 FROM public.shops s WHERE s.id = shop_members.shop_id AND s.created_by = public.kromi_uid())
  );

-- shop_reviews — public read (so shop pages show reviews); owner-only writes.
CREATE POLICY "shop_reviews_sel" ON public.shop_reviews
  FOR SELECT USING (true);
CREATE POLICY "shop_reviews_ins" ON public.shop_reviews
  FOR INSERT WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "shop_reviews_upd" ON public.shop_reviews
  FOR UPDATE USING (user_id = public.kromi_uid())
             WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "shop_reviews_del" ON public.shop_reviews
  FOR DELETE USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());

-- shop_hours / shop_services / shop_calendar / shop_calendar_shares:
-- managed by shop members; publicly readable (needed for booking pages).
CREATE POLICY "shop_hours_sel" ON public.shop_hours FOR SELECT USING (true);
CREATE POLICY "shop_hours_mod" ON public.shop_hours
  FOR ALL USING (
    public.is_super_admin_jwt()
    OR EXISTS (SELECT 1 FROM public.shop_members m WHERE m.shop_id = shop_hours.shop_id AND m.user_id = public.kromi_uid())
  ) WITH CHECK (
    public.is_super_admin_jwt()
    OR EXISTS (SELECT 1 FROM public.shop_members m WHERE m.shop_id = shop_hours.shop_id AND m.user_id = public.kromi_uid())
  );

CREATE POLICY "shop_services_sel" ON public.shop_services FOR SELECT USING (true);
CREATE POLICY "shop_services_mod" ON public.shop_services
  FOR ALL USING (
    public.is_super_admin_jwt()
    OR EXISTS (SELECT 1 FROM public.shop_members m WHERE m.shop_id = shop_services.shop_id AND m.user_id = public.kromi_uid())
  ) WITH CHECK (
    public.is_super_admin_jwt()
    OR EXISTS (SELECT 1 FROM public.shop_members m WHERE m.shop_id = shop_services.shop_id AND m.user_id = public.kromi_uid())
  );

CREATE POLICY "shop_calendar_sel" ON public.shop_calendar
  FOR SELECT USING (
    public.is_super_admin_jwt()
    OR EXISTS (SELECT 1 FROM public.shop_members m WHERE m.shop_id = shop_calendar.shop_id AND m.user_id = public.kromi_uid())
  );
CREATE POLICY "shop_calendar_mod" ON public.shop_calendar
  FOR ALL USING (
    public.is_super_admin_jwt()
    OR EXISTS (SELECT 1 FROM public.shop_members m WHERE m.shop_id = shop_calendar.shop_id AND m.user_id = public.kromi_uid())
  ) WITH CHECK (
    public.is_super_admin_jwt()
    OR EXISTS (SELECT 1 FROM public.shop_members m WHERE m.shop_id = shop_calendar.shop_id AND m.user_id = public.kromi_uid())
  );

CREATE POLICY "shop_calendar_shares_sel" ON public.shop_calendar_shares
  FOR SELECT USING (
    public.is_super_admin_jwt()
    OR EXISTS (SELECT 1 FROM public.shop_members m WHERE m.shop_id = shop_calendar_shares.shop_id AND m.user_id = public.kromi_uid())
  );
CREATE POLICY "shop_calendar_shares_mod" ON public.shop_calendar_shares
  FOR ALL USING (
    public.is_super_admin_jwt()
    OR EXISTS (SELECT 1 FROM public.shop_members m WHERE m.shop_id = shop_calendar_shares.shop_id AND m.user_id = public.kromi_uid())
  ) WITH CHECK (
    public.is_super_admin_jwt()
    OR EXISTS (SELECT 1 FROM public.shop_members m WHERE m.shop_id = shop_calendar_shares.shop_id AND m.user_id = public.kromi_uid())
  );

-- ═══════════════════════════════════════════════════════════════
-- TIER 5 — Rescue: public-read while active, anon-insert allowed
-- ═══════════════════════════════════════════════════════════════

-- rescue_requests — victim_lat/lng visible while active so rescuers
-- can see them on the map. No direct user_id column — rows are keyed
-- by an emergency_token (random UUID stored in victim's localStorage).
CREATE POLICY "rescue_requests_sel" ON public.rescue_requests
  FOR SELECT USING (true); -- browsing active rescues is public
CREATE POLICY "rescue_requests_ins" ON public.rescue_requests
  FOR INSERT WITH CHECK (true); -- anyone in distress can insert
CREATE POLICY "rescue_requests_upd" ON public.rescue_requests
  FOR UPDATE USING (public.is_super_admin_jwt() OR status IN ('active','help_on_way'));

-- rescue_responses — visible to responders
CREATE POLICY "rescue_responses_sel" ON public.rescue_responses
  FOR SELECT USING (true);
CREATE POLICY "rescue_responses_ins" ON public.rescue_responses
  FOR INSERT WITH CHECK (public.kromi_uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════
-- TIER 6 — Auth infra (tight)
-- ═══════════════════════════════════════════════════════════════

-- device_tokens — self-manage own row; edge function (service role) bypasses.
CREATE POLICY "device_tokens_sel" ON public.device_tokens
  FOR SELECT USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());
CREATE POLICY "device_tokens_ins" ON public.device_tokens
  FOR INSERT WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "device_tokens_upd" ON public.device_tokens
  FOR UPDATE USING (user_id = public.kromi_uid())
             WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY "device_tokens_del" ON public.device_tokens
  FOR DELETE USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());

-- user_sessions — completely closed to anon/authenticated roles.
-- All reads go through resolve_session_user_id() which is SECURITY DEFINER.
-- (No policies means "deny all" once RLS is on — and it already is.)

-- login_history — own rows only
CREATE POLICY "login_history_sel" ON public.login_history
  FOR SELECT USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());
CREATE POLICY "login_history_ins" ON public.login_history
  FOR INSERT WITH CHECK (user_id = public.kromi_uid());

-- otp_codes — completely closed; only the send-otp/verify-otp edge
-- functions touch this table via service role.
-- (No policies = deny all.)

-- edge_function_rate_limits — managed by edge functions via service role.
-- (No policies = deny all for frontend.)

-- ═══════════════════════════════════════════════════════════════
-- TIER 7 — Public/ops tables
-- ═══════════════════════════════════════════════════════════════

-- debug_logs — anyone can POST a log entry (including anon during
-- bootstrap), nobody can read them from the frontend.
CREATE POLICY "debug_logs_ins" ON public.debug_logs
  FOR INSERT WITH CHECK (true);
CREATE POLICY "debug_logs_sel_admin" ON public.debug_logs
  FOR SELECT USING (public.is_super_admin_jwt());

-- elevation_cache — shared read-only cache, authenticated inserts.
CREATE POLICY "elevation_cache_sel" ON public.elevation_cache
  FOR SELECT USING (true);
CREATE POLICY "elevation_cache_ins" ON public.elevation_cache
  FOR INSERT WITH CHECK (public.kromi_uid() IS NOT NULL);

-- bike_components — catalogue, public read, authenticated upsert
-- (the useCount increment RPC uses SECURITY DEFINER).
CREATE POLICY "bike_components_sel" ON public.bike_components
  FOR SELECT USING (true);
CREATE POLICY "bike_components_ins" ON public.bike_components
  FOR INSERT WITH CHECK (public.kromi_uid() IS NOT NULL);
CREATE POLICY "bike_components_upd" ON public.bike_components
  FOR UPDATE USING (public.kromi_uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════
-- DONE. Smoke tests to run after apply:
--
-- 1. Impersonate anon: should see 0 rows in kromi_files of any user
--    SET LOCAL role TO anon;
--    SELECT COUNT(*) FROM public.kromi_files;  -- expect 0
--    RESET role;
--
-- 2. Simulate user X: should see only their own rides
--    SET LOCAL request.jwt.claims TO '{"sub":"<user-x-uuid>","role":"authenticated"}';
--    SELECT COUNT(*) FROM public.ride_sessions WHERE user_id = '<user-y-uuid>';
--    -- expect 0 (user Y's rides blocked)
--
-- 3. Simulate super admin: should see everything
--    SET LOCAL request.jwt.claims TO '{"sub":"<admin-uuid>","role":"authenticated"}';
--    SELECT COUNT(*) FROM public.ride_sessions;  -- expect all rows
--
-- ═══════════════════════════════════════════════════════════════
