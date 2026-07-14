/*
  # Fix creator pool safety-buffer math + add debug counters

  Problem:
  - `ad_daily_revenue_input.safety_buffer_percentage` is treated in the UI as "USABLE %"
    (usable revenue = total * safety_buffer_percentage/100).
  - The pro‑rata function previously treated it as "RESERVED %" (net = total * (1 - pct/100)),
    which incorrectly shrinks the payout pool.

  Fix:
  - Use: net_revenue = total_revenue_usd * (safety_buffer_percentage/100)
  - Add debug counts to the returned JSON so you can see:
    - total impressions on that day
    - impressions with content_id
    - impressions attributed to an artist_id
*/

CREATE OR REPLACE FUNCTION public.admin_distribute_creator_pool_for_date(p_revenue_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  v_input record;
  v_caps record;
  v_net_revenue numeric;
  v_creator_pct numeric;
  v_creator_pool numeric;
  v_total_weight numeric;
  v_inserted integer := 0;
  v_credited_users integer := 0;
  v_impressions_total bigint := 0;
  v_impressions_with_content bigint := 0;
  v_impressions_attributed bigint := 0;
BEGIN
  -- Allow SQL editor / service context where auth.uid() is NULL, otherwise require admin user.
  SELECT (
    auth.uid() IS NULL OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can distribute creator pool';
  END IF;

  IF EXISTS (SELECT 1 FROM public.ad_creator_pool_distributions WHERE revenue_date = p_revenue_date) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'already_distributed',
      'revenue_date', p_revenue_date
    );
  END IF;

  SELECT * INTO v_input
  FROM public.ad_daily_revenue_input
  WHERE revenue_date = p_revenue_date
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'status', 'no_daily_input', 'revenue_date', p_revenue_date);
  END IF;

  IF COALESCE(v_input.is_locked, false) = false THEN
    RETURN jsonb_build_object('ok', false, 'status', 'date_not_locked', 'revenue_date', p_revenue_date);
  END IF;

  SELECT * INTO v_caps
  FROM public.ad_safety_caps
  WHERE is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_safety_caps active row not found';
  END IF;

  v_creator_pct := COALESCE(v_caps.artist_revenue_percentage, 50.0);

  -- FIX: safety_buffer_percentage is "USABLE %"
  v_net_revenue := COALESCE(v_input.total_revenue_usd, 0) * (COALESCE(v_input.safety_buffer_percentage, 0) / 100.0);
  v_creator_pool := v_net_revenue * (v_creator_pct / 100.0);

  -- Debug counters (helps explain Total Weight = 0)
  SELECT COUNT(*) INTO v_impressions_total
  FROM public.ad_impressions ai
  WHERE ai.created_at::date = p_revenue_date;

  SELECT COUNT(*) INTO v_impressions_with_content
  FROM public.ad_impressions ai
  WHERE ai.created_at::date = p_revenue_date
    AND ai.content_id IS NOT NULL;

  WITH impression_artist AS (
    SELECT
      CASE
        WHEN ai.content_type = 'song' THEN s.artist_id
        ELSE ap.artist_id
      END AS artist_id
    FROM public.ad_impressions ai
    LEFT JOIN public.songs s
      ON ai.content_type = 'song' AND s.id = ai.content_id
    LEFT JOIN public.content_uploads cu
      ON ai.content_type <> 'song' AND cu.id = ai.content_id
    LEFT JOIN public.artist_profiles ap
      ON cu.artist_profile_id = ap.id
    WHERE ai.created_at::date = p_revenue_date
      AND ai.content_id IS NOT NULL
  )
  SELECT COUNT(*) INTO v_impressions_attributed
  FROM impression_artist
  WHERE artist_id IS NOT NULL;

  -- Compute weights per artist for this date
  WITH impression_artist AS (
    SELECT
      ai.ad_type,
      ai.duration_viewed,
      ai.completed,
      CASE
        WHEN ai.content_type = 'song' THEN s.artist_id
        ELSE ap.artist_id
      END AS artist_id
    FROM public.ad_impressions ai
    LEFT JOIN public.songs s
      ON ai.content_type = 'song' AND s.id = ai.content_id
    LEFT JOIN public.content_uploads cu
      ON ai.content_type <> 'song' AND cu.id = ai.content_id
    LEFT JOIN public.artist_profiles ap
      ON cu.artist_profile_id = ap.id
    WHERE ai.created_at::date = p_revenue_date
      AND ai.content_id IS NOT NULL
  ),
  artist_weights AS (
    SELECT
      artist_id,
      SUM(public.compute_ad_impression_weight(ad_type, duration_viewed, completed)) AS weight
    FROM impression_artist
    WHERE artist_id IS NOT NULL
    GROUP BY artist_id
  )
  SELECT COALESCE(SUM(weight), 0) INTO v_total_weight FROM artist_weights;

  IF v_total_weight <= 0 OR v_creator_pool <= 0 THEN
    INSERT INTO public.ad_creator_pool_distributions (
      revenue_date,
      input_total_revenue_usd,
      safety_buffer_percentage,
      net_revenue_usd,
      creator_percentage,
      creator_pool_usd,
      total_weight,
      status
    ) VALUES (
      p_revenue_date,
      COALESCE(v_input.total_revenue_usd, 0),
      COALESCE(v_input.safety_buffer_percentage, 0),
      v_net_revenue,
      v_creator_pct,
      v_creator_pool,
      v_total_weight,
      'skipped_no_impressions'
    );

    RETURN jsonb_build_object(
      'ok', true,
      'status', 'skipped_no_impressions',
      'revenue_date', p_revenue_date,
      'input_total_revenue_usd', COALESCE(v_input.total_revenue_usd, 0),
      'safety_buffer_percentage', COALESCE(v_input.safety_buffer_percentage, 0),
      'net_revenue_usd', v_net_revenue,
      'creator_percentage', v_creator_pct,
      'creator_pool_usd', v_creator_pool,
      'total_weight', v_total_weight,
      'debug', jsonb_build_object(
        'impressions_total', v_impressions_total,
        'impressions_with_content', v_impressions_with_content,
        'impressions_attributed', v_impressions_attributed
      )
    );
  END IF;

  -- Insert per-artist payouts (pro‑rata)
  WITH impression_artist AS (
    SELECT
      ai.ad_type,
      ai.duration_viewed,
      ai.completed,
      CASE
        WHEN ai.content_type = 'song' THEN s.artist_id
        ELSE ap.artist_id
      END AS artist_id
    FROM public.ad_impressions ai
    LEFT JOIN public.songs s
      ON ai.content_type = 'song' AND s.id = ai.content_id
    LEFT JOIN public.content_uploads cu
      ON ai.content_type <> 'song' AND cu.id = ai.content_id
    LEFT JOIN public.artist_profiles ap
      ON cu.artist_profile_id = ap.id
    WHERE ai.created_at::date = p_revenue_date
      AND ai.content_id IS NOT NULL
  ),
  artist_weights AS (
    SELECT
      artist_id,
      SUM(public.compute_ad_impression_weight(ad_type, duration_viewed, completed)) AS weight
    FROM impression_artist
    WHERE artist_id IS NOT NULL
    GROUP BY artist_id
  ),
  payouts AS (
    SELECT
      artist_id,
      weight,
      ROUND(v_creator_pool * (weight / v_total_weight), 6) AS payout_usd
    FROM artist_weights
  )
  INSERT INTO public.ad_creator_daily_payouts (revenue_date, artist_id, weight, payout_usd)
  SELECT p_revenue_date, artist_id, weight, payout_usd
  FROM payouts
  ON CONFLICT (revenue_date, artist_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  WITH artist_user_counts AS (
    SELECT artist_id, COUNT(DISTINCT user_id) AS cnt
    FROM public.artist_profiles
    WHERE artist_id IS NOT NULL AND user_id IS NOT NULL
    GROUP BY artist_id
  ),
  user_credits AS (
    SELECT
      ap.user_id,
      SUM(p.payout_usd / NULLIF(c.cnt, 0)) AS credit_usd
    FROM public.ad_creator_daily_payouts p
    JOIN public.artist_profiles ap ON ap.artist_id = p.artist_id
    JOIN artist_user_counts c ON c.artist_id = p.artist_id
    WHERE p.revenue_date = p_revenue_date
      AND ap.user_id IS NOT NULL
    GROUP BY ap.user_id
  )
  UPDATE public.users u
  SET total_earnings = COALESCE(u.total_earnings, 0) + uc.credit_usd,
      updated_at = now()
  FROM user_credits uc
  WHERE u.id = uc.user_id;

  GET DIAGNOSTICS v_credited_users = ROW_COUNT;

  INSERT INTO public.ad_creator_pool_distributions (
    revenue_date,
    input_total_revenue_usd,
    safety_buffer_percentage,
    net_revenue_usd,
    creator_percentage,
    creator_pool_usd,
    total_weight,
    status
  ) VALUES (
    p_revenue_date,
    COALESCE(v_input.total_revenue_usd, 0),
    COALESCE(v_input.safety_buffer_percentage, 0),
    v_net_revenue,
    v_creator_pct,
    v_creator_pool,
    v_total_weight,
    'completed'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'completed',
    'revenue_date', p_revenue_date,
    'input_total_revenue_usd', COALESCE(v_input.total_revenue_usd, 0),
    'safety_buffer_percentage', COALESCE(v_input.safety_buffer_percentage, 0),
    'net_revenue_usd', v_net_revenue,
    'creator_percentage', v_creator_pct,
    'creator_pool_usd', v_creator_pool,
    'total_weight', v_total_weight,
    'artists_paid', v_inserted,
    'users_credited', v_credited_users,
    'debug', jsonb_build_object(
      'impressions_total', v_impressions_total,
      'impressions_with_content', v_impressions_with_content,
      'impressions_attributed', v_impressions_attributed
    )
  );
END;
$$;

