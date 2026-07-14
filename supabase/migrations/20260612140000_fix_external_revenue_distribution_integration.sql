/*
  External Revenue distribution fixes:
    - Auto-consume pending listener topups during monthly contribution conversion
    - Include pending topups in pool suggestion + combined suggested total
    - Wallet ensure before direct listener credits
    - Skip auto creator payout for manual attribution (status = partial)
    - Block distribute when pools have no eligible recipients (non-manual / non-pool modes)
    - Overview KPIs: separate creator paid, listener direct paid, listener topups
*/

-- ---------------------------------------------------------------------------
-- 1) Conversion history: track external-revenue topup portion
-- ---------------------------------------------------------------------------
ALTER TABLE public.contribution_conversion_history
  ADD COLUMN IF NOT EXISTS external_revenue_topup_usd numeric(14, 4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.contribution_conversion_history.external_revenue_topup_usd IS
  'USD from consumed external_revenue_contribution_pool_topups added to reward_pool_usd for this run.';

-- ---------------------------------------------------------------------------
-- 2) Pool suggestion includes pending external-revenue topups
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.compute_contribution_pool_suggestion(p_period_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_month_start date;
  v_month_end date;
  v_net_sum numeric;
  v_artist_pct numeric;
  v_listener_pct numeric;
  v_platform_usd numeric;
  v_pool_pct numeric;
  v_suggested numeric;
  v_days integer;
  v_pending_topups numeric := 0;
  v_pending_count integer := 0;
BEGIN
  IF p_period_date IS NULL THEN
    RETURN jsonb_build_object('error', 'period_date_required');
  END IF;

  SELECT
    COALESCE(SUM(amount_usd), 0)::numeric,
    COUNT(*)::integer
  INTO v_pending_topups, v_pending_count
  FROM public.external_revenue_contribution_pool_topups
  WHERE status = 'pending';

  v_month_start := date_trunc('month', p_period_date::timestamp)::date;
  v_month_end := (v_month_start + interval '1 month - 1 day')::date;

  SELECT
    a.artist_revenue_percentage,
    a.listener_revenue_percentage
  INTO v_artist_pct, v_listener_pct
  FROM public.ad_safety_caps a
  WHERE a.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT COALESCE(platform_to_pool_percentage, 15::numeric) INTO v_pool_pct
    FROM public.contribution_conversion_settings
    WHERE is_active = true
    ORDER BY updated_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'period_start', v_month_start,
      'period_end', v_month_end,
      'usable_net_total_usd', 0,
      'platform_revenue_usd', 0,
      'pool_percentage', COALESCE(v_pool_pct, 15),
      'suggested_pool_usd', 0,
      'admob_days_count', 0,
      'caps_missing', true,
      'pending_external_revenue_topup_usd', round(v_pending_topups, 2),
      'pending_external_revenue_topup_count', v_pending_count,
      'combined_suggested_pool_usd', round(v_pending_topups, 2)
    );
  END IF;

  v_artist_pct := greatest(0::numeric, least(100::numeric, coalesce(v_artist_pct, 0)));
  v_listener_pct := greatest(0::numeric, least(100::numeric, coalesce(v_listener_pct, 0)));

  SELECT
    COALESCE(SUM(
      COALESCE(i.total_revenue_usd, 0) * (
        GREATEST(0::numeric, LEAST(100::numeric, COALESCE(i.safety_buffer_percentage, 75))) / 100.0
      )
    ), 0)::numeric,
    COUNT(*)::integer
  INTO v_net_sum, v_days
  FROM public.ad_daily_revenue_input i
  WHERE i.source = 'admob_api'
    AND i.revenue_date >= v_month_start
    AND i.revenue_date <= v_month_end;

  v_platform_usd :=
    v_net_sum
    - (v_net_sum * v_artist_pct / 100.0)
    - (v_net_sum * v_listener_pct / 100.0);

  SELECT COALESCE(cs.platform_to_pool_percentage, 15::numeric) INTO v_pool_pct
  FROM public.contribution_conversion_settings cs
  WHERE cs.is_active = true
  ORDER BY cs.updated_at DESC
  LIMIT 1;

  v_pool_pct := greatest(0::numeric, least(100::numeric, COALESCE(v_pool_pct, 15)));
  v_suggested := round((v_platform_usd * (v_pool_pct / 100.0))::numeric, 2);

  RETURN jsonb_build_object(
    'period_start', v_month_start,
    'period_end', v_month_end,
    'usable_net_total_usd', round(v_net_sum, 2),
    'platform_revenue_usd', round(v_platform_usd, 2),
    'pool_percentage', v_pool_pct,
    'suggested_pool_usd', v_suggested,
    'admob_days_count', v_days,
    'caps_missing', false,
    'pending_external_revenue_topup_usd', round(v_pending_topups, 2),
    'pending_external_revenue_topup_count', v_pending_count,
    'combined_suggested_pool_usd', round(v_suggested + v_pending_topups, 2)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Monthly conversion: consume pending external-revenue topups into pool
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_distribute_contribution_rewards(date, numeric);

CREATE OR REPLACE FUNCTION public.admin_distribute_contribution_rewards(
  p_period_date date,
  p_reward_pool_usd numeric,
  p_include_external_revenue_topups boolean DEFAULT true
)
RETURNS TABLE (
  success boolean,
  total_distributed_usd numeric,
  distributed_count integer,
  scaling_applied boolean,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_is_admin boolean;
  v_total_points bigint;
  v_conversion_history_id uuid;
  v_users_rewarded integer := 0;
  v_total_distributed numeric := 0;
  v_conversion_rate numeric;
  v_min_points integer;
  v_scaling_applied boolean := false;
  v_actual_rate numeric;
  v_external_topup numeric := 0;
  v_effective_pool numeric;
BEGIN
  IF auth.role() = 'service_role' THEN
    v_admin_id := NULL;
    v_is_admin := true;
  ELSE
    v_admin_id := auth.uid();

    IF v_admin_id IS NULL THEN
      RAISE EXCEPTION 'Authentication failed: No user session found. Please ensure you are logged in.';
    END IF;

    SELECT (role = 'admin') INTO v_is_admin
    FROM users
    WHERE id = v_admin_id;

    IF NOT COALESCE(v_is_admin, false) THEN
      RAISE EXCEPTION 'Permission denied: Admin role required. Current user is not an admin.';
    END IF;
  END IF;

  IF p_period_date IS NULL THEN
    RAISE EXCEPTION 'Invalid input: Period date cannot be NULL';
  END IF;

  IF p_reward_pool_usd IS NULL OR p_reward_pool_usd < 0 THEN
    RAISE EXCEPTION 'Invalid input: Reward pool cannot be negative';
  END IF;

  IF COALESCE(p_include_external_revenue_topups, true) THEN
    WITH consumed AS (
      UPDATE public.external_revenue_contribution_pool_topups
      SET status = 'consumed',
          consumed_for_period_date = p_period_date,
          consumed_at = now(),
          consumed_by = v_admin_id
      WHERE status = 'pending'
      RETURNING amount_usd
    )
    SELECT COALESCE(SUM(amount_usd), 0) INTO v_external_topup FROM consumed;
  END IF;

  v_effective_pool := COALESCE(p_reward_pool_usd, 0) + COALESCE(v_external_topup, 0);

  IF v_effective_pool <= 0 THEN
    RAISE EXCEPTION 'Invalid input: Reward pool must be greater than 0 (base % + external topups %)',
      p_reward_pool_usd, v_external_topup;
  END IF;

  SELECT
    cs.conversion_rate,
    cs.minimum_points_for_payout
  INTO v_conversion_rate, v_min_points
  FROM contribution_conversion_settings cs
  WHERE cs.is_active = true
  ORDER BY cs.updated_at DESC
  LIMIT 1;

  v_conversion_rate := COALESCE(v_conversion_rate, 0.001);
  v_min_points := COALESCE(v_min_points, 10);

  SELECT COALESCE(SUM(lcs.current_period_points), 0) INTO v_total_points
  FROM listener_contribution_scores lcs
  WHERE lcs.current_period_points >= v_min_points;

  IF v_total_points = 0 THEN
    RETURN QUERY SELECT
      true::boolean,
      0::numeric,
      0::integer,
      false::boolean,
      CASE
        WHEN v_external_topup > 0 THEN
          format(
            'No eligible users found with minimum points. %s USD external-revenue topups were consumed but not distributed.',
            round(v_external_topup, 2)
          )
        ELSE
          'No eligible users found with minimum points'::text
      END;
    RETURN;
  END IF;

  IF (v_total_points * v_conversion_rate) > v_effective_pool THEN
    v_scaling_applied := true;
    v_actual_rate := v_effective_pool / v_total_points;
  ELSE
    v_actual_rate := v_conversion_rate;
  END IF;

  INSERT INTO contribution_conversion_history (
    conversion_date,
    reward_pool_usd,
    external_revenue_topup_usd,
    total_points_converted,
    total_users_paid,
    conversion_rate_used,
    actual_rate_applied,
    scaling_applied,
    total_distributed_usd,
    executed_by,
    status
  )
  VALUES (
    p_period_date,
    v_effective_pool,
    COALESCE(v_external_topup, 0),
    v_total_points,
    0,
    v_conversion_rate,
    v_actual_rate,
    v_scaling_applied,
    0,
    v_admin_id,
    'processing'
  )
  RETURNING id INTO v_conversion_history_id;

  CREATE TEMP TABLE earnings_updates AS
  SELECT
    lcs.user_id,
    lcs.current_period_points AS total_points,
    ROUND((lcs.current_period_points * v_actual_rate)::numeric, 2) AS reward_amount_usd
  FROM listener_contribution_scores lcs
  WHERE lcs.current_period_points >= v_min_points;

  UPDATE users u
  SET
    total_earnings = COALESCE(u.total_earnings, 0) + eu.reward_amount_usd,
    updated_at = NOW()
  FROM earnings_updates eu
  WHERE u.id = eu.user_id;

  SELECT COUNT(*)::integer, COALESCE(SUM(reward_amount_usd), 0)::numeric
  INTO v_users_rewarded, v_total_distributed
  FROM earnings_updates;

  INSERT INTO notifications (
    user_id, type, category, title, message, metadata, is_read
  )
  SELECT
    eu.user_id,
    'reward',
    'contribution_rewards',
    'Contribution Rewards Received',
    'You earned $' || eu.reward_amount_usd::text || ' from your ' || eu.total_points::text || ' contribution points this month!',
    jsonb_build_object(
      'conversion_history_id', v_conversion_history_id,
      'period_date', p_period_date,
      'amount_usd', eu.reward_amount_usd,
      'points_converted', eu.total_points,
      'source', 'contribution_rewards',
      'external_revenue_topup_usd', v_external_topup
    ),
    false
  FROM earnings_updates eu;

  UPDATE listener_contribution_scores lcs
  SET
    current_period_points = 0,
    last_reward_date = p_period_date,
    updated_at = NOW()
  FROM earnings_updates eu
  WHERE lcs.user_id = eu.user_id;

  UPDATE contribution_conversion_history
  SET
    total_users_paid = v_users_rewarded,
    total_distributed_usd = v_total_distributed,
    status = 'completed'
  WHERE id = v_conversion_history_id;

  DROP TABLE earnings_updates;

  RETURN QUERY SELECT
    true::boolean,
    v_total_distributed,
    v_users_rewarded,
    v_scaling_applied,
    CASE
      WHEN v_external_topup > 0 THEN
        format(
          'Conversion completed. Included $%s from external-revenue listener topups (base pool $%s). Notifications sent.',
          round(v_external_topup, 2),
          round(COALESCE(p_reward_pool_usd, 0), 2)
        )
      ELSE
        'Conversion completed successfully. Notifications sent to all recipients.'::text
    END;

EXCEPTION
  WHEN OTHERS THEN
    DROP TABLE IF EXISTS earnings_updates;

    IF v_conversion_history_id IS NOT NULL THEN
      UPDATE contribution_conversion_history
      SET status = 'failed', execution_notes = SQLERRM
      WHERE id = v_conversion_history_id;
    END IF;

    RAISE EXCEPTION 'Monthly conversion failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_distribute_contribution_rewards(date, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_distribute_contribution_rewards(date, numeric, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_distribute_contribution_rewards(date, numeric, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.admin_distribute_external_revenue_entry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_distribute_external_revenue_entry(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_preview_external_revenue_distribution(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_preview_external_revenue_distribution(uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_external_revenue_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_external_revenue_overview() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) External revenue distribute + preview + overview
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_distribute_external_revenue_entry(
  p_entry_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_entry record;
  v_split record;
  v_distribution_id uuid;
  v_creator_pool numeric;
  v_listener_pool numeric;
  v_platform_retained numeric;
  v_window_start date;
  v_window_end date;
  v_creators_paid integer := 0;
  v_listeners_paid integer := 0;
  v_topup_usd numeric := 0;
  v_creator_eligible integer := 0;
  v_listener_eligible integer := 0;
  v_status text := 'distributed';

  v_journal_id uuid;
  v_acct_cash uuid;
  v_acct_creator_pay uuid;
  v_acct_listener_pay uuid;
  v_acct_external_rev uuid;
BEGIN
  v_uid := auth.uid();
  IF NOT public.admin_external_revenue_is_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin role required');
  END IF;

  SELECT * INTO v_entry FROM public.external_revenue_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Entry not found');
  END IF;

  IF NOT v_entry.is_locked THEN
    RETURN jsonb_build_object('success', false, 'error', 'Entry must be locked before distribution');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.external_revenue_distributions WHERE entry_id = p_entry_id
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'already_distributed',
      'distribution_id', (SELECT id FROM public.external_revenue_distributions WHERE entry_id = p_entry_id LIMIT 1)
    );
  END IF;

  SELECT * INTO v_split
  FROM public.external_revenue_split_settings
  WHERE is_active = true AND source_id = v_entry.source_id
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_split.id IS NULL THEN
    SELECT * INTO v_split
    FROM public.external_revenue_split_settings
    WHERE is_active = true AND source_id IS NULL
    ORDER BY updated_at DESC
    LIMIT 1;
  END IF;

  IF v_split.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active split settings configured');
  END IF;

  v_creator_pool      := round((v_entry.distributable_amount_usd * v_split.creator_pool_percentage  / 100.0)::numeric, 4);
  v_listener_pool     := round((v_entry.distributable_amount_usd * v_split.listener_pool_percentage / 100.0)::numeric, 4);
  v_platform_retained := round((v_entry.net_amount_usd - v_entry.distributable_amount_usd)::numeric, 4);

  IF round((v_creator_pool + v_listener_pool)::numeric, 2)
     <> round(v_entry.distributable_amount_usd::numeric, 2) THEN
    v_listener_pool := round((v_entry.distributable_amount_usd - v_creator_pool)::numeric, 4);
  END IF;

  v_window_end := v_entry.entry_date;
  v_window_start := (v_entry.entry_date - (v_split.attribution_window_days || ' days')::interval)::date;

  IF v_creator_pool > 0 AND v_split.creator_attribution <> 'manual' THEN
    SELECT COUNT(*)::integer INTO v_creator_eligible
    FROM (
      SELECT s.artist_id
      FROM public.listening_history lh
      JOIN public.songs s ON s.id = lh.song_id
      WHERE s.artist_id IS NOT NULL
        AND lh.listened_at::date >= v_window_start
        AND lh.listened_at::date <= v_window_end
      GROUP BY s.artist_id
      HAVING COUNT(*) >= v_split.min_plays_for_creator_eligibility
    ) eligible;

    IF v_creator_eligible = 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', format(
          'Creator pool is $%s but no artists meet the eligibility threshold (%s+ plays between %s and %s). Adjust split settings or entry date, or switch to manual creator attribution.',
          round(v_creator_pool, 2),
          v_split.min_plays_for_creator_eligibility,
          v_window_start,
          v_window_end
        )
      );
    END IF;
  END IF;

  IF v_listener_pool > 0 AND v_split.listener_attribution IN ('proportional_points', 'equal_active_listeners') THEN
    SELECT COUNT(*)::integer INTO v_listener_eligible
    FROM public.listener_contribution_scores
    WHERE current_period_points >= v_split.min_points_for_listener_eligibility;

    IF v_listener_eligible = 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', format(
          'Listener pool is $%s but no listeners meet the eligibility threshold (%s+ points). Adjust settings or use feed_contribution_pool mode.',
          round(v_listener_pool, 2),
          v_split.min_points_for_listener_eligibility
        )
      );
    END IF;
  END IF;

  IF v_split.creator_attribution = 'manual' AND v_creator_pool > 0 THEN
    v_status := 'partial';
  END IF;

  INSERT INTO public.external_revenue_distributions (
    entry_id, net_amount_usd, distributable_amount_usd,
    creator_pool_usd, listener_pool_usd, platform_retained_usd,
    creator_attribution, listener_attribution,
    attribution_window_days, attribution_window_start, attribution_window_end,
    status, executed_by
  ) VALUES (
    p_entry_id, v_entry.net_amount_usd, v_entry.distributable_amount_usd,
    v_creator_pool, v_listener_pool, v_platform_retained,
    v_split.creator_attribution, v_split.listener_attribution,
    v_split.attribution_window_days, v_window_start, v_window_end,
    v_status, v_uid
  )
  RETURNING id INTO v_distribution_id;

  IF v_creator_pool > 0 AND v_split.creator_attribution <> 'manual' THEN
    WITH plays AS (
      SELECT s.artist_id, COUNT(*)::numeric AS plays_count
      FROM public.listening_history lh
      JOIN public.songs s ON s.id = lh.song_id
      WHERE s.artist_id IS NOT NULL
        AND lh.listened_at::date >= v_window_start
        AND lh.listened_at::date <= v_window_end
      GROUP BY s.artist_id
      HAVING COUNT(*) >= v_split.min_plays_for_creator_eligibility
    ),
    ranked AS (
      SELECT
        artist_id,
        plays_count,
        CASE WHEN v_split.creator_attribution = 'plays_in_period' THEN plays_count ELSE 1 END AS metric
      FROM plays
    ),
    sums AS (SELECT SUM(metric) AS total FROM ranked),
    inserts AS (
      INSERT INTO public.external_revenue_creator_payouts (
        distribution_id, artist_id, attribution_metric_value, payout_usd
      )
      SELECT
        v_distribution_id,
        r.artist_id,
        r.metric,
        round((v_creator_pool * r.metric / NULLIF(s.total, 0))::numeric, 4)
      FROM ranked r CROSS JOIN sums s
      WHERE COALESCE(s.total, 0) > 0
      RETURNING artist_id, payout_usd
    )
    SELECT COUNT(*)::integer INTO v_creators_paid FROM inserts;

    IF v_creators_paid > 0 THEN
      WITH artist_user_counts AS (
        SELECT artist_id, COUNT(DISTINCT user_id)::numeric AS cnt
        FROM public.artist_profiles
        WHERE artist_id IS NOT NULL AND user_id IS NOT NULL
        GROUP BY artist_id
      ),
      user_credits AS (
        SELECT
          ap.user_id,
          SUM(p.payout_usd / NULLIF(c.cnt, 0)) AS credit_usd
        FROM public.external_revenue_creator_payouts p
        JOIN public.artist_profiles ap ON ap.artist_id = p.artist_id
        JOIN artist_user_counts c ON c.artist_id = p.artist_id
        WHERE p.distribution_id = v_distribution_id
          AND ap.user_id IS NOT NULL
        GROUP BY ap.user_id
      )
      UPDATE public.users u
      SET total_earnings = COALESCE(u.total_earnings, 0) + uc.credit_usd,
          updated_at = now()
      FROM user_credits uc
      WHERE u.id = uc.user_id;
    END IF;
  END IF;

  IF v_listener_pool > 0 THEN
    IF v_split.listener_attribution = 'feed_contribution_pool' THEN
      INSERT INTO public.external_revenue_contribution_pool_topups (
        distribution_id, amount_usd, status
      ) VALUES (
        v_distribution_id, v_listener_pool, 'pending'
      );
      v_topup_usd := v_listener_pool;
      v_listeners_paid := 0;

    ELSIF v_split.listener_attribution = 'proportional_points' THEN
      WITH pts AS (
        SELECT user_id, current_period_points::numeric AS points
        FROM public.listener_contribution_scores
        WHERE current_period_points >= v_split.min_points_for_listener_eligibility
      ),
      sums AS (SELECT SUM(points) AS total FROM pts),
      inserts AS (
        INSERT INTO public.external_revenue_listener_payouts (
          distribution_id, user_id, attribution_metric_value, payout_usd
        )
        SELECT
          v_distribution_id,
          p.user_id,
          p.points,
          round((v_listener_pool * p.points / NULLIF(s.total, 0))::numeric, 4)
        FROM pts p CROSS JOIN sums s
        WHERE COALESCE(s.total, 0) > 0
        RETURNING user_id, payout_usd
      ),
      ensured AS (
        SELECT DISTINCT i.user_id FROM inserts i
      ),
      _ensure AS (
        SELECT public.ensure_treat_wallet(ew.user_id) FROM ensured ew
      ),
      wallet_updates AS (
        UPDATE public.treat_wallets tw
        SET balance = balance + i.payout_usd,
            earned_balance = earned_balance + i.payout_usd,
            total_earned = total_earned + i.payout_usd,
            updated_at = now()
        FROM inserts i
        WHERE tw.user_id = i.user_id
        RETURNING tw.user_id, i.payout_usd
      ),
      tx_inserts AS (
        INSERT INTO public.treat_transactions (
          user_id, transaction_type, amount,
          balance_before, balance_after,
          description, metadata, status
        )
        SELECT
          wu.user_id, 'external_revenue_reward', wu.payout_usd,
          tw.balance - wu.payout_usd, tw.balance,
          'External revenue distribution',
          jsonb_build_object(
            'source', 'external_revenue',
            'distribution_id', v_distribution_id,
            'entry_id', p_entry_id,
            'attribution', 'proportional_points'
          ),
          'completed'
        FROM wallet_updates wu
        JOIN public.treat_wallets tw ON tw.user_id = wu.user_id
        RETURNING user_id, amount
      )
      SELECT COUNT(*)::integer INTO v_listeners_paid FROM tx_inserts;

    ELSIF v_split.listener_attribution = 'equal_active_listeners' THEN
      WITH eligible AS (
        SELECT user_id
        FROM public.listener_contribution_scores
        WHERE current_period_points >= v_split.min_points_for_listener_eligibility
      ),
      cnt AS (SELECT COUNT(*)::numeric AS total FROM eligible),
      inserts AS (
        INSERT INTO public.external_revenue_listener_payouts (
          distribution_id, user_id, attribution_metric_value, payout_usd
        )
        SELECT
          v_distribution_id,
          e.user_id,
          1,
          round((v_listener_pool / NULLIF(c.total, 0))::numeric, 4)
        FROM eligible e CROSS JOIN cnt c
        WHERE COALESCE(c.total, 0) > 0
        RETURNING user_id, payout_usd
      ),
      ensured AS (
        SELECT DISTINCT i.user_id FROM inserts i
      ),
      _ensure AS (
        SELECT public.ensure_treat_wallet(ew.user_id) FROM ensured ew
      ),
      wallet_updates AS (
        UPDATE public.treat_wallets tw
        SET balance = balance + i.payout_usd,
            earned_balance = earned_balance + i.payout_usd,
            total_earned = total_earned + i.payout_usd,
            updated_at = now()
        FROM inserts i
        WHERE tw.user_id = i.user_id
        RETURNING tw.user_id, i.payout_usd
      ),
      tx_inserts AS (
        INSERT INTO public.treat_transactions (
          user_id, transaction_type, amount,
          balance_before, balance_after,
          description, metadata, status
        )
        SELECT
          wu.user_id, 'external_revenue_reward', wu.payout_usd,
          tw.balance - wu.payout_usd, tw.balance,
          'External revenue distribution',
          jsonb_build_object(
            'source', 'external_revenue',
            'distribution_id', v_distribution_id,
            'entry_id', p_entry_id,
            'attribution', 'equal_active_listeners'
          ),
          'completed'
        FROM wallet_updates wu
        JOIN public.treat_wallets tw ON tw.user_id = wu.user_id
        RETURNING user_id, amount
      )
      SELECT COUNT(*)::integer INTO v_listeners_paid FROM tx_inserts;
    END IF;
  END IF;

  v_acct_cash         := public.accounting_get_account_id('1000');
  v_acct_creator_pay  := public.accounting_get_account_id('2000');
  v_acct_listener_pay := public.accounting_get_account_id('2050');
  v_acct_external_rev := public.accounting_get_account_id('4020');

  IF v_acct_cash IS NULL OR v_acct_creator_pay IS NULL
     OR v_acct_listener_pay IS NULL OR v_acct_external_rev IS NULL THEN
    RAISE EXCEPTION 'Missing required COA accounts (1000/2000/2050/4020) for external revenue posting';
  END IF;

  INSERT INTO public.accounting_journal_entries (entry_date, source_type, source_id, memo)
  VALUES (
    v_entry.entry_date,
    'external_revenue_distribution',
    v_distribution_id::text,
    'External revenue cash + distribution split'
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, revenue_date)
  VALUES (v_journal_id, v_acct_cash, v_entry.net_amount_usd, 0, v_entry.entry_date);

  INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, revenue_date)
  VALUES (v_journal_id, v_acct_external_rev, 0, v_entry.net_amount_usd, v_entry.entry_date);

  IF v_entry.distributable_amount_usd > 0 THEN
    INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, revenue_date)
    VALUES (v_journal_id, v_acct_external_rev, v_entry.distributable_amount_usd, 0, v_entry.entry_date);

    IF v_creator_pool > 0 THEN
      INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, revenue_date)
      VALUES (v_journal_id, v_acct_creator_pay, 0, v_creator_pool, v_entry.entry_date);
    END IF;
    IF v_listener_pool > 0 THEN
      INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, revenue_date)
      VALUES (v_journal_id, v_acct_listener_pay, 0, v_listener_pool, v_entry.entry_date);
    END IF;
  END IF;

  UPDATE public.external_revenue_distributions
  SET creators_paid_count = v_creators_paid,
      listeners_paid_count = v_listeners_paid,
      contribution_pool_topup_usd = v_topup_usd
  WHERE id = v_distribution_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_status,
    'distribution_id', v_distribution_id,
    'creator_pool_usd', v_creator_pool,
    'listener_pool_usd', v_listener_pool,
    'platform_retained_usd', v_platform_retained,
    'creators_paid', v_creators_paid,
    'listeners_paid', v_listeners_paid,
    'contribution_pool_topup_usd', v_topup_usd,
    'journal_entry_id', v_journal_id,
    'creator_attribution', v_split.creator_attribution,
    'manual_creator_pending', (v_split.creator_attribution = 'manual' AND v_creator_pool > 0)
  );
