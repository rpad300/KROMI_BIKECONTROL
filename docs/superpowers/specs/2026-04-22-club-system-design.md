# Club System — Complete Design Spec

> **Date:** 2026-04-22
> **Status:** Approved
> **Scope:** 3 sub-projects (this spec covers all 3, implement sequentially)
> **Reference:** Marao-Sobrado editorial page (`G:\O meu disco\-- DOWNLOADS DIARIOS\VIAGEM MARAO\marao_sobrado_2026.html`)

---

## Overview

Complete club/team system for KROMI BikeControl with:
- Club management with 4-tier roles (Owner/Admin/Moderator/Member)
- Public/private visibility with invite links + email invites + join requests
- Backoffice for club admins to configure the landing page
- Professional public landing page per club (`club.html?s={slug}`)
- Editorial ride pages with SVG altimetry, segment analysis, per-rider stats
- Social feed of rides with photos/videos

---

## Sub-project 1: Club Core

### 1.1 Database Schema Changes

#### Modify: `clubs` table
```sql
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'private'));
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS slug text UNIQUE;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS banner_url text;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS founded_at date;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS social_links jsonb DEFAULT '{}';
  -- e.g. {"instagram": "url", "facebook": "url", "website": "url"}
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS landing_config jsonb DEFAULT '{}';
  -- Backoffice config: which sections to show, order, custom text
  -- e.g. {"show_members": true, "show_leaderboard": true, "show_map": true,
  --        "show_feed": true, "show_upcoming_rides": true,
  --        "custom_about": "Somos um clube de BTT...",
  --        "board_members": [{"user_id": "uuid", "title": "Presidente"}, ...]}
```

#### Modify: `club_members` table
```sql
-- role column already exists but may need CHECK constraint update
ALTER TABLE club_members DROP CONSTRAINT IF EXISTS club_members_role_check;
ALTER TABLE club_members ADD CONSTRAINT club_members_role_check
  CHECK (role IN ('owner', 'admin', 'moderator', 'member'));
-- Default new members to 'member'
ALTER TABLE club_members ALTER COLUMN role SET DEFAULT 'member';
```

#### New: `club_invites`
```sql
CREATE TABLE club_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  code text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(4), 'hex'),
  created_by uuid NOT NULL REFERENCES app_users(id),
  email text,                          -- NULL = generic link, non-null = email invite
  max_uses int NOT NULL DEFAULT 1,     -- 0 = unlimited
  used_count int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE club_invites ENABLE ROW LEVEL SECURITY;
-- Club admins+ can manage invites
CREATE POLICY ci_manage ON club_invites FOR ALL
  USING (club_id IN (
    SELECT club_id FROM club_members
    WHERE user_id = public.kromi_uid()
    AND role IN ('owner', 'admin', 'moderator')
  ));
-- Anyone can read an invite by code (for the join flow)
CREATE POLICY ci_read_by_code ON club_invites FOR SELECT
  USING (true);

CREATE INDEX idx_ci_code ON club_invites(code);
CREATE INDEX idx_ci_club ON club_invites(club_id);
```

#### New: `club_join_requests`
```sql
CREATE TABLE club_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id),
  message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES app_users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(club_id, user_id, status)  -- one pending request per user per club
);

ALTER TABLE club_join_requests ENABLE ROW LEVEL SECURITY;
-- User can see their own requests
CREATE POLICY cjr_own ON club_join_requests FOR SELECT
  USING (user_id = public.kromi_uid());
-- User can create their own request
CREATE POLICY cjr_create ON club_join_requests FOR INSERT
  WITH CHECK (user_id = public.kromi_uid());
-- Club admins+ can see and update requests for their club
CREATE POLICY cjr_admin ON club_join_requests FOR ALL
  USING (club_id IN (
    SELECT club_id FROM club_members
    WHERE user_id = public.kromi_uid()
    AND role IN ('owner', 'admin', 'moderator')
  ));
```

