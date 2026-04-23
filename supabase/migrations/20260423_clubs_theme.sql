-- Add theme jsonb to clubs for club-branded ride pages
-- Fields: font_heading, font_body, color_primary, color_secondary, dark_bg, light_bg
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS theme jsonb;
