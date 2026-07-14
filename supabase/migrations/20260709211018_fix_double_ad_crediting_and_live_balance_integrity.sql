/*
  # Fix double AdMob crediting + live balance integrity guard

  ## Problem
  - Production still ran the legacy `process_ad_impression_revenue` that credits
    `users.total_earnings` per impression WHILE daily creator pool distribution also
    credits the same revenue → ~$4.46 duplicate live balance.
  - Migration 20260317000010 was marked applied but the live function had reverted.

  ## Changes
  1. Re-deploy pool-model `process_ad_impression_revenue` (audit only, no live credits).
  2. Add `admin_verify_live_balance_integrity()` guard RPC.
  3. Extend `admin_get_usd_earnings_totals()` to surface integrity in admin analytics.
*/

-- 1) Pool model: record impressions for analytics; credit only via daily distribution.
CREATE OR REPLACE FUNCTION public.process_ad_impression_revenue(
  impression_uuid uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  impression_record record;
  artist_record record;
  content_record record;
  revenue_amount numeric;
  artist_share_estimate numeric := 0;
  platform_share_estimate numeric := 0;
  payout_settings jsonb;
  new_revenue_id uuid;
  result jsonb;
BEGIN
  SELECT * INTO impression_record
  FROM public.ad_impressions
  WHERE id = impression_uuid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Ad impression not found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ad_revenue_events
    WHERE impression_id = impression_uuid
  ) THEN
    RETURN jsonb_build_object('error', 'Revenue already processed for this impression');
  END IF;

  IF impression_record.content_id IS NOT NULL THEN
    IF impression_record.content_type = 'song' THEN
      SELECT s.*, s.artist_id AS artist_id INTO content_record
      FROM public.songs s
      WHERE s.id = impression_record.content_id;

      IF FOUND AND content_record.artist_id IS NOT NULL THEN
        SELECT * INTO artist_record
        FROM public.artists
        WHERE id = content_record.artist_id;
      END IF;
    ELSE
      SELECT cu.*, ap.artist_id INTO content_record
      FROM public.content_uploads cu
      LEFT JOIN public.artist_profiles ap ON cu.artist_profile_id = ap.id
      WHERE cu.id = impression_record.content_id;

      IF FOUND AND content_record.artist_id IS NOT NULL THEN
        SELECT * INTO artist_record
        FROM public.artists
        WHERE id = content_record.artist_id;
      END IF;
    END IF;
  END IF;

  revenue_amount := public.calculate_ad_revenue(impression_uuid);
  payout_settings := public.get_user_ad_payout_settings(COALESCE(impression_record.user_id, NULL));

  IF artist_record.id IS NOT NULL THEN
    artist_share_estimate := revenue_amount * (payout_settings->>'artist_percentage')::numeric / 100;
  END IF;
  platform_share_estimate := revenue_amount - artist_share_estimate;

  INSERT INTO public.ad_revenue_events (
    impression_id,
    revenue_amount,
    currency,
    user_id,
    artist_id,
    content_id,
    status,
    metadata
  ) VALUES (
    impression_uuid,
    revenue_amount,
    'USD',
    impression_record.user_id,
    artist_record.id,
    impression_record.content_id,
    'pending',
    jsonb_build_object(
      'model', 'daily_pro_rata_pool',
      'note', 'No per-impression crediting. Daily pool distribution will credit creators.',
      'artist_share_estimate', artist_share_estimate,
      'platform_share_estimate', platform_share_estimate,
      'weight', public.compute_ad_impression_weight(
        impression_record.ad_type,
        impression_record.duration_viewed,
        impression_record.completed
      ),
      'ad_type', impression_record.ad_type,
      'content_type', impression_record.content_type,
      'duration_viewed', impression_record.duration_viewed,
      'completed', impression_record.completed,
      'credited_to_users', false
    )
  )
  RETURNING id INTO new_revenue_id;

  result := jsonb_build_object(
    'success', true,
    'revenue_event_id', new_revenue_id,
    'revenue_amount_estimate', revenue_amount,
    'credited_to_users', false,
    'message', 'Impression recorded. Creator payout occurs in daily pro-rata distribution.'
  );

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.process_ad_impression_revenue(uuid) IS
  'Pool model: records ad_revenue_events for analytics but does NOT credit users.total_earnings. Use admin_distribute_creator_pool_for_date(date) for payouts.';

