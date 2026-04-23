# Club System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete club/team system with 4-tier roles, public/private visibility, invite links, backoffice, professional landing pages, and editorial ride pages.

**Architecture:** Three sequential sub-projects. Sub-project 1 builds the DB schema, SECURITY DEFINER RPCs, a ClubService abstraction, and the admin UI tabs in Settings. Sub-project 2 creates a standalone `club.html` landing page with data from Supabase anon reads. Sub-project 3 creates a standalone `ride.html` editorial page with SVG altimetry and per-rider stats.

**Tech Stack:** Supabase PostgreSQL (custom JWT + kromi_uid() RLS), React 18 + TypeScript + Tailwind (dark-first), Zustand, supaFetch, KromiFileStore, standalone HTML pages (like live.html pattern).

**Spec:** `docs/superpowers/specs/2026-04-22-club-system-design.md`

---

## Existing State

- **Tables exist:** `clubs`, `club_members`, `club_rides`, `club_ride_participants` with RLS (session 18 migration)
- **ClubPage exists:** `src/components/Settings/Settings.tsx:422-873` — basic search, join, create, members list, group rides with GPX support
- **No ClubService** — ClubPage calls supaFetch directly
- **Navigation:** `src/config/navigation.ts` has `features.clubs` permission gate
- **Missing:** slug, visibility, avatar_url, banner_url, social_links, landing_config columns; club_invites, club_join_requests, club_ride_posts tables; all RPCs; email invite edge function; club.html; ride.html

## File Structure

### New Files
```
supabase/migrations/20260422_club_system.sql          — Schema extensions + new tables + triggers + RPCs
supabase/functions/club-invite/index.ts                — Email invite via Resend
src/services/club/ClubService.ts                       — Club CRUD, invites, requests, role management
src/components/Club/ClubSettingsTab.tsx                 — Club settings (name, visibility, avatar, social)
src/components/Club/ClubMembersTab.tsx                  — Members list, role changes, kick, join requests
src/components/Club/ClubInvitesTab.tsx                  — Invite link generation, email invites
src/components/Club/ClubBackofficeTab.tsx               — Landing page config (toggles, about, board)
public/club.html                                       — Public club landing page (~900 lines)
public/ride.html                                       — Editorial ride page (~1100 lines)
```

### Modified Files
```
src/components/Settings/Settings.tsx                   — Refactor ClubPage into tab navigation
```

---

## SUB-PROJECT 1: Club Core

### Task 1: Database Migration — Schema Extensions

**Files:**
- Create: `supabase/migrations/20260422_club_system.sql`

- [ ] **Step 1: Write the migration SQL — ALTER clubs table**

Apply via Supabase MCP `apply_migration`. The full migration content:

```sql
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
```

- [ ] **Step 2: Write slug generation trigger**

```sql
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
```

- [ ] **Step 3: Write club_invites table + RLS**

```sql
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

-- Admins+ can manage invites for their club
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

-- Anyone authenticated can read an invite by code (for join flow)
CREATE POLICY ci_read_by_code ON public.club_invites FOR SELECT
  USING (public.kromi_uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_ci_code ON public.club_invites(code);
CREATE INDEX IF NOT EXISTS idx_ci_club ON public.club_invites(club_id);
```

- [ ] **Step 4: Write club_join_requests table + RLS**

```sql
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

-- User can see their own requests
CREATE POLICY cjr_own ON public.club_join_requests FOR SELECT
  USING (user_id = public.kromi_uid());

-- User can create their own request
CREATE POLICY cjr_create ON public.club_join_requests FOR INSERT
  WITH CHECK (user_id = public.kromi_uid());

-- Club admins+ can see and manage requests for their club
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
```

- [ ] **Step 5: Write club_ride_posts table + RLS**

```sql
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

-- Club members + public clubs can read
CREATE POLICY crp_member_read ON public.club_ride_posts FOR SELECT
  USING (
    public.is_super_admin_jwt()
    OR EXISTS (SELECT 1 FROM public.club_members WHERE club_id = club_ride_posts.club_id AND user_id = public.kromi_uid())
    OR EXISTS (SELECT 1 FROM public.clubs WHERE id = club_ride_posts.club_id AND visibility = 'public')
  );

-- Author can CRUD their own posts
CREATE POLICY crp_author ON public.club_ride_posts FOR ALL
  USING (author_id = public.kromi_uid());

CREATE INDEX IF NOT EXISTS idx_crp_club ON public.club_ride_posts(club_id, created_at DESC);

-- Updated-at trigger
CREATE TRIGGER trg_club_ride_posts_updated_at
  BEFORE UPDATE ON public.club_ride_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
```

- [ ] **Step 6: Write the SECURITY DEFINER RPCs**

```sql
-- ─── 7. Helper: is_club_admin ───────────────────────────────
CREATE OR REPLACE FUNCTION public.is_club_admin(p_club_id uuid, p_user_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_members
    WHERE club_id = p_club_id AND user_id = p_user_id
    AND role IN ('owner', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = 'public';

-- Helper: is_club_staff (admin + moderator)
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

  -- Check not already a member
  IF EXISTS (SELECT 1 FROM public.club_members WHERE club_id = v_invite.club_id AND user_id = v_uid) THEN
    RETURN v_invite.club_id; -- Already a member, just return club_id
  END IF;

  -- Get display name
  SELECT display_name INTO v_name FROM public.app_users WHERE id = v_uid;

  -- Insert member
  INSERT INTO public.club_members (club_id, user_id, display_name, role)
  VALUES (v_invite.club_id, v_uid, COALESCE(v_name, 'Rider'), 'member');

  -- Increment member count
  UPDATE public.clubs SET member_count = COALESCE(member_count, 0) + 1 WHERE id = v_invite.club_id;

  -- Increment invite used_count
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

  -- Check not already a member
  IF EXISTS (SELECT 1 FROM public.club_members WHERE club_id = p_club_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'already_member';
  END IF;

  -- Check no pending request
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
      reviewed_by = v_uid,
      reviewed_at = now()
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

  -- Only owner can set roles to owner/admin; admins can set moderator/member
  IF p_role IN ('owner', 'admin') AND v_caller_role != 'owner' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_caller_role NOT IN ('owner', 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Cannot demote the owner unless you ARE the owner transferring ownership
  IF v_target_role = 'owner' AND v_uid != p_target_user_id THEN RAISE EXCEPTION 'cannot_demote_owner'; END IF;

  -- If promoting someone to owner, demote current owner to admin
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

-- ─── 14. Update clubs RLS for public read (anon for landing page) ───
-- The landing page reads club data with just the anon key, so we need
-- to allow SELECT on public clubs without kromi_uid().
-- Drop the old policy that requires kromi_uid() IS NOT NULL and replace
-- with one that allows reading public clubs without auth.
DROP POLICY IF EXISTS "clubs_sel" ON public.clubs;
CREATE POLICY "clubs_sel" ON public.clubs
  FOR SELECT USING (
    visibility = 'public'
    OR public.kromi_uid() IS NOT NULL
    OR public.is_super_admin_jwt()
  );

-- Also allow anon reads on club_members for public clubs (landing page)
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
```

- [ ] **Step 7: Apply migration via Supabase MCP**

Run: `apply_migration` with name `20260422_club_system` and the combined SQL from steps 1-6.

- [ ] **Step 8: Verify migration by listing tables**

Run: `list_tables` to confirm `club_invites`, `club_join_requests`, `club_ride_posts` exist.
Run: `execute_sql` with `SELECT slug FROM clubs LIMIT 5;` to verify slug backfill.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260422_club_system.sql
git commit -m "feat(clubs): schema extensions — slug, visibility, invites, join requests, ride posts, 7 RPCs"
```

---

### Task 2: ClubService — Service Abstraction Layer

**Files:**
- Create: `src/services/club/ClubService.ts`

- [ ] **Step 1: Create ClubService with types and CRUD**

```typescript
// src/services/club/ClubService.ts
import { supaFetch, supaGet, supaRpc } from '../../lib/supaFetch';

// ─── Types ──────────────────────────────────────────────────
export interface Club {
  id: string;
  name: string;
  slug: string;
  color: string;
  location: string;
  description?: string;
  website?: string;
  visibility: 'public' | 'private';
  avatar_url?: string;
  banner_url?: string;
  founded_at?: string;
  social_links: Record<string, string>;
  landing_config: LandingConfig;
  member_count: number;
  created_by: string;
}

export interface LandingConfig {
  show_members?: boolean;
  show_leaderboard?: boolean;
  show_map?: boolean;
  show_feed?: boolean;
  show_upcoming_rides?: boolean;
  custom_about?: string;
  board_members?: BoardMember[];
  show_board?: boolean;
}

export interface BoardMember {
  user_id: string;
  title: string;
  display_name?: string;
  avatar_url?: string;
}

export interface ClubMember {
  user_id: string;
  club_id: string;
  display_name: string;
  role: 'owner' | 'admin' | 'moderator' | 'member';
  joined_at: string;
  avatar_url?: string;
}

export interface ClubInvite {
  id: string;
  club_id: string;
  code: string;
  created_by: string;
  email?: string;
  max_uses: number;
  used_count: number;
  expires_at: string;
  created_at: string;
}

export interface ClubJoinRequest {
  id: string;
  club_id: string;
  user_id: string;
  message?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
  // Joined from app_users for display
  display_name?: string;
}

export interface ClubRidePost {
  id: string;
  club_id: string;
  ride_id?: string;
  author_id: string;
  content?: string;
  stats?: Record<string, unknown>;
  photos?: { drive_view_url: string; drive_thumbnail_url: string; caption?: string; lat?: number; lng?: number }[];
  gpx_file_id?: string;
  ride_data?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
  // Joined
  author_name?: string;
  author_avatar?: string;
}

// ─── Club CRUD ──────────────────────────────────────────────
export async function getClub(clubId: string): Promise<Club | null> {
  const data = await supaGet<Club[]>(`/rest/v1/clubs?id=eq.${clubId}&select=*&limit=1`);
  return data[0] ?? null;
}

export async function getClubBySlug(slug: string): Promise<Club | null> {
  const data = await supaGet<Club[]>(`/rest/v1/clubs?slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`);
  return data[0] ?? null;
}

export async function searchClubs(query: string): Promise<Club[]> {
  if (query.length < 2) return [];
  return supaGet<Club[]>(`/rest/v1/clubs?name=ilike.*${encodeURIComponent(query)}*&select=*&limit=10`);
}

