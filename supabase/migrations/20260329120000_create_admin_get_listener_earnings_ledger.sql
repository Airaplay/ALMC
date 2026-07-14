/*
  # Admin: Listener Earnings Ledger

  Exposes `admin_get_listener_earnings_ledger(p_user_id uuid)` returning JSON for the
  admin dashboard: listen-to-earn activity (Treats + live USD), songs listened, ad
  interaction counts, referral/bonus totals, withdrawals, and recent treat_transactions
  rows (up to 500).

  Security: SECURITY DEFINER with explicit role check (admin, manager, editor, account).
*/

CREATE OR REPLACE FUNCTION admin_get_listener_earnings_ledger(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
  v_balance_treats numeric := 0;
  v_total_withdrawn_treats numeric := 0;
  v_songs bigint := 0;
  v_ad_int bigint := 0;
  v_ref numeric := 0;
  v_bonus numeric := 0;
  v_withdraw_usd numeric := 0;
  v_entries jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin', 'manager', 'editor', 'account')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT id, display_name, email, COALESCE(total_earnings, 0) AS total_earnings
  INTO v_user
  FROM users
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  SELECT COALESCE(tw.balance, 0), COALESCE(tw.total_withdrawn, 0)
  INTO v_balance_treats, v_total_withdrawn_treats
  FROM treat_wallets tw
  WHERE tw.user_id = p_user_id;

  IF NOT FOUND THEN
    v_balance_treats := 0;
    v_total_withdrawn_treats := 0;
  END IF;

  SELECT COUNT(*) INTO v_songs
  FROM listening_history
  WHERE user_id = p_user_id;

  SELECT COUNT(*) INTO v_ad_int
  FROM ad_impression_logs
  WHERE user_id = p_user_id;

  SELECT COALESCE(SUM(tt.amount), 0) INTO v_ref
  FROM treat_transactions tt
  WHERE tt.user_id = p_user_id
    AND tt.transaction_type = 'referral_bonus'
    AND (tt.status IS NULL OR tt.status = 'completed');

  SELECT COALESCE(SUM(tt.amount), 0) INTO v_bonus
  FROM treat_transactions tt
  WHERE tt.user_id = p_user_id
    AND tt.transaction_type IN ('bonus', 'daily_checkin', 'checkin_reward')
    AND (tt.status IS NULL OR tt.status = 'completed');

  SELECT COALESCE(SUM(COALESCE(wr.net_amount, wr.amount_usd, wr.amount, 0)), 0) INTO v_withdraw_usd
  FROM withdrawal_requests wr
  WHERE wr.user_id = p_user_id
    AND wr.status IS NOT NULL
    AND wr.status NOT IN ('pending', 'rejected', 'cancelled', 'failed');

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'category', x.category,
        'label', x.label,
        'amount_usd', NULL::numeric,
        'amount_treats', x.amount_treats,
        'currency', 'TREATS',
        'occurred_at', x.occurred_at,
        'ref_id', x.ref_id
      ) ORDER BY x.occurred_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_entries
  FROM (
    SELECT
      tt.id::text AS ref_id,
      tt.created_at AS occurred_at,
      CASE tt.transaction_type
        WHEN 'ad_revenue' THEN 'ad_interaction'
        WHEN 'referral_bonus' THEN 'referral_reward'
        WHEN 'bonus' THEN 'bonus_campaign'
        WHEN 'daily_checkin' THEN 'bonus_campaign'
        WHEN 'checkin_reward' THEN 'bonus_campaign'
        WHEN 'withdrawal' THEN 'withdrawal'
        WHEN 'earn' THEN 'listen_reward'
        WHEN 'reward' THEN 'listen_reward'
        WHEN 'stream_revenue' THEN 'listen_reward'
        WHEN 'play_reward' THEN 'listen_reward'
        WHEN 'contribution_reward' THEN 'listen_reward'
        ELSE 'other'
      END AS category,
      COALESCE(
        NULLIF(trim(tt.description), ''),
        initcap(replace(tt.transaction_type, '_', ' '))
      ) AS label,
      CASE
        WHEN tt.transaction_type = 'withdrawal' THEN ABS(tt.amount)
        ELSE tt.amount
      END AS amount_treats
    FROM treat_transactions tt
    WHERE tt.user_id = p_user_id
      AND (tt.status IS NULL OR tt.status = 'completed')
    ORDER BY tt.created_at DESC
    LIMIT 500
  ) x;

  RETURN jsonb_build_object(
    'success', true,
    'user', jsonb_build_object(
      'id', v_user.id,
      'display_name', v_user.display_name,
      'email', v_user.email,
      'current_balance_treats', v_balance_treats,
      'current_balance_usd', v_user.total_earnings
    ),
    'totals', jsonb_build_object(
      'songs_listened', v_songs,
      'ad_interactions', v_ad_int,
      'referral_rewards_treats', v_ref,
      'bonus_campaigns_treats', v_bonus,
      'withdrawals_treats', v_total_withdrawn_treats,
      'withdrawals_usd', v_withdraw_usd
    ),
    'entries', COALESCE(v_entries, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_listener_earnings_ledger(uuid) TO authenticated;

COMMENT ON FUNCTION admin_get_listener_earnings_ledger(uuid) IS
  'Admin dashboard: listener listen-to-earn ledger (Treats, listening_history, ad impressions, withdrawals).';
