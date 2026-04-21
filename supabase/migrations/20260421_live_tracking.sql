-- ══════════════════════════════════════════════════════════════════
-- Live Tracking — tracking_sessions + tracking_points
-- Session 21 | 2026-04-21
-- ══════════════════════════════════════════════════════════════════

-- Live tracking sessions
CREATE TABLE IF NOT EXISTS tracking_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id),
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  -- Latest snapshot (updated every 15s by the PWA)
  lat double precision,
  lng double precision,
  altitude double precision,
  heading double precision,
  speed_kmh double precision DEFAULT 0,
  avg_speed_kmh double precision DEFAULT 0,
  distance_km double precision DEFAULT 0,
  elevation_gain_m double precision DEFAULT 0,
  battery_pct integer DEFAULT 100,
  heart_rate integer DEFAULT 0,
  power_watts integer DEFAULT 0,
  cadence_rpm integer DEFAULT 0,
  assist_mode integer DEFAULT 0,
  gear integer DEFAULT 0,
  total_gears integer DEFAULT 12,
  range_km double precision DEFAULT 0,
  -- Route navigation (when GPX active)
  route_name text,
  route_total_km double precision,
  route_done_km double precision,
  route_remaining_km double precision,
  route_eta_min integer,
  route_progress_pct double precision DEFAULT 0,
  -- Metadata
  updated_at timestamptz DEFAULT now(),
  rider_name text,
  bike_name text
);

-- RLS: owner can CRUD, anyone can read by token
ALTER TABLE tracking_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ts_owner_all ON tracking_sessions FOR ALL USING (user_id = public.kromi_uid());
CREATE POLICY ts_public_read ON tracking_sessions FOR SELECT USING (true);

-- Index for token lookup
CREATE INDEX idx_tracking_token ON tracking_sessions(token) WHERE is_active = true;

-- Track history points (breadcrumb trail for the public viewer)
CREATE TABLE IF NOT EXISTS tracking_points (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  altitude double precision,
  speed_kmh double precision,
  heart_rate integer,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tracking_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY tp_owner_ins ON tracking_points FOR INSERT WITH CHECK (
  session_id IN (SELECT id FROM tracking_sessions WHERE user_id = public.kromi_uid())
);
CREATE POLICY tp_public_read ON tracking_points FOR SELECT USING (true);

CREATE INDEX idx_tp_session ON tracking_points(session_id, recorded_at DESC);
