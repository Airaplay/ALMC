/*
  # Creator Pool Payout Ledger + Admin History RPC

  Adds:
  - ad_creator_payout_ledger: per-user credit rows with balance_before/balance_after
  - admin_get_creator_pool_payout_history(start_date, end_date): admin reporting for UI

  Updates:
  - admin_distribute_creator_pool_for_date(date): write ledger rows and capture before/after balances.
*/

-- 1) Ledger table (auditable before/after)
CREATE TABLE IF NOT EXISTS public.ad_creator_payout_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revenue_date date NOT NULL,
  artist_id uuid NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  payout_usd numeric(12, 6) NOT NULL CHECK (payout_usd >= 0),
  balance_before_usd numeric(12, 6) NOT NULL DEFAULT 0,
  balance_after_usd numeric(12, 6) NOT NULL DEFAULT 0,
  distribution_id uuid REFERENCES public.ad_creator_pool_distributions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  UNIQUE (revenue_date, artist_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_creator_payout_ledger_date ON public.ad_creator_payout_ledger(revenue_date DESC);
CREATE INDEX IF NOT EXISTS idx_ad_creator_payout_ledger_user ON public.ad_creator_payout_ledger(user_id, revenue_date DESC);
CREATE INDEX IF NOT EXISTS idx_ad_creator_payout_ledger_artist ON public.ad_creator_payout_ledger(artist_id, revenue_date DESC);

ALTER TABLE public.ad_creator_payout_ledger ENABLE ROW LEVEL SECURITY;

-- Admins can read all
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='ad_creator_payout_ledger' AND policyname='Admins read creator payout ledger'
  ) THEN
    CREATE POLICY "Admins read creator payout ledger"
    ON public.ad_creator_payout_ledger
    FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role='admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='ad_creator_payout_ledger' AND policyname='Admins manage creator payout ledger'
  ) THEN
    CREATE POLICY "Admins manage creator payout ledger"
    ON public.ad_creator_payout_ledger
    FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role='admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role='admin'));
  END IF;
END $$;

-- 2) Admin history RPC for UI (filterable)
CREATE OR REPLACE FUNCTION public.admin_get_creator_pool_payout_history(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  revenue_date date,
  artist_id uuid,
  stage_name text,
  user_id uuid,
  user_display_name text,
  user_email text,
  impressions_attributed bigint,
  weight numeric,
  payout_usd numeric,
  balance_before_usd numeric,
  balance_after_usd numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  WITH attributed AS (
    SELECT
      ai.created_at::date AS revenue_date,
      CASE
        WHEN ai.content_type = 'song' THEN s.artist_id
        ELSE ap.artist_id
      END AS artist_id,
      COUNT(*) AS impressions_attributed,
      SUM(public.compute_ad_impression_weight(ai.ad_type, ai.duration_viewed, ai.completed)) AS weight
    FROM public.ad_impressions ai
    LEFT JOIN public.songs s
      ON ai.content_type = 'song' AND s.id = ai.content_id
    LEFT JOIN public.content_uploads cu
      ON ai.content_type <> 'song' AND cu.id = ai.content_id
    LEFT JOIN public.artist_profiles ap
      ON cu.artist_profile_id = ap.id
    WHERE ai.created_at::date BETWEEN p_start_date AND p_end_date
      AND ai.content_id IS NOT NULL
    GROUP BY 1, 2
  )
  SELECT
    l.revenue_date,
    l.artist_id,
    ap.stage_name,
    l.user_id,
    u.display_name,
    u.email,
    COALESCE(a.impressions_attributed, 0) AS impressions_attributed,
    COALESCE(a.weight, 0) AS weight,
    l.payout_usd,
    l.balance_before_usd,
    l.balance_after_usd
  FROM public.ad_creator_payout_ledger l
  LEFT JOIN public.artist_profiles ap ON ap.artist_id = l.artist_id
  LEFT JOIN public.users u ON u.id = l.user_id
  LEFT JOIN attributed a ON a.revenue_date = l.revenue_date AND a.artist_id = l.artist_id
  WHERE l.revenue_date BETWEEN p_start_date AND p_end_date
  ORDER BY l.revenue_date DESC, l.payout_usd DESC;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_creator_pool_payout_history(date, date) TO authenticated;
COMMENT ON FUNCTION public.admin_get_creator_pool_payout_history(date, date) IS
  'Admin-only. Returns creator pool payout history with impressions, weights, and before/after balances for a date range.';

-- 3) Update distribution function to write ledger with before/after
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
  v_distribution_id uuid;