#### New: `club_ride_posts` (social feed)
```sql
CREATE TABLE club_ride_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  ride_id uuid REFERENCES club_rides(id) ON DELETE SET NULL,
  author_id uuid NOT NULL REFERENCES app_users(id),
  content text,
  stats jsonb,
    -- {"distance_km", "elevation_gain_m", "duration_s", "avg_speed_kmh",
    --  "max_speed_kmh", "participants": [{"user_id", "name", "distance_km", ...}]}
  photos jsonb DEFAULT '[]',
    -- [{"drive_view_url", "drive_thumbnail_url", "caption", "lat", "lng"}]
  gpx_file_id text,                   -- Drive file ID if GPX attached
  ride_data jsonb,
    -- Full ride analysis: elevation profile, segments, per-rider breakdown
    -- {"elevation_profile": [{d, e}], "segments": [...], "rider_stats": [...]}
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE club_ride_posts ENABLE ROW LEVEL SECURITY;
-- Club members can read
CREATE POLICY crp_member_read ON club_ride_posts FOR SELECT
  USING (
    club_id IN (SELECT club_id FROM club_members WHERE user_id = public.kromi_uid())
    OR club_id IN (SELECT id FROM clubs WHERE visibility = 'public')
  );
-- Author can CRUD their own posts
CREATE POLICY crp_author ON club_ride_posts FOR ALL
  USING (author_id = public.kromi_uid());

CREATE INDEX idx_crp_club ON club_ride_posts(club_id, created_at DESC);
```

### 1.2 Slug Generation

Auto-generate slug from club name on create/update:
```
"Trail Riders Porto" → "trail-riders-porto"
"BTT Sintra 🏔" → "btt-sintra"
```
Collision handling: append `-2`, `-3`, etc.

Implemented as a trigger on `clubs`:
```sql
CREATE OR REPLACE FUNCTION generate_club_slug()
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
  WHILE EXISTS (SELECT 1 FROM clubs WHERE slug = final_slug AND id != NEW.id) LOOP
    counter := counter + 1;
    final_slug := base_slug || '-' || counter;
  END LOOP;
  NEW.slug := final_slug;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_club_slug
  BEFORE INSERT OR UPDATE OF name ON clubs
  FOR EACH ROW EXECUTE FUNCTION generate_club_slug();
```

### 1.3 Admin RPCs (SECURITY DEFINER)

All RPCs validate caller is club admin+ via helper:

```sql
CREATE OR REPLACE FUNCTION is_club_admin(p_club_id uuid, p_user_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM club_members
    WHERE club_id = p_club_id AND user_id = p_user_id
    AND role IN ('owner', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = 'public';
```

#### `club_use_invite(p_code text)` — Join via invite code
```
1. Find invite by code
2. Check not expired, not exhausted (used_count < max_uses OR max_uses = 0)
3. Check club visibility: if private, invite is required
4. Insert into club_members with role='member'
5. Increment invite used_count
6. Return club_id
```

#### `club_request_join(p_club_id uuid, p_message text)` — Request to join private club
```
1. Check club exists and is private
2. Check no existing pending request
3. Insert into club_join_requests with status='pending'
```

#### `club_review_request(p_request_id uuid, p_approve boolean)` — Admin approves/rejects
```
1. Validate caller is admin+ of the request's club
2. Update status to 'approved' or 'rejected'
3. If approved, insert into club_members
```

#### `club_set_member_role(p_club_id uuid, p_target_user_id uuid, p_role text)` — Change member role
```
1. Validate caller is owner or admin (admins can't promote to owner)
2. Cannot demote the owner
3. Update club_members.role
```

#### `club_remove_member(p_club_id uuid, p_target_user_id uuid)` — Kick member
```
1. Validate caller is admin+ (moderators can't kick)
2. Cannot kick the owner
3. Delete from club_members
```

#### `club_update_landing_config(p_club_id uuid, p_config jsonb)` — Update backoffice config
```
1. Validate caller is owner or admin
2. Merge p_config into clubs.landing_config
```

### 1.4 Email Invite (Edge Function)

New edge function: `supabase/functions/club-invite/index.ts`

Actions:
- `send_invite`: Creates invite row + sends email via Resend with link `https://www.kromi.online/club.html?s={slug}&invite={code}`
- `validate_code`: Returns invite details (club name, expiry, uses remaining) for the join page

### 1.5 UI: Club Settings / Backoffice

In `Settings.tsx` ClubPage, add new tabs/sections:

#### Club Settings Tab (owner/admin only)
- **Geral**: nome, descricao, localizacao, cor, visibilidade (public/private toggle)
- **Imagem**: upload avatar (logo) + banner via KromiFileStore
- **Redes sociais**: links para Instagram, Facebook, website
- **Fundacao**: data de fundacao

