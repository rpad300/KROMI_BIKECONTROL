-- ══════════════════════════════════════════════════════════════════
-- Live Tracking — add route_elevation_profile + ride_photos table
-- Session 22 | 2026-04-22
-- ══════════════════════════════════════════════════════════════════

-- 1. Add missing JSONB column for elevation profile on tracking_sessions
ALTER TABLE tracking_sessions
  ADD COLUMN IF NOT EXISTS route_elevation_profile jsonb;

COMMENT ON COLUMN tracking_sessions.route_elevation_profile
  IS 'Sampled elevation profile [{d: distance_m, e: elevation_m}, ...] for live viewer chart';

-- 2. Ride photos — links photos to tracking sessions with GPS coords
CREATE TABLE IF NOT EXISTS ride_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id),
  tracking_session_id uuid REFERENCES tracking_sessions(id) ON DELETE SET NULL,
  lat double precision NOT NULL DEFAULT 0,
  lng double precision NOT NULL DEFAULT 0,
  altitude double precision,
  drive_file_id text,
  drive_view_url text,
  drive_thumbnail_url text,
  caption text,
  media_type text NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo', 'video')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE ride_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY rp_owner_sel ON ride_photos FOR SELECT
  USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());

CREATE POLICY rp_owner_ins ON ride_photos FOR INSERT
  WITH CHECK (user_id = public.kromi_uid());

CREATE POLICY rp_owner_upd ON ride_photos FOR UPDATE
  USING (user_id = public.kromi_uid())
  WITH CHECK (user_id = public.kromi_uid());

CREATE POLICY rp_owner_del ON ride_photos FOR DELETE
  USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());

-- Public can see photos linked to public tracking sessions (for live viewer)
CREATE POLICY rp_public_read ON ride_photos FOR SELECT
  USING (tracking_session_id IS NOT NULL);

-- Index for session lookup
CREATE INDEX idx_rp_session ON ride_photos(tracking_session_id) WHERE tracking_session_id IS NOT NULL;
CREATE INDEX idx_rp_user ON ride_photos(user_id, created_at DESC);
