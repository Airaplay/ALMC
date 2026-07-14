/*
  # Server-Side Cost Validation (CRITICAL SECURITY FIX)

  ## Security Issues Fixed
  1. **Cost Manipulation** - Prevents client from tampering with promotion costs
  2. **Server Recalculation** - Recalculates cost based on official pricing
  3. **Price Validation** - Ensures pricing matches database rates

  ## Changes
  - New trigger function: `validate_promotion_cost()`
  - Recalculates cost server-side from promotion_section_pricing
  - Rejects if client cost doesn't match server calculation
  - Forces server-calculated values for duration

  ## Security Level
  CRITICAL - Prevents financial abuse through cost manipulation
*/

-- Function to validate and recalculate promotion cost server-side
CREATE OR REPLACE FUNCTION public.validate_promotion_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected_cost numeric;
  v_daily_rate numeric;
  v_duration_days integer;
  v_duration_hours integer;
BEGIN
  -- Get the official daily rate from pricing table
  SELECT treats_cost INTO v_daily_rate
  FROM promotion_section_pricing psp
  WHERE psp.section_id = NEW.promotion_section_id
  AND psp.content_type = NEW.promotion_type
  AND psp.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid promotion section or content type combination';
  END IF;

  IF v_daily_rate IS NULL OR v_daily_rate <= 0 THEN
    RAISE EXCEPTION 'Invalid pricing configuration for this section';
  END IF;

  -- Calculate duration in days (ceiling to ensure full days)
  v_duration_hours := CEIL(EXTRACT(EPOCH FROM (NEW.end_date - NEW.start_date)) / 3600);
  v_duration_days := CEIL(v_duration_hours::numeric / 24);

  -- Ensure minimum 1 day
  IF v_duration_days < 1 THEN
    v_duration_days := 1;
  END IF;

  -- Calculate expected cost
  v_expected_cost := v_daily_rate * v_duration_days;

  -- CRITICAL: Verify client-provided cost matches server calculation
  -- Allow small rounding difference (0.01) but reject significant discrepancies
  IF ABS(NEW.treats_cost - v_expected_cost) > 0.01 THEN
    RAISE EXCEPTION 'Cost validation failed. Server calculated cost does not match submitted cost. Please refresh and try again.';
  END IF;

  -- CRITICAL: Force server-calculated values (don't trust client)
  NEW.treats_cost := v_expected_cost;
  NEW.duration_days := v_duration_days;
  NEW.duration_hours := v_duration_hours;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS validate_promotion_cost_trigger ON public.promotions;

-- Create trigger on promotions table (BEFORE INSERT)
-- This runs AFTER enforce_promotion_quotas_trigger
CREATE TRIGGER validate_promotion_cost_trigger
BEFORE INSERT ON public.promotions
FOR EACH ROW
EXECUTE FUNCTION public.validate_promotion_cost();

-- Add helpful comments
COMMENT ON FUNCTION public.validate_promotion_cost() IS
'CRITICAL SECURITY: Recalculates promotion cost server-side and validates against official pricing. Prevents cost manipulation attacks.';

COMMENT ON TRIGGER validate_promotion_cost_trigger ON public.promotions IS
'CRITICAL SECURITY: Server-side cost validation to prevent financial manipulation';

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.validate_promotion_cost() TO authenticated;