# KROMI BikeControl — Session 17 Prompt

> **Date target:** next session
> **Focus:** Apply RBAC to existing features + refactor remaining file uploaders + impersonation hardening
> **Hardware needed:** No (PWA + admin work)

---

## Context — what landed in Session 16

Two huge features shipped end-to-end:

1. **Google Drive central storage** (commit `14a42c3`)
   - Edge function `drive-storage` (OAuth refresh token, not service account)
   - `kromi_files` table — central polymorphic file registry
   - `KromiFileStore.uploadFile()` — single mandatory entry point for all file uploads
   - Per-user folder taxonomy: `users/{slug}/{bikes,bikefits,activities,routes,profile,other}/`
   - `useDriveBootstrap` hook — auto-creates user folders on first login

2. **Super Admin panel + RBAC** (commit `4200828`)
   - `app_users.is_super_admin` flag (rdias300@gmail.com is the only one)
   - 18 permissions across 3 categories (core / features / admin)
   - 5 roles (free, premium, mechanic, coach, super_admin)
   - `user_feature_flags` for per-user allow/deny overrides
   - `usePermission(key)` hook with super-admin short-circuit
   - `authStore` split: `realUser` / `impersonatedUser` / `user` (viewer)
   - `AdminPanel` (4 tabs: Users / Roles / Drive / System)
   - Impersonation with persistent banner + audit log

Plus 3 follow-up bug fixes (CORS, desktop nav, hide Drive from regular users).

**Read these first:**
- `memory/reference_kromi_files.md` — Drive backend
- `memory/reference_rbac.md` — RBAC system
- `memory/feedback_file_storage.md` — KromiFileStore convention
- `memory/feedback_dual_navigation.md` — MENU_CATEGORIES + DESKTOP_NAV duplication
- `memory/feedback_hide_internal_infra.md` — never expose Drive/Supabase to users
- `docs/KROMI-DRIVE-STORAGE.md` — full architecture
- `docs/KROMI-RBAC-ADMIN.md` — full RBAC + admin guide

---

## Goals for this session

### 🎯 Goal 1 — Apply RBAC to existing features (HIGHEST PRIORITY)

The RBAC infrastructure exists but no feature checks permissions yet. Make the menus + features actually respect roles.

**Settings menu (`src/components/Settings/Settings.tsx`):**
Filter `MENU_CATEGORIES` items by `usePermission`:
- `bikefit` → `features.bike_fit`
- `service-book` → `features.service_book`
- `shop` → `features.shop_management`
- `club` → `features.clubs`
- `kromi` (KROMI Intelligence) → `features.intelligence_v2`
- `emergency` → `features.emergency_qr`
- `accessories` → keep visible (BLE accessories are core-ish)

**Same in `DESKTOP_NAV` in `src/App.tsx`** — REMEMBER, two arrays to update (see `feedback_dual_navigation.md`).

**Dashboard widgets** — wrap optional widgets with `usePermission`:
- NutritionWidget → `features.nutrition_tracking`
- WPrimeWidget / fatigue / efficiency → `features.intelligence_v2`
- TripSummary advanced sections → `features.ride_analysis_pro`

**Acceptance criteria:**
- Create a test user via Supabase SQL (or UI) with only `free` role
- Log in as that user (use impersonation if needed)
- Verify that bike fit / service book / clubs / kromi intelligence / nutrition / etc. are HIDDEN
- Switch to `premium` role → verify they appear

### 🎯 Goal 2 — Read-only guard during impersonation

Currently the store has `impersonationReadOnly: true` but nothing enforces it. Add the guard.

**Implementation:**
1. Create `src/hooks/useReadOnlyGuard.ts`:
   ```typescript
   export function useReadOnlyGuard() {
     const isImpersonating = useAuthStore((s) => s.isImpersonating());
     return useCallback(() => {
       if (isImpersonating) {
         throw new Error('READ_ONLY_IMPERSONATION');
       }
     }, [isImpersonating]);
   }
   ```
2. Or simpler: a `useIsReadOnly()` returning boolean, plus a `<ReadOnlyBanner>` toast component.
3. Wire into key write operations: `BikesPage.save`, `addPhoto`, `addServiceItem`, etc. Show toast "Modo impersonation — sem permissão para alterar".
4. The banner already says "A ver como X" — add a sub-line "(somente leitura)".

### 🎯 Goal 3 — Refactor remaining uploaders to KromiFileStore

The `PhotoUploader` (service photos) is done. These still bypass:
- **`BikesPage.tsx`** — bike profile photo (uses Gemini-generated URL or `photo_url` field). Migrate to upload via `KromiFileStore.uploadFile({ category: 'bike_photo', entityType: 'bike', entityId: bikeId, bikeSlug, ownerUserSlug })`.
- **`ShopManagementPage.tsx`** — shop logo. Use `category: 'shop_logo'`, `shopSlug`. NOTE: shops are NOT under `users/{slug}/`, they live at top-level `shops/{slug}/`.
- **`BikeFitPage.tsx`** — bike fit photos. `category: 'bikefit_photo'`, dated sub-folders.
- **`RideHistory` / `FitImport`** — ride exports (FIT, GPX, JSON). `category: 'ride_export'`, `entityId: ride_id`.

