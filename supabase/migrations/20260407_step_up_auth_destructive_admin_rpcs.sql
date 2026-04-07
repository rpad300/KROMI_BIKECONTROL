-- Step-up confirmation for the most destructive admin RPCs.
-- Each now requires a confirmation string (target email / role key)
-- that the caller must type — last chance to catch "wrong user".

DROP FUNCTION IF EXISTS public.admin_set_super_admin(text, uuid, boolean);

CREATE OR REPLACE FUNCTION public.admin_set_super_admin(
  p_session_token text,
  p_target_user_id uuid,
  p_is_super boolean,
  p_confirmation_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_email text;
BEGIN
  PERFORM public.assert_super_admin(p_session_token);

  IF p_confirmation_email IS NULL OR length(trim(p_confirmation_email)) = 0 THEN
    RAISE EXCEPTION 'confirmation_email required' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_target_email FROM public.app_users WHERE id = p_target_user_id;
  IF v_target_email IS NULL THEN
    RAISE EXCEPTION 'target user not found' USING ERRCODE = '22023';
  END IF;

  IF lower(trim(p_confirmation_email)) <> lower(trim(v_target_email)) THEN
    RAISE EXCEPTION 'confirmation email mismatch' USING ERRCODE = '22023';
  END IF;

  UPDATE public.app_users SET is_super_admin = p_is_super WHERE id = p_target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_super_admin(text, uuid, boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_set_super_admin(text, uuid, boolean, text)
  TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_delete_role(text, uuid);
DROP FUNCTION IF EXISTS public.admin_delete_role(text, uuid, text);

CREATE OR REPLACE FUNCTION public.admin_delete_role(
  p_session_token text,
  p_role_id uuid,
  p_confirmation_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_system boolean;
  v_role_key text;
BEGIN
  PERFORM public.assert_super_admin(p_session_token);

  SELECT is_system, key INTO v_is_system, v_role_key
    FROM public.roles WHERE id = p_role_id;

  IF v_role_key IS NULL THEN
    RAISE EXCEPTION 'role not found' USING ERRCODE = '22023';
  END IF;

  IF v_is_system THEN
    RAISE EXCEPTION 'cannot delete system role' USING ERRCODE = '42501';
  END IF;

  IF p_confirmation_name IS NULL OR length(trim(p_confirmation_name)) = 0 THEN
    RAISE EXCEPTION 'confirmation_name required' USING ERRCODE = '22023';
  END IF;

  IF lower(trim(p_confirmation_name)) <> lower(trim(v_role_key)) THEN
    RAISE EXCEPTION 'confirmation name mismatch' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.role_permissions WHERE role_id = p_role_id;
  DELETE FROM public.user_roles WHERE role_id = p_role_id;
  DELETE FROM public.roles WHERE id = p_role_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_role(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_delete_role(text, uuid, text)
  TO anon, authenticated, service_role;