BEGIN
  SELECT (
    auth.uid() IS NULL OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can distribute creator pool';
  END IF;

  IF EXISTS (SELECT 1 FROM public.ad_creator_pool_distributions WHERE revenue_date = p_revenue_date) THEN
    RETURN jsonb_build_object('ok', true, 'status', 'already_distributed', 'revenue_date', p_revenue_date);
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
  v_net_revenue := COALESCE(v_input.total_revenue_usd, 0) * (COALESCE(v_input.safety_buffer_percentage, 0) / 100.0);
  v_creator_pool := v_net_revenue * (v_creator_pct / 100.0);

  SELECT COUNT(*) INTO v_impressions_total
  FROM public.ad_impressions ai
  WHERE ai.created_at::date = p_revenue_date;

  SELECT COUNT(*) INTO v_impressions_with_content
  FROM public.ad_impressions ai
  WHERE ai.created_at::date = p_revenue_date AND ai.content_id IS NOT NULL;

  WITH ia AS (
    SELECT CASE WHEN ai.content_type='song' THEN s.artist_id ELSE ap.artist_id END AS artist_id
    FROM public.ad_impressions ai
    LEFT JOIN public.songs s ON ai.content_type='song' AND s.id=ai.content_id
    LEFT JOIN public.content_uploads cu ON ai.content_type<>'song' AND cu.id=ai.content_id
    LEFT JOIN public.artist_profiles ap ON cu.artist_profile_id=ap.id
    WHERE ai.created_at::date = p_revenue_date AND ai.content_id IS NOT NULL
  )
  SELECT COUNT(*) INTO v_impressions_attributed FROM ia WHERE artist_id IS NOT NULL;

  -- total weight
  WITH impression_artist AS (
    SELECT
      ai.ad_type,
      ai.duration_viewed,
      ai.completed,
      CASE WHEN ai.content_type='song' THEN s.artist_id ELSE ap.artist_id END AS artist_id
    FROM public.ad_impressions ai
    LEFT JOIN public.songs s ON ai.content_type='song' AND s.id=ai.content_id
    LEFT JOIN public.content_uploads cu ON ai.content_type<>'song' AND cu.id=ai.content_id
    LEFT JOIN public.artist_profiles ap ON cu.artist_profile_id=ap.id
    WHERE ai.created_at::date = p_revenue_date AND ai.content_id IS NOT NULL
  ),
  artist_weights AS (
    SELECT artist_id, SUM(public.compute_ad_impression_weight(ad_type, duration_viewed, completed)) AS weight
    FROM impression_artist
    WHERE artist_id IS NOT NULL
    GROUP BY artist_id
  )
  SELECT COALESCE(SUM(weight), 0) INTO v_total_weight FROM artist_weights;

  -- If nothing to pay, record distribution row and stop
  IF v_total_weight <= 0 OR v_creator_pool <= 0 THEN
    INSERT INTO public.ad_creator_pool_distributions (
      revenue_date, input_total_revenue_usd, safety_buffer_percentage, net_revenue_usd,
      creator_percentage, creator_pool_usd, total_weight, status
    ) VALUES (
      p_revenue_date, COALESCE(v_input.total_revenue_usd, 0), COALESCE(v_input.safety_buffer_percentage, 0),
      v_net_revenue, v_creator_pct, v_creator_pool, v_total_weight, 'skipped_no_impressions'
    )
    RETURNING id INTO v_distribution_id;

    RETURN jsonb_build_object(
      'ok', true,
      'status', 'skipped_no_impressions',
      'revenue_date', p_revenue_date,
      'creator_pool_usd', v_creator_pool,
      'total_weight', v_total_weight,
      'distribution_id', v_distribution_id,
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
      CASE WHEN ai.content_type='song' THEN s.artist_id ELSE ap.artist_id END AS artist_id
    FROM public.ad_impressions ai
    LEFT JOIN public.songs s ON ai.content_type='song' AND s.id=ai.content_id
    LEFT JOIN public.content_uploads cu ON ai.content_type<>'song' AND cu.id=ai.content_id
    LEFT JOIN public.artist_profiles ap ON cu.artist_profile_id=ap.id
    WHERE ai.created_at::date = p_revenue_date AND ai.content_id IS NOT NULL
  ),
  artist_weights AS (
    SELECT artist_id, SUM(public.compute_ad_impression_weight(ad_type, duration_viewed, completed)) AS weight
    FROM impression_artist
    WHERE artist_id IS NOT NULL
    GROUP BY artist_id
  ),
  payouts AS (
    SELECT artist_id, weight, ROUND(v_creator_pool * (weight / v_total_weight), 6) AS payout_usd
    FROM artist_weights
  )
  INSERT INTO public.ad_creator_daily_payouts (revenue_date, artist_id, weight, payout_usd)
  SELECT p_revenue_date, artist_id, weight, payout_usd
  FROM payouts
  ON CONFLICT (revenue_date, artist_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Calculate user credits
  WITH artist_user_counts AS (
    SELECT artist_id, COUNT(DISTINCT user_id) AS cnt
    FROM public.artist_profiles
    WHERE artist_id IS NOT NULL AND user_id IS NOT NULL
    GROUP BY artist_id
  ),
  user_credits AS (
    SELECT
      ap.user_id,
      p.artist_id,
      SUM(p.payout_usd / NULLIF(c.cnt, 0)) AS credit_usd
    FROM public.ad_creator_daily_payouts p
    JOIN public.artist_profiles ap ON ap.artist_id = p.artist_id
    JOIN artist_user_counts c ON c.artist_id = p.artist_id
    WHERE p.revenue_date = p_revenue_date
      AND ap.user_id IS NOT NULL
    GROUP BY ap.user_id, p.artist_id
  ),
  users_before AS (
    SELECT u.id AS user_id, COALESCE(u.total_earnings, 0) AS balance_before_usd
    FROM public.users u
    WHERE u.id IN (SELECT DISTINCT user_id FROM user_credits)
    FOR UPDATE
  ),
  credits_with_before AS (
    SELECT
      uc.user_id,
      uc.artist_id,
      uc.credit_usd,
      ub.balance_before_usd
    FROM user_credits uc
    JOIN users_before ub ON ub.user_id = uc.user_id
  ),
  updated AS (
    UPDATE public.users u
    SET total_earnings = COALESCE(u.total_earnings, 0) + c.credit_usd,
        updated_at = now()
    FROM credits_with_before c
    WHERE u.id = c.user_id
    RETURNING u.id AS user_id, u.total_earnings AS balance_after_usd
  )
  INSERT INTO public.ad_creator_payout_ledger (
    revenue_date, artist_id, user_id, payout_usd, balance_before_usd, balance_after_usd, distribution_id
  )
  SELECT
    p_revenue_date,
    c.artist_id,
    c.user_id,
    c.credit_usd,
    c.balance_before_usd,
    u.balance_after_usd,
    NULL
  FROM credits_with_before c
  JOIN updated u ON u.user_id = c.user_id
  ON CONFLICT (revenue_date, artist_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_credited_users = ROW_COUNT;

  INSERT INTO public.ad_creator_pool_distributions (
    revenue_date, input_total_revenue_usd, safety_buffer_percentage, net_revenue_usd,
    creator_percentage, creator_pool_usd, total_weight, status
  ) VALUES (
    p_revenue_date, COALESCE(v_input.total_revenue_usd, 0), COALESCE(v_input.safety_buffer_percentage, 0),
    v_net_revenue, v_creator_pct, v_creator_pool, v_total_weight, 'completed'
  )
  RETURNING id INTO v_distribution_id;

  -- Backfill distribution_id into ledger rows for this date
  UPDATE public.ad_creator_payout_ledger
  SET distribution_id = v_distribution_id
  WHERE revenue_date = p_revenue_date AND distribution_id IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'completed',
    'revenue_date', p_revenue_date,
    'distribution_id', v_distribution_id,
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

GRANT EXECUTE ON FUNCTION public.admin_distribute_creator_pool_for_date(date) TO authenticated;