#### Membros Tab (owner/admin/moderator)
- Lista de membros com role badge
- Dropdown para mudar role (owner/admin only)
- Botao "Expulsar" (admin+ only)
- Pedidos de adesao pendentes (approve/reject)

#### Convites Tab (owner/admin/moderator)
- Gerar link de convite (com opcoes: usos, expiracao)
- Enviar convite por email
- Lista de convites activos com stats (usados/max)
- Copiar link para clipboard

#### Landing Page Tab (owner/admin) — BACKOFFICE
- Toggle on/off para cada seccao da landing page:
  - Membros visivel? (checkbox)
  - Leaderboard visivel? (checkbox)
  - Mapa de actividade visivel? (checkbox)
  - Feed de rides visivel? (checkbox)
  - Proximas rides visivel? (checkbox)
- Texto "Sobre nos" (textarea)
- Direccao / Board Members:
  - Adicionar membro da direccao: seleccionar user do clube + titulo ("Presidente", "Vice-Presidente", "Tesoureiro", etc.)
  - Reordenar com drag
  - Toggle "Mostrar direccao na landing page"
- Preview button (abre a landing page num novo tab)

### 1.6 Join Flow

#### Public club
1. User pesquisa clube ou recebe link
2. Clica "Entrar" → directo insert em `club_members`
3. Redirect para pagina do clube na app

#### Private club — via invite
1. User recebe link com `?invite=ABC123`
2. Landing page mostra convite com nome do clube
3. Se logado: clica "Aceitar convite" → `club_use_invite(code)` → entra
4. Se nao logado: mostra botao "Criar conta" → login → auto-join

#### Private club — request
1. User encontra clube (pesquisa ou link sem invite)
2. Landing page mostra "Clube privado" + botao "Pedir adesao"
3. User escreve mensagem opcional → `club_request_join()`
4. Admin ve notificacao na tab Membros → aprova/rejeita

---

## Sub-project 2: Club Landing Page

### 2.1 Public Page: `public/club.html`

Standalone HTML (like live.html/emergency.html). URL: `https://www.kromi.online/club.html?s={slug}`

#### Data Sources (all via Supabase anon key)
- `clubs?slug=eq.{slug}` — club info, landing_config
- `club_members?club_id=eq.{id}` — member list with names (join app_users)
- `club_ride_posts?club_id=eq.{id}` — feed posts
- `club_rides?club_id=eq.{id}&status=eq.planned` — upcoming rides
- Leaderboard: computed from ride_posts stats

#### Page Sections (controlled by landing_config toggles)

1. **Hero Banner**
   - Club avatar (logo) + banner image
   - Club name, location, member count, founded date
   - Club color as accent throughout
   - Buttons: "Entrar" (public) or "Pedir Adesao" (private) or "Aceitar Convite" (with invite code)
   - Social links (Instagram, Facebook, website)

2. **Stats Grid**
   - Total rides, total km, total D+, member count, founded date
   - Computed from club_ride_posts stats

3. **Sobre / About** (if custom_about set)
   - Rich text from landing_config.custom_about

4. **Direccao / Board** (if board_members configured and show=true)
   - Grid of board member cards: avatar, name, title (Presidente, etc.)
   - Role badge

5. **Proximas Rides** (if show_upcoming_rides=true)
   - List of planned rides with date, name, location, confirmed count
   - "Ver detalhes" link

6. **Feed de Rides** (if show_feed=true)
   - Chronological feed of completed rides
   - Each post: author avatar+name, timestamp, text content
   - Inline stats: distance, D+, duration, participant count
   - Photo carousel (horizontal scroll)
   - "Ver ride completa" link → ride page

7. **Leaderboard Mensal** (if show_leaderboard=true)
   - Current month
   - Table: rank, rider name+avatar, total km, total D+, ride count
   - Top 3 highlighted with medal icons
   - Computed from ride posts in current month

8. **Membros** (if show_members=true)
   - Grid of member cards: avatar, name, role badge
   - Owner: crown, Admin: shield, Moderator: wrench, Member: user icon
   - "Ver todos" expandable if >12 members

9. **Mapa de Actividade** (if show_map=true)
   - Google Maps with polylines from recent ride posts
   - Heatmap-style overlay of frequently ridden areas
   - Club location marker

10. **Footer**
    - "Powered by kromi.online" with link
    - Club social links repeated

