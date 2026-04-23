-- Add ride_data jsonb to club_rides for AI enrichment cache and ride analytics
ALTER TABLE public.club_rides ADD COLUMN IF NOT EXISTS ride_data jsonb;