END;
$$;

-- Preview: add warnings + align rounding
CREATE OR REPLACE FUNCTION public.admin_preview_external_revenue_distribution(
  p_entry_id uuid,
  p_sample_size integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_entry record;
  v_split record;
  v_creator_pool numeric;
  v_listener_pool numeric;
  v_platform_retained numeric;
  v_window_start date;
  v_window_end date;
  v_total_creator_metric numeric := 0;
  v_total_listener_metric numeric := 0;
  v_creator_count integer := 0;
  v_listener_count integer := 0;
  v_creator_samples jsonb := '[]'::jsonb;
  v_listener_samples jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_blocking jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.admin_external_revenue_is_finance_role() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT * INTO v_entry FROM public.external_revenue_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Entry not found');
  END IF;

  SELECT * INTO v_split
  FROM public.external_revenue_split_settings
  WHERE is_active = true AND source_id = v_entry.source_id
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_split.id IS NULL THEN
    SELECT * INTO v_split
    FROM public.external_revenue_split_settings
    WHERE is_active = true AND source_id IS NULL
    ORDER BY updated_at DESC
    LIMIT 1;
  END IF;

  IF v_split.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active split settings configured');
  END IF;

  v_creator_pool      := round((v_entry.distributable_amount_usd * v_split.creator_pool_percentage  / 100.0)::numeric, 4);
  v_listener_pool     := round((v_entry.distributable_amount_usd * v_split.listener_pool_percentage / 100.0)::numeric, 4);
  v_platform_retained := round((v_entry.net_amount_usd - v_entry.distributable_amount_usd)::numeric, 4);

  IF round((v_creator_pool + v_listener_pool)::numeric, 2)
     <> round(v_entry.distributable_amount_usd::numeric, 2) THEN
    v_listener_pool := round((v_entry.distributable_amount_usd - v_creator_pool)::numeric, 4);
  END IF;

  v_window_end := v_entry.entry_date;
  v_window_start := (v_entry.entry_date - (v_split.attribution_window_days || ' days')::interval)::date;

  IF v_split.creator_attribution = 'manual' AND v_creator_pool > 0 THEN
    v_warnings := v_warnings || jsonb_build_array(
      jsonb_build_object(
        'code', 'manual_creator',
        'message', format('Creator pool $%s will be reserved for manual assignment (no automatic artist payouts).', round(v_creator_pool, 2))
      )
    );
  ELSIF v_split.creator_attribution IN ('plays_in_period', 'equal_active') THEN
    WITH plays AS (
      SELECT s.artist_id, COUNT(*)::numeric AS plays_count
      FROM public.listening_history lh
      JOIN public.songs s ON s.id = lh.song_id
      WHERE s.artist_id IS NOT NULL
        AND lh.listened_at::date >= v_window_start
        AND lh.listened_at::date <= v_window_end
      GROUP BY s.artist_id
      HAVING COUNT(*) >= v_split.min_plays_for_creator_eligibility
    )
    SELECT COALESCE(SUM(
              CASE WHEN v_split.creator_attribution = 'plays_in_period' THEN plays_count ELSE 1 END
            ), 0),
           COUNT(*)
      INTO v_total_creator_metric, v_creator_count
    FROM plays;

    IF v_creator_pool > 0 AND v_creator_count = 0 THEN
      v_blocking := v_blocking || jsonb_build_array(
        jsonb_build_object(
          'code', 'no_eligible_creators',
          'message', format(
            'Creator pool $%s but no artists with %s+ plays between %s and %s.',
            round(v_creator_pool, 2),
            v_split.min_plays_for_creator_eligibility,
            v_window_start,
            v_window_end
          )
        )
      );
    END IF;

    IF v_creator_count > 0 AND v_creator_pool > 0 THEN
      SELECT COALESCE(jsonb_agg(row_obj ORDER BY metric DESC NULLS LAST), '[]'::jsonb)
      INTO v_creator_samples
      FROM (
        WITH plays AS (
          SELECT s.artist_id, COUNT(*)::numeric AS plays_count
          FROM public.listening_history lh
          JOIN public.songs s ON s.id = lh.song_id
          WHERE s.artist_id IS NOT NULL
            AND lh.listened_at::date >= v_window_start
            AND lh.listened_at::date <= v_window_end
          GROUP BY s.artist_id
          HAVING COUNT(*) >= v_split.min_plays_for_creator_eligibility
        ),
        ranked AS (
          SELECT a.artist_id, a.plays_count,
                 CASE WHEN v_split.creator_attribution = 'plays_in_period' THEN a.plays_count ELSE 1 END AS metric
          FROM plays a
        ),
        sums AS (SELECT SUM(metric) AS total FROM ranked)
        SELECT
          r.metric AS metric,
          jsonb_build_object(
            'artist_id', r.artist_id,
            'plays_count', r.plays_count,
            'metric', r.metric,
            'estimated_payout_usd', round((v_creator_pool * r.metric / NULLIF(s.total, 0))::numeric, 4)
          ) AS row_obj
        FROM ranked r CROSS JOIN sums s
        ORDER BY r.metric DESC NULLS LAST
        LIMIT GREATEST(0, COALESCE(p_sample_size, 25))
      ) q;
    END IF;
  END IF;

  IF v_split.listener_attribution = 'feed_contribution_pool' THEN
    v_listener_count := 0;
    IF v_listener_pool > 0 THEN
      v_listener_samples := jsonb_build_array(jsonb_build_object(
        'note', 'Listener pool will be added to the next monthly contribution conversion (auto-included in reward pool).',
        'topup_usd', v_listener_pool
      ));
    END IF;
  ELSIF v_split.listener_attribution = 'proportional_points' THEN
    WITH pts AS (
      SELECT user_id, current_period_points
      FROM public.listener_contribution_scores
      WHERE current_period_points >= v_split.min_points_for_listener_eligibility
    )
    SELECT COALESCE(SUM(current_period_points), 0), COUNT(*)
      INTO v_total_listener_metric, v_listener_count
    FROM pts;

    IF v_listener_pool > 0 AND v_listener_count = 0 THEN
      v_blocking := v_blocking || jsonb_build_array(
        jsonb_build_object(
          'code', 'no_eligible_listeners',
          'message', format(
            'Listener pool $%s but no listeners with %s+ contribution points.',
            round(v_listener_pool, 2),
            v_split.min_points_for_listener_eligibility
          )
        )
      );
    END IF;

    IF v_listener_count > 0 AND v_listener_pool > 0 THEN
      SELECT COALESCE(jsonb_agg(row_obj ORDER BY pts_value DESC NULLS LAST), '[]'::jsonb)
      INTO v_listener_samples
      FROM (
        WITH pts AS (
          SELECT user_id, current_period_points::numeric AS pts_value
          FROM public.listener_contribution_scores
          WHERE current_period_points >= v_split.min_points_for_listener_eligibility
        ),
        sums AS (SELECT SUM(pts_value) AS total FROM pts)
        SELECT
          p.pts_value AS pts_value,
          jsonb_build_object(
            'user_id', p.user_id,
            'points', p.pts_value,
            'estimated_payout_usd', round((v_listener_pool * p.pts_value / NULLIF(s.total, 0))::numeric, 4)
          ) AS row_obj
        FROM pts p CROSS JOIN sums s
        ORDER BY p.pts_value DESC NULLS LAST
        LIMIT GREATEST(0, COALESCE(p_sample_size, 25))
      ) q;
    END IF;
  ELSIF v_split.listener_attribution = 'equal_active_listeners' THEN
    SELECT COUNT(*)::integer, COUNT(*)::numeric
      INTO v_listener_count, v_total_listener_metric
    FROM public.listener_contribution_scores
    WHERE current_period_points >= v_split.min_points_for_listener_eligibility;

    IF v_listener_pool > 0 AND v_listener_count = 0 THEN
      v_blocking := v_blocking || jsonb_build_array(
        jsonb_build_object(
          'code', 'no_eligible_listeners',
          'message', format(
            'Listener pool $%s but no listeners with %s+ contribution points.',
            round(v_listener_pool, 2),
            v_split.min_points_for_listener_eligibility
          )
        )
      );
    END IF;

    IF v_listener_count > 0 AND v_listener_pool > 0 THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'user_id', user_id,
        'estimated_payout_usd', round((v_listener_pool / v_listener_count)::numeric, 4)
      )), '[]'::jsonb)
      INTO v_listener_samples
      FROM (
        SELECT user_id
        FROM public.listener_contribution_scores
        WHERE current_period_points >= v_split.min_points_for_listener_eligibility
        ORDER BY current_period_points DESC NULLS LAST
        LIMIT GREATEST(0, COALESCE(p_sample_size, 25))
      ) q;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'entry', jsonb_build_object(
      'id', v_entry.id,
      'entry_date', v_entry.entry_date,
      'source_id', v_entry.source_id,
      'gross_amount_usd', v_entry.gross_amount_usd,
      'fees_usd', v_entry.fees_usd,
      'net_amount_usd', v_entry.net_amount_usd,
      'distributable_amount_usd', v_entry.distributable_amount_usd,
      'is_locked', v_entry.is_locked
    ),
    'split', jsonb_build_object(
      'creator_pool_percentage', v_split.creator_pool_percentage,
      'listener_pool_percentage', v_split.listener_pool_percentage,
      'creator_attribution', v_split.creator_attribution,
      'listener_attribution', v_split.listener_attribution,
      'attribution_window_days', v_split.attribution_window_days,
      'attribution_window_start', v_window_start,
      'attribution_window_end', v_window_end
    ),
    'pools', jsonb_build_object(
      'creator_pool_usd', v_creator_pool,
      'listener_pool_usd', v_listener_pool,
      'platform_retained_usd', v_platform_retained
    ),
    'counts', jsonb_build_object(
      'creators_eligible', v_creator_count,
      'listeners_eligible', v_listener_count
    ),
    'samples', jsonb_build_object(
      'creators', v_creator_samples,
      'listeners', v_listener_samples
    ),
    'warnings', v_warnings,
    'blocking_errors', v_blocking,
    'can_distribute', (jsonb_array_length(v_blocking) = 0)
  );
