/*
  # Pro‑Rata Creator Pool Distribution (Spotify-style)

  Goal:
  - Pay creators EXACTLY 50% of the *actual* daily AdMob revenue input (after safety buffer, if any),
    distributed pro‑rata by share of weighted ad impressions attributed to their content.

  Why:
  - Prevents over/under-payment vs real revenue.
  - Scales cleanly to thousands of creators.
  - Auditable and easy to verify (sum of creator payouts == creator_pool).

  Notes:
  - Impressions are stored in `ad_impressions` (content_id + content_type).
  - Daily revenue is stored in `ad_daily_revenue_input` (revenue_date + total_revenue_usd + safety_buffer_percentage + is_locked).
  - Revenue split percentages come from `ad_safety_caps` (active row).
*/

-- 1) Track one distribution run per day (idempotency / no double-pay)
CREATE TABLE IF NOT EXISTS public.ad_creator_pool_distributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revenue_date date NOT NULL UNIQUE,
  input_total_revenue_usd numeric NOT NULL DEFAULT 0 CHECK (input_total_revenue_usd >= 0),
  safety_buffer_percentage numeric NOT NULL DEFAULT 0 CHECK (safety_buffer_percentage >= 0 AND safety_buffer_percentage <= 100),
  net_revenue_usd numeric NOT NULL DEFAULT 0 CHECK (net_revenue_usd >= 0),
  creator_percentage numeric NOT NULL DEFAULT 50 CHECK (creator_percentage >= 0 AND creator_percentage <= 100),
  creator_pool_usd numeric NOT NULL DEFAULT 0 CHECK (creator_pool_usd >= 0),
  total_weight numeric NOT NULL DEFAULT 0 CHECK (total_weight >= 0),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'skipped_no_impressions')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);

ALTER TABLE public.ad_creator_pool_distributions ENABLE ROW LEVEL SECURITY;

-- Admins can view/manage
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ad_creator_pool_distributions' AND policyname = 'Admins manage creator pool distributions'
  ) THEN
    CREATE POLICY "Admins manage creator pool distributions"
    ON public.ad_creator_pool_distributions
    FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;

-- 2) Store per-artist daily payouts (auditable)
CREATE TABLE IF NOT EXISTS public.ad_creator_daily_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revenue_date date NOT NULL,
  artist_id uuid NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  weight numeric NOT NULL DEFAULT 0 CHECK (weight >= 0),
  payout_usd numeric NOT NULL DEFAULT 0 CHECK (payout_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  UNIQUE (revenue_date, artist_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_creator_daily_payouts_date ON public.ad_creator_daily_payouts(revenue_date);
CREATE INDEX IF NOT EXISTS idx_ad_creator_daily_payouts_artist ON public.ad_creator_daily_payouts(artist_id, revenue_date DESC);

ALTER TABLE public.ad_creator_daily_payouts ENABLE ROW LEVEL SECURITY;

-- Artists can view their payouts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ad_creator_daily_payouts' AND policyname = 'Artists view own daily payouts'
  ) THEN
    CREATE POLICY "Artists view own daily payouts"
    ON public.ad_creator_daily_payouts
    FOR SELECT
    TO authenticated
    USING (
      artist_id IN (
        SELECT ap.artist_id FROM public.artist_profiles ap WHERE ap.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ad_creator_daily_payouts' AND policyname = 'Admins view all daily payouts'
  ) THEN
    CREATE POLICY "Admins view all daily payouts"
    ON public.ad_creator_daily_payouts
    FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;

-- 3) Weight function (tunable, but deterministic)
CREATE OR REPLACE FUNCTION public.compute_ad_impression_weight(
  p_ad_type text,
  p_duration_viewed integer,
  p_completed boolean
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  ad_mult numeric := 1.0;
  completion_mult numeric := 1.0;
  duration_mult numeric := 1.0;
BEGIN
  -- Ad type weights (tune based on actual monetization)
  CASE COALESCE(p_ad_type, '')
    WHEN 'rewarded' THEN ad_mult := 4.0;
    WHEN 'interstitial' THEN ad_mult := 2.5;
    WHEN 'banner' THEN ad_mult := 1.0;
    ELSE ad_mult := 1.0;
  END CASE;

  IF p_completed THEN
    completion_mult := 1.5;
  END IF;

  -- Small duration boost, capped (prevents extreme values)
  IF COALESCE(p_duration_viewed, 0) > 0 THEN
    -- +0.10 per 30s viewed, capped at 1.30x
    duration_mult := LEAST(1.0 + (p_duration_viewed::numeric / 30.0) * 0.10, 1.30);
  END IF;

  RETURN ROUND(ad_mult * completion_mult * duration_mult, 6);
END;
$$;

COMMENT ON FUNCTION public.compute_ad_impression_weight(text, integer, boolean) IS
  'Returns a deterministic weight for an ad impression. Used for pro‑rata creator pool distribution.';

-- 4) Distribute creator pool for a given date (admin-only, idempotent)
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
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin') INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can distribute creator pool';
  END IF;

  -- Idempotency: if already distributed, return summary
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

  -- Require lock before distribution (prevents changes after payout)
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

  -- Apply safety buffer (treat as reserved; prevents over-crediting)
  v_net_revenue := COALESCE(v_input.total_revenue_usd, 0) * (1 - COALESCE(v_input.safety_buffer_percentage, 0) / 100.0);
  v_creator_pool := v_net_revenue * (v_creator_pct / 100.0);

  -- Compute weights per artist for this date
  WITH impression_artist AS (
    SELECT
      ai.id AS impression_id,
      ai.ad_type,
      ai.duration_viewed,
      ai.completed,
      ai.created_at,
      ai.content_type,
      ai.content_id,
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
      AND ai.content_type IN ('song', 'video', 'short_clip', 'general')
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
      'creator_pool_usd', v_creator_pool,
      'total_weight', v_total_weight
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

  -- Credit users.total_earnings (split equally across any user profiles for the artist_id to avoid overpay)
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

  -- Record run summary
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
    'users_credited', v_credited_users
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_distribute_creator_pool_for_date(date) TO authenticated;

COMMENT ON FUNCTION public.admin_distribute_creator_pool_for_date(date) IS
  'Admin-only. Distributes the daily creator pool (actual revenue * creator %) pro‑rata by weighted ad impressions. Requires ad_daily_revenue_input.is_locked=true. Idempotent per date.';

