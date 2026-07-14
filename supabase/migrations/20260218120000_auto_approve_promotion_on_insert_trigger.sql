/*
  # Auto-approve new promotions on INSERT when global setting is enabled

  ## Problem
  - Auto-approval relied on pg_cron (every 10 min), which often fails or is unavailable in Supabase.
  - Promotions stayed in pending_approval until manually approved.

  ## Solution
  - AFTER INSERT trigger: only set status = 'active' when the user's start date/time
    has been reached (start_date <= now()) and end_date is still valid. Otherwise
    the row stays pending_approval until that time (e.g. when RPC runs later).
  - RPC auto_approve_pending_promotions(): same rule — only approve promotions
    whose start_date <= now() and end_date >= now(), so user-set date and time are followed.
  - Treat deduction already runs on INSERT; the email trigger runs on the UPDATE we perform.

  ## Security
  - Function is SECURITY DEFINER, search_path = public.
  - Only updates rows when global setting is enabled.
*/

CREATE OR REPLACE FUNCTION public.trigger_auto_approve_promotion_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auto_enabled boolean;
BEGIN
  IF NEW.status NOT IN ('pending_approval', 'pending') THEN
    RETURN NEW;
  END IF;

  SELECT auto_approval_enabled INTO v_auto_enabled
  FROM public.promotion_global_settings
  LIMIT 1;

  IF v_auto_enabled IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Only set to active when the user's chosen start date/time has been reached (and end date still valid)
  IF NEW.start_date > now() OR (NEW.end_date IS NOT NULL AND NEW.end_date < now()) THEN
    RETURN NEW;  -- Leave as pending_approval; will become active when start_date is reached (e.g. when RPC runs)
  END IF;

  UPDATE public.promotions
  SET status = 'active',
      updated_at = now()
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_approve_promotion_on_insert ON public.promotions;
CREATE TRIGGER trigger_auto_approve_promotion_on_insert
  AFTER INSERT ON public.promotions
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_auto_approve_promotion_on_insert();

COMMENT ON FUNCTION public.trigger_auto_approve_promotion_on_insert() IS
'When auto_approval_enabled is true, set status to active only if the promotion start_date has been reached and end_date is still valid. Otherwise leave pending_approval.';

-- Also fix auto_approve_pending_promotions() RPC to follow each promotion's start_date/end_date (do not set start_date = now())
CREATE OR REPLACE FUNCTION public.auto_approve_pending_promotions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auto_enabled boolean;
  approved_count integer := 0;
BEGIN
  SELECT auto_approval_enabled INTO v_auto_enabled
  FROM public.promotion_global_settings
  LIMIT 1;

  IF v_auto_enabled IS NULL OR v_auto_enabled = false THEN
    RETURN;
  END IF;

  -- Only approve when the user's start date/time has been reached and end date is still valid
  UPDATE public.promotions
  SET status = 'active',
      updated_at = now()
  WHERE status IN ('pending_approval', 'pending')
    AND start_date <= now()
    AND (end_date IS NULL OR end_date >= now());

  GET DIAGNOSTICS approved_count = ROW_COUNT;
END;
$$;

COMMENT ON FUNCTION public.auto_approve_pending_promotions() IS
'Auto-approves pending promotions when global setting is on. Only sets active when each promotion''s start_date has been reached and end_date is still valid (user-set date and time are followed).';
