# KROMI BikeControl — Session 18 Prompt

> **Date target:** next session
> **Focus:** Close the RLS gap on user-data tables, fix the cross-tab IndexedDB leak, build user-facing GDPR tools, refresh docs
> **Hardware needed:** No (PWA + admin + DB work)
> **Out of scope:** Anything BLE / hardware / APK; anything 2FA-related

---

## Context — what landed in Session 17

Session 17 was massive. Everything from the prompt + 5 stretch goals + 6 self-identified polish items + 7 bug fixes shipped. Summary:

### RBAC application (commits `344feb1`, `5a73d39`)
- `MENU_CATEGORIES` + `DESKTOP_NAV` + dashboard widgets + `TripSummaryModal` all filter by `usePermission`
- Single canonical nav config at `src/config/navigation.ts` consumed by both mobile and desktop
- Service writes (status, comments, items, notes, deletes) and bike fit save now gate on `useReadOnlyGuard`

### Read-only guard (commit `4b09286`)
- `useReadOnlyGuard` hook + pub/sub toast bus in `src/hooks/useReadOnlyGuard.ts`
- Banner subline "(somente leitura)" + blocked-action toast
- Wired into bike CRUD, service writes, bike fit save, photo uploads

### Admin panel polish (commits `eb94c21`, `0c0f518`)
- New **Auditoria** tab with filters (admin / target / date range / active only) + cursor pagination
- Drive tab: Recharts horizontal bar chart for top 10 users by storage
- User detail: activity stats card (rides, bikes, files, storage, last activity) + ban/unban timeline
- Custom roles CRUD UI: create / edit / delete with "copy permissions from another role" dropdown

### File storage (commit `b519b87`)
- `LegacyPhotoMigration` admin-triggered tool to re-upload Supabase Storage photos via KromiFileStore
- Runs from Super Admin → Sistema tab with progress bar + per-row error list

### Impersonation — full rewrite (commits `3b178eb`, `df0477c`, `f8d0a96`)
- **Opens in a new tab** via `?as=<uuid>&log=<log_id>` URL param instead of mutating current tab
- `authStore.applyImpersonationFromUrl` runs at App bootstrap, swaps `user` to target, reloads settings from DB
- `settingsStore` detects the URL param and swaps persist to `sessionStorage` so the admin's `localStorage` stays clean
- `useIsSuperAdmin()` returns false when `impersonatedUser` is set → Super Admin menu + panel hidden inside the impersonation tab (the mirror illusion is preserved; exit = close tab)
- Email alert via `notify-impersonation` edge function (Resend) — fail-soft on any error
- `endImpersonation` calls `window.close()` in impersonation tabs

### RLS hardening — admin tables only (commit `b2251cc`)
- `pgcrypto`-backed `resolve_session_user_id(token)` and `is_super_admin_session(token)` helpers, **accepts both hashed session tokens and `device:{id}` auto-login format**
- 9 `SECURITY DEFINER` admin RPCs: `admin_set_super_admin`, `admin_set_suspended`, `admin_set_user_roles`, `admin_create_role`, `admin_update_role`, `admin_delete_role`, `admin_set_role_permissions`, `admin_set_user_feature_flag`, `admin_clear_user_feature_flag`
- **RESTRICTIVE** policies block direct INSERT/UPDATE/DELETE on `app_users`, `roles`, `role_permissions`, `user_roles`, `user_feature_flags`
- `impersonation_log` DELETE blocked (audit trail tamper-proof)
- SELECT remains open on all sensitive tables (admin panel needs to read)

### Edge function hardening (commit `57ec5e3`)
- `edge_function_rate_limits` table + `check_rate_limit()` RPC (token-bucket)
- `drive-storage` caps at 120 calls/IP/60s
- `notify-impersonation` caps at 10 alerts/IP/60s
- Both fail-open if the rate-limit RPC errors

### DB seed & triggers
- Premium role now has `features.clubs` + `features.service_book`
- `waldemar.isbrecht@gmail.com` was backfilled to `free` role (had zero roles)
- `trg_assign_default_role` trigger auto-assigns `free` on every new `app_users` insert
- `bikes` column added to `user_settings` (full BikeConfig array, not slim — needed for impersonation data restore)

**Read these before starting:**
- `memory/reference_rbac.md`
- `memory/feedback_file_storage.md`
- `memory/reference_kromi_files.md`
- `memory/feedback_hide_internal_infra.md`
- `memory/feedback_dual_navigation.md` (now partially obsolete — see `src/config/navigation.ts`)
- `docs/KROMI-RBAC-ADMIN.md` and `docs/KROMI-DRIVE-STORAGE.md`
- The 17 commits between `3f6e17e..f8d0a96` on `main`

---

## Goals for this session