#### Design Language
- Dark theme: `#0e0e0e` background, `#3fff8b` accent (or club custom color)
- Typography: JetBrains Mono for labels/numbers, system sans for body
- Responsive: mobile-first, 1-column on phone, 2-column on tablet, 3-column on desktop
- Smooth scroll, fade-in on scroll (IntersectionObserver)
- OG meta tags for social sharing (club name, description, avatar)

---

## Sub-project 3: Ride Pages

### 3.1 Ride Page: `public/ride.html`

URL: `https://www.kromi.online/ride.html?id={ride_post_id}`

Two modes:
- **Pre-ride** (ride is planned, has GPX): shows the planned route, elevation profile, waypoints, meeting point, scheduled time
- **Post-ride** (ride is completed, has ride_data): shows actual data, per-rider stats, segment analysis, photos, comparison with plan

#### Data Source
- `club_ride_posts?id=eq.{id}` — the post with stats, photos, ride_data, gpx_file_id
- `club_rides?id=eq.{ride_id}` — ride metadata (name, date, meeting point)
- `clubs?id=eq.{club_id}` — club info for header

#### Pre-Ride Page Sections

1. **Hero** — editorial style inspired by Marao page
   - Ride name as large serif title
   - Date, time, meeting point
   - Stats bar: distance, D+, D-, estimated time
   - Club badge

2. **Map** — Leaflet or Google Maps
   - GPX route rendered as polyline
   - Waypoints with labels (start, checkpoints, finish)
   - Meeting point marker

3. **Altimetria** — SVG elevation profile
   - Interactive: hover shows distance/altitude
   - Waypoint markers on profile
   - Gradient coloring (green=flat, orange=climb, red=steep)

4. **Segmentos de Subida/Descida**
   - Auto-detected from GPX elevation data
   - Each segment: name (if available), distance, D+/D-, avg gradient, max gradient
   - Difficulty rating (easy/moderate/hard/extreme)

5. **Participantes Confirmados**
   - List of riders who joined
   - Total count

#### Post-Ride Page Sections (all of pre-ride PLUS)

6. **Comparacao Planeado vs Real**
   - Side-by-side or overlay: planned GPX vs actual trail
   - Deviations highlighted

7. **Stats Gerais da Ride**
   - Total distance, D+, D-, duration, avg speed, max speed
   - Weather conditions (if available)
   - Battery consumption (avg across e-bikes)

8. **Stats por Participante**
   - Table/cards: each rider with their individual stats
   - Distance, D+, duration, avg speed, avg HR, avg power
   - Per-segment breakdown: time on each climb, avg gradient per rider

9. **Segmentos — Classificacao**
   - Each climb/descent segment:
     - Overall stats (avg for group)
     - Per-rider ranking (fastest, most power, etc.)
     - Mini leaderboard per segment

10. **Galeria de Fotos**
    - Grid/masonry layout
    - GPS-tagged: tap shows location on map
    - Lightbox with caption and rider name

11. **Feed / Comentarios**
    - Rider comments about the ride
    - Post-ride impressions

12. **Footer**
    - "Powered by kromi.online"
    - Share buttons (copy link, WhatsApp)
    - "Download GPX" button

#### Design Language
- Same editorial quality as the Marao page reference
- Dark theme variant (KROMI standard) with club accent color
- SVG altimetry profile with gradient fill, waypoint markers, interactive hover
- Parallax hero (optional, for rides with photos)
- Responsive, print-friendly (for ride reports)

---

## File Structure

### New files
```
supabase/migrations/20260422_club_system.sql       — schema + RLS + triggers
supabase/functions/club-invite/index.ts             — email invite via Resend
src/services/club/ClubService.ts                    — club CRUD, invites, requests
src/components/Admin/ClubBackoffice.tsx              — landing page backoffice
public/club.html                                    — club landing page (~800 lines)
public/ride.html                                    — ride editorial page (~1000 lines)
```

### Modified files
```
src/components/Settings/Settings.tsx                — ClubPage: add settings/members/invites/backoffice tabs
src/config/navigation.ts                            — add club routes if needed
```

---

## Implementation Order

1. **Sub-project 1** (Club Core): Migration + RPCs + ClubService + UI tabs
2. **Sub-project 2** (Landing Page): club.html + backoffice UI
3. **Sub-project 3** (Ride Pages): ride.html + ride_data generation from ride sessions

Each sub-project: spec review → implementation plan → code → deploy → test
