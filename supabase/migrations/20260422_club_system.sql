-- ═══════════════════════════════════════════════════════════════
-- Club System — Schema Extensions + New Tables + Triggers + RPCs
-- Session 23 — 2026-04-22
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. ALTER clubs table ───────────────────────────────────
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'private'));
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS slug text UNIQUE;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS banner_url text;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS founded_at date;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS social_links jsonb DEFAULT '{}';
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS landing_config jsonb DEFAULT '{}';

-- ─── 2. ALTER club_members — enforce 4-tier roles ──────────
ALTER TABLE public.club_members DROP CONSTRAINT IF EXISTS club_members_role_check;
ALTER TABLE public.club_members ADD CONSTRAINT club_members_role_check
  CHECK (role IN ('owner', 'admin', 'moderator', 'member'));
ALTER TABLE public.club_members ALTER COLUMN role SET DEFAULT 'member';

-- ─── 3. Slug generation trigger ─────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_club_slug()
RETURNS TRIGGER AS $$
DECLARE
  base_slug text;
  final_slug text;
  counter int := 1;
BEGIN
  base_slug := lower(regexp_replace(
    regexp_replace(NEW.name, '[^a-zA-Z0-9\s-]', '', 'g'),
    '\s+', '-', 'g'
  ));
  base_slug := trim(both '-' from base_slug);
  final_slug := base_slug;
  WHILE EXISTS (SELECT 1 FROM public.clubs WHERE slug = final_slug AND id != NEW.id) LOOP
    counter := counter + 1;
    final_slug := base_slug || '-' || counter;
  END LOOP;
  NEW.slug := final_slug;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public';

DROP TRIGGER IF EXISTS trg_club_slug ON public.clubs;
CREATE TRIGGER trg_club_slug
  BEFORE INSERT OR UPDATE OF name ON public.clubs
  FOR EACH ROW EXECUTE FUNCTION public.generate_club_slug();

-- Backfill slugs for existing clubs
UPDATE public.clubs SET name = name WHERE slug IS NULL;

-- ─── 4. club_invites ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.club_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  code text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(4), 'hex'),
  created_by uuid NOT NULL REFERENCES public.app_users(id),
  email text,
  max_uses int NOT NULL DEFAULT 1,
  used_count int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.club_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_invites FORCE ROW LEVEL SECURITY;

CREATE POLICY ci_manage ON public.club_invites FOR ALL
  USING (
    public.is_super_admin_jwt()
    OR EXISTS (
      SELECT 1 FROM public.club_members
      WHERE club_id = club_invites.club_id
      AND user_id = public.kromi_uid()
      AND role IN ('owner', 'admin', 'moderator')
    )
  );

CREATE POLICY ci_read_by_code ON public.club_invites FOR SELECT
  USING (public.kromi_uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_ci_code ON public.club_invites(code);
CREATE INDEX IF NOT EXISTS idx_ci_club ON public.club_invites(club_id);

-- ─── 5. club_join_requests ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.club_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.app_users(id),
  message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES public.app_users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(club_id, user_id, status)
);

ALTER TABLE public.club_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_join_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY cjr_own ON public.club_join_requests FOR SELECT
  USING (user_id = public.kromi_uid());

CREATE POLICY cjr_create ON public.club_join_requests FOR INSERT
  WITH CHECK (user_id = public.kromi_uid());

CREATE POLICY cjr_admin ON public.club_join_requests FOR ALL
  USING (
    public.is_super_admin_jwt()
    OR EXISTS (
      SELECT 1 FROM public.club_members
      WHERE club_id = club_join_requests.club_id
      AND user_id = public.kromi_uid()
      AND role IN ('owner', 'admin', 'moderator')
    )
  );

