/*
  # Enforce Promotion Quotas and Creator Eligibility (CRITICAL SECURITY FIX)

  ## Security Issues Fixed
  1. **Quota Enforcement** - Prevents users from creating unlimited promotions
  2. **Creator Validation** - Ensures only approved creators can promote
  3. **Balance Verification** - Double-checks wallet balance
  4. **System Toggle** - Respects global promotions_enabled setting

  ## Changes
  - New trigger function: `enforce_promotion_quotas()`
  - Validates creator status at database level
  - Enforces max_active_promotions_per_user limit
  - Prevents cost manipulation (checks cost > 0)
  - Validates sufficient balance

  ## Security Level
  CRITICAL - Prevents bypass of UI-only checks
*/

-- Function to enforce promotion quotas and eligibility
CREATE OR REPLACE FUNCTION public.enforce_promotion_quotas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_count integer;
  v_max_allowed integer;
  v_is_creator boolean;
  v_promotions_enabled boolean;
  v_min_balance numeric;
  v_current_balance numeric;
  v_is_approved boolean;
BEGIN
  -- Check if promotions are globally enabled
  SELECT
    promotions_enabled,
    max_active_promotions_per_user,
    min_treats_balance
  INTO
    v_promotions_enabled,
    v_max_allowed,
    v_min_balance
  FROM promotion_global_settings
  LIMIT 1;

  -- If no settings found, use safe defaults
  IF NOT FOUND THEN
    v_promotions_enabled := true;
    v_max_allowed := 5;
    v_min_balance := 100;
  END IF;

  -- Check if promotions are globally disabled
  IF NOT v_promotions_enabled THEN
    RAISE EXCEPTION 'Promotions are currently disabled by administrator';
  END IF;

  -- CRITICAL: Verify user is an approved creator
  SELECT EXISTS (
    SELECT 1
    FROM artist_profiles
    WHERE user_id = NEW.user_id
  ) INTO v_is_creator;

  IF NOT v_is_creator THEN
    RAISE EXCEPTION 'Only approved creators can create promotions. Please submit a creator request first.';
  END IF;

  -- Check if creator account is approved (not pending or rejected)
  SELECT EXISTS (
    SELECT 1
    FROM artist_profiles ap
    LEFT JOIN creator_requests cr ON cr.user_id = ap.user_id
    WHERE ap.user_id = NEW.user_id
    AND (cr.status IS NULL OR cr.status = 'approved')
  ) INTO v_is_approved;

  IF NOT v_is_approved THEN
    RAISE EXCEPTION 'Creator account is not yet approved. Please wait for admin approval.';
  END IF;

  -- CRITICAL: Enforce active promotion quota
  SELECT COUNT(*) INTO v_active_count
  FROM promotions
  WHERE user_id = NEW.user_id
  AND status IN ('pending_approval', 'pending', 'active')
  AND (end_date IS NULL OR end_date > now());

  IF v_active_count >= v_max_allowed THEN
    RAISE EXCEPTION 'Maximum active promotions limit reached. Please wait for existing promotions to complete.';
  END IF;

  -- CRITICAL: Verify cost is valid (prevent negative or zero)
  IF NEW.treats_cost IS NULL OR NEW.treats_cost <= 0 THEN
    RAISE EXCEPTION 'Invalid promotion cost. Cost must be greater than 0.';
  END IF;

  -- Verify cost is reasonable (prevent absurd values)
  IF NEW.treats_cost > 1000000 THEN
    RAISE EXCEPTION 'Promotion cost exceeds maximum allowed. Contact support for enterprise promotions.';
  END IF;

  -- Verify sufficient balance
  SELECT balance INTO v_current_balance
  FROM treat_wallets
  WHERE user_id = NEW.user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found for user. Please contact support.';
  END IF;

  IF v_current_balance < v_min_balance THEN
    RAISE EXCEPTION 'Insufficient treats balance. Please purchase more treats to continue.';
  END IF;

  -- Verify sufficient balance for this specific promotion
  IF v_current_balance < NEW.treats_cost THEN
    RAISE EXCEPTION 'Insufficient balance for this promotion. Please purchase more treats.';
  END IF;

  -- Verify dates are valid
  IF NEW.start_date >= NEW.end_date THEN
    RAISE EXCEPTION 'Promotion end date must be after start date';
  END IF;

  -- Verify duration is reasonable (not more than 90 days)
  IF NEW.end_date > NEW.start_date + INTERVAL '90 days' THEN
    RAISE EXCEPTION 'Promotion duration cannot exceed 90 days';
  END IF;

  -- Verify promotion section exists and is valid
  IF NEW.promotion_section_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM promotion_sections
      WHERE id = NEW.promotion_section_id
      AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Invalid or inactive promotion section';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS enforce_promotion_quotas_trigger ON public.promotions;

-- Create trigger on promotions table (BEFORE INSERT)
CREATE TRIGGER enforce_promotion_quotas_trigger
BEFORE INSERT ON public.promotions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_promotion_quotas();

-- Add helpful comments
COMMENT ON FUNCTION public.enforce_promotion_quotas() IS
'CRITICAL SECURITY: Enforces creator eligibility, promotion quotas, balance checks, and business rules. Prevents bypass of UI-only validations.';

COMMENT ON TRIGGER enforce_promotion_quotas_trigger ON public.promotions IS
'CRITICAL SECURITY: Validates all promotion creation attempts at database level to prevent abuse';

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.enforce_promotion_quotas() TO authenticated;