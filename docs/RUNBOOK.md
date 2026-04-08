# KROMI BikeControl — Operations Runbook

> Critical when you need it, zero value until you do. Keep this short, factual, and up to date.
> Last reviewed: 2026-04-08 (Session 19)

## Project coordinates

| Thing | Where |
|---|---|
| **Production URL** | https://kromi.online (Vercel) |
| **Supabase project** | `ctsuupvmmyjlrtjnxagv` ([dashboard](https://supabase.com/dashboard/project/ctsuupvmmyjlrtjnxagv)) |
| **Git repo** | https://github.com/rpad300/KROMI_BIKECONTROL |
| **Google Drive root** | `KROMI PLATFORM` folder, id `1fjb2tKtZ14PaofV573ScoeZDra95ubua` |
| **OAuth identity** | `rdias300@gmail.com` (refresh-token-based, lives in edge function secrets) |
| **Super admin** | `rdias300@gmail.com` (only one — see below for adding more) |

---

## 1. Incident response playbook

### 1.1 Symptom: Users can't log in

**Checklist:**
1. Is Vercel up? → https://status.vercel.com
2. Is Supabase up? → https://status.supabase.com
3. Check the most recent CI run on main — did a bad migration ship?
   ```bash
   gh run list --limit 3
   ```
4. Browser DevTools → Network tab → look at the failing call:
   - `send-otp` 500 → `RESEND_API_KEY` missing or invalid in edge function secrets
   - `send-otp` 429 → rate limit (5/60s/IP or 3/15min/email — intentional)
   - `verify-otp` 401 → OTP expired or already used (normal)
   - `verify-session` 401 → session token expired OR JWT secret misconfigured

**If JWT is broken (`kromi_uid()` returns null):**
```sql
-- Run in Supabase SQL editor
SET LOCAL request.jwt.claims = '{"sub":"<any-valid-user-uuid>","role":"authenticated","aud":"authenticated"}';
SELECT public.kromi_uid();
-- Should return the uuid. If null → JWT verification broken.
```
Fix: **Dashboard → Edge Functions → Manage Secrets** → verify `KROMI_JWT_SECRET` matches **Project Settings → API → JWT Settings → JWT Secret** (no trailing whitespace).

### 1.2 Symptom: 42P17 "infinite recursion in policy"

Classic RLS anti-pattern — a policy does `EXISTS (SELECT FROM same_table ...)`.

**Find the bad policy:**
```sql
SELECT c.relname, p.polname, pg_get_expr(p.polqual, p.polrelid)
FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
WHERE c.relname = '<table_name>';
```

**Fix pattern** — create a SECURITY DEFINER helper that bypasses RLS:
```sql
CREATE OR REPLACE FUNCTION public.is_<scope>_member(p_scope_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.<table> WHERE <scope>_id = p_scope_id AND user_id = public.kromi_uid());
$$;

DROP POLICY <bad_policy> ON public.<table>;
CREATE POLICY <bad_policy> ON public.<table> FOR SELECT
  USING (public.is_super_admin_jwt() OR public.is_<scope>_member(<scope>_id));
```

See `memory/feedback_rls_patterns.md` for the full pattern + examples.

### 1.3 Symptom: anon is seeing data they shouldn't

**Run the smoke test against production:**
```bash
SUPABASE_URL=https://ctsuupvmmyjlrtjnxagv.supabase.co \
SUPABASE_ANON_KEY=<anon_key_from_supabase_dashboard> \
npm run rls-smoke
```
Fails loud if any lockdown table leaks. Add any new user-data table to `LOCKDOWN_TABLES` in `tests/rls-smoke.mjs`.

### 1.4 Symptom: Cron job stopped running

**Check the health viewer first:** Super Admin → Sistema → Cron jobs (pg_cron).

**Manual query:**
```sql
SELECT * FROM public.kromi_cron_job_status();
-- last_run_at should be recent (15 min for suspensions, 24h for deletions)
-- last_status = 'error' → check last_error
-- runs_24h should match expected cadence
```

**If a job is stuck/missing, re-schedule it:**
```sql
-- List current jobs
SELECT jobid, jobname, schedule, active FROM cron.job;

-- Re-schedule expire suspensions
SELECT cron.unschedule((SELECT jobid FROM cron.job WHERE jobname='kromi_expire_due_suspensions'));
SELECT cron.schedule('kromi_expire_due_suspensions', '*/15 * * * *',
  $$SELECT public.kromi_expire_due_suspensions_cron_wrapped();$$);
```

### 1.5 Symptom: Google Drive uploads failing

**OAuth refresh token expired or revoked.**

**Diagnose:**
```bash
# Hit the ping action
curl -X POST https://ctsuupvmmyjlrtjnxagv.supabase.co/functions/v1/drive-storage \
  -H "apikey: <anon>" \
  -H "Content-Type: application/json" \
  -d '{"action":"ping"}'
```
If response is `{ error: "invalid_grant" }` or similar, rotate the refresh token — see §2.1.

---

## 2. Routine operations

### 2.1 Rotate Google Drive OAuth refresh token

Only do this when:
- The current token is leaked
- Upload starts failing with `invalid_grant`
- On scheduled rotation (every 6 months is reasonable)

**Steps:**
1. Go to [GCP Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Find the OAuth 2.0 Client ID for KROMI (type: Desktop App)
3. Use `tools/drive-auth.sh` (if it still exists) or the OAuth playground to obtain a fresh refresh token:
   - Scopes: `https://www.googleapis.com/auth/drive`
   - Approval prompt: `consent` (forces a new refresh token)
4. In Supabase Dashboard → Edge Functions → Manage Secrets, update:
   - `GOOGLE_DRIVE_REFRESH_TOKEN` → the new token
5. No redeploy needed — secret propagates within ~30s
6. Test: `curl ...drive-storage { action: "ping" }` → `{ ok: true }`

**DO NOT** commit the refresh token anywhere. Treat it as radioactive.

### 2.2 Apply a new migration

1. Write the SQL file: `supabase/migrations/YYYYMMDD_description.sql`
2. Apply it in dev first (via `supabase db push` or Dashboard SQL editor)
3. Verify with the relevant smoke tests:
   ```bash
   npm run type-check && npm run lint && npm run rls-smoke
   npm run db:drift  # confirms file + DB are in sync
   ```
4. Commit + push. Vercel auto-deploys; CI validates.

**Emergency rollback:** Postgres migrations are hard to truly reverse — prefer writing a forward fix. If you MUST rollback, use the Supabase Dashboard → Database → Backups to restore a point-in-time.

### 2.3 Add a new super admin

```sql
UPDATE public.app_users SET is_super_admin = true
 WHERE email = 'new-admin@example.com';
```
**This is logged in `admin_audit_log`** — visible in Super Admin → Auditoria.

Current count: 1 (`rdias300@gmail.com`). Adding more means more JWTs with 1h TTL circulating.

### 2.4 Manually delete a user

**Prefer** the GDPR schedule flow (Super Admin → user detail → "Entrar como" → Privacidade → Schedule deletion — 30-day grace window).

**For a hard delete right now** (only if legally required or clearly intentional):
```sql
-- Read the target row first!
SELECT id, email FROM app_users WHERE email = 'target@example.com';

-- Then:
SELECT public._kromi_hard_delete_account_internal(
  '<a_super_admin_session_token>',
  'target@example.com'
);
```
This cascades across 15+ tables and tombstones `app_users`. **Irreversible.**

### 2.5 Force-run the account deletion cron

```sql
SELECT public.kromi_execute_scheduled_deletions_cron_wrapped();
-- Returns the number of accounts that were hard-deleted.
-- Log row appears in cron_job_runs.
```

### 2.6 Revoke all sessions for a user

```sql
DELETE FROM public.user_sessions WHERE user_id = (SELECT id FROM app_users WHERE email = 'target@example.com');
DELETE FROM public.device_tokens WHERE user_id = (SELECT id FROM app_users WHERE email = 'target@example.com');
```
The next `verify-session` call returns 401 and the PWA forces re-login.

---

## 3. Monitoring & observability

| What | Where | Cadence |
|---|---|---|
| Cron job health | Super Admin → Sistema → Cron jobs | check weekly |
| Admin audit log | Super Admin → Auditoria | check on suspected incident |
| Impersonation log | Super Admin → Auditoria → Impersonation tab | check weekly |
| Edge function logs | Supabase Dashboard → Edge Functions → Logs | on suspected edge crash |
| Storage usage | Super Admin → Drive tab → chart | check monthly |
| Slow queries | `SELECT * FROM extensions.pg_stat_statements WHERE mean_exec_time > 50 ORDER BY total_exec_time DESC LIMIT 20;` | check monthly |
| GitHub Actions runs | `gh run list --limit 10` or repo → Actions tab | continuous |

---

## 4. Backup & disaster recovery

- **Database:** Supabase automatic daily backups, 7-day retention on the free tier. Point-in-time restore available for paid tiers. **Verify annually** by spinning a test project.
- **Google Drive:** Files live in the `KROMI PLATFORM` folder owned by `rdias300@gmail.com`. Trash has ~30 day retention. A deleted user's folder sits in Trash during the GDPR grace window and can be restored from there before it's permanently purged.
- **Git history:** Full reproducibility via `supabase/migrations/` + `supabase/functions/` + source code. CI validates on every push.
- **Secrets:** NOT backed up. Documented in the secret inventory below — treat as recreate-from-scratch if lost.

### Secret inventory

| Secret | Where | How to rotate |
|---|---|---|
| `KROMI_JWT_SECRET` (edge fn) | Supabase Edge Function secrets | Project Settings → API → JWT Settings → Copy JWT Secret → paste |
| `RESEND_API_KEY` | Edge function secrets | [resend.com dashboard](https://resend.com) → API Keys |
| `GOOGLE_DRIVE_REFRESH_TOKEN` | Edge function secrets | See §2.1 |
| `VITE_GOOGLE_MAPS_API_KEY` | Vercel env vars | GCP Console → Credentials |
| `KROMI_NOTIFY_TO` | Edge function secrets | comma-separated emails to alert on impersonation |
| `KROMI_SLACK_WEBHOOK_URL` (optional) | Edge function secrets | Slack admin → Apps → Incoming Webhooks |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` (CI) | GitHub Actions secrets | Project Settings → API |

---

## 5. Known tripwires

### 5.1 `*_all` policies with `USING (true)`
Every table added before Session 19 may have an orphan permissive policy from the early days (`rbac_*_all`, `anon_all`, etc.). The Session 19 audit (commit `d[...]`) caught 4 of these. **If you add a new table, always run the smoke test.**

### 5.2 supaFetch is not optional
Raw `fetch('${SB_URL}/rest/v1/...')` bypasses the JWT and hits RLS as anon. Returns `[]` with no error. Easy to miss in code review. **Grep for `fetch(\`\${` in new PRs.**

### 5.3 Impersonation tab isolation
New persisted zustand stores holding user data must detect `?as=` and swap to sessionStorage. See `settingsStore` for the pattern. Use `...(IS_IMPERSONATION_TAB ? { storage: ... } : {})` — **never** `storage: cond ? x : undefined`.

### 5.4 Super admin JWT = 1h TTL
Admins get refreshed on every `verify-session` call (app bootstrap). If you disable auto-refresh anywhere, admins will get 401s after 1h.

### 5.5 pg_cron runs as postgres
Cron workers can't use `kromi_uid()` (no JWT). They use `_cron` / `_cron_wrapped` variants that skip the auth check. **Never** grant EXECUTE on `_cron` functions to `anon` or `authenticated`.

### 5.6 shared catalog tables look like leaks but aren't
`bike_components`, `shops`, `shop_hours`, `shop_services`, `shop_reviews`, `elevation_cache`, `shop_services_templates` are **intentionally** public-read. Documented in `tests/rls-smoke.mjs` LOCKDOWN_TABLES comments + `memory/feedback_rls_patterns.md`.

---

## 6. Key references

- `CLAUDE.md` — project conventions (read first if unfamiliar)
- `memory/feedback_rls_patterns.md` — 5 rules for safe RLS policies
- `memory/reference_jwt_auth.md` — JWT auth flow details
- `memory/reference_gdpr.md` — GDPR soft-delete flow
- `memory/reference_admin_audit.md` — audit log + step-up auth
- `docs/KROMI-RBAC-ADMIN.md` — full admin panel docs
- `docs/KROMI-IMPERSONATION.md` — impersonation new-tab flow
- `docs/KROMI-DRIVE-STORAGE.md` — Google Drive storage architecture
- `NEXT_SESSION_PROMPT.md` — current backlog

---

**If something catastrophic happens and you're reading this at 3am:** stop, breathe, read the symptom section above, and if you're still stuck, the Supabase Dashboard SQL editor + `gh run list` will tell you 90% of what you need.
