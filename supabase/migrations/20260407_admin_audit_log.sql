-- Forensic audit log for administrative writes.
--
-- Complement to impersonation_log: captures every INSERT/UPDATE/DELETE
-- on the sensitive admin tables so if a super admin (or a bug) mutates
-- something it shouldn't, there's a trail.
--
-- Schema is intentionally polymorphic (table_name + row_id + before/after
-- jsonb) rather than one audit table per source table.

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  action      text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  table_name  text NOT NULL,
  row_id      uuid,
  row_before  jsonb,
  row_after   jsonb
);

CREATE INDEX IF NOT EXISTS admin_audit_log_occurred_at_idx ON public.admin_audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx      ON public.admin_audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_table_idx      ON public.admin_audit_log (table_name, occurred_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_audit_log_sel ON public.admin_audit_log;
CREATE POLICY admin_audit_log_sel ON public.admin_audit_log FOR SELECT USING (
  public.is_super_admin_jwt()
);

DROP POLICY IF EXISTS admin_audit_log_ins ON public.admin_audit_log;
CREATE POLICY admin_audit_log_ins ON public.admin_audit_log FOR INSERT
  WITH CHECK (public.is_super_admin_jwt());

DROP POLICY IF EXISTS admin_audit_log_no_upd ON public.admin_audit_log;
CREATE POLICY admin_audit_log_no_upd ON public.admin_audit_log AS RESTRICTIVE FOR UPDATE USING (false);

DROP POLICY IF EXISTS admin_audit_log_no_del ON public.admin_audit_log;
CREATE POLICY admin_audit_log_no_del ON public.admin_audit_log AS RESTRICTIVE FOR DELETE USING (false);

CREATE OR REPLACE FUNCTION public.admin_audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.kromi_uid();
  v_row_id uuid;
  v_before jsonb := NULL;
  v_after jsonb := NULL;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_after := to_jsonb(NEW);
    v_row_id := (NEW).id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    v_row_id := (NEW).id;
  ELSIF TG_OP = 'DELETE' THEN
    v_before := to_jsonb(OLD);
    v_row_id := (OLD).id;
  END IF;

  INSERT INTO public.admin_audit_log (actor_user_id, action, table_name, row_id, row_before, row_after)
  VALUES (v_actor, TG_OP, TG_TABLE_NAME, v_row_id, v_before, v_after);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_audit_app_users ON public.app_users;
CREATE TRIGGER trg_admin_audit_app_users
  AFTER INSERT OR UPDATE OR DELETE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.admin_audit_trigger();

DROP TRIGGER IF EXISTS trg_admin_audit_roles ON public.roles;
CREATE TRIGGER trg_admin_audit_roles
  AFTER INSERT OR UPDATE OR DELETE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.admin_audit_trigger();

DROP TRIGGER IF EXISTS trg_admin_audit_role_permissions ON public.role_permissions;
CREATE TRIGGER trg_admin_audit_role_permissions
  AFTER INSERT OR UPDATE OR DELETE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.admin_audit_trigger();

DROP TRIGGER IF EXISTS trg_admin_audit_user_roles ON public.user_roles;
CREATE TRIGGER trg_admin_audit_user_roles
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.admin_audit_trigger();

DROP TRIGGER IF EXISTS trg_admin_audit_user_feature_flags ON public.user_feature_flags;
CREATE TRIGGER trg_admin_audit_user_feature_flags
  AFTER INSERT OR UPDATE OR DELETE ON public.user_feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.admin_audit_trigger();
