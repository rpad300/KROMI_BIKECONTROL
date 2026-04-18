# /db — Supabase Database Operations

Interactive database helper for KROMI BikeControl (project: ctsuupvmmyjlrtjnxagv).

## Usage
- `/db tables` — list all tables with row counts
- `/db migrate <description>` — create and apply a new migration
- `/db rls <table>` — show RLS policies for a table
- `/db sql <query>` — execute a SQL query (read-only unless explicitly confirmed)
- `/db logs` — show recent Supabase logs
- `/db edge <name>` — show edge function details

## Rules
- Always use `kromi_uid()` in RLS policies, NEVER `auth.uid()`
- New tables MUST have RLS enabled + deny-all default
- Follow the RLS pattern from CLAUDE.md for new policies
- Test RLS with: `SET role authenticated; SET request.jwt.claims TO '{"sub":"...","role":"authenticated"}';`
- Use `mcp__claude_ai_Supabase__execute_sql` for queries
- Use `mcp__claude_ai_Supabase__apply_migration` for schema changes
