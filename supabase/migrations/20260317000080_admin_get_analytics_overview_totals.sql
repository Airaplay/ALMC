/*
  # Admin: Analytics Overview Totals (server-side aggregation)

  Returns the expensive totals used by AnalyticsOverviewSection without fetching full tables client-side.
  Designed for thousands of users and large tables.

  Includes:
  - plays totals (songs + video/short clips)
  - treat earnings/balances and treat purchase revenue
  - curator earnings total
  - USD earnings totals (gross/net/withdrawn)
*/

CREATE OR REPLACE FUNCTION public.admin_get_analytics_overview_totals()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  v_song_plays numeric := 0;
  v_video_plays numeric := 0;
  v_total_treat_earnings numeric := 0;
  v_treat_wallet_balance numeric := 0;
  v_total_treat_revenue_usd numeric := 0;
  v_curator_earnings numeric := 0;
  v_earnings jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Access denied. Admin privileges required.');
  END IF;

  -- Plays (sum play_count columns)
  SELECT COALESCE(SUM(COALESCE(play_count, 0)), 0) INTO v_song_plays
  FROM public.songs;

  SELECT COALESCE(SUM(COALESCE(play_count, 0)), 0) INTO v_video_plays
  FROM public.content_uploads
  WHERE content_type IN ('video', 'short_clip');

  -- Treat wallets
  SELECT
    COALESCE(SUM(COALESCE(total_earned, 0)), 0),
    COALESCE(SUM(COALESCE(balance, 0)), 0)
  INTO v_total_treat_earnings, v_treat_wallet_balance
  FROM public.treat_wallets;

  -- Treat payments revenue
  SELECT COALESCE(SUM(COALESCE(amount_usd, 0)), 0) INTO v_total_treat_revenue_usd
  FROM public.treat_payments
  WHERE status = 'completed';

  -- Curator earnings
  SELECT COALESCE(SUM(COALESCE(amount, 0)), 0) INTO v_curator_earnings
  FROM public.curator_earnings;

  -- USD earnings totals (gross/net/withdrawn)
  v_earnings := public.admin_get_usd_earnings_totals();
  IF v_earnings ? 'error' THEN
    RETURN v_earnings;
  END IF;

  RETURN jsonb_build_object(
    'song_plays', v_song_plays,
    'video_plays', v_video_plays,
    'total_plays', (v_song_plays + v_video_plays),
    'total_treat_earnings', v_total_treat_earnings,
    'treat_wallet_balance', v_treat_wallet_balance,
    'total_treat_revenue_usd', v_total_treat_revenue_usd,
    'curator_earnings', v_curator_earnings,
    'usd_earnings', v_earnings
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_analytics_overview_totals() TO authenticated;

COMMENT ON FUNCTION public.admin_get_analytics_overview_totals() IS
  'Admin-only. Server-side aggregated totals for AnalyticsOverviewSection (plays, treats, curator, and USD gross/net/withdrawn).';