-- ─── 6. club_ride_posts (social feed) ───────────────────────
CREATE TABLE IF NOT EXISTS public.club_ride_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  ride_id uuid REFERENCES public.club_rides(id) ON DELETE SET NULL,
  author_id uuid NOT NULL REFERENCES public.app_users(id),
  content text,
  stats jsonb,
  photos jsonb DEFAULT '[]',
  gpx_file_id text,
  ride_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.club_ride_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_ride_posts FORCE ROW LEVEL SECURITY;

CREATE POLICY crp_member_read ON public.club_ride_posts FOR SELECT
  USING (
    public.is_super_admin_jwt()
    OR EXISTS (SELECT 1 FROM public.club_members WHERE club_id = club_ride_posts.club_id AND user_id = public.kromi_uid())
    OR EXISTS (SELECT 1 FROM public.clubs WHERE id = club_ride_posts.club_id AND visibility = 'public')
  );

CREATE POLICY crp_author ON public.club_ride_posts FOR ALL
  USING (author_id = public.kromi_uid());

CREATE INDEX IF NOT EXISTS idx_crp_club ON public.club_ride_posts(club_id, created_at DESC);

CREATE TRIGGER trg_club_ride_posts_updated_at
  BEFORE UPDATE ON public.club_ride_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─── 7. Helper functions ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_club_admin(p_club_id uuid, p_user_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_members
    WHERE club_id = p_club_id AND user_id = p_user_id
    AND role IN ('owner', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = 'public';

CREATE OR REPLACE FUNCTION public.is_club_staff(p_club_id uuid, p_user_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_members
    WHERE club_id = p_club_id AND user_id = p_user_id
    AND role IN ('owner', 'admin', 'moderator')
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = 'public';

-- ─── 8. club_use_invite ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_use_invite(p_code text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  v_invite record;
  v_uid uuid := public.kromi_uid();
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_invite FROM public.club_invites
  WHERE code = p_code AND expires_at > now()
  AND (max_uses = 0 OR used_count < max_uses);
  IF v_invite IS NULL THEN RAISE EXCEPTION 'invite_invalid_or_expired'; END IF;
  IF EXISTS (SELECT 1 FROM public.club_members WHERE club_id = v_invite.club_id AND user_id = v_uid) THEN
    RETURN v_invite.club_id;
  END IF;
  SELECT display_name INTO v_name FROM public.app_users WHERE id = v_uid;
  INSERT INTO public.club_members (club_id, user_id, display_name, role)
  VALUES (v_invite.club_id, v_uid, COALESCE(v_name, 'Rider'), 'member');
  UPDATE public.clubs SET member_count = COALESCE(member_count, 0) + 1 WHERE id = v_invite.club_id;
  UPDATE public.club_invites SET used_count = used_count + 1 WHERE id = v_invite.id;
  RETURN v_invite.club_id;
END;
$$;

-- ─── 9. club_request_join ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_request_join(p_club_id uuid, p_message text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  v_uid uuid := public.kromi_uid();
  v_vis text;
  v_req_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT visibility INTO v_vis FROM public.clubs WHERE id = p_club_id;
  IF v_vis IS NULL THEN RAISE EXCEPTION 'club_not_found'; END IF;
  IF EXISTS (SELECT 1 FROM public.club_members WHERE club_id = p_club_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'already_member';
  END IF;
  IF EXISTS (SELECT 1 FROM public.club_join_requests WHERE club_id = p_club_id AND user_id = v_uid AND status = 'pending') THEN
    RAISE EXCEPTION 'request_pending';
  END IF;
  INSERT INTO public.club_join_requests (club_id, user_id, message)
  VALUES (p_club_id, v_uid, p_message)
  RETURNING id INTO v_req_id;
  RETURN v_req_id;
END;
$$;

-- ─── 10. club_review_request ────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_review_request(p_request_id uuid, p_approve boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  v_uid uuid := public.kromi_uid();
  v_req record;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_req FROM public.club_join_requests WHERE id = p_request_id AND status = 'pending';
  IF v_req IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF NOT public.is_club_staff(v_req.club_id, v_uid) AND NOT public.is_super_admin_jwt() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.club_join_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      reviewed_by = v_uid, reviewed_at = now()
  WHERE id = p_request_id;
  IF p_approve THEN
    SELECT display_name INTO v_name FROM public.app_users WHERE id = v_req.user_id;
    INSERT INTO public.club_members (club_id, user_id, display_name, role)
    VALUES (v_req.club_id, v_req.user_id, COALESCE(v_name, 'Rider'), 'member')
    ON CONFLICT DO NOTHING;
    UPDATE public.clubs SET member_count = COALESCE(member_count, 0) + 1 WHERE id = v_req.club_id;
  END IF;
END;
$$;

-- ─── 11. club_set_member_role ───────────────────────────────
CREATE OR REPLACE FUNCTION public.club_set_member_role(p_club_id uuid, p_target_user_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  v_uid uuid := public.kromi_uid();
  v_caller_role text;
  v_target_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_role NOT IN ('owner', 'admin', 'moderator', 'member') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  SELECT role INTO v_caller_role FROM public.club_members WHERE club_id = p_club_id AND user_id = v_uid;
  SELECT role INTO v_target_role FROM public.club_members WHERE club_id = p_club_id AND user_id = p_target_user_id;
  IF v_caller_role IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_target_role IS NULL THEN RAISE EXCEPTION 'member_not_found'; END IF;
  IF p_role IN ('owner', 'admin') AND v_caller_role != 'owner' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_caller_role NOT IN ('owner', 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_target_role = 'owner' AND v_uid != p_target_user_id THEN RAISE EXCEPTION 'cannot_demote_owner'; END IF;
  IF p_role = 'owner' AND v_uid != p_target_user_id THEN
    UPDATE public.club_members SET role = 'admin' WHERE club_id = p_club_id AND user_id = v_uid;
  END IF;
  UPDATE public.club_members SET role = p_role WHERE club_id = p_club_id AND user_id = p_target_user_id;
END;
$$;

-- ─── 12. club_remove_member ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.club_remove_member(p_club_id uuid, p_target_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  v_uid uuid := public.kromi_uid();
  v_target_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.is_club_admin(p_club_id, v_uid) AND NOT public.is_super_admin_jwt() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT role INTO v_target_role FROM public.club_members WHERE club_id = p_club_id AND user_id = p_target_user_id;
  IF v_target_role = 'owner' THEN RAISE EXCEPTION 'cannot_remove_owner'; END IF;
  DELETE FROM public.club_members WHERE club_id = p_club_id AND user_id = p_target_user_id;
  UPDATE public.clubs SET member_count = GREATEST(COALESCE(member_count, 1) - 1, 0) WHERE id = p_club_id;
END;
$$;

-- ─── 13. club_update_landing_config ─────────────────────────
CREATE OR REPLACE FUNCTION public.club_update_landing_config(p_club_id uuid, p_config jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  v_uid uuid := public.kromi_uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.is_club_admin(p_club_id, v_uid) AND NOT public.is_super_admin_jwt() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.clubs
  SET landing_config = COALESCE(landing_config, '{}'::jsonb) || p_config
  WHERE id = p_club_id;
END;
$$;

-- ─── 14. Update clubs RLS for public landing page reads ─────
DROP POLICY IF EXISTS "clubs_sel" ON public.clubs;
CREATE POLICY "clubs_sel" ON public.clubs
  FOR SELECT USING (
    visibility = 'public'
    OR public.kromi_uid() IS NOT NULL
    OR public.is_super_admin_jwt()
  );

DROP POLICY IF EXISTS "club_members_sel" ON public.club_members;
CREATE POLICY "club_members_sel" ON public.club_members
  FOR SELECT USING (
    public.is_super_admin_jwt()
    OR user_id = public.kromi_uid()
    OR EXISTS (
      SELECT 1 FROM public.club_members me
      WHERE me.club_id = club_members.club_id AND me.user_id = public.kromi_uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.clubs c
      WHERE c.id = club_members.club_id AND c.visibility = 'public'
    )
  );