For each: keep the legacy column nullable for backwards compat. Add a `file_id uuid REFERENCES kromi_files(id)` if not already there (some tables already have it from the migration).

### 🎯 Goal 4 — Admin polish (if time)

- **Impersonation log viewer** — new tab in AdminPanel "Auditoria" listing recent `impersonation_log` rows (admin → target → start → end → reason)
- **User detail enrichments** — show bikes count, rides count, total storage used (sum `size_bytes` from `kromi_files`), last activity date
- **Storage usage report** — a summary in the Drive tab: total files, total bytes, top 10 users by storage

### 🎯 Goal 5 — Cleanup

- **Delete `kromi-drive-sa.json`** from disk (no longer used, OAuth refresh token replaced it). It's gitignored so safe.
- **Rotate OAuth client_secret** in Google Cloud Console → "Reset Secret" → update Supabase secret `GOOGLE_OAUTH_CLIENT_SECRET`. The current secret was exposed in Session 16 chat history.
- **Single navigation source of truth** (optional, big refactor) — extract `MENU_CATEGORIES` and `DESKTOP_NAV` into `src/config/navigation.ts` consumed by both. Each item has a `permission?: string` field for RBAC integration.

---

## Important reminders

1. **`KromiFileStore.uploadFile()` is mandatory.** Never call Supabase Storage REST or Drive API directly. (See `feedback_file_storage.md`.)
2. **Update BOTH `MENU_CATEGORIES` and `DESKTOP_NAV`** when changing the Settings menu. (See `feedback_dual_navigation.md`.)
3. **Never expose internal infra to users.** Drive, Supabase, kromi_files IDs all stay inside the Super Admin panel. (See `feedback_hide_internal_infra.md`.)
4. **Always pass `ownerUserSlug: userFolderSlug(user)` to `uploadFile`** for personal categories. Otherwise files end up at root level.
5. **Type-check before committing** — `npx tsc --noEmit` must pass.
6. **Test on desktop AND mobile** when changing navigation.

---

## How to test as a non-admin

Two options:

**Option A: Impersonation (easier)**
1. Log in as `rdias300@gmail.com` (you're super admin)
2. Settings → Super Admin → Painel Admin → Utilizadores
3. Find another user (or create one via SQL)
4. Click → "Entrar como este utilizador"
5. The orange banner appears, you see the platform as them
6. Click "Sair" to return

**Option B: Create a fresh test account via SQL**
```sql
INSERT INTO public.app_users (id, email, name) VALUES (gen_random_uuid(), 'test-free@example.com', 'Test Free');
INSERT INTO public.user_roles (user_id, role_id)
SELECT u.id, r.id FROM public.app_users u, public.roles r
WHERE u.email = 'test-free@example.com' AND r.key = 'free';
```
Then impersonate that user.

---

## Useful MCP tools

- `mcp__claude_ai_Supabase__execute_sql` — quick queries
- `mcp__claude_ai_Supabase__list_tables` — schema overview
- `mcp__claude_ai_Supabase__deploy_edge_function` — redeploy drive-storage if needed
- `mcp__obsidian__*` — only if MCP is configured with `OBSIDIAN_API_KEY` env var

---

## Git workflow reminder

- Pequenos commits descriptivos
- `git push` → Vercel auto-deploy ~1 min
- Não tocar em APK builds (separate flow)
- Nunca committar `kromi-drive-sa.json`, `client_secret_*.json` (já gitignored)

---

## Stretch goals (only if everything above is done)

- One-time migration script: download legacy Supabase Storage photos → re-upload via KromiFileStore → set `service_photos.file_id` → null `storage_path`
- Permissions UI to **create custom roles** (currently roles are seeded, can't add new ones via UI)
- Storage usage chart (Recharts) in admin Drive tab
- Email notifications when an admin impersonates a user (audit/transparency)

---

## Don't do this session

- ❌ BLE / hardware testing (use the hardware session prompt for that)
- ❌ Big visual redesigns (Stitch designs are a separate effort)
- ❌ Touching the bridge APK
- ❌ Anything that requires the user to be physically with the bike

---

## Session 16 final state (commits)

```
ebd9da5 docs: add RBAC architecture doc + Session 17 prompt
6c25ac0 fix: hide Google Drive entry from non-admin Settings menu
c9edc80 fix(desktop): add Google Drive + Super Admin entries to desktop sidebar
5f71072 fix(drive-storage): allow apikey header in CORS preflight
4200828 feat: Super Admin panel + RBAC + impersonation
14a42c3 feat: Google Drive central storage backend (KROMI PLATFORM)
```
