/*
  # External Revenue Sharing — Distribute, Accounting Post, Reverse, Consume

  RPCs:
    - admin_distribute_external_revenue_entry(entry_id)
        Atomically:
          - validates entry is LOCKED and not already distributed
          - resolves split (per-source then default)
          - computes pools (creator/listener/platform retained)
          - inserts external_revenue_distributions header
          - creates per-creator payout audit rows and CREDITS users.total_earnings
          - listener side:
              * 'feed_contribution_pool' → creates a pending topup row
              * 'proportional_points'     → credits treat_wallets + logs treat_transactions
              * 'equal_active_listeners'  → credits treat_wallets + logs treat_transactions
          - posts ONE balanced accounting journal entry
              * Debit  Cash 1000                          = net
              * Credit ExternalRevenue 4020               = net
              * Debit  ExternalRevenue 4020               = distributable
              * Credit CreatorBalancesPayable 2000        = creator_pool
              * Credit ListenerBalancesPayable 2050       = listener_pool

    - admin_consume_external_revenue_topups(period_date)
        Optional helper — sums all pending topups, marks them consumed for the
        given period, and returns the bonus USD to add to the contribution pool.

    - admin_reverse_external_revenue_distribution(distribution_id, reason)
        Reverses a distribution by creating a NEW distribution row with status
        'reversed', deducts creator/listener balances (clamped at 0), posts a
        compensating journal entry, marks topups as reversed.
*/

