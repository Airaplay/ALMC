/*
  # Admin: Get USD Earnings Totals (Gross / Net / Withdrawn)

  Why:
  - AnalyticsOverviewSection currently fetches all users.total_earnings and all withdrawal rows
    and sums them client-side. This is slow and can be inconsistent at scale.
  - This function computes totals in the database with a single call.
*/

CREATE OR REPLACE FUNCTION public.admin_get_usd_earnings_totals()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  v_net_usd numeric := 0;
  v_withdrawn_usd numeric := 0;
  v_gross_usd numeric := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Access denied. Admin privileges required.');
  END IF;

  -- Net: current live balance across all users (after withdrawals)
  SELECT COALESCE(SUM(COALESCE(total_earnings, 0)), 0) INTO v_net_usd
  FROM public.users;

  -- Withdrawn: historical payouts paid out to users
  SELECT COALESCE(SUM(COALESCE(amount, 0)), 0) INTO v_withdrawn_usd
  FROM public.withdrawal_requests
  WHERE status IN ('approved', 'completed');

  -- Gross: total ever earned (net + withdrawn)
  v_gross_usd := v_net_usd + v_withdrawn_usd;

  RETURN jsonb_build_object(
    'net_usd', v_net_usd,
    'withdrawn_usd', v_withdrawn_usd,
    'gross_usd', v_gross_usd
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_usd_earnings_totals() TO authenticated;

COMMENT ON FUNCTION public.admin_get_usd_earnings_totals() IS
  'Admin-only. Returns net (sum users.total_earnings), withdrawn (sum withdrawal_requests), and gross (net+withdrawn) in USD.';

