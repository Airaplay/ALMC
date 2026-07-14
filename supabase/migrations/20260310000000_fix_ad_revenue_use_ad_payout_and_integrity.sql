/*
  # Fix Ad Revenue: Correct Payout Source + No Overpayment + Integrity Check

  ## Problem
  - process_ad_impression_revenue used get_user_payout_settings() (legacy 45/15/40).
  - Creators were underpaid; listeners were incorrectly credited from ad revenue.
  - No built-in way to verify daily creator payout vs 50% of revenue.

  ## Changes
  1. Use get_user_ad_payout_settings() so split comes from ad_safety_caps (50/0/50).
  2. Force listener share to 0 for ad revenue (user_share := 0).
  3. Add verify_daily_creator_payout_integrity(revenue_date) for admin checks.
  4. Add comment: ad_revenue_events.revenue_amount = gross; creator share = metadata.artist_share.
*/

-- 1) process_ad_impression_revenue: use ad payout settings and force 0% listener
CREATE OR REPLACE FUNCTION process_ad_impression_revenue(
  impression_uuid uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  impression_record record;
  user_record record;
  artist_record record;
  content_record record;
  revenue_amount numeric;
  artist_share numeric := 0;
  user_share numeric := 0;
  platform_share numeric := 0;
  payout_settings jsonb;
  new_revenue_id uuid;
  result jsonb;
  admob_ready boolean;
BEGIN
  admob_ready := is_admob_revenue_ready();

  SELECT * INTO impression_record
  FROM ad_impressions
  WHERE id = impression_uuid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Ad impression not found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM ad_revenue_events
    WHERE impression_id = impression_uuid
  ) THEN
    RETURN jsonb_build_object('error', 'Revenue already processed for this impression');
  END IF;

  IF impression_record.user_id IS NOT NULL THEN
    SELECT * INTO user_record
    FROM users
    WHERE id = impression_record.user_id;
  END IF;

  IF impression_record.content_id IS NOT NULL THEN
    IF impression_record.content_type = 'song' THEN
      SELECT s.*, a.id as artist_id INTO content_record
      FROM songs s
      LEFT JOIN artists a ON s.artist_id = a.id
      WHERE s.id = impression_record.content_id;
      IF FOUND AND content_record.artist_id IS NOT NULL THEN
        SELECT * INTO artist_record FROM artists WHERE id = content_record.artist_id;
      END IF;
    ELSE
      SELECT cu.*, ap.artist_id INTO content_record
      FROM content_uploads cu
      LEFT JOIN artist_profiles ap ON cu.artist_profile_id = ap.id
      WHERE cu.id = impression_record.content_id;
      IF FOUND AND content_record.artist_id IS NOT NULL THEN
        SELECT * INTO artist_record FROM artists WHERE id = content_record.artist_id;
      END IF;
    END IF;
  END IF;

  revenue_amount := calculate_ad_revenue(impression_uuid);

  -- Use AD payout settings only (ad_safety_caps = 50/0/50). Never use get_user_payout_settings for ads.
  IF user_record.id IS NOT NULL THEN
    payout_settings := get_user_ad_payout_settings(user_record.id);
  ELSE
    payout_settings := get_user_ad_payout_settings(NULL);
  END IF;

  -- Shares: artist gets configured %; listener always 0 for ad revenue; platform gets the rest
  IF artist_record.id IS NOT NULL THEN
    artist_share := revenue_amount * (payout_settings->>'artist_percentage')::numeric / 100;
  END IF;
  user_share := 0;  -- Listeners earn via Contribution Rewards only, never from ad revenue
  platform_share := revenue_amount - artist_share - user_share;

  INSERT INTO ad_revenue_events (
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
    CASE WHEN admob_ready THEN 'processed' ELSE 'pending_admob' END,
    jsonb_build_object(
      'artist_share', artist_share,
      'user_share', user_share,
      'platform_share', platform_share,
      'ad_type', impression_record.ad_type,
      'content_type', impression_record.content_type,
      'duration_viewed', impression_record.duration_viewed,
      'completed', impression_record.completed,
      'admob_ready', admob_ready,
      'credited_to_users', admob_ready
    )
  )
  RETURNING id INTO new_revenue_id;

  IF admob_ready THEN
    -- Do NOT credit user_share for ad revenue (always 0)
    IF artist_record.id IS NOT NULL AND artist_share > 0 THEN
      UPDATE users
      SET total_earnings = total_earnings + artist_share,
          updated_at = now()
      WHERE id IN (
        SELECT user_id FROM artist_profiles WHERE artist_id = artist_record.id
      );
    END IF;
  END IF;

  result := jsonb_build_object(
    'success', true,
    'revenue_event_id', new_revenue_id,
    'revenue_amount', revenue_amount,
    'artist_share', artist_share,
    'user_share', user_share,
    'platform_share', platform_share,
    'admob_ready', admob_ready,
    'credited_to_users', admob_ready,
    'message', CASE
      WHEN admob_ready THEN 'Revenue processed and credited to creators'
      ELSE 'Revenue event created but not credited (waiting for AdMob configuration)'
    END
  );
  RETURN result;