### 🎯 Goal 1 — RLS hardening for user-data tables (HIGHEST PRIORITY)

Session 17 only locked down the **admin** tables. The big remaining gap:

**Still `cmd:ALL, qual:true` (i.e. anon key can read/write anything):**
- `kromi_files`
- `ride_sessions`, `ride_snapshots`, `ride_summaries`, `ride_override_events`
- `service_requests`, `service_items`, `service_comments`, `service_photos`
- `shops`, `shop_*`
- `clubs`, `club_members`, `club_rides`, `club_ride_participants`
- `bike_configs`, `bike_components`, `bike_fits`, `bike_fit_changes`, `bike_qr_codes`
- `athlete_profiles`, `emergency_profiles`
- `user_settings`, `user_suspensions`
- `rescue_requests`, `rescue_responses`, `rider_presence`
- `device_tokens`, `otp_codes`, `user_sessions` ← especially scary
- `debug_logs`, `login_history`, `elevation_cache`, `maintenance_schedules`

**The hard part:** the frontend doesn't use Supabase Auth JWT. It uses custom OTP sessions with a raw token. PostgREST sees every request as `anon`, so there's no `auth.uid()` to build policies on.

**Proposed approach (pick ONE at the start and commit):**

**Option A — Session JWT migration**
Mint a custom JWT signed with `JWT_SECRET` on login. Frontend sends it as `Authorization: Bearer <jwt>`. PostgREST verifies it natively and exposes `auth.jwt() -> 'sub'`. Policies use `current_setting('request.jwt.claims', true)::json->>'sub'`.
- Pro: native PostgREST flow, zero per-request overhead
- Con: touches every REST call site; breaks device auto-login if not done carefully

**Option B — RPC wrappers (same pattern as the admin RPCs)**
Every sensitive write goes through a `SECURITY DEFINER` RPC that takes the session token, resolves it to a user_id, and checks ownership. For reads: either also wrap, or keep open with filter-aware policies.
- Pro: reuses the pattern already in use
- Con: massive refactor — dozens of write paths; RPC surface area explodes

**Option C — PostgREST pre-request GUC trick**
Set up a pre-request function that reads a custom header (`x-kromi-session`), validates, and sets `request.jwt.claims` GUC to a synthetic JSON. Policies then use the standard `current_setting('request.jwt.claims')` accessors.
- Pro: one change to PostgREST config, policies look normal
- Con: requires `db-pre-request` setting which is Supabase-controlled; may not be configurable on shared plan

**Recommendation:** start with Option C investigation (can be done in 30min via `show server_version; show pgrst.db_pre_request;` and a test). If Supabase doesn't support per-project pre-request hooks on the current tier, fall back to Option A (JWT migration — most future-proof).

**Acceptance criteria:**
- All tables in the list above have RLS policies that filter by `user_id = <resolved_caller>` for SELECT / UPDATE / DELETE
- INSERT policies check that the `user_id` column matches the caller
- Public/read-only tables (`elevation_cache`, `debug_logs` maybe) stay open but are flagged
- Smoke test: set role to `anon`, attempt SELECT on another user's `kromi_files` with the wrong filter → zero rows
- Smoke test: attempt DELETE on another user's `ride_sessions` → error

### 🎯 Goal 2 — LocalRideStore keyed by user_id

**Current state:** `src/services/storage/LocalRideStore.ts` uses a single IndexedDB database per origin. That means in an impersonation tab, the ride history shows the ADMIN's rides, not the target's.

**Fix:**
1. Either namespace the IndexedDB name by user_id (`kromi-rides-<uuid>`), OR add a `user_id` field to every row and filter reads by the current viewer's id.
2. Migration: on first load with the new code, detect existing rows without a `user_id`, assign them to the currently logged-in user, and flush.
3. Update all the getters to use `useAuthStore.getState().user?.id` at read time.

**Watch out for:**
- `LocalRideStore` is used in `RideHistory.tsx`, `TripSummaryModal.tsx`, the ride recording hooks — every call site might be implicit via `localRideStore.getSessionSnapshots(id)`.
- The FIT import (`FitImportService`) writes rows into it — needs to stamp user_id.

### 🎯 Goal 3 — GDPR user-facing tools

Admin can delete/suspend users, but **users themselves** have no way to export or delete their own data. This is a legal requirement in the EU.

**Build:**
- **Export my data** button in Settings → Conta. Bundles:
  - `user_settings`, `bike_configs`, `bike_fits`, `bike_fit_changes`
  - `ride_sessions` + `ride_snapshots` + `ride_summaries`
  - `service_requests` + `service_items` + `service_comments`
  - `kromi_files` metadata (not the file bytes — just the list + Drive links)
  - `club_members`, `emergency_profiles`, `athlete_profiles`
  - Zip it client-side via JSZip or stream as NDJSON. Download or push to Drive via KromiFileStore.