-- 2) Integrity guard: live balance must match auditable payout sources within tolerance.
CREATE OR REPLACE FUNCTION public.admin_verify_live_balance_integrity(
  p_tolerance_usd numeric DEFAULT 0.05
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  v_live_balance_usd numeric := 0;
  v_pool_ledger_usd numeric := 0;
  v_external_usd numeric := 0;
  v_contribution_usd numeric := 0;
  v_referral_usd numeric := 0;
  v_auditable_usd numeric := 0;
  v_overpayment_usd numeric := 0;
  v_per_impression_duplicate_usd numeric := 0;
  v_per_impression_crediting_active boolean := false;
  v_ok boolean;
  v_tolerance numeric;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Access denied. Admin privileges required.');
  END IF;

  v_tolerance := GREATEST(COALESCE(p_tolerance_usd, 0.05), 0);

  SELECT COALESCE(SUM(COALESCE(total_earnings, 0)), 0) INTO v_live_balance_usd
  FROM public.users;

  SELECT COALESCE(SUM(COALESCE(payout_usd, 0)), 0) INTO v_pool_ledger_usd
  FROM public.ad_creator_payout_ledger;

  SELECT COALESCE(SUM(credit_usd), 0) INTO v_external_usd
  FROM (
    SELECT p.payout_usd / NULLIF(c.cnt, 0) AS credit_usd
    FROM public.external_revenue_creator_payouts p
    JOIN public.artist_profiles ap ON ap.artist_id = p.artist_id AND ap.user_id IS NOT NULL
    JOIN (
      SELECT artist_id, COUNT(DISTINCT user_id)::numeric AS cnt
      FROM public.artist_profiles
      WHERE artist_id IS NOT NULL AND user_id IS NOT NULL
      GROUP BY artist_id
    ) c ON c.artist_id = p.artist_id
  ) external_credits;

  SELECT COALESCE(SUM(COALESCE(reward_amount_usd, 0)), 0) INTO v_contribution_usd
  FROM public.contribution_rewards_history
  WHERE status = 'completed';

  SELECT COALESCE(SUM(COALESCE(payout_amount_usd, 0)), 0) INTO v_referral_usd
  FROM public.referral_milestone_payouts
  WHERE credited_at IS NOT NULL;

  v_auditable_usd :=
    COALESCE(v_pool_ledger_usd, 0)
    + COALESCE(v_external_usd, 0)
    + COALESCE(v_contribution_usd, 0)
    + COALESCE(v_referral_usd, 0);

  v_overpayment_usd := COALESCE(v_live_balance_usd, 0) - v_auditable_usd;

  SELECT COALESCE(SUM(COALESCE((are.metadata->>'artist_share')::numeric, 0)), 0) INTO v_per_impression_duplicate_usd
  FROM public.ad_revenue_events are
  WHERE are.status = 'processed'
    AND COALESCE((are.metadata->>'credited_to_users')::boolean, false);

  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'process_ad_impression_revenue'
      AND pg_get_functiondef(p.oid) ILIKE '%total_earnings%'
      AND pg_get_functiondef(p.oid) ILIKE '%UPDATE%users%'
  ) INTO v_per_impression_crediting_active;

  v_ok := ABS(v_overpayment_usd) <= v_tolerance;

  RETURN jsonb_build_object(
    'ok', v_ok,
    'status', CASE
      WHEN v_ok THEN 'ok'
      WHEN v_overpayment_usd > v_tolerance THEN 'overpaid'
      ELSE 'underpaid'
    END,
    'tolerance_usd', v_tolerance,
    'live_balance_usd', v_live_balance_usd,
    'auditable_credits_usd', v_auditable_usd,
    'auditable_components', jsonb_build_object(
      'admob_pool_ledger_usd', v_pool_ledger_usd,
      'external_revenue_usd', v_external_usd,
      'contribution_rewards_usd', v_contribution_usd,
      'referral_milestone_usd', v_referral_usd
    ),
    'overpayment_usd', v_overpayment_usd,
    'per_impression_duplicate_usd', v_per_impression_duplicate_usd,
    'per_impression_crediting_active', v_per_impression_crediting_active,
    'message', CASE
      WHEN v_ok THEN 'Live balance matches auditable payout sources within tolerance.'
      WHEN v_per_impression_crediting_active THEN
        'Live balance exceeds auditable credits and per-impression crediting is still active. Disable per-impression crediting immediately.'
      WHEN v_overpayment_usd > v_tolerance THEN
        format(
          'Live balance exceeds auditable credits by $%s. Historical per-impression duplicate credits are likely (~$%s recorded).',
          ROUND(v_overpayment_usd, 4),
          ROUND(v_per_impression_duplicate_usd, 4)
        )
      ELSE
        format(
          'Live balance is $%s below auditable credits. Investigate missing payout ledger rows or balance resets.',
          ROUND(ABS(v_overpayment_usd), 4)
        )
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_verify_live_balance_integrity(numeric) TO authenticated;

COMMENT ON FUNCTION public.admin_verify_live_balance_integrity(numeric) IS
  'Admin guard: compares SUM(users.total_earnings) to auditable credits (pool ledger + external + contribution + referral). Flags per-impression duplicate crediting.';

-- 3) Surface integrity on admin USD earnings totals (used by Analytics Overview).
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
  v_integrity jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Access denied. Admin privileges required.');
  END IF;

  SELECT COALESCE(SUM(COALESCE(total_earnings, 0)), 0) INTO v_net_usd
  FROM public.users;

  SELECT COALESCE(SUM(COALESCE(amount, 0)), 0) INTO v_withdrawn_usd
  FROM public.withdrawal_requests
  WHERE status IN ('approved', 'completed');

  v_gross_usd := v_net_usd + v_withdrawn_usd;
  v_integrity := public.admin_verify_live_balance_integrity();

  RETURN jsonb_build_object(
    'net_usd', v_net_usd,
    'withdrawn_usd', v_withdrawn_usd,
    'gross_usd', v_gross_usd,
    'live_balance_integrity', v_integrity
  );
END;
$$;

COMMENT ON FUNCTION public.admin_get_usd_earnings_totals() IS
  'Admin-only. Returns net/withdrawn/gross USD totals plus live_balance_integrity guard payload.';
