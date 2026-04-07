# KROMI BikeControl — Session 19 Prompt

> **Focus:** pick one of the candidate tracks below with the user at the start of the session
> **Hardware needed:** depends on track
> **Out of scope:** BLE/motor protocol changes unless explicitly requested

---

## Context — Session 18 landed and was fully verified

Session 18 shipped:
- Custom HS256 JWT auth (`verify-otp`/`verify-session`/`login-by-device` mint; `KROMI_JWT_SECRET` set)
- 132 RLS policies across 23 user-data tables (kromi_files, ride_*, bike_*, service_*, shops, clubs, athlete_profiles, user_settings, user_sessions, device_tokens, …)
- `src/lib/supaFetch.ts` wrapper + 23 services migrated (~104 call sites)
- LocalRideStore user-scoped + impersonation sync disabled
- Settings → Privacidade: export-my-data + delete-my-account with `kromi_delete_my_account` RPC
- Admin Dashboard tab with KPIs/charts, user filters, CSV export, bulk role assign
- `trashUserFolder` action in drive-storage v19 (called from GDPR delete)
- "Sessões activas" section in Privacidade (`kromi_list_my_sessions` + `kromi_revoke_my_session`)
- Scheduled unsuspend (auto on admin mount + pg_cron every 15 min)
- Slack webhook channel in `notify-impersonation` v8 (opt-in via `KROMI_SLACK_WEBHOOK_URL`)

Post-S18 follow-ups closed in commit `6e8b9bc`:
- Fixed `shop_members_sel` infinite recursion (42P17) via `is_shop_member(uuid)` SECURITY DEFINER helper
- Locked down `ride_summaries` (data audit confirmed safe)
- pg_cron autonomous schedule for `kromi_expire_due_suspensions`
- Decommissioned `_probe_env` (returns 410; still needs hard delete from Dashboard)

**Current state:** production auth + RLS are solid. There is **no pending backend infra work** from Session 18.

---

## Candidate tracks for Session 19

### Track A — Admin Dashboard v2 (incremental, low risk)
Extend the current Dashboard tab:
- Date range picker (last 7d / 30d / 90d / custom) propagated to all three charts
- Drill-down: click a bar in "Impersonations per day" → audit log filtered to that day
- "Most active users" widget (rides + files in last 30d)
- "Storage growth forecast" — linear regression on the last 30d of kromi_files
- Server-side aggregation via a new RPC or materialized view if the client-side aggregations get slow

### Track B — User-facing feature work
Non-infra features the backend is now ready to support:
- Clubs polish — club rides UX, route sharing, leaderboards
- Route library — save/load/share GPX routes via the `routes` table
- Service book UX — photo upload flow, status notifications
- Emergency contacts screen — `emergency_profiles` already has RLS, UI needs surfacing

### Track C — 2FA for super admins (explicitly deferred from S18)
- TOTP enrollment flow (`otp_codes`-style but QR-based via a library like otpauth)
- `app_users.totp_secret` + `totp_enabled_at` columns
- Step-up check on every admin RPC + impersonation begin
- Recovery codes, emailed on enrollment
- Out of scope unless the user explicitly opts in

### Track D — Hardware / BLE (explicitly deferred unless requested)
- Anything under `src/services/bluetooth/`, `src/services/di2/`, `src/services/torque/`
- Real bike required

### Track E — Performance & observability
- Index audit: `pg_stat_statements` is installed, run a "slow queries > 100ms" report
- Add missing indexes on hot paths (impersonation_log.reason, ride_sessions.user_id+started_at, etc.)
- Client-side: React Profiler + Lighthouse PWA audit
- Sentry or equivalent error tracking if not already wired

---

## Start-of-session checklist

1. Ask the user which track to pursue (A-E or something else entirely)
2. If a backend-facing track, run this smoke test first to confirm S18 is still green:
   ```sql
   SET LOCAL ROLE anon;
   SELECT count(*) FROM kromi_files;     -- expect 0
   SELECT count(*) FROM ride_sessions;   -- expect 0
   RESET ROLE;
   ```
3. Check `git log --oneline -20` for any drift since commit `6e8b9bc`
4. Pull `NEXT_SESSION_PROMPT.md` (this file) and `memory/MEMORY.md` into context
5. Confirm `kromi-drive-sa.json` / `.env.local` are still untracked

---

## Reminders that still apply

- Every REST call MUST go through `src/lib/supaFetch.ts` — writing raw `fetch(\`${SB_URL}/rest/v1/...\`)` bypasses JWT and RLS sees anon
- Every upload MUST go through `KromiFileStore.uploadFile()` — never direct Drive API or Supabase Storage
- Any new persisted zustand store holding user data MUST detect `?as=` impersonation and swap to sessionStorage (see `settingsStore` pattern, spread operator not `undefined`)
- Super Admin UI is hidden inside impersonation tabs via `useIsSuperAdmin()` → don't regress
- SECURITY DEFINER helpers needed for any policy that references the same table it protects (shop_members lesson)
- Pre-commit hook runs kromi-doc sync automatically — the validation warnings about broken wikilinks / missing frontmatter are expected and don't block

---

## Manual follow-ups the user might still want to do

- Hard-delete `_probe_env` edge function from Dashboard (currently returns 410 stub, but still listed)
- Set `KROMI_SLACK_WEBHOOK_URL` secret if Slack alerts for impersonation are desired (email works without it)

---

## Don't

- ❌ Re-architect the auth/RLS layer — it's working and verified
- ❌ Touch the Giant GEV motor protocol unless the user explicitly asks
- ❌ Create new backward-compatibility shims for removed code
- ❌ Commit `kromi-drive-sa.json`, `client_secret_*.json`, `.env.local`
- ❌ Skip the anon smoke test if making any new RLS changes
