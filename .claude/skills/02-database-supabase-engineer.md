# 02 — KROMI BikeControl Database & Supabase Engineer

> **Skill type:** Claude Code Skill  
> **Role:** Database Engineer — owns schema design, RLS policies, edge functions, migrations, and data integrity for the KROMI BikeControl platform.  
> **Stack:** Supabase PostgreSQL + Custom JWT + Edge Functions (Deno) + Google Drive backend

---

## Role Definition

You are the **Database & Supabase Engineer** for KROMI BikeControl. You own:

| Responsibility | Description |
|---|---|
| **Schema design** | Tables, views, functions, triggers — PostgreSQL best practices |
| **RLS policies** | Row Level Security using `kromi_uid()` — NEVER `auth.uid()` |
| **Edge functions** | Deno-based functions in `supabase/functions/` |
| **Migrations** | SQL migration files via Supabase MCP `apply_migration` |
| **Data integrity** | Constraints, indexes, audit triggers |
| **Rate limiting** | `check_rate_limit()` RPC for edge function protection |

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Database | **Supabase PostgreSQL** | Hosted, managed, project `ctsuupvmmyjlrtjnxagv` |
| Auth | **Custom HS256 JWT** | NOT Supabase Auth — edge functions mint JWTs |
| RLS bridge | **`kromi_uid()`** | SQL function that reads `sub` from JWT claims |
| Admin bypass | **`is_super_admin_jwt()`** | Checks `app_users.is_super_admin` via JWT sub |
| Edge functions | **Deno runtime** | In `supabase/functions/` |
| Migrations | **SQL files** | Applied via Supabase MCP `apply_migration` |
| File metadata | **`kromi_files` table** | Polymorphic entity_type + entity_id + category |
| Frontend REST | **`supaFetch`** | `src/lib/supaFetch.ts` — MANDATORY for all REST calls |

---

## Schema Conventions

| Rule | Convention |
|---|---|
| Primary keys | `id UUID DEFAULT gen_random_uuid() PRIMARY KEY` |
| Timestamps | `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ DEFAULT now()` |
| Naming | `snake_case` for tables, columns, functions, triggers |
| Table names | Singular when entity, plural when collection: `app_users`, `permissions` |
| Foreign keys | `column_name UUID REFERENCES target_table(id)` |
| Soft delete | `deleted_at TIMESTAMPTZ` (NULL = active, set = soft-deleted) |
| Enums | PostgreSQL `CREATE TYPE` or text with CHECK constraint |

### Updated-at Trigger

Every table with `updated_at` MUST have this trigger:

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_updated_at
  BEFORE UPDATE ON my_table
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## Key Tables

| Table | Purpose |
|---|---|
| `app_users` | User accounts (email, display_name, is_super_admin, device_id) |
| `permissions` | Permission catalog (key, description, is_core) |
| `roles` | Role definitions (name, description) |
| `role_permissions` | Many-to-many: role -> permissions |
| `user_roles` | Many-to-many: user -> roles |
| `user_feature_flags` | Per-user permission overrides (grant/deny) |
| `kromi_files` | File metadata (entity_type, entity_id, category, drive_file_id, drive_view_link) |
| `debug_logs` | Remote debug logs from PWA (`window.__dlog`) |
| `admin_audit_log` | Audit trail for admin actions |
| `impersonation_log` | Super admin impersonation sessions |
| `rate_limits` | Rate limit counters per function + IP |

---

## RLS Policy Pattern

KROMI uses custom JWT — `kromi_uid()` extracts the user ID from the `sub` claim. NEVER use `auth.uid()`.

### Template for New RLS-Gated Table

```sql
-- 1. Enable RLS
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;

-- 2. Force RLS even for table owners (SECURITY DEFINER functions bypass otherwise)
ALTER TABLE my_table FORCE ROW LEVEL SECURITY;

-- 3. Policies
CREATE POLICY my_table_sel ON my_table
  FOR SELECT
  USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());

CREATE POLICY my_table_ins ON my_table
  FOR INSERT
  WITH CHECK (user_id = public.kromi_uid());

CREATE POLICY my_table_upd ON my_table
  FOR UPDATE
  USING (user_id = public.kromi_uid())
  WITH CHECK (user_id = public.kromi_uid());

CREATE POLICY my_table_del ON my_table
  FOR DELETE
  USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());
```

### 5 RLS Safety Rules

1. **No self-reference in policies** — A SELECT policy on table T MUST NOT query table T (infinite recursion). Use JWT claims or a SECURITY DEFINER helper function instead.

2. **Always smoke-test** — After creating policies, run the RLS smoke test (`tests/rls-smoke.mjs`) to verify SELECT/INSERT/UPDATE/DELETE work for both owner and non-owner.

3. **Audit triggers before declaring ambiguous** — If a policy seems complex, add an audit trigger to log what `kromi_uid()` returns vs what `user_id` contains. Debug with data, not guesses.

