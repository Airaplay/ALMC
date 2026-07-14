/*
  # Redefine Net USD Revenue as Airaplay earned after deductions

  Net USD Revenue = total money Airaplay has earned after subtracting deductions:
  - AdMob safety buffer + creator/listener splits → platform share on usable net
  - External fees + distributable creator/listener amounts → platform retained
  - Treat purchases excluded (IAP collected, not net platform earnings)
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
  v_user_gross_usd numeric := 0;
  v_admob_gross_usd numeric := 0;
  v_admob_net_usd numeric := 0;
  v_external_gross_usd numeric := 0;
  v_external_net_usd numeric := 0;
  v_creator_pool_paid_usd numeric := 0;
  v_platform_share_usd numeric := 0;
  v_admob_platform_component numeric := 0;
  v_platform_gross_usd numeric := 0;
  v_platform_revenue_gross_usd numeric := 0;
  v_platform_revenue_net_usd numeric := 0;
  v_admob_platform_share_usd numeric := 0;
  v_external_platform_share_usd numeric := 0;
  v_platform_share_revenue_usd numeric := 0;
  v_artist_pct numeric := 0;
  v_listener_pct numeric := 0;
  v_has_ad_caps boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Access denied. Admin privileges required.');
  END IF;

  SELECT COALESCE(SUM(COALESCE(play_count, 0)), 0) INTO v_song_plays
  FROM public.songs;

  SELECT COALESCE(SUM(COALESCE(play_count, 0)), 0) INTO v_video_plays
  FROM public.content_uploads
  WHERE content_type IN ('video', 'short_clip');

  SELECT
    COALESCE(SUM(COALESCE(total_earned, 0)), 0),
    COALESCE(SUM(COALESCE(balance, 0)), 0)
  INTO v_total_treat_earnings, v_treat_wallet_balance
  FROM public.treat_wallets;

  SELECT COALESCE(SUM(COALESCE(amount_usd, 0)), 0) INTO v_total_treat_revenue_usd
  FROM public.treat_payments
  WHERE status = 'completed';

  SELECT COALESCE(SUM(COALESCE(amount, 0)), 0) INTO v_curator_earnings
  FROM public.curator_earnings;

  SELECT
    COALESCE(SUM(COALESCE(total_revenue_usd, 0)), 0),
    COALESCE(SUM(
      COALESCE(total_revenue_usd, 0)
      * (GREATEST(0::numeric, LEAST(100::numeric, COALESCE(safety_buffer_percentage, 75))) / 100.0)
    ), 0)
  INTO v_admob_gross_usd, v_admob_net_usd
  FROM public.ad_daily_revenue_input;

  SELECT
    COALESCE(SUM(COALESCE(gross_amount_usd, 0)), 0),
    COALESCE(SUM(COALESCE(net_amount_usd, 0)), 0)
  INTO v_external_gross_usd, v_external_net_usd
  FROM public.external_revenue_entries;

  v_platform_revenue_gross_usd :=
    COALESCE(v_admob_gross_usd, 0)
    + COALESCE(v_total_treat_revenue_usd, 0)
    + COALESCE(v_external_gross_usd, 0);

  SELECT
    a.artist_revenue_percentage,
    a.listener_revenue_percentage
  INTO v_artist_pct, v_listener_pct
  FROM public.ad_safety_caps a
  WHERE a.is_active = true
  LIMIT 1;

  v_has_ad_caps := FOUND;
  IF v_has_ad_caps THEN
    v_artist_pct := GREATEST(0::numeric, LEAST(100::numeric, COALESCE(v_artist_pct, 0)));
    v_listener_pct := GREATEST(0::numeric, LEAST(100::numeric, COALESCE(v_listener_pct, 0)));
    v_admob_platform_share_usd :=
      COALESCE(v_admob_net_usd, 0)
      - (COALESCE(v_admob_net_usd, 0) * v_artist_pct / 100.0)
      - (COALESCE(v_admob_net_usd, 0) * v_listener_pct / 100.0);
  ELSE
    SELECT COALESCE(SUM(COALESCE(net_revenue_usd, 0) - COALESCE(creator_pool_usd, 0)), 0)
    INTO v_admob_platform_share_usd
    FROM public.ad_creator_pool_distributions
    WHERE status = 'completed';

    IF COALESCE(v_admob_platform_share_usd, 0) = 0 AND COALESCE(v_admob_gross_usd, 0) > 0 THEN
      v_admob_platform_share_usd := v_admob_gross_usd * 0.40;
    END IF;
  END IF;

  SELECT COALESCE(SUM(platform_usd), 0) INTO v_external_platform_share_usd
  FROM (
    SELECT
      COALESCE(
        (
          SELECT d.platform_retained_usd
          FROM public.external_revenue_distributions d
          WHERE d.entry_id = e.id
            AND d.status = 'distributed'
          LIMIT 1
        ),
        GREATEST(0, COALESCE(e.net_amount_usd, 0) - COALESCE(e.distributable_amount_usd, 0))
      ) AS platform_usd
    FROM public.external_revenue_entries e
  ) external_platform;

  -- Airaplay earned after deductions (buffers, fees, user payout splits). Treat excluded.
  v_platform_revenue_net_usd :=
    COALESCE(v_admob_platform_share_usd, 0)
    + COALESCE(v_external_platform_share_usd, 0);

  v_platform_share_revenue_usd :=
    COALESCE(v_admob_platform_share_usd, 0)
    + COALESCE(v_total_treat_revenue_usd, 0)
    + COALESCE(v_external_platform_share_usd, 0);

  v_earnings := public.admin_get_usd_earnings_totals();
  IF v_earnings ? 'error' THEN
    RETURN v_earnings;
  END IF;

  v_user_gross_usd := COALESCE((v_earnings->>'gross_usd')::numeric, 0);

  SELECT COALESCE(SUM(COALESCE(creator_pool_usd, 0)), 0) INTO v_creator_pool_paid_usd
  FROM public.ad_creator_pool_distributions
  WHERE status = 'completed';

  SELECT COALESCE(SUM(COALESCE(net_revenue_usd, 0) - COALESCE(creator_pool_usd, 0)), 0) INTO v_platform_share_usd
  FROM public.ad_creator_pool_distributions
  WHERE status = 'completed';

  v_admob_platform_component := COALESCE(v_platform_share_usd, 0);
  IF v_admob_platform_component = 0 AND COALESCE(v_admob_gross_usd, 0) > 0 THEN
    v_admob_platform_component := v_admob_gross_usd * 0.40;
  END IF;

  v_platform_gross_usd :=
    COALESCE(v_user_gross_usd, 0)
    + COALESCE(v_total_treat_revenue_usd, 0)
    + COALESCE(v_curator_earnings, 0)
    + COALESCE(v_admob_platform_component, 0);

  RETURN jsonb_build_object(
    'song_plays', v_song_plays,
    'video_plays', v_video_plays,
    'total_plays', (v_song_plays + v_video_plays),
    'total_treat_earnings', v_total_treat_earnings,
    'treat_wallet_balance', v_treat_wallet_balance,
    'total_treat_revenue_usd', v_total_treat_revenue_usd,
    'curator_earnings', v_curator_earnings,
    'usd_earnings', v_earnings,
    'admob_total_revenue_usd', v_admob_gross_usd,
    'admob_net_revenue_usd', v_admob_net_usd,
    'external_revenue_gross_usd', v_external_gross_usd,
    'external_revenue_net_usd', v_external_net_usd,
    'platform_revenue_gross_usd', v_platform_revenue_gross_usd,
    'platform_revenue_net_usd', v_platform_revenue_net_usd,
    'platform_share_revenue_usd', v_platform_share_revenue_usd,
    'platform_share_components', jsonb_build_object(
      'admob_platform_share_usd', v_admob_platform_share_usd,
      'treat_platform_share_usd', v_total_treat_revenue_usd,
      'external_platform_share_usd', v_external_platform_share_usd
    ),
    'platform_revenue_net_components', jsonb_build_object(
      'admob_platform_share_usd', v_admob_platform_share_usd,
      'external_platform_share_usd', v_external_platform_share_usd
    ),
    'platform_revenue_components', jsonb_build_object(
      'admob_gross_usd', v_admob_gross_usd,
      'admob_net_usd', v_admob_net_usd,
      'treat_revenue_usd', v_total_treat_revenue_usd,
      'external_gross_usd', v_external_gross_usd,
      'external_net_usd', v_external_net_usd
    ),
    'admob_creator_pool_paid_usd', v_creator_pool_paid_usd,
    'admob_platform_share_usd', v_platform_share_usd,
    'platform_gross_usd', v_platform_gross_usd,
    'platform_gross_components', jsonb_build_object(
      'user_usd_gross', v_user_gross_usd,
      'treat_revenue_usd', v_total_treat_revenue_usd,
      'curator_earnings_usd', v_curator_earnings,
      'admob_platform_component_usd', v_admob_platform_component
    )
  );
END;
$$;

COMMENT ON FUNCTION public.admin_get_analytics_overview_totals() IS
  'Admin overview totals. platform_revenue_net_usd = Airaplay earned after deductions (AdMob platform share + External platform retained; Treat excluded). platform_revenue_gross_usd = all incoming revenue. platform_share_revenue_usd includes Treat IAP in platform share.';
