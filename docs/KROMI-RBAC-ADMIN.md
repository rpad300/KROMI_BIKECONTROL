# KROMI Super Admin + RBAC

> **Status:** Production (Session 18, 2026-04-07)
> **Super admin:** `rdias300@gmail.com`
> **Frontend:** `src/components/Admin/`, `src/hooks/usePermission.ts`, `src/store/permissionStore.ts`
> **Backend:** Supabase tables + view + 9 SECURITY DEFINER admin RPCs, edge function `drive-storage` (admin actions)

---

## TL;DR

KROMI now has a complete role-based access control system and a Super Admin panel:
- **Super admin flag** on `app_users.is_super_admin` — bypasses ALL permission checks
- **18 permissions** across 3 categories (core / features / admin)
- **5 system roles** (free, premium, mechanic, coach, super_admin)
- **Per-user feature flags** for allow/deny overrides on top of role grants
- **Admin panel** (Settings → Super Admin) with 4 tabs: Users, Roles, Drive, System
- **Impersonation** ("Entrar como") with persistent banner and audit log
- **Drive folder status** per user with one-click force-bootstrap

---

## Database

```
app_users
  + is_super_admin   boolean       (master toggle, bypasses RBAC)
  + suspended_at     timestamptz
  + suspended_reason text

permissions          (catalog of toggleable features)
  key text PK
  category text     (core | features | admin)
  label, description text
  is_core boolean   (always granted, cannot be revoked)

roles
  id uuid PK
  key, label, description
  is_system boolean (cannot be deleted)

role_permissions    (M:N)
  role_id, permission_key

user_roles          (M:N — a user can have multiple roles)
  user_id, role_id, granted_by, granted_at

user_feature_flags  (per-user override on top of role grants)
  user_id, permission_key, mode ('allow' | 'deny'), reason, set_by

impersonation_log   (audit trail)
  admin_user_id, impersonated_user_id, started_at, ended_at, reason

VIEW effective_user_permissions
  user_id, permission_key
  = role_grants ∪ allow_overrides − deny_overrides ∪ always_core
```

---

## Permissions catalog (18)

### Core (always on, 5)
- `core.dashboard` — Dashboard
- `core.ble_devices` — BLE / sensors
- `core.bike_profile` — Edit basic bike data
- `core.ride_recording` — Start/stop rides
- `core.settings_basic` — Personal/physical/medical profile

### Features (9)
- `features.service_book` — Caderneta de Serviço
- `features.shop_management` — Gestão de Oficina (mechanic dashboard)
- `features.clubs` — Clubes + group rides
- `features.bike_fit` — Bike Fit completo (25+ measurements)
- `features.intelligence_v2` — KROMI Intelligence advanced
- `features.emergency_qr` — Emergency QR + rescue
- `features.ride_analysis_pro` — Stats avançados, segments, KOMs
- `features.nutrition_tracking` — Carbs, hydration, fuel windows
- `features.desktop_app` — Desktop version access

### Admin (4)
- `admin.panel` — Access the admin panel
- `admin.user_management` — List/edit/suspend users
- `admin.impersonation` — Enter user view
- `admin.role_management` — Create/edit roles

---

## Roles seeded

| Role | Grants |
|---|---|
| `free` | core only |
| `premium` | core + intelligence + ride_analysis + nutrition + bike_fit + emergency + desktop |
| `mechanic` | core + service_book + shop_management + bike_fit |
| `coach` | premium grants + clubs |
| `super_admin` | ALL permissions |

Every existing user is auto-assigned `free` on migration. Super admins also get `super_admin`.

---

## Frontend integration

### Hooks

```typescript
import { usePermission, useIsSuperAdmin, usePermissions } from '../hooks/usePermission';

function ServiceBookButton() {
  const canSee = usePermission('features.service_book');
  if (!canSee) return null;
  return <button>Caderneta</button>;
}

function AdminBadge() {
  const isAdmin = useIsSuperAdmin();
  return isAdmin ? <Badge>SUPER ADMIN</Badge> : null;
}

function NavMenu() {
  const perms = usePermissions(['features.clubs', 'features.bike_fit', 'features.shop_management']);
  // perms.['features.clubs'] === true | false
}
```

Super admins always return `true` (short-circuit, no fetch needed).

### Stores