- **Delete my account** button, same place. Requires typed email confirmation. Issues:
  - Cascade delete via a single `admin_delete_user_account(p_session_token, p_confirmation)` RPC (server-side because of RLS)
  - Drive folder: trash all files in `users/{slug}/` via `drive-storage` action
  - Log to a new `account_deletion_log` table for audit
- Settings → Privacidade sub-section can house both.

### 🎯 Goal 4 — Documentation refresh

Every memory/doc file is at least 1-3 sessions stale. Update:

1. **`memory/reference_rbac.md`** — mention the SECURITY DEFINER RPC architecture, list the 9 admin RPCs, explain the session token resolution trick
2. **`memory/feedback_dual_navigation.md`** — mark as obsolete, point to `src/config/navigation.ts`
3. **`memory/project_overview.md`** — bump version, mention Session 17 landmarks
4. **`CLAUDE.md`** — add a section on "writing RBAC-gated features" (usePermission pattern, how to add a new permission key, how to grant via role or feature_flag), and a section on "impersonation tab architecture" so future work doesn't break the tab isolation
5. **`docs/KROMI-RBAC-ADMIN.md`** — expand with the RLS section, RPC list, lockdown policies, rate limiting
6. **New `docs/KROMI-IMPERSONATION.md`** — document the new-tab flow, sessionStorage isolation, URL param contract, known limitations
7. **New memory file** `reference_edge_rate_limits.md` — note `check_rate_limit()` signature, `edge_function_rate_limits` table schema, current caps per function

### 🎯 Goal 5 — Small admin polish

Quick wins while we're in the admin area:

- **User search** in `AdminUsersPage` — filter by email substring, role, suspended-only
- **CSV export** of the users list
- **Bulk role assign** — select multiple users, assign one role in one click
- **Orphan file cleanup** in Drive tab — detect `kromi_files` rows where `entity_id` points to a deleted entity; offer a "Move to trash" button
- **Rate limit viewer** — new card in Sistema tab showing recent 429 rejections from `edge_function_rate_limits`

### 🎯 Goal 6 — Stretch (only if everything above is done)

