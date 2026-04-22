-- ══════════════════════════════════════════════════════════════════
-- Tighten RLS policies — restrict public SELECT scope
-- Session 22 | 2026-04-22
-- ══════════════════════════════════════════════════════════════════

-- 1. tracking_sessions: only active sessions are publicly readable
--    (live.html/emergency.html filter by token anyway)
DROP POLICY IF EXISTS ts_public_read ON tracking_sessions;
CREATE POLICY ts_public_read ON tracking_sessions
  FOR SELECT USING (is_active = true);

-- 2. tracking_points: only points from active sessions are publicly readable
DROP POLICY IF EXISTS tp_public_read ON tracking_points;
CREATE POLICY tp_public_read ON tracking_points
  FOR SELECT USING (
    session_id IN (SELECT id FROM tracking_sessions WHERE is_active = true)
  );

-- 3. ride_photos: only photos from active tracking sessions are public
--    (was USING (tracking_session_id IS NOT NULL) — exposed all photos)
DROP POLICY IF EXISTS rp_public_read ON ride_photos;
CREATE POLICY rp_public_read ON ride_photos
  FOR SELECT USING (
    tracking_session_id IN (SELECT id FROM tracking_sessions WHERE is_active = true)
  );
