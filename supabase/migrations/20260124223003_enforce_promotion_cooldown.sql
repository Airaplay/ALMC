/*
  # Enforce Promotion Cooldown (HIGH PRIORITY SECURITY FIX)

  ## Security Issues Fixed
  1. **Cooldown Bypass** - Prevents users from bypassing UI cooldown checks
  2. **Spam Prevention** - Stops rapid re-promotion of same content
  3. **Section Flooding** - Prevents monopolization of promotion slots

  ## Changes
  - New trigger function: `enforce_promotion_cooldown()`
  - Enforces 2-hour cooldown between promotions of same content in same section
  - Prevents duplicate active promotions

  ## Security Level
  HIGH - Prevents spam and ensures fair rotation
*/

-- Function to enforce promotion cooldown
CREATE OR REPLACE FUNCTION public.enforce_promotion_cooldown()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_promotion_end timestamptz;
  v_cooldown_hours integer := 2;
  v_has_active boolean;
BEGIN
  -- Check if there's already an active promotion for same content in same section
  SELECT EXISTS (
    SELECT 1
    FROM promotions
    WHERE user_id = NEW.user_id
    AND target_id = NEW.target_id
    AND promotion_section_id = NEW.promotion_section_id
    AND status IN ('pending_approval', 'pending', 'active')
    AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) INTO v_has_active;

  IF v_has_active THEN
    RAISE EXCEPTION 'Cannot promote the same content in the same section while an active promotion exists';
  END IF;

  -- Check cooldown period for completed promotions
  SELECT MAX(end_date) INTO v_last_promotion_end
  FROM promotions
  WHERE user_id = NEW.user_id
  AND target_id = NEW.target_id
  AND promotion_section_id = NEW.promotion_section_id
  AND status IN ('completed', 'cancelled')
  AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF v_last_promotion_end IS NOT NULL THEN
    IF v_last_promotion_end + (v_cooldown_hours || ' hours')::interval > now() THEN
      RAISE EXCEPTION 'Cooldown period active. Cannot promote same content in same section until 2 hours after previous promotion ended';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS enforce_promotion_cooldown_trigger ON public.promotions;

-- Create trigger on promotions table (BEFORE INSERT)
CREATE TRIGGER enforce_promotion_cooldown_trigger
BEFORE INSERT ON public.promotions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_promotion_cooldown();

-- Add helpful comments
COMMENT ON FUNCTION public.enforce_promotion_cooldown() IS
'HIGH PRIORITY SECURITY: Enforces 2-hour cooldown between promotions of same content in same section. Prevents spam and ensures fair rotation.';

COMMENT ON TRIGGER enforce_promotion_cooldown_trigger ON public.promotions IS
'HIGH PRIORITY SECURITY: Cooldown enforcement to prevent promotion spam';

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.enforce_promotion_cooldown() TO authenticated;