- `useAuthStore` — split into `realUser` (always the logged-in admin), `impersonatedUser` (target during impersonation), `user` (the "viewer" — what the rest of the app reads).
- `usePermissionStore` — caches effective permissions per viewer. Auto-loaded by `usePermission` on first call.

### Auth flow

1. User logs in (OTP or device token) → `realUser` is set, `user = realUser`
2. Super admin opens user detail → clicks "Entrar como" → `beginImpersonation(target)`
3. Store: `impersonatedUser = target`, `user = target` (viewer switched), log start in `impersonation_log`
4. ImpersonationBanner appears at top of app
5. Click "Sair" → `endImpersonation()` → log end, restore `user = realUser`

The session token never changes — it remains the admin's. We never generate a token for the impersonated user (security).

---

## Admin Panel structure

`Settings → Super Admin → Painel Admin` (mobile)
`Sidebar → Super Admin → Painel Admin` (desktop)

Both routes mount `<AdminPanel />` from `src/components/Admin/AdminPanel.tsx`. This is gated by `useIsSuperAdmin()`; non-admins see "Acesso negado".

### Tab 1: Utilizadores (`AdminUsersPage`)
- Search box (filters by email or name)
- Each row shows: name + email, badges (SUPER ADMIN / SUSPENSO), Drive folder status (✓ Drive OK / ✗ N missing), inline "Forçar criar" button if missing
- Click row → `AdminUserDetail`
- "Recarregar" button forces refetch

### Tab 2: Roles + Permissões (`AdminRolesPage`)
- Lists all roles (with SYSTEM badge for non-deletable ones)
- Shows count of granted perms per role
- Click to expand → permission matrix grouped by category
- Toggle individual perms (core perms locked at "checked")
- Saves immediately on toggle

### Tab 3: Google Drive (`DriveStoragePage`)
- Re-uses the existing diagnostic page
- Status: connected / offline
- Acting-as user (who the OAuth refresh token belongs to)
- Storage quota with progress bar
- "Inicializar estrutura" button — creates `users/` and `shops/` top-level folders

### Tab 4: Sistema
- Static info page with TODO list

### `AdminUserDetail`
Per-user management. Sections:
1. **Perfil** — name, email, ID, slug (`users/{slug}/`), created/last login dates
2. **Acções**
   - Entrar como este utilizador (impersonate)
   - Forçar criar pastas Drive
   - Tornar/Remover Super Admin
3. **Estado da conta** — suspend with reason, or unsuspend
4. **Roles atribuídos** — checkboxes for each role
5. **Overrides de funcionalidades** — per-permission Allow / Deny / Clear (only non-core perms)

---

## Edge function actions (drive-storage v13)

| Action | Auth | Use |
|---|---|---|
| `ping` | none | Health check |
| `ensureFolderPath` | session | Generic folder create |
| `upload` | session | Multipart upload |
| `delete` | session | Trash file |
| `list` | session | List folder contents |
| `getFile` | session | Single file metadata |
| `checkUserFolders` | session | **Admin:** batch check `users/{slug}/{6 subs}` existence |
| `bootstrapUser` | session | **Admin:** create the 6 sub-folders for `users/{slug}/` |

CORS headers include `apikey` (was missing in v12, fixed in v13).

---

## Adding a new permission

1. Insert into `permissions` table:
   ```sql
   INSERT INTO public.permissions (key, category, label, description, is_core)
   VALUES ('features.my_new_thing', 'features', 'Minha Nova Feature', 'Descrição', false);
   ```
2. Grant to roles that should have it:
   ```sql
   INSERT INTO public.role_permissions (role_id, permission_key)
   SELECT id, 'features.my_new_thing' FROM public.roles WHERE key IN ('premium','coach');
   ```
3. Use in code:
   ```typescript
   const can = usePermission('features.my_new_thing');
   ```

The cache in `permissionStore` auto-refreshes on next session. Force refresh via `usePermissionStore.getState().refresh()`.

---

## Adding a new super admin

```sql
UPDATE public.app_users SET is_super_admin = true WHERE email = 'someone@example.com';

INSERT INTO public.user_roles (user_id, role_id)
SELECT u.id, r.id FROM public.app_users u, public.roles r
WHERE u.email = 'someone@example.com' AND r.key = 'super_admin'
ON CONFLICT DO NOTHING;
```

---

## Security notes

