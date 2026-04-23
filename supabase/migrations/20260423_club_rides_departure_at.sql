-- Add departure_at (ride start time) separate from scheduled_at (meeting time)
-- scheduled_at = when riders meet at the location
-- departure_at = when they actually start riding (used for chronogram/weather)
ALTER TABLE public.club_rides ADD COLUMN IF NOT EXISTS departure_at timestamptz;