-- ============================================================================
-- admin_distribute_external_revenue_entry
-- ============================================================================

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

  v_journal_id uuid;
  v_acct_cash uuid;
  v_acct_creator_pay uuid;
  v_acct_listener_pay uuid;
  v_acct_external_rev uuid;

  v_creator_assigned numeric := 0;
  v_listener_assigned numeric := 0;
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

  -- Resolve split (per-source first, then default)
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

  -- Force pools to exactly equal distributable (avoid rounding drift)
  IF round((v_creator_pool + v_listener_pool)::numeric, 2)
     <> round(v_entry.distributable_amount_usd::numeric, 2) THEN
    v_listener_pool := round((v_entry.distributable_amount_usd - v_creator_pool)::numeric, 4);
  END IF;

  v_window_end := v_entry.entry_date;
  v_window_start := (v_entry.entry_date - (v_split.attribution_window_days || ' days')::interval)::date;

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
    'distributed', v_uid
  )
  RETURNING id INTO v_distribution_id;

  -- ----------------------------------------------------------------
  -- CREATOR side: insert payouts and credit users.total_earnings
  -- ----------------------------------------------------------------
  IF v_creator_pool > 0 THEN
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
    SELECT COUNT(*)::integer, COALESCE(SUM(payout_usd), 0)
      INTO v_creators_paid, v_creator_assigned
    FROM inserts;

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

  -- ----------------------------------------------------------------
  -- LISTENER side: branch by attribution method
  -- ----------------------------------------------------------------
  IF v_listener_pool > 0 THEN
    IF v_split.listener_attribution = 'feed_contribution_pool' THEN
      INSERT INTO public.external_revenue_contribution_pool_topups (
        distribution_id, amount_usd, status
      ) VALUES (
        v_distribution_id, v_listener_pool, 'pending'
      );
      v_topup_usd := v_listener_pool;
      v_listeners_paid := 0; -- will pay out via monthly conversion later

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
      SELECT COUNT(*)::integer, COALESCE(SUM(amount), 0)
        INTO v_listeners_paid, v_listener_assigned
      FROM tx_inserts;

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
      SELECT COUNT(*)::integer, COALESCE(SUM(amount), 0)
        INTO v_listeners_paid, v_listener_assigned
      FROM tx_inserts;
    END IF;
  END IF;

  -- ----------------------------------------------------------------
  -- ACCOUNTING JOURNAL — single balanced entry, idempotent by source_id
  -- ----------------------------------------------------------------
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

  -- Cash receipt
  INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, revenue_date)
  VALUES (v_journal_id, v_acct_cash, v_entry.net_amount_usd, 0, v_entry.entry_date);
  -- Revenue recognition (gross of distribution)
  INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, revenue_date)
  VALUES (v_journal_id, v_acct_external_rev, 0, v_entry.net_amount_usd, v_entry.entry_date);

  -- Move distributable portion out of revenue into payables
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

  -- ----------------------------------------------------------------
  -- Final summary update
  -- ----------------------------------------------------------------
  UPDATE public.external_revenue_distributions
  SET creators_paid_count = v_creators_paid,
      listeners_paid_count = v_listeners_paid,
      contribution_pool_topup_usd = v_topup_usd
  WHERE id = v_distribution_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'distributed',
    'distribution_id', v_distribution_id,
    'creator_pool_usd', v_creator_pool,
    'listener_pool_usd', v_listener_pool,
    'platform_retained_usd', v_platform_retained,
    'creators_paid', v_creators_paid,
    'listeners_paid', v_listeners_paid,
    'contribution_pool_topup_usd', v_topup_usd,
    'journal_entry_id', v_journal_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_distribute_external_revenue_entry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_distribute_external_revenue_entry(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_distribute_external_revenue_entry(uuid) IS
  'Admin-only. Distributes a LOCKED external revenue entry. Idempotent per entry. Posts a balanced double-entry journal.';

-- ============================================================================
-- admin_consume_external_revenue_topups
-- Optional helper. Returns total pending USD to add to a contribution pool and
-- marks all pending topups as consumed. Call this BEFORE running the monthly
-- contribution conversion if you want external revenue to top it up.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_consume_external_revenue_topups(
  p_period_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_total numeric := 0;
  v_count integer := 0;
BEGIN
  v_uid := auth.uid();
  IF NOT public.admin_external_revenue_is_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin role required');
  END IF;

  IF p_period_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'period_date is required');
  END IF;

  WITH consumed AS (
    UPDATE public.external_revenue_contribution_pool_topups
    SET status = 'consumed',
        consumed_for_period_date = p_period_date,
        consumed_at = now(),
        consumed_by = v_uid
    WHERE status = 'pending'
    RETURNING amount_usd
  )
  SELECT COALESCE(SUM(amount_usd), 0), COUNT(*) INTO v_total, v_count FROM consumed;

  RETURN jsonb_build_object(
    'success', true,
    'consumed_count', v_count,
    'total_amount_usd', round(v_total::numeric, 2)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_consume_external_revenue_topups(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_consume_external_revenue_topups(date) TO authenticated;

-- ============================================================================
-- admin_get_pending_external_revenue_topup_total
-- Read-only summary used by the Monthly Conversion screen to show admin the
-- bonus USD available.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_pending_external_revenue_topup_total()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'success', true,
    'pending_count', COUNT(*),
    'pending_total_usd', COALESCE(SUM(amount_usd), 0)
  )
  FROM public.external_revenue_contribution_pool_topups
  WHERE status = 'pending';
$$;

REVOKE ALL ON FUNCTION public.admin_get_pending_external_revenue_topup_total() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_pending_external_revenue_topup_total() TO authenticated;

-- ============================================================================
-- admin_reverse_external_revenue_distribution
-- Creates a compensating distribution + journal entry, debits balances back
-- (clamped at 0), marks topups as reversed if still pending.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_reverse_external_revenue_distribution(
  p_distribution_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_orig record;
  v_new_id uuid;
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

  SELECT * INTO v_orig FROM public.external_revenue_distributions WHERE id = p_distribution_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Distribution not found');
  END IF;
  IF v_orig.status = 'reversed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already reversed');
  END IF;

  -- New audit row representing the reversal (NULL entry_id is not allowed because of UNIQUE+NOT NULL;
  -- instead we link via reverses_distribution_id and reuse the same entry_id).
  -- Distribution.entry_id is UNIQUE, so we must temporarily violate it. To avoid that
  -- we model the reversal as a status change + journal entry, NOT a new row.
  UPDATE public.external_revenue_distributions
  SET status = 'reversed',
      reversal_reason = p_reason,
      executed_by = v_uid
  WHERE id = p_distribution_id;

  -- Reverse creator credits (clamp at 0)
  WITH artist_user_counts AS (
    SELECT artist_id, COUNT(DISTINCT user_id)::numeric AS cnt
    FROM public.artist_profiles
    WHERE artist_id IS NOT NULL AND user_id IS NOT NULL
    GROUP BY artist_id
  ),
  user_debits AS (
    SELECT
      ap.user_id,
      SUM(p.payout_usd / NULLIF(c.cnt, 0)) AS debit_usd
    FROM public.external_revenue_creator_payouts p
    JOIN public.artist_profiles ap ON ap.artist_id = p.artist_id
    JOIN artist_user_counts c ON c.artist_id = p.artist_id
    WHERE p.distribution_id = p_distribution_id
      AND ap.user_id IS NOT NULL
    GROUP BY ap.user_id
  )
  UPDATE public.users u
  SET total_earnings = GREATEST(0, COALESCE(u.total_earnings, 0) - ud.debit_usd),
      updated_at = now()
  FROM user_debits ud
  WHERE u.id = ud.user_id;

  -- Reverse listener direct credits (only Mode B; Mode A topups are reversed separately)
  WITH wallet_debits AS (
    UPDATE public.treat_wallets tw
    SET balance = GREATEST(0, balance - p.payout_usd),
        earned_balance = GREATEST(0, earned_balance - p.payout_usd),
        updated_at = now()
    FROM public.external_revenue_listener_payouts p
    WHERE p.distribution_id = p_distribution_id
      AND tw.user_id = p.user_id
    RETURNING tw.user_id, p.payout_usd
  )
  INSERT INTO public.treat_transactions (
    user_id, transaction_type, amount,
    balance_before, balance_after,
    description, metadata, status
  )
  SELECT
    wd.user_id, 'external_revenue_reward', -wd.payout_usd,
    tw.balance + wd.payout_usd, tw.balance,
    'External revenue distribution reversed',
    jsonb_build_object(
      'source', 'external_revenue_reversal',
      'distribution_id', p_distribution_id,
      'reason', p_reason
    ),
    'completed'
  FROM wallet_debits wd
  JOIN public.treat_wallets tw ON tw.user_id = wd.user_id;

  -- Reverse pending topups (Mode A)
  UPDATE public.external_revenue_contribution_pool_topups
  SET status = 'reversed'
  WHERE distribution_id = p_distribution_id
    AND status = 'pending';

  -- Compensating journal entry (idempotent per reversed distribution)
  v_acct_cash         := public.accounting_get_account_id('1000');
  v_acct_creator_pay  := public.accounting_get_account_id('2000');
  v_acct_listener_pay := public.accounting_get_account_id('2050');
  v_acct_external_rev := public.accounting_get_account_id('4020');

  INSERT INTO public.accounting_journal_entries (entry_date, source_type, source_id, memo)
  VALUES (
    CURRENT_DATE,
    'external_revenue_distribution_reversal',
    p_distribution_id::text,
    COALESCE('External revenue reversal: ' || p_reason, 'External revenue reversal')
  )
  ON CONFLICT (source_type, source_id) DO NOTHING
  RETURNING id INTO v_journal_id;

  IF v_journal_id IS NOT NULL THEN
    -- Cash credit (cash decreases conceptually; in cash-basis reversals we
    -- credit cash and debit revenue back to pre-distribution state).
    INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, revenue_date)
    VALUES (v_journal_id, v_acct_cash, 0, v_orig.net_amount_usd, CURRENT_DATE);

    INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, revenue_date)
    VALUES (v_journal_id, v_acct_external_rev, v_orig.net_amount_usd, 0, CURRENT_DATE);

    IF v_orig.distributable_amount_usd > 0 THEN
      INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, revenue_date)
      VALUES (v_journal_id, v_acct_external_rev, 0, v_orig.distributable_amount_usd, CURRENT_DATE);

      IF v_orig.creator_pool_usd > 0 THEN
        INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, revenue_date)
        VALUES (v_journal_id, v_acct_creator_pay, v_orig.creator_pool_usd, 0, CURRENT_DATE);
      END IF;
      IF v_orig.listener_pool_usd > 0 THEN
        INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, revenue_date)
        VALUES (v_journal_id, v_acct_listener_pay, v_orig.listener_pool_usd, 0, CURRENT_DATE);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'distribution_id', p_distribution_id,
    'journal_entry_id', v_journal_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reverse_external_revenue_distribution(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reverse_external_revenue_distribution(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.admin_reverse_external_revenue_distribution(uuid, text) IS
  'Admin-only. Reverses an external revenue distribution: debits balances (clamped at 0), reverses pending topups, posts compensating journal entry.';

-- ============================================================================
-- admin_list_external_revenue_entries (paginated listing for the dashboard)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_list_external_revenue_entries(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_source_code text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_source_id uuid;
  v_rows jsonb;
  v_total integer;
BEGIN
  IF NOT public.admin_external_revenue_is_finance_role() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF p_source_code IS NOT NULL THEN
    SELECT id INTO v_source_id
    FROM public.external_revenue_sources
    WHERE code = p_source_code
    LIMIT 1;
  END IF;

  WITH base AS (
    SELECT
      e.*,
      s.code AS source_code,
      s.name AS source_name,
      (SELECT id FROM public.external_revenue_distributions d WHERE d.entry_id = e.id LIMIT 1) AS distribution_id,
      (SELECT status FROM public.external_revenue_distributions d WHERE d.entry_id = e.id LIMIT 1) AS distribution_status
    FROM public.external_revenue_entries e
    JOIN public.external_revenue_sources s ON s.id = e.source_id
    WHERE (v_source_id IS NULL OR e.source_id = v_source_id)
      AND (p_from_date IS NULL OR e.entry_date >= p_from_date)
      AND (p_to_date   IS NULL OR e.entry_date <= p_to_date)
      AND (
        p_status IS NULL
        OR (p_status = 'unlocked'    AND e.is_locked = false)
        OR (p_status = 'locked'      AND e.is_locked = true
            AND NOT EXISTS (SELECT 1 FROM public.external_revenue_distributions d WHERE d.entry_id = e.id))
        OR (p_status = 'distributed' AND EXISTS (SELECT 1 FROM public.external_revenue_distributions d WHERE d.entry_id = e.id AND d.status = 'distributed'))
        OR (p_status = 'reversed'    AND EXISTS (SELECT 1 FROM public.external_revenue_distributions d WHERE d.entry_id = e.id AND d.status = 'reversed'))
      )
  )
  SELECT COUNT(*)::int INTO v_total FROM base;

  SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.entry_date DESC, b.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      e.id, e.entry_date, e.source_id,
      s.code AS source_code, s.name AS source_name,
      e.gross_amount_usd, e.fees_usd, e.net_amount_usd,
      e.distributable_amount_usd,
      e.original_currency, e.fx_rate_to_usd,
      e.reference, e.notes,
      e.is_locked, e.locked_at, e.locked_by,
      e.created_by, e.created_at, e.updated_at,
      (SELECT jsonb_build_object(
                'id', d.id,
                'status', d.status,
                'creator_pool_usd', d.creator_pool_usd,
                'listener_pool_usd', d.listener_pool_usd,
                'platform_retained_usd', d.platform_retained_usd,
                'creators_paid_count', d.creators_paid_count,
                'listeners_paid_count', d.listeners_paid_count,
                'contribution_pool_topup_usd', d.contribution_pool_topup_usd,
                'executed_at', d.executed_at)
       FROM public.external_revenue_distributions d
       WHERE d.entry_id = e.id LIMIT 1) AS distribution
    FROM public.external_revenue_entries e
    JOIN public.external_revenue_sources s ON s.id = e.source_id
    WHERE (v_source_id IS NULL OR e.source_id = v_source_id)
      AND (p_from_date IS NULL OR e.entry_date >= p_from_date)
      AND (p_to_date   IS NULL OR e.entry_date <= p_to_date)
      AND (
        p_status IS NULL
        OR (p_status = 'unlocked'    AND e.is_locked = false)
        OR (p_status = 'locked'      AND e.is_locked = true
            AND NOT EXISTS (SELECT 1 FROM public.external_revenue_distributions d2 WHERE d2.entry_id = e.id))
        OR (p_status = 'distributed' AND EXISTS (SELECT 1 FROM public.external_revenue_distributions d3 WHERE d3.entry_id = e.id AND d3.status = 'distributed'))
        OR (p_status = 'reversed'    AND EXISTS (SELECT 1 FROM public.external_revenue_distributions d4 WHERE d4.entry_id = e.id AND d4.status = 'reversed'))
      )
    ORDER BY e.entry_date DESC, e.created_at DESC
    LIMIT GREATEST(0, LEAST(COALESCE(p_limit, 50), 200))
    OFFSET GREATEST(0, COALESCE(p_offset, 0))
  ) b;

  RETURN jsonb_build_object(
    'success', true,
    'total', v_total,
    'rows', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_external_revenue_entries(
  integer, integer, text, text, date, date
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_external_revenue_entries(
  integer, integer, text, text, date, date
) TO authenticated;

-- ============================================================================
-- admin_external_revenue_overview  (KPI tiles + summary)
-- ============================================================================

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
  v_listener_paid numeric := 0;
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
    COALESCE(SUM(d.creator_pool_usd), 0),
    COALESCE(SUM(d.listener_pool_usd), 0),
    COALESCE(SUM(d.platform_retained_usd), 0),
    COALESCE(SUM(d.creator_pool_usd + d.listener_pool_usd), 0),
    COUNT(*) FILTER (WHERE d.status = 'distributed')
  INTO v_creator_paid, v_listener_paid, v_platform_retained, v_total_distributed, v_distributed_count
  FROM public.external_revenue_distributions d
  WHERE d.status = 'distributed';

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
      'listener_paid_usd', round(v_listener_paid::numeric, 2),
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

REVOKE ALL ON FUNCTION public.admin_external_revenue_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_external_revenue_overview() TO authenticated;