export async function updateClub(clubId: string, updates: Partial<Pick<Club, 'name' | 'location' | 'color' | 'website' | 'description' | 'visibility' | 'avatar_url' | 'banner_url' | 'founded_at' | 'social_links'>>): Promise<void> {
  await supaFetch(`/rest/v1/clubs?id=eq.${clubId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

// ─── Members ────────────────────────────────────────────────
export async function getMembers(clubId: string): Promise<ClubMember[]> {
  return supaGet<ClubMember[]>(`/rest/v1/club_members?club_id=eq.${clubId}&select=user_id,club_id,display_name,role,joined_at,avatar_url&order=joined_at.asc`);
}

export async function setMemberRole(clubId: string, targetUserId: string, role: string): Promise<void> {
  await supaRpc('club_set_member_role', { p_club_id: clubId, p_target_user_id: targetUserId, p_role: role });
}

export async function removeMember(clubId: string, targetUserId: string): Promise<void> {
  await supaRpc('club_remove_member', { p_club_id: clubId, p_target_user_id: targetUserId });
}

// ─── Invites ────────────────────────────────────────────────
export async function getInvites(clubId: string): Promise<ClubInvite[]> {
  return supaGet<ClubInvite[]>(`/rest/v1/club_invites?club_id=eq.${clubId}&order=created_at.desc`);
}

export async function createInvite(clubId: string, createdBy: string, opts: { email?: string; maxUses?: number; expiresInDays?: number } = {}): Promise<ClubInvite> {
  const expiresAt = new Date(Date.now() + (opts.expiresInDays ?? 7) * 86400000).toISOString();
  const res = await supaFetch('/rest/v1/club_invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({
      club_id: clubId,
      created_by: createdBy,
      email: opts.email ?? null,
      max_uses: opts.maxUses ?? 0,
      expires_at: expiresAt,
    }),
  });
  const [invite] = await res.json();
  return invite;
}

export async function useInvite(code: string): Promise<string> {
  return supaRpc<string>('club_use_invite', { p_code: code });
}

// ─── Join Requests ──────────────────────────────────────────
export async function getJoinRequests(clubId: string): Promise<ClubJoinRequest[]> {
  return supaGet<ClubJoinRequest[]>(`/rest/v1/club_join_requests?club_id=eq.${clubId}&status=eq.pending&order=created_at.asc`);
}

export async function requestJoin(clubId: string, message?: string): Promise<string> {
  return supaRpc<string>('club_request_join', { p_club_id: clubId, p_message: message ?? null });
}

export async function reviewRequest(requestId: string, approve: boolean): Promise<void> {
  await supaRpc('club_review_request', { p_request_id: requestId, p_approve: approve });
}

// ─── Landing Config ─────────────────────────────────────────
export async function updateLandingConfig(clubId: string, config: Partial<LandingConfig>): Promise<void> {
  await supaRpc('club_update_landing_config', { p_club_id: clubId, p_config: config });
}

// ─── Ride Posts ─────────────────────────────────────────────
export async function getRidePosts(clubId: string, limit = 20): Promise<ClubRidePost[]> {
  return supaGet<ClubRidePost[]>(`/rest/v1/club_ride_posts?club_id=eq.${clubId}&order=created_at.desc&limit=${limit}`);
}

export async function createRidePost(post: Omit<ClubRidePost, 'id' | 'created_at' | 'updated_at'>): Promise<ClubRidePost> {
  const res = await supaFetch('/rest/v1/club_ride_posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(post),
  });
  const [created] = await res.json();
  return created;
}
```

- [ ] **Step 2: Verify build passes**

Run: `npm run type-check`
Expected: No errors related to ClubService.

- [ ] **Step 3: Commit**

```bash
git add src/services/club/ClubService.ts
git commit -m "feat(clubs): ClubService abstraction — CRUD, invites, join requests, ride posts"
```

---

### Task 3: Club Settings Tab Component

**Files:**
- Create: `src/components/Club/ClubSettingsTab.tsx`

- [ ] **Step 1: Create ClubSettingsTab component**

```typescript
// src/components/Club/ClubSettingsTab.tsx
import { useState, useEffect } from 'react';
import { getClub, updateClub, type Club } from '../../services/club/ClubService';
import { uploadFile, userFolderSlug } from '../../services/storage/KromiFileStore';
import { useAuthStore } from '../../store/authStore';

interface Props {
  clubId: string;
  onUpdated: () => void;
}

export function ClubSettingsTab({ clubId, onUpdated }: Props) {
  const [club, setClub] = useState<Club | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', location: '', color: '#3fff8b', website: '', description: '',
    visibility: 'public' as 'public' | 'private',
    founded_at: '',
    social_instagram: '', social_facebook: '', social_website: '',
  });

  useEffect(() => {
    getClub(clubId).then((c) => {
      if (!c) return;
      setClub(c);
      setForm({
        name: c.name ?? '', location: c.location ?? '', color: c.color ?? '#3fff8b',
        website: c.website ?? '', description: c.description ?? '',
        visibility: c.visibility ?? 'public',
        founded_at: c.founded_at ?? '',
        social_instagram: c.social_links?.instagram ?? '',
        social_facebook: c.social_links?.facebook ?? '',
        social_website: c.social_links?.website ?? '',
      });
    });
  }, [clubId]);

  const save = async () => {
    setSaving(true);
    try {
      await updateClub(clubId, {
        name: form.name, location: form.location, color: form.color,
        website: form.website, description: form.description,
        visibility: form.visibility, founded_at: form.founded_at || undefined,
        social_links: {
          instagram: form.social_instagram || undefined,
          facebook: form.social_facebook || undefined,
          website: form.social_website || undefined,
        },
      });
      onUpdated();
    } finally { setSaving(false); }
  };

  const uploadImage = async (type: 'avatar_url' | 'banner_url', file: File) => {
    const user = useAuthStore.getState().user;
    if (!user) return;
    const result = await uploadFile(file, {
      ownerUserId: user.id,
      ownerUserSlug: userFolderSlug(user),
      category: 'club_photo',
      entityType: 'club',
      entityId: clubId,
    });
    if (result?.drive_view_link) {
      await updateClub(clubId, { [type]: result.drive_view_link });
      setClub((c) => c ? { ...c, [type]: result.drive_view_link } : c);
    }
  };

  if (!club) return <div style={{ color: '#777', fontSize: '11px', textAlign: 'center', padding: '20px' }}>A carregar...</div>;

  const inputStyle = { width: '100%', backgroundColor: '#262626', color: 'white', padding: '10px', border: '1px solid #333', fontSize: '12px', borderRadius: '4px' };
  const labelStyle = { fontSize: '10px', color: '#888', marginBottom: '2px', display: 'block' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Geral */}
      <div style={{ backgroundColor: '#1a1919', padding: '12px', borderRadius: '8px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#fbbf24', marginBottom: '8px' }}>GERAL</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div><label style={labelStyle}>Nome</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} /></div>
          <div><label style={labelStyle}>Localizacao</label><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} style={inputStyle} /></div>
          <div><label style={labelStyle}>Website</label><input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} style={inputStyle} /></div>
          <div><label style={labelStyle}>Descricao</label><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} /></div>
          <div><label style={labelStyle}>Data de Fundacao</label><input type="date" value={form.founded_at} onChange={(e) => setForm({ ...form, founded_at: e.target.value })} style={inputStyle} /></div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: '#adaaaa', fontSize: '12px' }}>Cor</span>
            <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} style={{ width: '40px', height: '30px', border: 'none', cursor: 'pointer' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: '#adaaaa', fontSize: '12px' }}>Visibilidade</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {(['public', 'private'] as const).map((v) => (
                <button key={v} onClick={() => setForm({ ...form, visibility: v })}
                  style={{ padding: '4px 12px', fontSize: '11px', fontWeight: 600, border: 'none', cursor: 'pointer',
                    backgroundColor: form.visibility === v ? '#3fff8b' : '#262626',
                    color: form.visibility === v ? 'black' : '#adaaaa', borderRadius: '4px' }}>
                  {v === 'public' ? 'Publico' : 'Privado'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Imagem */}
      <div style={{ backgroundColor: '#1a1919', padding: '12px', borderRadius: '8px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#fbbf24', marginBottom: '8px' }}>IMAGEM</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Avatar (logo)</label>
            {club.avatar_url && <img src={club.avatar_url} alt="avatar" style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover', marginBottom: '4px' }} />}
            <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage('avatar_url', f); }}
              style={{ fontSize: '10px', color: '#888' }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Banner</label>
            {club.banner_url && <img src={club.banner_url} alt="banner" style={{ width: '100%', height: '48px', objectFit: 'cover', borderRadius: '4px', marginBottom: '4px' }} />}
            <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage('banner_url', f); }}
              style={{ fontSize: '10px', color: '#888' }} />
          </div>
        </div>
      </div>

      {/* Social */}
      <div style={{ backgroundColor: '#1a1919', padding: '12px', borderRadius: '8px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#fbbf24', marginBottom: '8px' }}>REDES SOCIAIS</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div><label style={labelStyle}>Instagram</label><input value={form.social_instagram} onChange={(e) => setForm({ ...form, social_instagram: e.target.value })} placeholder="https://instagram.com/..." style={inputStyle} /></div>
          <div><label style={labelStyle}>Facebook</label><input value={form.social_facebook} onChange={(e) => setForm({ ...form, social_facebook: e.target.value })} placeholder="https://facebook.com/..." style={inputStyle} /></div>
        </div>
      </div>

      <button onClick={save} disabled={saving}
        style={{ width: '100%', padding: '12px', backgroundColor: '#3fff8b', color: 'black', border: 'none', fontWeight: 700, fontSize: '13px', cursor: 'pointer', borderRadius: '6px', opacity: saving ? 0.5 : 1 }}>
        {saving ? 'A guardar...' : 'Guardar Alteracoes'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Club/ClubSettingsTab.tsx
git commit -m "feat(clubs): ClubSettingsTab — name, visibility, avatar, social links"
```

---

### Task 4: Club Members Tab Component

**Files:**
- Create: `src/components/Club/ClubMembersTab.tsx`

- [ ] **Step 1: Create ClubMembersTab component**

```typescript
// src/components/Club/ClubMembersTab.tsx
import { useState, useEffect } from 'react';
import { getMembers, getJoinRequests, setMemberRole, removeMember, reviewRequest, type ClubMember, type ClubJoinRequest } from '../../services/club/ClubService';
import { useAuthStore } from '../../store/authStore';

interface Props {
  clubId: string;
  userRole: string;
}

const ROLE_COLORS: Record<string, string> = { owner: '#fbbf24', admin: '#6e9bff', moderator: '#e966ff', member: '#777' };
const ROLE_ICONS: Record<string, string> = { owner: 'stars', admin: 'shield', moderator: 'build', member: 'person' };
const ROLE_OPTIONS = ['owner', 'admin', 'moderator', 'member'] as const;

export function ClubMembersTab({ clubId, userRole }: Props) {
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [requests, setRequests] = useState<ClubJoinRequest[]>([]);
  const userId = useAuthStore.getState().getUserId();
  const canManage = userRole === 'owner' || userRole === 'admin';
  const canModerate = canManage || userRole === 'moderator';

  const loadData = () => {
    getMembers(clubId).then(setMembers);
    if (canModerate) getJoinRequests(clubId).then(setRequests);
  };

  useEffect(() => { loadData(); }, [clubId]);

  const handleRoleChange = async (targetId: string, newRole: string) => {
    if (!confirm(`Alterar role para ${newRole}?`)) return;
    await setMemberRole(clubId, targetId, newRole);
    loadData();
  };

  const handleKick = async (targetId: string, name: string) => {
    if (!confirm(`Expulsar ${name}?`)) return;
    await removeMember(clubId, targetId);
    loadData();
  };

  const handleReview = async (reqId: string, approve: boolean) => {
    await reviewRequest(reqId, approve);
    loadData();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Pending join requests */}
      {canModerate && requests.length > 0 && (
        <div style={{ backgroundColor: '#1a1919', padding: '12px', borderRadius: '8px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#e966ff', marginBottom: '8px' }}>
            PEDIDOS DE ADESAO ({requests.length})
          </div>
          {requests.map((req) => (
            <div key={req.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #262626' }}>
              <div>
                <div style={{ fontSize: '12px', color: 'white' }}>{req.display_name || 'Rider'}</div>
                {req.message && <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>{req.message}</div>}
                <div style={{ fontSize: '9px', color: '#555' }}>{new Date(req.created_at).toLocaleDateString('pt-PT')}</div>
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button onClick={() => handleReview(req.id, true)}
                  style={{ padding: '4px 10px', backgroundColor: '#3fff8b', color: 'black', border: 'none', fontSize: '10px', fontWeight: 700, cursor: 'pointer', borderRadius: '4px' }}>
                  Aceitar
                </button>
                <button onClick={() => handleReview(req.id, false)}
                  style={{ padding: '4px 10px', backgroundColor: '#262626', color: '#ff716c', border: '1px solid rgba(255,113,108,0.3)', fontSize: '10px', fontWeight: 700, cursor: 'pointer', borderRadius: '4px' }}>
                  Rejeitar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Members list */}
      <div style={{ backgroundColor: '#1a1919', padding: '12px', borderRadius: '8px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#fbbf24', marginBottom: '8px' }}>
          MEMBROS ({members.length})
        </div>
        {members.map((m) => (
          <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1e1e1e' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '18px', color: ROLE_COLORS[m.role] }}>{ROLE_ICONS[m.role]}</span>
              <div>
                <div style={{ fontSize: '12px', color: 'white' }}>{m.display_name || 'Rider'}</div>
                <div style={{ fontSize: '9px', color: '#555' }}>{new Date(m.joined_at).toLocaleDateString('pt-PT')}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {canManage && m.user_id !== userId && m.role !== 'owner' ? (
                <select value={m.role} onChange={(e) => handleRoleChange(m.user_id, e.target.value)}
                  style={{ backgroundColor: '#262626', color: ROLE_COLORS[m.role], border: 'none', fontSize: '10px', padding: '2px 4px', cursor: 'pointer' }}>
                  {ROLE_OPTIONS.filter((r) => userRole === 'owner' || r !== 'owner').map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              ) : (
                <span style={{ fontSize: '9px', padding: '1px 6px', backgroundColor: ROLE_COLORS[m.role] + '22', color: ROLE_COLORS[m.role], borderRadius: '4px' }}>{m.role}</span>
              )}
              {canManage && m.user_id !== userId && m.role !== 'owner' && (
                <button onClick={() => handleKick(m.user_id, m.display_name)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#ff716c' }}>person_remove</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Club/ClubMembersTab.tsx
git commit -m "feat(clubs): ClubMembersTab — role management, kick, join request approval"
```

---

### Task 5: Club Invites Tab Component

**Files:**
- Create: `src/components/Club/ClubInvitesTab.tsx`

- [ ] **Step 1: Create ClubInvitesTab component**

```typescript
// src/components/Club/ClubInvitesTab.tsx
import { useState, useEffect } from 'react';
import { getInvites, createInvite, type ClubInvite } from '../../services/club/ClubService';
import { useAuthStore } from '../../store/authStore';

interface Props {
  clubId: string;
  clubSlug: string;
}

export function ClubInvitesTab({ clubId, clubSlug }: Props) {
  const [invites, setInvites] = useState<ClubInvite[]>([]);
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState('');
  const [maxUses, setMaxUses] = useState(0);
  const [expiryDays, setExpiryDays] = useState(7);
  const [copied, setCopied] = useState<string | null>(null);
  const userId = useAuthStore.getState().getUserId();

  const load = () => { getInvites(clubId).then(setInvites); };
  useEffect(() => { load(); }, [clubId]);

  const handleCreate = async () => {
    if (!userId) return;
    await createInvite(clubId, userId, { email: email || undefined, maxUses, expiresInDays: expiryDays });
    setCreating(false); setEmail(''); load();
  };

  const copyLink = (code: string) => {
    const url = `https://www.kromi.online/club.html?s=${clubSlug}&invite=${code}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const inputStyle = { width: '100%', backgroundColor: '#262626', color: 'white', padding: '8px', border: '1px solid #333', fontSize: '12px', borderRadius: '4px' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Create invite */}
      {creating ? (
        <div style={{ backgroundColor: '#1a1919', padding: '12px', borderRadius: '8px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#e966ff', marginBottom: '8px' }}>NOVO CONVITE</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>
              <div style={{ fontSize: '10px', color: '#888', marginBottom: '2px' }}>Email (opcional — vazio = link generico)</div>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemplo.com" style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '10px', color: '#888', marginBottom: '2px' }}>Max usos (0 = ilimitado)</div>
                <input type="number" value={maxUses} onChange={(e) => setMaxUses(+e.target.value)} min={0} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '10px', color: '#888', marginBottom: '2px' }}>Expira em (dias)</div>
                <input type="number" value={expiryDays} onChange={(e) => setExpiryDays(+e.target.value)} min={1} max={90} style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={handleCreate} style={{ flex: 1, padding: '10px', backgroundColor: '#e966ff', color: 'white', border: 'none', fontWeight: 700, fontSize: '12px', cursor: 'pointer', borderRadius: '4px' }}>Criar Convite</button>
              <button onClick={() => setCreating(false)} style={{ padding: '10px', backgroundColor: '#262626', color: '#adaaaa', border: 'none', cursor: 'pointer', borderRadius: '4px' }}>Cancelar</button>
            </div>
          </div>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} style={{ width: '100%', padding: '12px', backgroundColor: '#1a1919', border: '1px dashed #494847', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', color: '#e966ff', fontSize: '12px', fontWeight: 700, borderRadius: '4px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>link</span>
          Criar Convite
        </button>
      )}

      {/* Active invites */}
      <div style={{ backgroundColor: '#1a1919', padding: '12px', borderRadius: '8px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#fbbf24', marginBottom: '8px' }}>CONVITES ACTIVOS ({invites.length})</div>
        {invites.length === 0 && <div style={{ fontSize: '11px', color: '#555', textAlign: 'center' }}>Nenhum convite</div>}
        {invites.map((inv) => {
          const expired = new Date(inv.expires_at) < new Date();
          const exhausted = inv.max_uses > 0 && inv.used_count >= inv.max_uses;
          const inactive = expired || exhausted;
          return (
            <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #262626', opacity: inactive ? 0.4 : 1 }}>
              <div>
                <div style={{ fontSize: '11px', color: 'white', fontFamily: 'monospace' }}>{inv.code}</div>
                {inv.email && <div style={{ fontSize: '10px', color: '#6e9bff' }}>{inv.email}</div>}
                <div style={{ fontSize: '9px', color: '#555' }}>
                  {inv.used_count}/{inv.max_uses === 0 ? '\u221E' : inv.max_uses} usos
                  {' \u00B7 '}expira {new Date(inv.expires_at).toLocaleDateString('pt-PT')}
                  {expired && ' (expirado)'}
                </div>
              </div>
              {!inactive && (
                <button onClick={() => copyLink(inv.code)}
                  style={{ padding: '4px 10px', backgroundColor: '#262626', color: copied === inv.code ? '#3fff8b' : '#adaaaa', border: '1px solid #333', fontSize: '10px', fontWeight: 700, cursor: 'pointer', borderRadius: '4px' }}>
                  {copied === inv.code ? 'Copiado!' : 'Copiar link'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Club/ClubInvitesTab.tsx
git commit -m "feat(clubs): ClubInvitesTab — create invites, copy link, usage stats"
```

---

### Task 6: Club Backoffice Tab Component

**Files:**
- Create: `src/components/Club/ClubBackofficeTab.tsx`

- [ ] **Step 1: Create ClubBackofficeTab component**

```typescript
// src/components/Club/ClubBackofficeTab.tsx
import { useState, useEffect } from 'react';
import { getClub, getMembers, updateLandingConfig, type Club, type LandingConfig, type BoardMember, type ClubMember } from '../../services/club/ClubService';

interface Props {
  clubId: string;
}

export function ClubBackofficeTab({ clubId }: Props) {
  const [club, setClub] = useState<Club | null>(null);
  const [config, setConfig] = useState<LandingConfig>({});
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [saving, setSaving] = useState(false);
  const [newBoardUserId, setNewBoardUserId] = useState('');
  const [newBoardTitle, setNewBoardTitle] = useState('');

  useEffect(() => {
    getClub(clubId).then((c) => {
      if (c) { setClub(c); setConfig(c.landing_config ?? {}); }
    });
    getMembers(clubId).then(setMembers);
  }, [clubId]);

  const toggleSection = (key: keyof LandingConfig) => {
    setConfig((c) => ({ ...c, [key]: !c[key] }));
  };

  const addBoardMember = () => {
    if (!newBoardUserId || !newBoardTitle) return;
    const member = members.find((m) => m.user_id === newBoardUserId);
    const bm: BoardMember = { user_id: newBoardUserId, title: newBoardTitle, display_name: member?.display_name };
    setConfig((c) => ({ ...c, board_members: [...(c.board_members ?? []), bm] }));
    setNewBoardUserId(''); setNewBoardTitle('');
  };

  const removeBoardMember = (idx: number) => {
    setConfig((c) => ({ ...c, board_members: (c.board_members ?? []).filter((_, i) => i !== idx) }));
  };

  const save = async () => {
    setSaving(true);
    try { await updateLandingConfig(clubId, config); } finally { setSaving(false); }
  };

  const preview = () => {
    window.open(`/club.html?s=${club?.slug}`, '_blank');
  };

  if (!club) return <div style={{ color: '#777', fontSize: '11px', textAlign: 'center', padding: '20px' }}>A carregar...</div>;

  const toggleStyle = (active: boolean) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1e1e1e',
  });
  const dotStyle = (active: boolean) => ({
    width: '10px', height: '10px', borderRadius: '50%',
    backgroundColor: active ? '#3fff8b' : '#333', cursor: 'pointer', transition: 'background 0.2s',
  });
  const inputStyle = { width: '100%', backgroundColor: '#262626', color: 'white', padding: '8px', border: '1px solid #333', fontSize: '12px', borderRadius: '4px' };

  const sections: { key: keyof LandingConfig; label: string }[] = [
    { key: 'show_members', label: 'Membros' },
    { key: 'show_leaderboard', label: 'Leaderboard Mensal' },
    { key: 'show_map', label: 'Mapa de Actividade' },
    { key: 'show_feed', label: 'Feed de Rides' },
    { key: 'show_upcoming_rides', label: 'Proximas Rides' },
    { key: 'show_board', label: 'Direccao / Board' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Section toggles */}
      <div style={{ backgroundColor: '#1a1919', padding: '12px', borderRadius: '8px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#fbbf24', marginBottom: '8px' }}>SECCOES DA LANDING PAGE</div>
        {sections.map(({ key, label }) => (
          <div key={key} style={toggleStyle(!!config[key])} onClick={() => toggleSection(key)}>
            <span style={{ fontSize: '12px', color: 'white' }}>{label}</span>
            <div style={dotStyle(!!config[key])} />
          </div>
        ))}
      </div>

      {/* About text */}
      <div style={{ backgroundColor: '#1a1919', padding: '12px', borderRadius: '8px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#fbbf24', marginBottom: '8px' }}>SOBRE NOS</div>
        <textarea value={config.custom_about ?? ''} onChange={(e) => setConfig({ ...config, custom_about: e.target.value })}
          placeholder="Texto sobre o clube..."
          style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} />
      </div>

      {/* Board members */}
      {config.show_board && (
        <div style={{ backgroundColor: '#1a1919', padding: '12px', borderRadius: '8px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#fbbf24', marginBottom: '8px' }}>DIRECCAO</div>
          {(config.board_members ?? []).map((bm, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #262626' }}>
              <div>
                <div style={{ fontSize: '12px', color: 'white' }}>{bm.display_name || bm.user_id}</div>
                <div style={{ fontSize: '10px', color: '#e966ff' }}>{bm.title}</div>
              </div>
              <button onClick={() => removeBoardMember(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#ff716c' }}>close</span>
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
            <select value={newBoardUserId} onChange={(e) => setNewBoardUserId(e.target.value)}
              style={{ flex: 2, backgroundColor: '#262626', color: 'white', border: '1px solid #333', fontSize: '11px', padding: '6px', borderRadius: '4px' }}>
              <option value="">Seleccionar membro...</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
            </select>
            <input value={newBoardTitle} onChange={(e) => setNewBoardTitle(e.target.value)} placeholder="Titulo..."
              style={{ flex: 1, backgroundColor: '#262626', color: 'white', border: '1px solid #333', fontSize: '11px', padding: '6px', borderRadius: '4px' }} />
            <button onClick={addBoardMember} style={{ padding: '6px 10px', backgroundColor: '#e966ff', color: 'white', border: 'none', fontSize: '11px', fontWeight: 700, cursor: 'pointer', borderRadius: '4px' }}>+</button>
          </div>
        </div>
      )}

      {/* Save + Preview */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={save} disabled={saving}
          style={{ flex: 1, padding: '12px', backgroundColor: '#3fff8b', color: 'black', border: 'none', fontWeight: 700, fontSize: '13px', cursor: 'pointer', borderRadius: '6px', opacity: saving ? 0.5 : 1 }}>
          {saving ? 'A guardar...' : 'Guardar Config'}
        </button>
        <button onClick={preview}
          style={{ padding: '12px', backgroundColor: '#262626', color: '#6e9bff', border: '1px solid #333', fontWeight: 700, fontSize: '13px', cursor: 'pointer', borderRadius: '6px' }}>
          Preview
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Club/ClubBackofficeTab.tsx
git commit -m "feat(clubs): ClubBackofficeTab — landing page section toggles, about text, board members"
```

---

### Task 7: Refactor ClubPage with Tab Navigation

**Files:**
- Modify: `src/components/Settings/Settings.tsx:422-873` (ClubPage function)

- [ ] **Step 1: Refactor ClubPage to use tabs**

Replace the existing `ClubPage` function body (when user has a club) to add tab navigation. The existing "no club" flow (search/create) stays as-is. When user has a club, show tabs: **Geral** (existing rides + members), **Definicoes** (ClubSettingsTab), **Membros** (ClubMembersTab), **Convites** (ClubInvitesTab), **Landing** (ClubBackofficeTab).

Key changes:
- Add `import` for the 4 new tab components at the top of Settings.tsx
- Add `tab` state (`'geral' | 'settings' | 'members' | 'invites' | 'landing'`)
- Add `userRole` state (loaded from club_members for current user)
- Show tabs only for admin+ roles where appropriate
- Keep the existing rides/members view as the "Geral" tab content

The "Geral" tab preserves all existing functionality (club header, members, rides, create ride, leave club). Tabs Definicoes/Membros/Convites/Landing only visible to owner/admin (Membros also visible to moderator).

- [ ] **Step 2: Add imports at top of Settings.tsx**

Add these imports near the top of Settings.tsx (alongside existing imports):

```typescript
import { ClubSettingsTab } from '../Club/ClubSettingsTab';
import { ClubMembersTab } from '../Club/ClubMembersTab';
import { ClubInvitesTab } from '../Club/ClubInvitesTab';
import { ClubBackofficeTab } from '../Club/ClubBackofficeTab';
```

- [ ] **Step 3: Add tab navigation inside the "has club" branch**

Inside the ClubPage function, right after the club header div (line ~636), add tab navigation before the members section. Add state: `const [tab, setTab] = useState('geral');` and `const [userRole, setUserRole] = useState('member');`. Load userRole on mount by querying club_members for the current user.

Tab bar:
```tsx
<div style={{ display: 'flex', gap: '2px', overflowX: 'auto', padding: '4px 0' }}>
  {[
    { id: 'geral', label: 'Geral', show: true },
    { id: 'settings', label: 'Definicoes', show: userRole === 'owner' || userRole === 'admin' },
    { id: 'members', label: 'Membros', show: ['owner', 'admin', 'moderator'].includes(userRole) },
    { id: 'invites', label: 'Convites', show: ['owner', 'admin', 'moderator'].includes(userRole) },
    { id: 'landing', label: 'Landing', show: userRole === 'owner' || userRole === 'admin' },
  ].filter((t) => t.show).map((t) => (
    <button key={t.id} onClick={() => setTab(t.id)}
      style={{ padding: '6px 12px', fontSize: '11px', fontWeight: 700, border: 'none', cursor: 'pointer', borderRadius: '4px',
        backgroundColor: tab === t.id ? '#3fff8b' : '#262626',
        color: tab === t.id ? 'black' : '#adaaaa', whiteSpace: 'nowrap' }}>
      {t.label}
    </button>
  ))}
</div>
```

Then render tab content:
```tsx
{tab === 'geral' && (/* existing members list + rides + create ride + leave button */)}
{tab === 'settings' && <ClubSettingsTab clubId={profile.club_id!} onUpdated={/* reload clubDetail */} />}
{tab === 'members' && <ClubMembersTab clubId={profile.club_id!} userRole={userRole} />}
{tab === 'invites' && <ClubInvitesTab clubId={profile.club_id!} clubSlug={club?.slug ?? ''} />}
{tab === 'landing' && <ClubBackofficeTab clubId={profile.club_id!} />}
```

- [ ] **Step 4: Load user role and club slug on mount**

Add a useEffect that queries the current user's role and the club slug:

```typescript
const [userRole, setUserRole] = useState('member');
const [clubSlug, setClubSlug] = useState('');

useEffect(() => {
  if (!profile.club_id || !userId) return;
  supaGet<{ role: string }[]>(`/rest/v1/club_members?club_id=eq.${profile.club_id}&user_id=eq.${userId}&select=role&limit=1`)
    .then((d) => { if (d[0]) setUserRole(d[0].role); });
  supaGet<{ slug: string }[]>(`/rest/v1/clubs?id=eq.${profile.club_id}&select=slug&limit=1`)
    .then((d) => { if (d[0]) setClubSlug(d[0].slug); });
}, [profile.club_id, userId]);
```

- [ ] **Step 5: Verify build**

Run: `npm run type-check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings/Settings.tsx src/components/Club/
git commit -m "feat(clubs): tab navigation in ClubPage — settings, members, invites, landing backoffice"
```

---

### Task 8: Email Invite Edge Function

**Files:**
- Create: `supabase/functions/club-invite/index.ts`

- [ ] **Step 1: Create the edge function**

```typescript
// supabase/functions/club-invite/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  try {
    const { action, ...params } = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Rate limit
    const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
    const { data: allowed } = await supabase.rpc('check_rate_limit', {
      p_function: 'club-invite', p_ip: ip, p_max_calls: 20, p_window_seconds: 60,
    });
    if (!allowed) return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 });

    switch (action) {
      case 'send_invite': {
        const { club_id, invite_code, email, club_name, club_slug } = params;
        if (!email || !invite_code || !club_name || !club_slug) {
          return new Response(JSON.stringify({ error: 'missing_params' }), { status: 400 });
        }
        const link = `https://www.kromi.online/club.html?s=${club_slug}&invite=${invite_code}`;
        if (RESEND_API_KEY) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
            body: JSON.stringify({
              from: 'KROMI <noreply@kromi.online>',
              to: [email],
              subject: `Convite para ${club_name} — KROMI BikeControl`,
              html: `
                <div style="font-family:sans-serif;background:#0e0e0e;color:white;padding:32px;border-radius:8px;max-width:480px;margin:0 auto">
                  <h2 style="color:#3fff8b;margin:0 0 16px">Foste convidado para <strong>${club_name}</strong></h2>
                  <p style="color:#adaaaa;font-size:14px;line-height:1.5">
                    Junta-te ao clube no KROMI BikeControl. Clica no botao abaixo para aceitar o convite.
                  </p>
                  <a href="${link}" style="display:inline-block;background:#3fff8b;color:black;padding:12px 24px;font-weight:700;text-decoration:none;border-radius:6px;margin-top:16px">
                    Aceitar Convite
                  </a>
                  <p style="color:#555;font-size:11px;margin-top:24px">Codigo: ${invite_code} · Este convite expira em 7 dias.</p>
                </div>
              `,
            }),
          });
        }
        return new Response(JSON.stringify({ ok: true, link }), { status: 200 });
      }

      case 'validate_code': {
        const { code } = params;
        const { data: invite } = await supabase
          .from('club_invites')
          .select('id, club_id, expires_at, max_uses, used_count, clubs(name, slug, avatar_url, color, member_count)')
          .eq('code', code)
          .single();
        if (!invite) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
        const expired = new Date(invite.expires_at) < new Date();
        const exhausted = invite.max_uses > 0 && invite.used_count >= invite.max_uses;
        return new Response(JSON.stringify({ ...invite, expired, exhausted, valid: !expired && !exhausted }), { status: 200 });
      }

      default:
        return new Response(JSON.stringify({ error: 'unknown_action' }), { status: 400 });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});
```

- [ ] **Step 2: Deploy via Supabase CLI or MCP**

Run: `deploy_edge_function` with name `club-invite`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/club-invite/index.ts
git commit -m "feat(clubs): club-invite edge function — send email via Resend, validate invite codes"
```

---

## SUB-PROJECT 2: Club Landing Page

### Task 9: `public/club.html` — Standalone Landing Page

**Files:**
- Create: `public/club.html`

This is a standalone HTML file (no React, no bundler) — same pattern as `public/live.html`. It reads data from Supabase via the anon key. The page reads `?s={slug}` from the URL and optionally `?invite={code}`.

- [ ] **Step 1: Create `public/club.html` with HTML skeleton + CSS**

The file will be ~900 lines. Build it in this order:
1. HTML head with OG meta tags, viewport, theme-color
2. CSS variables and styles (dark theme, `#0e0e0e` bg, `#3fff8b` accent)
3. Page structure: hero, stats, about, board, upcoming rides, feed, leaderboard, members, map, footer
4. JavaScript: fetch club data, populate sections, handle join/invite flows

Key design decisions:
- CSS uses custom properties with club color override: `--accent: ${club.color}`
- IntersectionObserver for fade-in animations on scroll
- Mobile-first responsive: 1 col phone, 2 col tablet, 3 col desktop
- JetBrains Mono via Google Fonts for numbers/labels
- All sections gated by `landing_config` toggles
- Google Maps embed for activity map (if show_map enabled)

```html
<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0e0e0e">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<title>KROMI Club</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0e0e0e; --bg-card: #1a1919; --bg-surface: #131313;
    --text: #fff; --text-muted: #adaaaa; --text-dim: #777; --border: #262626;
    --accent: #3fff8b; --accent-dim: rgba(63,255,139,0.15);
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; min-height:100vh; }
  .mono { font-family:'JetBrains Mono',monospace; }
  .container { max-width:960px; margin:0 auto; padding:0 16px; }

  /* Hero */
  .hero { position:relative; padding:48px 16px 32px; text-align:center; background:var(--bg-surface); border-bottom:1px solid var(--border); }
  .hero-banner { position:absolute; inset:0; background-size:cover; background-position:center; opacity:0.2; }
  .hero-content { position:relative; z-index:1; }
  .hero-avatar { width:80px; height:80px; border-radius:50%; border:3px solid var(--accent); object-fit:cover; margin-bottom:12px; }
  .hero-name { font-size:28px; font-weight:900; letter-spacing:-0.5px; }
  .hero-meta { font-size:13px; color:var(--text-muted); margin-top:6px; }
  .hero-socials { display:flex; gap:12px; justify-content:center; margin-top:12px; }
  .hero-socials a { color:var(--text-dim); text-decoration:none; font-size:13px; transition:color 0.2s; }
  .hero-socials a:hover { color:var(--accent); }
  .hero-actions { margin-top:16px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap; }
  .btn { padding:10px 24px; font-weight:700; font-size:13px; border:none; border-radius:6px; cursor:pointer; transition:transform 0.1s; }
  .btn:active { transform:scale(0.97); }
  .btn-primary { background:var(--accent); color:#000; }
  .btn-secondary { background:var(--bg-card); color:var(--text-muted); border:1px solid var(--border); }

  /* Stats grid */
  .stats-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:1px; background:var(--border); border-radius:10px; overflow:hidden; margin:16px 0; }
  .stat-cell { background:var(--bg-card); padding:16px 12px; text-align:center; }
  .stat-value { font-size:24px; font-weight:700; color:var(--accent); }
  .stat-label { font-size:10px; color:var(--text-dim); text-transform:uppercase; letter-spacing:1px; margin-top:4px; }

  /* Section */
  .section { padding:24px 0; }
  .section-title { font-size:14px; font-weight:800; color:var(--accent); letter-spacing:2px; text-transform:uppercase; margin-bottom:16px; }

  /* Cards */
  .card { background:var(--bg-card); border-radius:10px; padding:16px; margin-bottom:12px; }

  /* Member grid */
  .member-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:8px; }
  .member-card { background:var(--bg-card); border-radius:8px; padding:12px; text-align:center; }
  .member-avatar { width:40px; height:40px; border-radius:50%; background:var(--border); margin:0 auto 6px; display:flex; align-items:center; justify-content:center; font-size:18px; }
  .member-name { font-size:12px; font-weight:600; }
  .member-role { font-size:9px; color:var(--text-dim); text-transform:uppercase; margin-top:2px; }

  /* Leaderboard */
  .lb-table { width:100%; border-collapse:collapse; }
  .lb-table th { text-align:left; font-size:10px; color:var(--text-dim); padding:6px 8px; border-bottom:1px solid var(--border); text-transform:uppercase; }
  .lb-table td { padding:8px; font-size:12px; border-bottom:1px solid #1e1e1e; }
  .lb-medal { font-size:16px; }

  /* Feed */
  .feed-post { border-left:3px solid var(--accent); padding-left:12px; margin-bottom:16px; }
  .feed-meta { font-size:10px; color:var(--text-dim); margin-bottom:4px; }
  .feed-content { font-size:13px; line-height:1.5; color:var(--text-muted); }
  .feed-stats { display:flex; gap:12px; margin-top:8px; font-size:11px; color:var(--text-dim); }
  .feed-photos { display:flex; gap:6px; overflow-x:auto; margin-top:8px; padding-bottom:4px; }
  .feed-photos img { width:120px; height:80px; object-fit:cover; border-radius:6px; flex-shrink:0; }

  /* Ride card */
  .ride-card { display:flex; justify-content:space-between; align-items:center; padding:12px; background:var(--bg-card); border-radius:8px; margin-bottom:8px; }
  .ride-date { font-size:11px; color:var(--accent); font-weight:700; }
  .ride-name { font-size:14px; font-weight:700; }
  .ride-meta { font-size:10px; color:var(--text-dim); margin-top:2px; }
  .ride-count { font-size:20px; font-weight:700; color:var(--accent); text-align:center; min-width:48px; }

  /* Footer */
  .footer { text-align:center; padding:32px 16px; border-top:1px solid var(--border); margin-top:24px; }
  .footer a { color:var(--accent); text-decoration:none; }

  /* Fade-in animation */
  .fade-in { opacity:0; transform:translateY(20px); transition:opacity 0.5s,transform 0.5s; }
  .fade-in.visible { opacity:1; transform:translateY(0); }

  /* Invite banner */
  .invite-banner { background:linear-gradient(135deg,rgba(63,255,139,0.15),rgba(110,155,255,0.15)); border:1px solid rgba(63,255,139,0.3); padding:16px; border-radius:10px; text-align:center; margin:16px 0; }
  .invite-banner h3 { color:var(--accent); font-size:16px; margin-bottom:8px; }

  /* Loading */
  .loading { display:flex; align-items:center; justify-content:center; min-height:60vh; }
  .spinner { width:40px; height:40px; border:3px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:spin 0.8s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }

  /* Private club overlay */
  .private-overlay { text-align:center; padding:48px 16px; }
  .lock-icon { font-size:48px; margin-bottom:16px; }

  /* Responsive */
  @media(min-width:768px) {
    .hero-name { font-size:36px; }
    .stats-grid { grid-template-columns:repeat(5,1fr); }
    .member-grid { grid-template-columns:repeat(4,1fr); }
  }
</style>
</head>
<body>

<div id="loading" class="loading"><div class="spinner"></div></div>
<div id="app" style="display:none">

  <!-- Hero -->
  <div class="hero" id="hero">
    <div class="hero-banner" id="hero-banner"></div>
    <div class="hero-content">
      <img id="hero-avatar" class="hero-avatar" src="" alt="" style="display:none">
      <h1 class="hero-name" id="club-name"></h1>
      <div class="hero-meta" id="club-meta"></div>
      <div class="hero-socials" id="club-socials"></div>
      <div class="hero-actions" id="hero-actions"></div>
    </div>
  </div>

  <!-- Invite banner (shown when ?invite= present) -->
  <div class="container">
    <div id="invite-banner" class="invite-banner" style="display:none"></div>
  </div>

  <!-- Stats -->
  <div class="container">
    <div class="stats-grid" id="stats-grid"></div>
  </div>

  <!-- Dynamic sections (order controlled by landing_config) -->
  <div class="container" id="sections"></div>

  <!-- Footer -->
  <div class="footer">
    <div style="font-size:11px;color:var(--text-dim)">Powered by <a href="https://www.kromi.online">kromi.online</a></div>
    <div id="footer-socials" style="margin-top:8px"></div>
  </div>
</div>

<script>
// ─── Config ────────────────────────────────────────────────
const SB_URL = 'https://ctsuupvmmyjlrtjnxagv.supabase.co';
const SB_KEY = '/* ANON KEY — injected at build or hardcoded */';
// NOTE: The implementer must fill in the actual anon key from env
// For now we read it from a meta tag or fallback
const ANON_KEY = document.querySelector('meta[name="sb-anon-key"]')?.content || SB_KEY;

const params = new URLSearchParams(location.search);
const slug = params.get('s');
const inviteCode = params.get('invite');

if (!slug) { document.getElementById('loading').innerHTML = '<p style="color:#ff716c;text-align:center;padding:48px">Clube nao encontrado. URL: club.html?s={slug}</p>'; }

// ─── Fetch helpers ─────────────────────────────────────────
async function sbGet(path) {
  const r = await fetch(`${SB_URL}${path}`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } });
  return r.json();
}
async function sbRpc(fn, args) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  return r.json();
}

// ─── Main ──────────────────────────────────────────────────
async function init() {
  if (!slug) return;

  // 1. Load club
  const clubs = await sbGet(`/rest/v1/clubs?slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`);
  if (!clubs.length) { document.getElementById('loading').innerHTML = '<p style="color:#ff716c;text-align:center;padding:48px">Clube nao encontrado.</p>'; return; }
  const club = clubs[0];

  // Set accent color
  if (club.color) document.documentElement.style.setProperty('--accent', club.color);

  // OG tags
  document.title = `${club.name} — KROMI Club`;
  setMeta('og:title', `${club.name} — KROMI Club`);
  setMeta('og:description', club.description || `Clube de ciclismo com ${club.member_count} membros`);
  if (club.avatar_url) setMeta('og:image', club.avatar_url);

  // 2. Load members
  const members = await sbGet(`/rest/v1/club_members?club_id=eq.${club.id}&select=user_id,display_name,role,joined_at,avatar_url&order=joined_at.asc`);

  // 3. Load feed posts (public clubs only)
  let posts = [];
  if (club.visibility === 'public') {
    posts = await sbGet(`/rest/v1/club_ride_posts?club_id=eq.${club.id}&order=created_at.desc&limit=20`);
  }

  // 4. Load upcoming rides
  let rides = [];
  if (club.visibility === 'public') {
    rides = await sbGet(`/rest/v1/club_rides?club_id=eq.${club.id}&status=eq.planned&order=scheduled_at.asc&limit=10`);
  }

  // 5. Render
  renderHero(club, members.length);
  renderStats(club, members, posts);

  const cfg = club.landing_config || {};
  const sectionsEl = document.getElementById('sections');

  if (cfg.custom_about) renderAbout(sectionsEl, cfg.custom_about);
  if (cfg.show_board && cfg.board_members?.length) renderBoard(sectionsEl, cfg.board_members, members);
  if (cfg.show_upcoming_rides && rides.length) renderUpcomingRides(sectionsEl, rides);
  if (cfg.show_feed && posts.length) renderFeed(sectionsEl, posts);
  if (cfg.show_leaderboard && posts.length) renderLeaderboard(sectionsEl, posts, members);
  if (cfg.show_members) renderMembers(sectionsEl, members);

  // Handle invite
  if (inviteCode) await handleInvite(club);

  // Show
  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  // Fade-in observer
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
  }, { threshold: 0.1 });
  document.querySelectorAll('.fade-in').forEach((el) => obs.observe(el));
}

// ─── Render functions ──────────────────────────────────────
function setMeta(prop, content) {
  let el = document.querySelector(`meta[property="${prop}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute('property', prop); document.head.appendChild(el); }
  el.content = content;
}

function renderHero(club, memberCount) {
  if (club.banner_url) {
    document.getElementById('hero-banner').style.backgroundImage = `url(${club.banner_url})`;
  }
  const avatar = document.getElementById('hero-avatar');
  if (club.avatar_url) { avatar.src = club.avatar_url; avatar.style.display = 'block'; }
  document.getElementById('club-name').textContent = club.name;

  const meta = [];
  if (club.location) meta.push(`\uD83D\uDCCD ${club.location}`);
  meta.push(`\uD83D\uDC65 ${memberCount} membros`);
  if (club.founded_at) meta.push(`Est. ${new Date(club.founded_at).getFullYear()}`);
  document.getElementById('club-meta').textContent = meta.join(' \u00B7 ');

  // Socials
  const socials = club.social_links || {};
  const socialsEl = document.getElementById('club-socials');
  if (socials.instagram) socialsEl.innerHTML += `<a href="${socials.instagram}" target="_blank">Instagram</a>`;
  if (socials.facebook) socialsEl.innerHTML += `<a href="${socials.facebook}" target="_blank">Facebook</a>`;
  if (socials.website || club.website) socialsEl.innerHTML += `<a href="${socials.website || club.website}" target="_blank">Website</a>`;

  // Action buttons
  const actions = document.getElementById('hero-actions');
  if (club.visibility === 'public' && !inviteCode) {
    actions.innerHTML = `<button class="btn btn-primary" onclick="joinPublic('${club.id}')">Entrar no Clube</button>`;
  } else if (club.visibility === 'private' && !inviteCode) {
    actions.innerHTML = `<button class="btn btn-secondary" onclick="requestJoin('${club.id}')">Pedir Adesao</button>`;
  }
}

function renderStats(club, members, posts) {
  const grid = document.getElementById('stats-grid');
  const totalKm = posts.reduce((s, p) => s + (p.stats?.distance_km || 0), 0);
  const totalD = posts.reduce((s, p) => s + (p.stats?.elevation_gain_m || 0), 0);
  const stats = [
    { v: posts.length, l: 'Rides' },
    { v: Math.round(totalKm), l: 'Km Total' },
    { v: Math.round(totalD), l: 'D+ Total' },
    { v: members.length, l: 'Membros' },
  ];
  if (club.founded_at) stats.push({ v: new Date(club.founded_at).getFullYear(), l: 'Fundado' });
  grid.innerHTML = stats.map((s) => `<div class="stat-cell"><div class="stat-value mono">${s.v.toLocaleString('pt-PT')}</div><div class="stat-label">${s.l}</div></div>`).join('');
}

function renderAbout(parent, text) {
  const sec = createSection('Sobre', parent);
  sec.innerHTML += `<div class="card"><p style="font-size:14px;line-height:1.6;color:var(--text-muted)">${text.replace(/\n/g, '<br>')}</p></div>`;
}

function renderBoard(parent, boardMembers, allMembers) {
  const sec = createSection('Direccao', parent);
  const grid = document.createElement('div');
  grid.className = 'member-grid';
  boardMembers.forEach((bm) => {
    const m = allMembers.find((x) => x.user_id === bm.user_id);
    grid.innerHTML += `
      <div class="member-card">
        <div class="member-avatar">${(bm.display_name || m?.display_name || '?')[0].toUpperCase()}</div>
        <div class="member-name">${bm.display_name || m?.display_name || 'Membro'}</div>
        <div class="member-role" style="color:var(--accent)">${bm.title}</div>
      </div>`;
  });
  sec.appendChild(grid);
}

function renderUpcomingRides(parent, rides) {
  const sec = createSection('Proximas Rides', parent);
  rides.forEach((r) => {
    const d = new Date(r.scheduled_at);
    sec.innerHTML += `
      <div class="ride-card fade-in">
        <div>
          <div class="ride-date">${d.toLocaleDateString('pt-PT',{weekday:'short',day:'numeric',month:'short'})} \u00B7 ${d.toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'})}</div>
          <div class="ride-name">${r.name}</div>
          ${r.meeting_address ? `<div class="ride-meta">\uD83D\uDCCD ${r.meeting_address}</div>` : ''}
        </div>
        <a href="/ride.html?id=${r.id}" class="btn btn-secondary" style="font-size:11px;padding:6px 12px">Ver</a>
      </div>`;
  });
}

function renderFeed(parent, posts) {
  const sec = createSection('Feed de Rides', parent);
  posts.slice(0, 10).forEach((p) => {
    const d = new Date(p.created_at);
    let photosHtml = '';
    if (p.photos?.length) {
      photosHtml = `<div class="feed-photos">${p.photos.map((ph) => `<img src="${ph.drive_thumbnail_url || ph.drive_view_url}" alt="${ph.caption || ''}">`).join('')}</div>`;
    }
    let statsHtml = '';
    if (p.stats) {
      const s = p.stats;
      const parts = [];
      if (s.distance_km) parts.push(`${Number(s.distance_km).toFixed(1)} km`);
      if (s.elevation_gain_m) parts.push(`${Math.round(s.elevation_gain_m)} D+`);
      if (s.duration_s) parts.push(formatDuration(s.duration_s));
      if (s.participants?.length) parts.push(`${s.participants.length} riders`);
      statsHtml = `<div class="feed-stats">${parts.map((x) => `<span>${x}</span>`).join('')}</div>`;
    }
    sec.innerHTML += `
      <div class="feed-post fade-in">
        <div class="feed-meta">${d.toLocaleDateString('pt-PT',{day:'numeric',month:'long',year:'numeric'})}</div>
        ${p.content ? `<div class="feed-content">${p.content}</div>` : ''}
        ${statsHtml}
        ${photosHtml}
        ${p.ride_id ? `<a href="/ride.html?id=${p.id}" style="font-size:11px;color:var(--accent);margin-top:6px;display:inline-block">Ver ride completa \u2192</a>` : ''}
      </div>`;
  });
}

function renderLeaderboard(parent, posts, members) {
  const sec = createSection('Leaderboard Mensal', parent);
  // Compute current month stats per rider
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthPosts = posts.filter((p) => p.created_at >= monthStart);
  const riderStats = {};
  monthPosts.forEach((p) => {
    const riders = p.stats?.participants || [{ user_id: p.author_id, distance_km: p.stats?.distance_km || 0, elevation_gain_m: p.stats?.elevation_gain_m || 0 }];
    riders.forEach((r) => {
      if (!riderStats[r.user_id]) riderStats[r.user_id] = { km: 0, d: 0, rides: 0 };
      riderStats[r.user_id].km += r.distance_km || 0;
      riderStats[r.user_id].d += r.elevation_gain_m || 0;
      riderStats[r.user_id].rides++;
    });
  });
  const sorted = Object.entries(riderStats).sort((a, b) => b[1].km - a[1].km);
  if (!sorted.length) return;

  const medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];
  let tableHtml = `<table class="lb-table"><thead><tr><th>#</th><th>Rider</th><th>Km</th><th>D+</th><th>Rides</th></tr></thead><tbody>`;
  sorted.slice(0, 15).forEach(([uid, s], i) => {
    const m = members.find((x) => x.user_id === uid);
    const name = m?.display_name || 'Rider';
    const rank = i < 3 ? `<span class="lb-medal">${medals[i]}</span>` : (i + 1);
    tableHtml += `<tr><td>${rank}</td><td>${name}</td><td class="mono">${Math.round(s.km)}</td><td class="mono">${Math.round(s.d)}</td><td class="mono">${s.rides}</td></tr>`;
  });
  tableHtml += '</tbody></table>';
  sec.innerHTML += `<div class="card">${tableHtml}</div>`;
}

function renderMembers(parent, members) {
  const sec = createSection(`Membros (${members.length})`, parent);
  const grid = document.createElement('div');
  grid.className = 'member-grid';
  const roleIcons = { owner: '\uD83D\uDC51', admin: '\uD83D\uDEE1\uFE0F', moderator: '\uD83D\uDD27', member: '' };
  const show = members.slice(0, 24);
  show.forEach((m) => {
    grid.innerHTML += `
      <div class="member-card fade-in">
        <div class="member-avatar">${(m.display_name || '?')[0].toUpperCase()}</div>
        <div class="member-name">${m.display_name || 'Rider'}</div>
        <div class="member-role">${roleIcons[m.role] || ''} ${m.role}</div>
      </div>`;
  });
  sec.appendChild(grid);
  if (members.length > 24) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.style.marginTop = '12px'; btn.style.width = '100%';
    btn.textContent = `Ver todos (${members.length})`;
    btn.onclick = () => { grid.innerHTML = ''; renderMembers(parent, members); };
    sec.appendChild(btn);
  }
}

// ─── Helpers ───────────────────────────────────────────────
function createSection(title, parent) {
  const sec = document.createElement('div');
  sec.className = 'section fade-in';
  sec.innerHTML = `<div class="section-title">${title}</div>`;
  parent.appendChild(sec);
  return sec;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m}min`;
}

async function handleInvite(club) {
  const banner = document.getElementById('invite-banner');
  banner.style.display = 'block';
  banner.innerHTML = `
    <h3>Foste convidado para ${club.name}!</h3>
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
      Abre a app KROMI BikeControl para aceitar o convite.
    </p>
    <button class="btn btn-primary" onclick="window.location.href='https://www.kromi.online/?join=${inviteCode}'">
      Abrir na App
    </button>`;
}

function joinPublic(clubId) {
  alert('Abre a app KROMI BikeControl para te juntares ao clube.');
}

function requestJoin(clubId) {
  alert('Abre a app KROMI BikeControl para pedires adesao.');
}

// ─── Init ──────────────────────────────────────────────────
init();
</script>
</body>
</html>
```

**Note:** The `SB_KEY` (anon key) must be filled in during deployment. The implementer should read it from `import.meta.env.VITE_SUPABASE_ANON_KEY` or hardcode the public anon key (it's a public, non-secret key).

- [ ] **Step 2: Verify the page loads locally**

Open `http://localhost:5173/club.html?s=test-slug` in the browser. Should show the loading spinner, then "Clube nao encontrado" if no matching slug.

- [ ] **Step 3: Commit**

```bash
git add public/club.html
git commit -m "feat(clubs): club.html landing page — hero, stats, feed, leaderboard, members, invites"
```

---

## SUB-PROJECT 3: Ride Pages

### Task 10: `public/ride.html` — Editorial Ride Page

**Files:**
- Create: `public/ride.html`

This is a standalone HTML page. URL: `/ride.html?id={ride_post_id}`. Two modes: pre-ride (from club_rides with GPX) and post-ride (from club_ride_posts with stats/photos).

- [ ] **Step 1: Create `public/ride.html` with skeleton + CSS + pre-ride mode**

The page structure:
1. Hero with ride name, date, club badge
2. Map with GPX polyline (Google Maps or Leaflet)
3. SVG altimetry profile with gradient coloring and interactive hover
4. Segment analysis (auto-detected climbs/descents)
5. Participant list
6. Post-ride additions: comparison, per-rider stats, segment rankings, photo gallery

Key design: dark theme, editorial quality, SVG elevation with gradient fill (green/orange/red by steepness), interactive hover tooltip.

```html
<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0e0e0e">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary_large_image">
<title>KROMI Ride</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Playfair+Display:wght@700;900&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0e0e0e; --bg-card: #1a1919; --bg-surface: #131313;
    --text: #fff; --text-muted: #adaaaa; --text-dim: #777; --border: #262626;
    --accent: #3fff8b; --accent-dim: rgba(63,255,139,0.15);
    --climb-easy: #3fff8b; --climb-mod: #fbbf24; --climb-hard: #ff716c; --climb-extreme: #e966ff;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  .mono { font-family:'JetBrains Mono',monospace; }
  .serif { font-family:'Playfair Display',Georgia,serif; }
  .container { max-width:800px; margin:0 auto; padding:0 16px; }

  /* Hero */
  .ride-hero { padding:48px 16px 32px; text-align:center; background:var(--bg-surface); border-bottom:1px solid var(--border); position:relative; }
  .ride-hero h1 { font-size:32px; font-weight:900; line-height:1.1; }
  .ride-hero .club-badge { display:inline-flex; align-items:center; gap:6px; padding:4px 12px; background:var(--accent-dim); border:1px solid rgba(63,255,139,0.3); border-radius:20px; font-size:11px; color:var(--accent); font-weight:700; margin-bottom:12px; }
  .ride-meta { font-size:13px; color:var(--text-muted); margin-top:8px; }
  .ride-stats-bar { display:flex; gap:24px; justify-content:center; margin-top:16px; flex-wrap:wrap; }
  .ride-stat { text-align:center; }
  .ride-stat-value { font-size:22px; font-weight:700; color:var(--accent); }
  .ride-stat-label { font-size:10px; color:var(--text-dim); text-transform:uppercase; letter-spacing:1px; }

  /* Map */
  #ride-map { width:100%; height:400px; background:#111; margin:16px 0; border-radius:10px; overflow:hidden; }

  /* Altimetry SVG */
  .altimetry-container { position:relative; margin:16px 0; }
  .altimetry-svg { width:100%; height:200px; }
  .altimetry-tooltip { position:absolute; pointer-events:none; background:rgba(0,0,0,0.85); color:white; padding:6px 10px; border-radius:6px; font-size:11px; display:none; transform:translateX(-50%); white-space:nowrap; }

  /* Segments */
  .segment { display:flex; align-items:center; gap:12px; padding:12px; background:var(--bg-card); border-radius:8px; margin-bottom:8px; border-left:4px solid var(--accent); }
  .segment-icon { font-size:20px; min-width:24px; text-align:center; }
  .segment-info { flex:1; }
  .segment-name { font-size:13px; font-weight:700; }
  .segment-stats { font-size:11px; color:var(--text-dim); margin-top:2px; }
  .segment-grade { padding:2px 8px; border-radius:4px; font-size:10px; font-weight:700; }

  /* Rider stats table */
  .riders-table { width:100%; border-collapse:collapse; margin:16px 0; }
  .riders-table th { text-align:left; font-size:10px; color:var(--text-dim); padding:8px; border-bottom:1px solid var(--border); text-transform:uppercase; }
  .riders-table td { padding:8px; font-size:12px; border-bottom:1px solid #1e1e1e; }

  /* Photo gallery */
  .gallery { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:8px; margin:16px 0; }
  .gallery img { width:100%; height:180px; object-fit:cover; border-radius:8px; cursor:pointer; transition:transform 0.2s; }
  .gallery img:hover { transform:scale(1.02); }

  /* Lightbox */
  .lightbox { position:fixed; inset:0; background:rgba(0,0,0,0.95); z-index:1000; display:none; align-items:center; justify-content:center; flex-direction:column; }
  .lightbox img { max-width:90%; max-height:80vh; object-fit:contain; }
  .lightbox-caption { color:var(--text-muted); font-size:13px; margin-top:12px; }
  .lightbox-close { position:absolute; top:16px; right:16px; background:none; border:none; color:white; font-size:28px; cursor:pointer; }

  /* Section */
  .section { padding:24px 0; }
  .section-title { font-size:14px; font-weight:800; color:var(--accent); letter-spacing:2px; text-transform:uppercase; margin-bottom:16px; }

  /* Footer */
  .footer { text-align:center; padding:32px 16px; border-top:1px solid var(--border); margin-top:24px; }
  .footer a { color:var(--accent); text-decoration:none; }
  .share-btns { display:flex; gap:8px; justify-content:center; margin-top:12px; }
  .share-btn { padding:8px 16px; background:var(--bg-card); color:var(--text-muted); border:1px solid var(--border); border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; text-decoration:none; }

  .btn { padding:10px 24px; font-weight:700; font-size:13px; border:none; border-radius:6px; cursor:pointer; }
  .btn-primary { background:var(--accent); color:#000; }

  .loading { display:flex; align-items:center; justify-content:center; min-height:60vh; }
  .spinner { width:40px; height:40px; border:3px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:spin 0.8s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }

  .fade-in { opacity:0; transform:translateY(20px); transition:opacity 0.5s,transform 0.5s; }
  .fade-in.visible { opacity:1; transform:translateY(0); }

  @media print { body { background:#fff; color:#000; } .btn,.footer,.share-btns { display:none; } }
  @media(min-width:768px) { .ride-hero h1 { font-size:42px; } .altimetry-svg { height:280px; } }
</style>
</head>
<body>

<div id="loading" class="loading"><div class="spinner"></div></div>
<div id="app" style="display:none">
  <div class="ride-hero" id="ride-hero"></div>
  <div class="container" id="content"></div>
  <div class="footer">
    <div style="font-size:11px;color:var(--text-dim)">Powered by <a href="https://www.kromi.online">kromi.online</a></div>
    <div class="share-btns" id="share-btns"></div>
  </div>
</div>

<!-- Lightbox -->
<div class="lightbox" id="lightbox" onclick="this.style.display='none'">
  <button class="lightbox-close">&times;</button>
  <img id="lightbox-img" src="" alt="">
  <div class="lightbox-caption" id="lightbox-caption"></div>
</div>

<script>
const SB_URL = 'https://ctsuupvmmyjlrtjnxagv.supabase.co';
const ANON_KEY = document.querySelector('meta[name="sb-anon-key"]')?.content || '';

const params = new URLSearchParams(location.search);
const postId = params.get('id');
const rideId = params.get('ride');

async function sbGet(path) {
  const r = await fetch(`${SB_URL}${path}`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } });
  return r.json();
}

async function init() {
  if (!postId && !rideId) {
    document.getElementById('loading').innerHTML = '<p style="color:#ff716c;text-align:center;padding:48px">Ride nao encontrada.</p>';
    return;
  }

  let post = null, ride = null, club = null;

  if (postId) {
    const posts = await sbGet(`/rest/v1/club_ride_posts?id=eq.${postId}&select=*&limit=1`);
    post = posts[0];
    if (!post) { document.getElementById('loading').innerHTML = '<p style="color:#ff716c;text-align:center;padding:48px">Ride nao encontrada.</p>'; return; }
    if (post.ride_id) {
      const rides = await sbGet(`/rest/v1/club_rides?id=eq.${post.ride_id}&select=*&limit=1`);
      ride = rides[0];
    }
    const clubs = await sbGet(`/rest/v1/clubs?id=eq.${post.club_id}&select=id,name,slug,color,avatar_url&limit=1`);
    club = clubs[0];
  } else if (rideId) {
    const rides = await sbGet(`/rest/v1/club_rides?id=eq.${rideId}&select=*&limit=1`);
    ride = rides[0];
    if (!ride) { document.getElementById('loading').innerHTML = '<p style="color:#ff716c;text-align:center;padding:48px">Ride nao encontrada.</p>'; return; }
    const clubs = await sbGet(`/rest/v1/clubs?id=eq.${ride.club_id}&select=id,name,slug,color,avatar_url&limit=1`);
    club = clubs[0];
  }

  if (club?.color) document.documentElement.style.setProperty('--accent', club.color);

  // Set OG
  const title = ride?.name || post?.content?.slice(0, 60) || 'Ride';
  document.title = `${title} — KROMI Ride`;

  // Render hero
  renderRideHero(post, ride, club);

  const content = document.getElementById('content');

  // Elevation profile (from ride_data or GPX)
  const elevProfile = post?.ride_data?.elevation_profile || [];
  if (elevProfile.length > 2) {
    renderAltimetry(content, elevProfile);
  }

  // Segments
  const segments = post?.ride_data?.segments || [];
  if (segments.length) renderSegments(content, segments);

  // Per-rider stats (post-ride)
  const riderStats = post?.ride_data?.rider_stats || post?.stats?.participants || [];
  if (riderStats.length) renderRiderStats(content, riderStats);

  // Photos
  if (post?.photos?.length) renderPhotos(content, post.photos);

  // Share buttons
  renderShareButtons(title);

  // Show
  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  // Fade-in
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
  }, { threshold: 0.1 });
  document.querySelectorAll('.fade-in').forEach((el) => obs.observe(el));
}

function renderRideHero(post, ride, club) {
  const hero = document.getElementById('ride-hero');
  const name = ride?.name || 'Ride';
  const date = ride?.scheduled_at || post?.created_at;
  const dateStr = date ? new Date(date).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';

  let statsBar = '';
  const s = post?.stats || {};
  if (s.distance_km || s.elevation_gain_m || s.duration_s) {
    const items = [];
    if (s.distance_km) items.push(`<div class="ride-stat"><div class="ride-stat-value mono">${Number(s.distance_km).toFixed(1)}</div><div class="ride-stat-label">km</div></div>`);
    if (s.elevation_gain_m) items.push(`<div class="ride-stat"><div class="ride-stat-value mono">${Math.round(s.elevation_gain_m)}</div><div class="ride-stat-label">D+</div></div>`);
    if (s.elevation_loss_m) items.push(`<div class="ride-stat"><div class="ride-stat-value mono">${Math.round(s.elevation_loss_m)}</div><div class="ride-stat-label">D-</div></div>`);
    if (s.duration_s) items.push(`<div class="ride-stat"><div class="ride-stat-value mono">${formatDuration(s.duration_s)}</div><div class="ride-stat-label">Duracao</div></div>`);
    if (s.avg_speed_kmh) items.push(`<div class="ride-stat"><div class="ride-stat-value mono">${Number(s.avg_speed_kmh).toFixed(1)}</div><div class="ride-stat-label">km/h avg</div></div>`);
    statsBar = `<div class="ride-stats-bar">${items.join('')}</div>`;
  }

  hero.innerHTML = `
    <div class="hero-content">
      ${club ? `<a href="/club.html?s=${club.slug}" class="club-badge">${club.name}</a>` : ''}
      <h1 class="serif">${name}</h1>
      <div class="ride-meta">${dateStr}</div>
      ${ride?.meeting_address ? `<div style="font-size:12px;color:var(--text-dim);margin-top:4px">\uD83D\uDCCD ${ride.meeting_address}</div>` : ''}
      ${statsBar}
    </div>`;
}

function renderAltimetry(parent, profile) {
  const sec = document.createElement('div');
  sec.className = 'section fade-in';
  sec.innerHTML = '<div class="section-title">Altimetria</div>';

  const container = document.createElement('div');
  container.className = 'altimetry-container';

  const W = 800, H = 200, PAD = 30;
  const maxD = Math.max(...profile.map((p) => p.d));
  const minE = Math.min(...profile.map((p) => p.e));
  const maxE = Math.max(...profile.map((p) => p.e));
  const rangeE = maxE - minE || 1;

  const scaleX = (d) => PAD + (d / maxD) * (W - 2 * PAD);
  const scaleY = (e) => H - PAD - ((e - minE) / rangeE) * (H - 2 * PAD);

  // Build polyline points
  const points = profile.map((p) => `${scaleX(p.d)},${scaleY(p.e)}`).join(' ');
  const areaPoints = `${scaleX(0)},${H - PAD} ${points} ${scaleX(maxD)},${H - PAD}`;

  // Gradient: compute slope colors
  let gradientStops = '';
  profile.forEach((p, i) => {
    if (i === 0) return;
    const slope = Math.abs((p.e - profile[i - 1].e) / (((p.d - profile[i - 1].d) * 1000) || 1)) * 100;
    let color = 'var(--climb-easy)';
    if (slope > 12) color = 'var(--climb-extreme)';
    else if (slope > 8) color = 'var(--climb-hard)';
    else if (slope > 4) color = 'var(--climb-mod)';
    const pct = (p.d / maxD) * 100;
    gradientStops += `<stop offset="${pct}%" stop-color="${color}" stop-opacity="0.6"/>`;
  });

  const svg = `
    <svg class="altimetry-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="elev-grad" x1="0" y1="0" x2="1" y2="0">${gradientStops}</linearGradient>
      </defs>
      <polygon points="${areaPoints}" fill="url(#elev-grad)" opacity="0.3"/>
      <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>
      <!-- Y-axis labels -->
      <text x="${PAD - 4}" y="${scaleY(maxE)}" fill="var(--text-dim)" font-size="10" text-anchor="end" dominant-baseline="middle">${Math.round(maxE)}m</text>
      <text x="${PAD - 4}" y="${scaleY(minE)}" fill="var(--text-dim)" font-size="10" text-anchor="end" dominant-baseline="middle">${Math.round(minE)}m</text>
      <!-- X-axis labels -->
      <text x="${scaleX(0)}" y="${H - 5}" fill="var(--text-dim)" font-size="10" text-anchor="middle">0</text>
      <text x="${scaleX(maxD)}" y="${H - 5}" fill="var(--text-dim)" font-size="10" text-anchor="middle">${maxD.toFixed(1)}km</text>
    </svg>`;

  container.innerHTML = svg + '<div class="altimetry-tooltip" id="alt-tooltip"></div>';

  // Hover interaction
  container.addEventListener('mousemove', (e) => {
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, (x - PAD * (rect.width / W)) / (rect.width * (1 - 2 * PAD / W))));
    const dist = pct * maxD;
    // Find closest point
    let closest = profile[0];
    for (const p of profile) { if (Math.abs(p.d - dist) < Math.abs(closest.d - dist)) closest = p; }
    const tooltip = document.getElementById('alt-tooltip');
    tooltip.style.display = 'block';
    tooltip.style.left = x + 'px';
    tooltip.style.top = '10px';
    tooltip.innerHTML = `<strong>${closest.e.toFixed(0)}m</strong> · ${closest.d.toFixed(1)}km`;
  });
  container.addEventListener('mouseleave', () => {
    document.getElementById('alt-tooltip').style.display = 'none';
  });

  sec.appendChild(container);
  parent.appendChild(sec);
}

function renderSegments(parent, segments) {
  const sec = document.createElement('div');
  sec.className = 'section fade-in';
  sec.innerHTML = '<div class="section-title">Segmentos</div>';

  segments.forEach((s) => {
    const isClimb = (s.elevation_gain_m || 0) > (s.elevation_loss_m || 0);
    const icon = isClimb ? '\u2B06\uFE0F' : '\u2B07\uFE0F';
    const grade = s.avg_gradient_pct != null ? Math.abs(s.avg_gradient_pct) : 0;
    let difficulty = 'Facil', diffColor = 'var(--climb-easy)';
    if (grade > 12) { difficulty = 'Extremo'; diffColor = 'var(--climb-extreme)'; }
    else if (grade > 8) { difficulty = 'Dificil'; diffColor = 'var(--climb-hard)'; }
    else if (grade > 4) { difficulty = 'Moderado'; diffColor = 'var(--climb-mod)'; }

    sec.innerHTML += `
      <div class="segment" style="border-left-color:${diffColor}">
        <div class="segment-icon">${icon}</div>
        <div class="segment-info">
          <div class="segment-name">${s.name || (isClimb ? 'Subida' : 'Descida')}</div>
          <div class="segment-stats">
            ${s.distance_km ? s.distance_km.toFixed(1) + ' km' : ''}
            ${s.elevation_gain_m ? ' \u00B7 ' + Math.round(s.elevation_gain_m) + ' D+' : ''}
            ${grade ? ' \u00B7 ' + grade.toFixed(1) + '% avg' : ''}
            ${s.max_gradient_pct ? ' \u00B7 ' + Math.abs(s.max_gradient_pct).toFixed(1) + '% max' : ''}
          </div>
        </div>
        <span class="segment-grade" style="background:${diffColor}22;color:${diffColor}">${difficulty}</span>
      </div>`;
  });
  parent.appendChild(sec);
}

function renderRiderStats(parent, riders) {
  const sec = document.createElement('div');
  sec.className = 'section fade-in';
  sec.innerHTML = '<div class="section-title">Stats por Participante</div>';

  let html = '<table class="riders-table"><thead><tr><th>Rider</th><th>Km</th><th>D+</th><th>Vel Avg</th><th>FC Avg</th><th>W Avg</th></tr></thead><tbody>';
  riders.forEach((r) => {
    html += `<tr>
      <td style="font-weight:600">${r.name || r.display_name || 'Rider'}</td>
      <td class="mono">${r.distance_km ? Number(r.distance_km).toFixed(1) : '-'}</td>
      <td class="mono">${r.elevation_gain_m ? Math.round(r.elevation_gain_m) : '-'}</td>
      <td class="mono">${r.avg_speed_kmh ? Number(r.avg_speed_kmh).toFixed(1) : '-'}</td>
      <td class="mono">${r.avg_heart_rate || '-'}</td>
      <td class="mono">${r.avg_power ? Math.round(r.avg_power) : '-'}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  sec.innerHTML += html;
  parent.appendChild(sec);
}

function renderPhotos(parent, photos) {
  const sec = document.createElement('div');
  sec.className = 'section fade-in';
  sec.innerHTML = '<div class="section-title">Galeria</div>';

  const grid = document.createElement('div');
  grid.className = 'gallery';
  photos.forEach((p) => {
    const img = document.createElement('img');
    img.src = p.drive_thumbnail_url || p.drive_view_url;
    img.alt = p.caption || '';
    img.loading = 'lazy';
    img.onclick = () => {
      document.getElementById('lightbox-img').src = p.drive_view_url;
      document.getElementById('lightbox-caption').textContent = p.caption || '';
      document.getElementById('lightbox').style.display = 'flex';
    };
    grid.appendChild(img);
  });
  sec.appendChild(grid);
  parent.appendChild(sec);
}

function renderShareButtons(title) {
  const btns = document.getElementById('share-btns');
  const url = window.location.href;
  btns.innerHTML = `
    <button class="share-btn" onclick="navigator.clipboard.writeText('${url}').then(()=>this.textContent='Copiado!')">Copiar Link</button>
    <a class="share-btn" href="https://wa.me/?text=${encodeURIComponent(title + ' ' + url)}" target="_blank">WhatsApp</a>`;
}

function formatDuration(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m}min`;
}

init();
</script>
</body>
</html>
```

- [ ] **Step 2: Verify the page loads**

Open `http://localhost:5173/ride.html?id=test` in browser. Should show loading then "Ride nao encontrada".

- [ ] **Step 3: Commit**

```bash
git add public/ride.html
git commit -m "feat(clubs): ride.html editorial page — hero, SVG altimetry, segments, rider stats, photo gallery"
```

---

### Task 11: Final Build Verification + Integration Test

- [ ] **Step 1: Run type-check**

Run: `npm run type-check`
Expected: PASS

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: PASS, `club.html` and `ride.html` appear in `dist/`

- [ ] **Step 3: Verify club.html and ride.html are in the build output**

Run: `ls dist/club.html dist/ride.html`
Expected: Both files present (Vite copies from `public/` to `dist/`).

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(clubs): Club System complete — schema, service, UI tabs, landing page, ride page"
```

---

## Spec Coverage Checklist

| Spec Requirement | Task |
|---|---|
| ALTER clubs (visibility, slug, avatar, banner, social_links, landing_config) | Task 1, Step 1 |
| club_members 4-tier roles | Task 1, Step 1 |
| Slug auto-generation trigger | Task 1, Step 2 |
| club_invites table + RLS | Task 1, Step 3 |
| club_join_requests table + RLS | Task 1, Step 4 |
| club_ride_posts table + RLS | Task 1, Step 5 |
| is_club_admin helper | Task 1, Step 6 |
| club_use_invite RPC | Task 1, Step 6 |
| club_request_join RPC | Task 1, Step 6 |
| club_review_request RPC | Task 1, Step 6 |
| club_set_member_role RPC | Task 1, Step 6 |
| club_remove_member RPC | Task 1, Step 6 |
| club_update_landing_config RPC | Task 1, Step 6 |
| ClubService abstraction | Task 2 |
| Club Settings tab (name, visibility, avatar, social) | Task 3 |
| Members tab (role changes, kick, join requests) | Task 4 |
| Invites tab (create, copy link, usage stats) | Task 5 |
| Landing page backoffice (toggles, about, board) | Task 6 |
| Tab navigation in ClubPage | Task 7 |
| Email invite edge function | Task 8 |
| club.html landing page (hero, stats, about, board, rides, feed, leaderboard, members) | Task 9 |
| ride.html editorial page (hero, altimetry, segments, rider stats, photos, share) | Task 10 |
| Public club RLS (anon read for landing page) | Task 1, Step 6 (policy updates) |
| OG meta tags for social sharing | Task 9, Task 10 |
| Responsive design (mobile/tablet/desktop) | Task 9, Task 10 |
| IntersectionObserver fade-in | Task 9, Task 10 |
