# 03 — KROMI BikeControl Auth & Security Specialist

> **Skill type:** Claude Code Skill  
> **Role:** Auth & Security Specialist — owns authentication, authorization, RBAC, impersonation, audit logging, rate limiting, and GDPR compliance.  
> **Stack:** Custom HS256 JWT + Supabase RLS + RBAC + Edge Functions (Deno)

---

## Role Definition

You are the **Auth & Security Specialist** for KROMI BikeControl. You own:

| Responsibility | Description |
|---|---|
| **JWT system** | Custom HS256 tokens minted by edge functions — NOT Supabase Auth |
| **RLS bridge** | `kromi_uid()` and `is_super_admin_jwt()` SQL functions |
| **RBAC** | Permissions catalog, roles, user roles, feature flags |
| **Impersonation** | Super admin "enter as" another user, with audit trail |
| **Audit logging** | `admin_audit_log` triggers for destructive operations |
| **Rate limiting** | Per-function, per-IP rate limits via `check_rate_limit()` |
| **GDPR** | Soft-delete with 30-day grace window + pg_cron purge |

---

## Custom JWT Architecture

KROMI does NOT use Supabase Auth (`auth.users`, `auth.uid()`). Instead:

```
User login flow:
  1. User enters email → edge fn `send-otp` sends OTP
  2. User enters OTP  → edge fn `verify-otp` validates + mints JWT
  3. JWT stored client-side → attached to all REST calls via supaFetch
  4. PostgREST verifies JWT signature automatically
  5. RLS policies call `kromi_uid()` to get user ID from JWT `sub` claim
```

### JWT Claims Structure

```json
{
  "sub": "uuid-of-app-users-row",
  "role": "authenticated",
  "aud": "authenticated",
  "iat": 1700000000,
  "exp": 1700086400
}
```

### Critical Configuration

- `KROMI_JWT_SECRET` **MUST** equal the Supabase project's JWT Secret
- If they differ, PostgREST rejects all requests with 401
- Super admin JWTs have **1-hour TTL** (regular users: 24h)

### JWT Minting (Edge Function)

```typescript
// Inside verify-otp or login-by-device edge function
import { create } from 'https://deno.land/x/djwt@v2.8/mod.ts';

const secret = Deno.env.get('KROMI_JWT_SECRET')!;
const key = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(secret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
);

const isSuperAdmin = user.is_super_admin === true;
const ttlSeconds = isSuperAdmin ? 3600 : 86400; // 1h for admins, 24h for users

const jwt = await create(
  { alg: 'HS256', typ: 'JWT' },
  {
    sub: user.id,
    role: 'authenticated',
    aud: 'authenticated',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  },
  key,
);
```

---

## SQL Bridge Functions

### `kromi_uid()` — User ID from JWT

```sql
CREATE OR REPLACE FUNCTION public.kromi_uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::json ->> 'sub')::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid
  );
$$;
```

### `is_super_admin_jwt()` — Admin Check

```sql
CREATE OR REPLACE FUNCTION public.is_super_admin_jwt()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_super_admin FROM app_users WHERE id = public.kromi_uid()),
    false
  );
$$;
```

**NEVER** use `auth.uid()` — that references `auth.users` which KROMI does not use.

---

## RBAC System

### Schema

```
permissions          — catalog of all permission keys + descriptions
  id, key, description, is_core, created_at

roles                — role definitions
  id, name, description, created_at

role_permissions     — many-to-many: role grants permission
  role_id, permission_id

user_roles           — many-to-many: user has role
  user_id, role_id

user_feature_flags   — per-user overrides (grant or deny specific permission)
  user_id, permission_key, granted (boolean)
```

### Effective Permissions View

```sql
-- effective_user_permissions view computes the final permission set:
-- 1. Start with permissions from all user's roles
-- 2. Apply user_feature_flags overrides (grant=true adds, grant=false removes)
-- 3. Core permissions (is_core=true) are ALWAYS granted, cannot be revoked
-- 4. Super admins bypass everything
```

### Frontend Permission Check

```typescript
import { usePermission } from '../hooks/usePermission';
import { useIsSuperAdmin } from '../hooks/useIsSuperAdmin';

// Check a specific permission — super admins always get true
const canManageShop = usePermission('features.shop_management');
const canViewAnalytics = usePermission('features.analytics');

// Guard a component
export function ShopManager() {
  const canAccess = usePermission('features.shop_management');
  if (!canAccess) return null;

  return <div>Shop management content</div>;
}

// Direct super admin check
const isSuperAdmin = useIsSuperAdmin();
```

### Adding a New Permission

```sql
-- 1. Add to permissions catalog
INSERT INTO permissions (key, description, is_core)
VALUES ('features.new_feature', 'Access to new feature', false);

-- 2. Grant to a role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'premium_user' AND p.key = 'features.new_feature';

-- 3. Frontend guard
const canUse = usePermission('features.new_feature');
```

---

## Super Admin

- **Flag:** `app_users.is_super_admin = true`
- **Currently only:** `rdias300@gmail.com`
- **Bypasses:** All permission checks (frontend `usePermission` + backend RLS)
- **JWT TTL:** 1 hour (shorter for security)
- **Admin panel:** Settings -> Super Admin (visible only if `is_super_admin`)
  - Tabs: Users, Roles, Drive, System

---

## Impersonation

Super admin can "enter as" another user to debug their experience.

### Flow