- **Scheduled unsuspend** — `user_suspensions.expires_at` column + a cron edge function (or `pg_cron` if available) to auto-unsuspend on expiry
- **Slack webhook notifications** as a second output of `notify-impersonation` (alongside email)
- **Admin activity dashboard** — charts for impersonation frequency, storage growth, new users per week (all from existing tables)
- **Session management** — let users see their active `user_sessions` and revoke them (like GitHub's "sessions" page)

---

## Important reminders

1. **Branch new work, don't force-push `main`.** Several landmines in Session 17 were caught only because the user tested on the deployed Vercel build — keep that loop short.
2. **Test SECURITY DEFINER RPCs with both session token formats.** Remember that `loginByDevice` issues `device:{id}` tokens, not hashed ones. The `resolve_session_user_id` function already handles both; any new RPC should call it rather than re-implementing the lookup.
3. **Don't break the impersonation tab isolation.** If you add a new persisted Zustand store that contains user-specific data, it MUST detect `?as=` and switch to `sessionStorage` like `settingsStore` does. Pattern:
   ```typescript
   const IS_IMPERSONATION_TAB = typeof window !== 'undefined' &&
     new URLSearchParams(window.location.search).has('as');
   ...
   persist(..., {
     ...(IS_IMPERSONATION_TAB
       ? { storage: createJSONStorage(() => sessionStorage) }
       : {}),
   })
   ```
   Do NOT use `storage: IS_IMPERSONATION_TAB ? ... : undefined` — zustand treats explicit undefined as "storage unavailable" and breaks all writes.
4. **`KromiFileStore.uploadFile()` is still mandatory.** If the GDPR export needs to upload a zip to the user's Drive, use it.
5. **Super Admin UI is hidden inside impersonation tabs.** `useIsSuperAdmin()` returns false when `impersonatedUser` is set. Don't regress this — it's the "mirror illusion" guarantee.
6. **Never log secrets.** The legacy `kromi-drive-sa.json` deletion happened because credentials leaked into chat history once. Treat every `.env`, every token output, every Drive refresh token as radioactive.
7. **Type-check before committing:** `npx tsc --noEmit` must pass. No exceptions.
8. **Prefer small commits.** Session 17 had ~15 commits; each was easy to revert and easy to read. Don't bundle unrelated changes.

---

## How to test (same pattern as Session 17)

**Setup:**
- Log in as `rdias300@gmail.com` (super admin)
- Have at least one non-admin test user (`amandio.6@gmail.com` currently has `free` role)

**For Goal 1 (RLS):**
```sql
-- As the test user (or via impersonation tab + direct REST):
SET LOCAL ROLE anon;
SELECT * FROM kromi_files WHERE owner_user_id != '<admin-id>';
-- Before Session 18: returns all rows
-- After Session 18: returns 0 rows
RESET ROLE;
```
Also test via frontend: impersonate `amandio` → go to bikes → confirm you ONLY see his bikes (already working since Session 17) AND that fiddling the REST URL to query another user's bikes returns empty/403.

**For Goal 2 (LocalRideStore):**
Impersonate `amandio` → RideHistory should be empty (or his rides only). Your admin tab's RideHistory unaffected.

**For Goal 3 (GDPR):**
- Export: click "Exportar os meus dados", verify the zip contains all the expected tables
- Delete: create a burner test user, log in as them, click "Apagar conta", type email, confirm. Log back in as admin, verify row is gone from `app_users` and all FK-linked tables.

---

## Useful MCP tools

- `mcp__claude_ai_Supabase__execute_sql` — quick queries, RLS smoke tests
- `mcp__claude_ai_Supabase__apply_migration` — for new tables / policy changes
- `mcp__claude_ai_Supabase__list_tables` — quick schema overview
- `mcp__claude_ai_Supabase__get_logs` — service type `edge-function` to see why a function crashed
- `mcp__claude_ai_Supabase__get_edge_function` — pull current source code of a deployed function (used in S17 to diagnose `verify-session`)
- `mcp__claude_ai_Supabase__deploy_edge_function` — redeploy after edits

---

## Git workflow reminder

- Small descriptive commits
- `git push` → Vercel auto-deploys in ~1 min
- Don't touch APK builds (separate flow)
- Never commit `kromi-drive-sa.json`, `client_secret_*.json` (both gitignored)
- Pre-commit hook auto-syncs the Obsidian vault; the validation warnings (broken wikilinks etc.) are expected and don't block the push

---

## Don't do this session

- ❌ BLE / hardware testing
- ❌ APK bridge rebuilds
- ❌ Stitch visual redesigns
- ❌ **2FA** for super admins (explicitly out of scope)
- ❌ Anything that requires physical access to the bike
- ❌ Touching the Giant GEV protocol / motor control
- ❌ Re-architecting the Zustand stores unless Goal 2 requires it

---

## Known limitations to be AWARE of (not necessarily fixed this session)

1. **LocalRideStore shared across tabs** — addressed by Goal 2
2. **User-data tables RLS open** — addressed by Goal 1
3. **No soft-delete on app_users** — hard delete cascades, which is irreversible. Might matter for the GDPR delete flow (Goal 3) — think about whether to keep a tombstone
4. **Resend free-tier send restrictions** — if `KROMI_NOTIFY_FROM` uses a non-verified domain or the recipient isn't the account owner, Resend rejects. The edge function is fail-soft now (returns 200 + skipped: true) so it's not a blocker, but the email won't arrive
5. **Impersonation log cannot be queried by `reason` efficiently** — no index; if the audit log grows large, add one

---

## Session 17 final state (most recent commits, newest first)

```
f8d0a96 fix(impersonation): hide Super Admin UI inside impersonation tabs
df0477c fix(settings): don't pass storage:undefined to zustand persist
3b178eb feat(impersonation): open in new tab + actually load target user data
8ece56b fix(rbac): super admin check uses realUser so panel stays accessible during impersonation
bd03a76 fix(edge): notify-impersonation never returns 502
b2251cc feat(rbac): migrate admin writes to SECURITY DEFINER RPCs (RLS hardening)
57ec5e3 feat(edge): IP rate limiting on drive-storage and notify-impersonation
0c0f518 feat(admin): audit filters, ban timeline, role copy-from, server-side bikes count
b519b87 feat(admin): legacy photo migration tool + impersonation email alerts
cd89b84 refactor(rbac): single nav config + roles CRUD UI + storage chart
5a73d39 feat(rbac): close gaps from session 17 prompt
eb94c21 feat(admin): impersonation audit tab + storage usage report
4b09286 feat(impersonation): read-only guard + blocked-action toast
344feb1 feat(rbac): apply permission checks to menus and dashboard widgets
```

Plus DB migrations applied in Session 17:
- `auto_assign_free_role_to_new_users`
- `user_suspensions_timeline`
- `edge_function_rate_limiting`
- `user_settings_bikes_column`
- `rls_admin_rpcs_and_lockdown`
- `rls_fix_pgcrypto_search_path`
- `rls_accept_device_sessions`

And edge functions redeployed:
- `notify-impersonation` v5 (fail-soft on Resend errors + rate limiting)
- `drive-storage` v16 (rate limiting)
