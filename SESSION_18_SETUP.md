# Session 18 — Post-deploy setup steps

⚠️ **READ THIS BEFORE DEPLOYING.** Session 18 introduces custom JWT authentication + RLS lockdown. Some pieces landed as code + DB helpers, but the **full lockdown is gated behind a manual secret setup**. Until you complete the steps below, the app keeps working exactly as Session 17 (opaque tokens, open RLS).

## What landed automatically

| Component | State |
|---|---|
| `verify-otp` edge function | **v14 deployed** — mints JWT when secret is set, otherwise returns `jwt: null` |
| `verify-session` edge function | **v14 deployed** — same behaviour |
| `login-by-device` edge function | **v1 deployed** (new) |
| `src/lib/supaFetch.ts` | Central REST wrapper, injects JWT automatically |
| 23+ services migrated to `supaFetch` | ✅ |
| `authStore.jwt` + `publishJwtGlobal()` | ✅ |
| `LocalRideStore` user_id scoping + impersonation sync disable | ✅ |
| DB migration `rls_helpers_session18` | ✅ applied — `kromi_uid()`, `is_super_admin_jwt()`, RLS on `routes` + `shop_services_templates` |
| DB migration `gdpr_account_deletion` | ✅ applied — `kromi_delete_my_account()` RPC + `account_deletion_log` table |
| Settings → Privacidade page | ✅ — export-my-data + delete-my-account |

## Two manual steps you MUST do

### Step 1 — Set KROMI_JWT_SECRET on the edge functions

Without this, login still works but PostgREST never sees a valid JWT, so the S18 RLS lockdown (Step 2) is not safe to apply.

1. Go to **Supabase Dashboard → Project Settings → API → JWT Settings → JWT Secret**
2. Click "Reveal" and copy the secret string
3. Go to **Dashboard → Edge Functions → Manage Secrets** (the left sidebar → "Edge Functions" → tab "Secrets")
4. Click **Add new secret**:
   - Name: `KROMI_JWT_SECRET`
   - Value: paste the JWT Secret from step 2
5. Save. The secret propagates to all edge functions within ~30 seconds — no redeploy needed.

**Smoke test**:
```bash
# From a browser where you're logged in, check authStore.getState().jwt after a refresh.
# Before: null. After: a string starting with "eyJ..."
```
Or trigger a fresh `verify-session` call by refreshing the PWA and checking the Network tab for a non-null `jwt` field in the response.

### Step 2 — Apply the RLS lockdown migration

**ONLY after Step 1 is confirmed working.** The migration file is at:

```
supabase/migrations/20260407_session18_rls_user_data_lockdown.sql
```

Apply it via one of:
- Supabase Dashboard → SQL Editor → paste the file contents → Run
- Or from the repo root: `supabase db push` (if using the CLI)
- Or via Claude: ask "apply the s18 RLS lockdown migration"

The file header has a detailed pre-flight checklist + smoke test queries.

**If something goes wrong** and a real user gets locked out:
```sql
-- Emergency bypass: drop the offending policies and re-create them
-- permissively while you investigate. E.g.:
DROP POLICY "ride_sessions_sel" ON public.ride_sessions;
CREATE POLICY "ride_sessions_sel" ON public.ride_sessions FOR SELECT USING (true);
-- Then figure out what's wrong and re-lock.
```

## Clean-up (optional)

- There's a throwaway probe function at `_probe_env` on the Supabase project — safe to delete via dashboard (used during S18 bring-up to confirm which env vars are auto-injected).
- The `registerDevice(user, jwt)` signature now requires a fresh JWT from the login result. Any custom code that calls it with just `(user)` needs updating.

## Rollback

If Step 2 causes widespread breakage and Step 1 turns out to be mis-configured:
1. **Do NOT revert the migration** — the policies are cheap to replace in-place.
2. Run: `SELECT public.kromi_uid();` in SQL editor with a known good session set. If it returns `null`, JWT isn't reaching PostgREST.
3. Verify `KROMI_JWT_SECRET` in Edge Function Secrets matches the **exact** value from Project Settings → API → JWT Settings (no trailing whitespace).
4. Redeploy the 3 auth edge functions to pick up the new env var (if setting it via dashboard didn't trigger a reload).

## Follow-ups (next session)

- Trash the user's Drive folder during `kromi_delete_my_account` (currently orphans Drive files; acceptable for GDPR but not tidy).
- Lock down `ride_summaries` — currently left permissive because `athlete_id` column semantics are ambiguous (mix of user_id and athlete_profiles.id). Needs a data cleanup migration first.
- Admin polish items from the original S18 prompt (user search, CSV export, bulk role assign, orphan file cleanup, rate limit viewer).
