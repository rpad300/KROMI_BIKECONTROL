-- Read-only helper so tools/db-drift.mjs can enumerate applied
-- migrations via the normal REST path (no direct table access needed).
CREATE OR REPLACE FUNCTION public.db_migration_versions()
RETURNS TABLE(version text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, supabase_migrations
AS $$
  SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
$$;

REVOKE ALL ON FUNCTION public.db_migration_versions() FROM public;
GRANT EXECUTE ON FUNCTION public.db_migration_versions() TO anon, authenticated, service_role;
