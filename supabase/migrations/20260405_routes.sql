-- Routes table — stores planned routes from GPX/Komoot for KROMI Intelligence
-- Applied via Supabase Dashboard > SQL Editor

create table if not exists routes (
  id uuid default gen_random_uuid() primary key,
  user_id text not null default 'default',
  name text not null,
  description text,
  source text not null default 'gpx',  -- 'gpx' | 'komoot' | 'manual'
  source_url text,                      -- Komoot URL if applicable

  -- Route geometry (compressed: only key points, not every GPS sample)
  points jsonb not null,                -- Array of {lat, lng, elevation, distance_from_start_m}
  total_distance_km numeric not null,
  total_elevation_gain_m numeric not null,
  total_elevation_loss_m numeric not null,

  -- Terrain summary (from OSM analysis)
  surface_summary jsonb,                -- {paved: 45, gravel: 30, dirt: 20, technical: 5} (%)
  max_gradient_pct numeric,
  avg_gradient_pct numeric,

  -- Pre-ride estimates (from KROMI analysis)
  estimated_wh numeric,                 -- Total motor Wh needed
  estimated_time_min numeric,           -- Estimated ride time
  estimated_glycogen_g numeric,         -- Glycogen consumption estimate

  -- Bounding box (for map display)
  bbox_north numeric,
  bbox_south numeric,
  bbox_east numeric,
  bbox_west numeric,

  -- Metadata
  is_favorite boolean default false,
  ride_count integer default 0,         -- How many times ridden
  last_ridden_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Index for user queries
create index if not exists idx_routes_user on routes(user_id);
create index if not exists idx_routes_favorite on routes(user_id, is_favorite);

-- Add route_id to ride_sessions for linking rides to planned routes
alter table ride_sessions add column if not exists route_id uuid references routes(id);
