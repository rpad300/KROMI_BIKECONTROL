-- Add avatar_url to app_users and club_members
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.club_members ADD COLUMN IF NOT EXISTS avatar_url text;
