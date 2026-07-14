/*
  # Add AdMob totals to Analytics Overview RPC

  Adds keys to `admin_get_analytics_overview_totals()`:
  - admob_total_revenue_usd: SUM(ad_daily_revenue_input.total_revenue_usd)
  - admob_creator_pool_paid_usd: SUM(ad_creator_pool_distributions.creator_pool_usd) where completed
  - admob_platform_share_usd: SUM(net_revenue_usd - creator_pool_usd) where completed

  Notes:
  - "Total AdMob Revenue" uses inputs (source of truth).
  - "Creator Pool Paid" and "Platform Share" use completed pool distributions (money actually allocated).
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
  v_admob_total_revenue_usd numeric := 0;
  v_creator_pool_paid_usd numeric := 0;
  v_platform_share_usd numeric := 0;
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

  -- AdMob totals (all-time)
  SELECT COALESCE(SUM(COALESCE(total_revenue_usd, 0)), 0) INTO v_admob_total_revenue_usd
  FROM public.ad_daily_revenue_input;

  SELECT COALESCE(SUM(COALESCE(creator_pool_usd, 0)), 0) INTO v_creator_pool_paid_usd
  FROM public.ad_creator_pool_distributions
  WHERE status = 'completed';

  SELECT COALESCE(SUM(COALESCE(net_revenue_usd, 0) - COALESCE(creator_pool_usd, 0)), 0) INTO v_platform_share_usd
  FROM public.ad_creator_pool_distributions
  WHERE status = 'completed';

  RETURN jsonb_build_object(
    'song_plays', v_song_plays,
    'video_plays', v_video_plays,
    'total_plays', (v_song_plays + v_video_plays),
    'total_treat_earnings', v_total_treat_earnings,
    'treat_wallet_balance', v_treat_wallet_balance,
    'total_treat_revenue_usd', v_total_treat_revenue_usd,
    'curator_earnings', v_curator_earnings,
    'usd_earnings', v_earnings,
    'admob_total_revenue_usd', v_admob_total_revenue_usd,
    'admob_creator_pool_paid_usd', v_creator_pool_paid_usd,
    'admob_platform_share_usd', v_platform_share_usd
  );
END;
$$;