1. **Impersonation is currently honor-system read/write.** The store has `impersonationReadOnly: true` but no enforcement yet. Next session: add `useReadOnlyGuard()` hook that throws on mutations during impersonation.
2. **Session token stays admin's during impersonation** — we never give the impersonator the target's token.
3. **All admin actions are logged** in `impersonation_log` (start + end timestamps + reason).
4. **The OAuth client_secret was exposed in chat during Session 16.** Should be rotated via GCP Console → Reset Secret, then update Supabase Edge Function secret `GOOGLE_OAUTH_CLIENT_SECRET`.
5. **Custom OTP auth means Supabase RLS is permissive.** All RBAC enforcement happens at the application layer (hooks + stores). Don't trust DB-level filtering for security.

---

## RLS architecture (Session 18)

Up to Session 17 the user-data tables had `qual = true` policies — RLS was on but cosmetic. Session 18 swapped opaque tokens for a real HS256 JWT (see `docs/KROMI-RBAC-ADMIN.md` references to `KROMI_JWT_SECRET` and `memory/reference_jwt_auth.md`) so PostgREST sees a verified `sub` claim per request, then rebuilt every policy on top of two helpers:

- `public.kromi_uid() → uuid` — reads `request.jwt.claims.sub`. Use this in policies, NOT `auth.uid()` (KROMI doesn't use Supabase Auth).
- `public.is_super_admin_jwt() → boolean` — SECURITY DEFINER. Joins the JWT subject against `app_users.is_super_admin`. Used as the bypass clause in every owner-restricted SELECT/DELETE policy.

The lockdown migration is at `supabase/migrations/20260407_session18_rls_user_data_lockdown.sql`. It drops every existing policy on 37+ user-data tables, re-enables RLS, and rebuilds ~132 policies following the standard owner template:

```sql
CREATE POLICY t_sel ON t FOR SELECT USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());
CREATE POLICY t_ins ON t FOR INSERT WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY t_upd ON t FOR UPDATE USING (user_id = public.kromi_uid()) WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY t_del ON t FOR DELETE USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());
```

Child tables that don't carry a direct `user_id` (e.g. `service_items`, `ride_snapshots`) join through their parent via `EXISTS` subqueries. The `can_access_service(uuid)` helper centralises the service_* tree.

**Tables NOT covered by this migration:**
- `app_users`, `roles`, `role_permissions`, `user_roles`, `user_feature_flags`, `impersonation_log`, `user_suspensions` — locked down in Session 17 with restrictive policies that block ALL direct writes; admin mutations go through the SECURITY DEFINER RPCs below.
- `ride_summaries` — left permissive while the ambiguous `athlete_id` column (mix of `user_id` and `athlete_profiles.id`) is normalised in a follow-up migration.

---

## List of admin RPCs

All 9 admin write paths route through SECURITY DEFINER RPCs that take the caller's session token, resolve the actor via `resolve_session_user_id(p_session_token)`, and verify `is_super_admin = true` before mutating. Direct PostgREST writes to the underlying tables are blocked by restrictive RLS policies. Source: `src/services/rbac/RBACService.ts`.

| RPC | Signature | Effect |
|---|---|---|
| `admin_set_super_admin` | `(p_session_token text, p_target_user_id uuid, p_is_super boolean)` | Toggle the master super-admin flag on a user. |
| `admin_set_suspended` | `(p_session_token text, p_target_user_id uuid, p_suspend boolean, p_reason text)` | Suspend / unsuspend; updates `app_users` AND inserts a row into `user_suspensions` for the audit history. |
| `admin_set_user_roles` | `(p_session_token text, p_target_user_id uuid, p_role_ids uuid[])` | Replace the user's `user_roles` set in one transaction. |
| `admin_create_role` | `(p_session_token text, p_key text, p_label text, p_description text, p_sort_order int)` | Create a non-system role. Returns the new role id. |
| `admin_update_role` | `(p_session_token text, p_role_id uuid, p_label text, p_description text, p_sort_order int)` | Edit label / description / sort order. Blocks system roles. |
| `admin_delete_role` | `(p_session_token text, p_role_id uuid)` | Delete a custom role + cascade `role_permissions` + `user_roles`. Blocks system roles. |
| `admin_set_role_permissions` | `(p_session_token text, p_role_id uuid, p_permission_keys text[])` | Replace the role's permission set. Core perms cannot be revoked. |
| `admin_set_user_feature_flag` | `(p_session_token text, p_target_user_id uuid, p_permission_key text, p_mode text, p_reason text)` | Set an `allow` / `deny` override for one user + permission. |
| `admin_clear_user_feature_flag` | `(p_session_token text, p_target_user_id uuid, p_permission_key text)` | Remove the override row entirely (back to role-derived default). |

`resolve_session_user_id` accepts both hashed opaque session tokens (`user_sessions.token_hash`) and the `device:{device_token_id}` shorthand used by auto-login.

---

## Rate limiting

Edge functions enforce per-IP limits via the `public.check_rate_limit()` RPC, which logs each call into `edge_function_rate_limits` and counts entries within a sliding window.

```sql
check_rate_limit(p_function text, p_identifier text, p_window_secs int, p_max int)
  RETURNS jsonb  -- { allowed: bool, current: int }
```

Current caps:

| Edge function | Identifier | Window | Max |
|---|---|---|---|
| `drive-storage` | client IP | 60 s | 120 |
| `notify-impersonation` | client IP | 60 s | 10 |

The helper is **fail-open** — if the RPC errors (network, wrong service role) the request is allowed through rather than blocked. Recent 429s can be inspected directly in `edge_function_rate_limits` (filter by `function_name`).

See also: `memory/reference_edge_rate_limits.md`.

---

## GDPR RPC

Self-service account deletion lives at Settings → Privacidade. The RPC is:

```sql
kromi_delete_my_account(p_session_token text, p_confirmation_email text)
  RETURNS jsonb  -- { deleted: true, deletion_id: uuid }
```

It resolves the session token, verifies the confirmation email matches `app_users.email`, inserts a row into `account_deletion_log` FIRST so partial failures still leave a trail, then hard-deletes across 15+ tables. The `app_users` row itself is **tombstoned** rather than deleted: `email → deleted-<uuid>@deleted.local`, `name → null`, `deleted_at` set, suspended flag set. This keeps FKs from `login_history`, `impersonation_log`, `clubs.created_by` etc. intact for audit. Drive binaries are not yet GC'd — only the `kromi_files` metadata rows are dropped.

Companion frontend: `src/services/gdpr/GdprService.ts` (`exportMyData`, `deleteMyAccount`). Both are disabled while `useAuthStore.getState().isImpersonating()` returns true.

See also: `memory/reference_gdpr.md`.

---

## Pre-flight checklist before applying the RLS lockdown

Mirrors `SESSION_18_SETUP.md`. **Do NOT apply `20260407_session18_rls_user_data_lockdown.sql` until every box is checked**, otherwise every legitimate user will be locked out:

- [ ] `KROMI_JWT_SECRET` set in Supabase Dashboard → Edge Functions → Secrets to the **exact** value of Project Settings → API → JWT Settings → JWT Secret
- [ ] `verify-otp` v14+ deployed (mints JWT)
- [ ] `verify-session` v14+ deployed (mints + refreshes JWT)
- [ ] `login-by-device` v1+ deployed
- [ ] Production frontend ships the Session 18 build (`authStore` persists `jwt`, `src/lib/supaFetch.ts` exists, services migrated)
- [ ] Smoke test in SQL editor:
  ```sql
  SET LOCAL request.jwt.claims TO '{"sub":"<your-admin-uuid>","role":"authenticated"}';
  SELECT public.kromi_uid();          -- returns your uuid
  SELECT public.is_super_admin_jwt(); -- returns true
  ```
- [ ] Browser smoke test: refresh the PWA, check `useAuthStore.getState().jwt` is a non-null `eyJ...` string
- [ ] Rollback plan understood: drop and recreate the offending policy permissively, investigate, re-lock

---

## Pending features (next session)

- **Apply RBAC to existing features** — wrap Settings menu items with `usePermission` so users without `features.bike_fit` don't see Bike Fit, etc.
- **Read-only guard during impersonation** — `useReadOnlyGuard` hook + global write blockers
- **Impersonation log viewer** — show who-impersonated-whom-and-when in admin panel
- **User detail enrichments** — bikes count, rides count, last activity, storage usage (sum of size_bytes from kromi_files)
- **Migrate legacy Supabase Storage photos** — one-time script to download → re-upload via KromiFileStore
- **Refactor remaining file uploaders** — BikesPage, BikeFitPage, ShopManagementPage to use KromiFileStore
- **Single navigation source of truth** — collapse MENU_CATEGORIES + DESKTOP_NAV
