-- ════════════════════════════════════════════════════════════
-- Session 20, Bug #3 — block customers from forging status.
--
-- Problem: service_requests_upd policy allows either the bike
-- owner or a shop member to UPDATE the row, but doesn't
-- discriminate on *which columns* are changed. A customer
-- (bike owner) can PATCH status directly to 'completed' to
-- skip payment, or to 'cancelled' to repudiate work already
-- done. RLS alone can't do field-level authorization — we
-- need a BEFORE UPDATE trigger.
--
-- Allowed transitions for the customer (bike owner who is
-- NOT also a shop member of the target shop):
--   → draft, requested, cancelled
-- Everything else (accepted, in_progress, pending_approval,
-- completed, closed, rejected) is shop-owner only.
--
-- Shop members keep full freedom — the trigger only gates the
-- bike-owner-without-member case.
--
-- is_shop_member() is SECURITY DEFINER so it works even when
-- this trigger runs as the invoker.
--
-- Caught by tests/shop-e2e.mjs Phase X (security probes).
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.guard_service_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_owner bool;
  v_is_member bool;
BEGIN
  -- No-op if the status didn't actually change.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Super admin can do anything.
  IF public.is_super_admin_jwt() THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.bike_configs b
    WHERE b.id = NEW.bike_id
      AND b.user_id = public.kromi_uid()
  ) INTO v_is_owner;

  SELECT public.is_shop_member(NEW.shop_id) INTO v_is_member;

  -- Customer-only path: bike owner, not a member of the target shop.
  -- Restricted to the states they can legitimately self-trigger.
  IF v_is_owner AND NOT v_is_member THEN
    IF NEW.status NOT IN ('draft', 'requested', 'cancelled') THEN
      RAISE EXCEPTION
        'Customer cannot transition service status to %: only draft/requested/cancelled are allowed from the rider side.',
        NEW.status
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_status_guard ON public.service_requests;
CREATE TRIGGER trg_service_status_guard
  BEFORE UPDATE OF status ON public.service_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_service_status_transition();