END;
$$;

COMMENT ON FUNCTION process_ad_impression_revenue(uuid) IS
  'Processes one ad impression: uses get_user_ad_payout_settings (ad_safety_caps 50/0/50). Listener share is always 0. Creator share is stored in metadata.artist_share; revenue_amount is gross.';

-- 2) Daily integrity check: compare sum of creator payouts vs 50% of daily revenue input
CREATE OR REPLACE FUNCTION verify_daily_creator_payout_integrity(check_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
STABLE
AS $$
DECLARE
  v_input_revenue numeric;
  v_expected_creator_pool numeric;
  v_actual_creator_payout numeric;
  v_diff numeric;
  v_tolerance numeric := 0.01;
  v_ok boolean;
BEGIN
  SELECT COALESCE(total_revenue_usd, 0) INTO v_input_revenue
  FROM ad_daily_revenue_input
  WHERE revenue_date = check_date
  LIMIT 1;

  IF v_input_revenue IS NULL THEN
    RETURN jsonb_build_object(
      'revenue_date', check_date,
      'status', 'no_input',
      'message', 'No ad_daily_revenue_input row for this date'
    );
  END IF;

  v_expected_creator_pool := v_input_revenue * 0.50;

  SELECT COALESCE(SUM((metadata->>'artist_share')::numeric), 0) INTO v_actual_creator_payout
  FROM ad_revenue_events
  WHERE created_at::date = check_date
    AND status = 'processed';

  v_diff := v_actual_creator_payout - v_expected_creator_pool;
  v_ok := (abs(v_diff) <= v_tolerance);

  RETURN jsonb_build_object(
    'revenue_date', check_date,
    'total_revenue_usd', v_input_revenue,
    'expected_creator_pool_usd', v_expected_creator_pool,
    'actual_creator_payout_usd', v_actual_creator_payout,
    'diff_usd', v_diff,
    'ok', v_ok,
    'status', CASE
      WHEN v_ok THEN 'ok'
      WHEN v_diff > 0 THEN 'overpaid'
      ELSE 'underpaid'
    END,
    'message', CASE
      WHEN v_ok THEN 'Creator payout matches 50% of daily revenue (within tolerance)'
      WHEN v_diff > 0 THEN 'Creator payout exceeds 50% of daily revenue - investigate'
      ELSE 'Creator payout below 50% of daily revenue - may be pending or incomplete'
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION verify_daily_creator_payout_integrity(date) TO authenticated;
COMMENT ON FUNCTION verify_daily_creator_payout_integrity(date) IS
  'Admin integrity check: for a given date, compares sum(metadata.artist_share) to 50% of ad_daily_revenue_input. Use to ensure no over/under payment.';

-- Document ad_revenue_events columns for reporting
COMMENT ON COLUMN ad_revenue_events.revenue_amount IS
  'Gross revenue amount for this impression (USD). Creator share is in metadata.artist_share; platform in metadata.platform_share; listener share is always 0.';