END;
$$;

-- Overview KPIs from actual payout rows
CREATE OR REPLACE FUNCTION public.admin_external_revenue_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_total_net numeric := 0;
  v_total_distributable numeric := 0;
  v_total_distributed numeric := 0;
  v_creator_paid numeric := 0;
  v_listener_direct_paid numeric := 0;
  v_listener_topup_allocated numeric := 0;
  v_platform_retained numeric := 0;
  v_pending_topups numeric := 0;
  v_unlocked_count integer := 0;
  v_locked_undistributed integer := 0;
  v_distributed_count integer := 0;
BEGIN
  IF NOT public.admin_external_revenue_is_finance_role() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT COALESCE(SUM(net_amount_usd), 0),
         COALESCE(SUM(distributable_amount_usd), 0)
    INTO v_total_net, v_total_distributable
  FROM public.external_revenue_entries;

  SELECT
    COALESCE(SUM(d.platform_retained_usd), 0),
    COALESCE(SUM(d.creator_pool_usd + d.listener_pool_usd), 0),
    COALESCE(SUM(d.contribution_pool_topup_usd), 0),
    COUNT(*) FILTER (WHERE d.status IN ('distributed', 'partial'))
  INTO v_platform_retained, v_total_distributed, v_listener_topup_allocated, v_distributed_count
  FROM public.external_revenue_distributions d
  WHERE d.status IN ('distributed', 'partial');

  SELECT COALESCE(SUM(p.payout_usd), 0) INTO v_creator_paid
  FROM public.external_revenue_creator_payouts p
  JOIN public.external_revenue_distributions d ON d.id = p.distribution_id
  WHERE d.status IN ('distributed', 'partial');

  SELECT COALESCE(SUM(p.payout_usd), 0) INTO v_listener_direct_paid
  FROM public.external_revenue_listener_payouts p
  JOIN public.external_revenue_distributions d ON d.id = p.distribution_id
  WHERE d.status IN ('distributed', 'partial');

  SELECT COALESCE(SUM(amount_usd), 0)
    INTO v_pending_topups
  FROM public.external_revenue_contribution_pool_topups
  WHERE status = 'pending';

  SELECT COUNT(*) FILTER (WHERE NOT e.is_locked),
         COUNT(*) FILTER (WHERE e.is_locked AND NOT EXISTS (
            SELECT 1 FROM public.external_revenue_distributions d WHERE d.entry_id = e.id))
    INTO v_unlocked_count, v_locked_undistributed
  FROM public.external_revenue_entries e;

  RETURN jsonb_build_object(
    'success', true,
    'totals', jsonb_build_object(
      'net_revenue_usd', round(v_total_net::numeric, 2),
      'distributable_usd', round(v_total_distributable::numeric, 2),
      'distributed_usd', round(v_total_distributed::numeric, 2),
      'creator_paid_usd', round(v_creator_paid::numeric, 2),
      'listener_direct_paid_usd', round(v_listener_direct_paid::numeric, 2),
      'listener_pool_topup_usd', round(v_listener_topup_allocated::numeric, 2),
      'listener_paid_usd', round(v_listener_direct_paid::numeric, 2),
      'platform_retained_usd', round(v_platform_retained::numeric, 2),
      'pending_topups_usd', round(v_pending_topups::numeric, 2)
    ),
    'counts', jsonb_build_object(
      'unlocked_entries', v_unlocked_count,
      'locked_undistributed_entries', v_locked_undistributed,
      'distributions', v_distributed_count
    )
  );
END;
$$;
