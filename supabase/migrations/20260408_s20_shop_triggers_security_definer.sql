-- ════════════════════════════════════════════════════════════
-- Session 20, Bug #2 — fix silent RLS filtering of trigger updates.
--
-- Problem: update_shop_rating() is LANGUAGE plpgsql without
-- SECURITY DEFINER. When a customer inserts a shop_review, the
-- AFTER INSERT trigger runs as the customer. It tries to
-- UPDATE shops SET rating_avg = ... but the shops_upd RLS
-- policy requires created_by = kromi_uid() OR is_super_admin_jwt()
-- OR is_shop_member(id) — none of which the reviewing customer is.
-- PostgreSQL silently filters the UPDATE to zero rows (RLS doesn't
-- raise on UPDATE mismatches — it filters). Result: shops.rating_avg
-- stays 0 forever, UI shows "0.00★ (0 reviews)".
--
-- Fix: add SECURITY DEFINER + SET search_path = public. Now the
-- trigger runs as the function owner (superuser) and bypasses RLS
-- for the internal UPDATE. The trigger body is otherwise unchanged.
--
-- update_service_totals() has the same latent footgun but today
-- happens to work because every invoker (bike owner OR shop member)
-- is authorized to update the target service_requests row. Fixing
-- defensively removes the footgun for future refactors.
--
-- Caught by tests/shop-e2e.mjs Phase 4 (review → rating aggregation).
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_shop_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  UPDATE shops SET
    rating_avg = COALESCE(
      (SELECT AVG(rating)::numeric(3,2) FROM shop_reviews
       WHERE shop_id = COALESCE(NEW.shop_id, OLD.shop_id)),
      0),
    review_count = (
      SELECT COUNT(*) FROM shop_reviews
      WHERE shop_id = COALESCE(NEW.shop_id, OLD.shop_id))
  WHERE id = COALESCE(NEW.shop_id, OLD.shop_id);
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_service_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  UPDATE service_requests SET
    total_parts_cost = COALESCE((
      SELECT SUM(total_cost) FROM service_items
      WHERE service_id = COALESCE(NEW.service_id, OLD.service_id)
        AND item_type IN ('part', 'consumable')
        AND status != 'rejected'), 0),
    total_labor_cost = COALESCE((
      SELECT SUM(total_cost) FROM service_items
      WHERE service_id = COALESCE(NEW.service_id, OLD.service_id)
        AND item_type = 'labor'
        AND status != 'rejected'), 0),
    total_cost = COALESCE((
      SELECT SUM(total_cost) FROM service_items
      WHERE service_id = COALESCE(NEW.service_id, OLD.service_id)
        AND status != 'rejected'), 0),
    updated_at = now()
  WHERE id = COALESCE(NEW.service_id, OLD.service_id);
  RETURN COALESCE(NEW, OLD);
END;
$function$;