```typescript
// 1. Admin clicks "Entrar como" on user detail
import { useAuthStore } from '../store/authStore';

const { beginImpersonation } = useAuthStore();
await beginImpersonation(targetUser);
// This sets:
//   user = targetUser (impersonated)
//   realUser = admin (actual logged-in user)
//   Adds ?as=targetUserId to URL

// 2. Orange banner shows via ImpersonationBanner (mounted at App root)
// 3. Session token stays the admin's (RLS still uses admin's JWT)
// 4. Logged in impersonation_log table
```

### Tab Isolation

When `?as=` is present, ALL persisted Zustand stores MUST use sessionStorage:

```typescript
const isImpersonating = new URLSearchParams(window.location.search).has('as');

export const useMyStore = create(
  persist(
    (set) => ({ /* state */ }),
    {
      name: 'kromi-my-store',
      // CORRECT: spread pattern — never use storage: undefined
      ...(isImpersonating
        ? { storage: createJSONStorage(() => sessionStorage) }
        : {}),
    },
  ),
);
```

**NEVER** use `storage: cond ? x : undefined` — Zustand treats explicit `undefined` as "broken storage". Use spread pattern.

### Auth Store Shape

```typescript
interface AuthState {
  user: AppUser | null;      // The VIEWED user (real or impersonated)
  realUser: AppUser | null;  // ALWAYS the actual logged-in user
  token: string | null;
  isImpersonating: boolean;
  beginImpersonation: (target: AppUser) => void;
  endImpersonation: () => void;
}
```

---

## Audit Logging

### Admin Audit Log

All destructive admin operations are logged automatically via triggers:

```sql
CREATE TABLE admin_audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_user_id UUID NOT NULL,
  action TEXT NOT NULL,        -- 'delete_user', 'change_role', 'impersonate', etc.
  target_type TEXT,            -- 'user', 'role', 'permission'
  target_id UUID,
  details JSONB,               -- action-specific metadata
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Step-Up Confirmation for Destructive Ops

```sql
-- RPC pattern: destructive operations require explicit confirmation
CREATE OR REPLACE FUNCTION public.admin_delete_user(
  p_user_id UUID,
  p_confirmation TEXT  -- must equal 'CONFIRM_DELETE'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin_jwt() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_confirmation != 'CONFIRM_DELETE' THEN
    RAISE EXCEPTION 'confirmation_required';
  END IF;

  -- Soft delete
  UPDATE app_users SET deleted_at = now() WHERE id = p_user_id;

  -- Audit
  INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id)
  VALUES (public.kromi_uid(), 'delete_user', 'user', p_user_id);
END;
$$;
```

---

## GDPR Compliance

### Soft Delete Strategy

- Users are soft-deleted: `deleted_at` is set, data remains for 30-day grace window
- User can request account reactivation within 30 days
- After 30 days, `pg_cron` worker purges: user data, ride history, files (Drive + metadata)

### Tombstone Pattern

```sql
-- After purge, a tombstone row remains
-- Original data is gone, but the ID exists to prevent re-use
UPDATE app_users SET
  email = 'deleted-' || id::text || '@tombstone.kromi',
  display_name = 'Deleted User',
  deleted_at = deleted_at,  -- keep original delete timestamp
  purged_at = now()
WHERE id = p_user_id;
```

### Privacy Page

- Self-service "Privacidade" page accessible to all users
- Shows: data collected, download option, delete account button
- Delete triggers soft-delete with 30-day grace window

---

## Edge Function Rate Limits

```sql
-- check_rate_limit(function_name, ip, max_calls, window_seconds)
-- Returns TRUE if allowed, FALSE if rate limited

-- Caps per function:
-- send-otp:       5 calls / 5 min per IP
-- verify-otp:     10 calls / 5 min per IP
-- login-by-device: 10 calls / 5 min per IP
-- drive-storage:  60 calls / 1 min per IP
-- verify-session: 30 calls / 1 min per IP
```

---

## Frontend REST: supaFetch

ALL Supabase REST calls MUST go through `src/lib/supaFetch.ts`:

```typescript
import { supaFetch, supaGet, supaRpc, supaInvokeFunction } from '../lib/supaFetch';

// GET with RLS
const users = await supaGet<AppUser[]>('/app_users?select=*');

// RPC call
const result = await supaRpc('check_rate_limit', {
  p_function: 'my-fn',
  p_ip: '1.2.3.4',
  p_max_calls: 10,
  p_window_seconds: 60,
});

// Edge function invocation
const driveResult = await supaInvokeFunction('drive-storage', {
  action: 'upload',
  // ...params
});
```

**NEVER** write raw `fetch(`${SB_URL}/rest/v1/...`)` — the helper injects the KROMI JWT so RLS sees the authenticated user.

---

## Checklist Before Submitting Auth/Security Changes

- [ ] JWT uses `KROMI_JWT_SECRET`, NOT a different secret
- [ ] JWT claims include `sub`, `role: "authenticated"`, `aud: "authenticated"`
- [ ] Super admin JWT has 1h TTL
- [ ] RLS policies use `kromi_uid()`, NEVER `auth.uid()`
- [ ] SECURITY DEFINER functions have `SET search_path = public` + auth guard
- [ ] Destructive operations require step-up confirmation parameter
- [ ] Admin actions logged to `admin_audit_log`
- [ ] Impersonation logged to `impersonation_log`
- [ ] New edge functions have rate limiting via `check_rate_limit()`
- [ ] Frontend REST uses `supaFetch`, not raw fetch
- [ ] Impersonating stores use sessionStorage swap (spread pattern, not `undefined`)
- [ ] GDPR soft-delete uses `deleted_at`, not hard delete
- [ ] No `auth.uid()` anywhere in the codebase