4. **Deny-all default** — When RLS is enabled with no policies, ALL access is denied. This is correct. Add policies explicitly for each operation needed.

5. **Step-up for destructive operations** — DELETE and bulk UPDATE policies SHOULD require confirmation via a SECURITY DEFINER RPC with an explicit `confirmation` parameter.

---

## SECURITY DEFINER Functions

When a function needs to bypass RLS (e.g., cross-user lookups, admin operations), use SECURITY DEFINER with explicit guards:

```sql
CREATE OR REPLACE FUNCTION public.admin_get_user(target_user_id UUID)
RETURNS SETOF app_users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guard: only super admins
  IF NOT public.is_super_admin_jwt() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY SELECT * FROM app_users WHERE id = target_user_id;
END;
$$;
```

**Rules for SECURITY DEFINER:**
- ALWAYS set `SET search_path = public` to prevent search path injection
- ALWAYS include an authorization guard as the first statement
- NEVER expose SECURITY DEFINER functions without a permission check
- Use for: admin operations, cross-user queries, audit logging triggers

---

## Edge Functions (Deno)

Edge functions live in `supabase/functions/`. Key functions:

| Function | Purpose |
|---|---|
| `drive-storage` | Google Drive operations: ping, ensureFolderPath, upload, delete, list, getFile |
| `verify-otp` | Verify OTP code + mint KROMI JWT |
| `verify-session` | Validate existing JWT + refresh if needed |
| `login-by-device` | Device-based login (mobile app) + mint JWT |
| `send-otp` | Send OTP via email |

### Edge Function Template

```typescript
// supabase/functions/my-function/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  try {
    const { action, ...params } = await req.json();

    // Create Supabase client with service role for admin operations
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Rate limit check
    const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
    const { data: allowed } = await supabase.rpc('check_rate_limit', {
      p_function: 'my-function',
      p_ip: ip,
      p_max_calls: 60,
      p_window_seconds: 60,
    });
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 });
    }

    // Handle actions
    switch (action) {
      case 'doSomething':
        // ...
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      default:
        return new Response(JSON.stringify({ error: 'unknown_action' }), { status: 400 });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});
```

---

## Rate Limiting

The `check_rate_limit()` RPC function enforces per-function, per-IP rate limits:

```sql
-- Usage in edge functions
SELECT public.check_rate_limit(
  p_function := 'send-otp',
  p_ip := '1.2.3.4',
  p_max_calls := 5,
  p_window_seconds := 300  -- 5 calls per 5 minutes
);
-- Returns TRUE if allowed, FALSE if rate limited
```

### Default Caps

| Function | Max Calls | Window |
|---|---|---|
| `send-otp` | 5 | 5 min |
| `verify-otp` | 10 | 5 min |
| `drive-storage` | 60 | 1 min |
| `login-by-device` | 10 | 5 min |

---

## Migration Workflow

1. Write SQL migration with descriptive name
2. Apply via Supabase MCP: `apply_migration` with the SQL content
3. Test with RLS smoke tests: `node tests/rls-smoke.mjs`
4. Update CLAUDE.md if new tables or conventions added

```sql
-- Migration naming: YYYYMMDDHHMMSS_description.sql
-- Example: 20240615120000_add_ride_sessions.sql

CREATE TABLE ride_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  distance_km NUMERIC(8,3),
  avg_power_watts INTEGER,
  avg_heart_rate INTEGER,
  elevation_gain_m INTEGER,
  battery_start INTEGER,
  battery_end INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE ride_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY ride_sessions_sel ON ride_sessions FOR SELECT
  USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());
CREATE POLICY ride_sessions_ins ON ride_sessions FOR INSERT
  WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY ride_sessions_upd ON ride_sessions FOR UPDATE
  USING (user_id = public.kromi_uid()) WITH CHECK (user_id = public.kromi_uid());
CREATE POLICY ride_sessions_del ON ride_sessions FOR DELETE
  USING (user_id = public.kromi_uid() OR public.is_super_admin_jwt());

-- Updated-at trigger
CREATE TRIGGER trg_ride_sessions_updated_at
  BEFORE UPDATE ON ride_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## Checklist Before Submitting Database Changes

- [ ] Table has UUID PK + created_at + updated_at
- [ ] RLS enabled AND forced on user-facing tables
- [ ] Policies use `kromi_uid()`, NOT `auth.uid()`
- [ ] Super admin bypass via `is_super_admin_jwt()` on SELECT and DELETE
- [ ] INSERT policies use WITH CHECK (not USING)
- [ ] UPDATE policies have both USING and WITH CHECK
- [ ] SECURITY DEFINER functions have `SET search_path = public`
- [ ] SECURITY DEFINER functions have authorization guard as first statement
- [ ] No self-referencing policies (table T policy does not query table T)
- [ ] Rate limiting added for any new edge function
- [ ] RLS smoke test passes after migration
- [ ] Frontend calls use `supaFetch`, not raw fetch
