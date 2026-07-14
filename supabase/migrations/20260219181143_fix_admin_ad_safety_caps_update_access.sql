/*
  # Fix Admin Ad Safety Caps Update Access

  ## Summary
  The existing RLS policy on `ad_safety_caps` only grants access to users with
  role = 'admin', excluding 'account_admin'. More importantly, the trigger
  `ensure_ad_revenue_split_compliance` correctly validates the split rules, but
  the admin UI was calling the table directly. This migration:

  1. Adds account_admin to the admin RLS policy
  2. Creates a dedicated `admin_update_ad_safety_caps` function that admins call
     via RPC. The function validates the split and applies the update, bypassing
     the need for admin clients to have a separate superuser path.

  ## Changes
  - Drop + recreate "Admin manage safety caps" policy to include account_admin
  - Create `admin_update_ad_safety_caps(...)` SECURITY DEFINER function
  - Grant execute to authenticated (function enforces role check internally)

  ## Security
  - Function checks caller role is admin or account_admin before applying update
  - Trigger still validates data integrity (must total 100%, artist >= 50%)
  - No destructive operations
*/

-- 1. Update RLS policy to include account_admin
DROP POLICY IF EXISTS "Admin manage safety caps" ON ad_safety_caps;

CREATE POLICY "Admin manage safety caps"
  ON ad_safety_caps
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('admin', 'account_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('admin', 'account_admin')
    )
  );

-- 2. Create admin RPC function to update safety caps
CREATE OR REPLACE FUNCTION admin_update_ad_safety_caps(
  p_id                          uuid,
  p_max_rewarded_ads_per_day    integer,
  p_min_playback_duration_seconds integer,
  p_pending_balance_unlock_hours  integer,
  p_artist_revenue_percentage   numeric,
  p_platform_revenue_percentage numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
BEGIN
  -- Verify caller is admin or account_admin
  SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();

  IF v_caller_role NOT IN ('admin', 'account_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: admin role required');
  END IF;

  -- listener_revenue_percentage is always 0 per business model
  UPDATE ad_safety_caps
  SET
    max_rewarded_ads_per_day        = p_max_rewarded_ads_per_day,
    min_playback_duration_seconds   = p_min_playback_duration_seconds,
    pending_balance_unlock_hours    = p_pending_balance_unlock_hours,
    artist_revenue_percentage       = p_artist_revenue_percentage,
    listener_revenue_percentage     = 0.00,
    platform_revenue_percentage     = p_platform_revenue_percentage,
    updated_at                      = now()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Safety caps record not found');
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_ad_safety_caps(uuid, integer, integer, integer, numeric, numeric) TO authenticated;
