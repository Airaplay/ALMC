/*
  # Enhance Bot / Suspicious Pattern Detection

  Extends existing fast cached fraud detection to cover:
  - Plays at highly regular intervals (e.g. every ~30 seconds)
  - Same-track dominance (1 song getting ~100% of plays)
  - Long continuous playback behavior (24h-ish nonstop approximation)
  - (IP/device fan-out check removed by policy update)

  Design goals:
  - Do NOT change RPC signatures used by the app
  - Keep queries bounded (small N / indexed lookups) to avoid regressions
  - Prefer "flagging" + "block counting" consistent with current system
*/

-- Helpful indexes (safe IF NOT EXISTS).
-- NOTE: listening_history already has idx_listening_history_fraud_detection (user_id, listened_at DESC)
-- and idx_listening_history_duplicate_check (user_id, song_id, listened_at DESC) from scalability fixes.
CREATE INDEX IF NOT EXISTS idx_listening_history_user_ip_recent
  ON public.listening_history (ip_address, listened_at DESC)
  WHERE ip_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_video_playback_user_ip_recent
  ON public.video_playback_history (ip_address, watched_at DESC)
  WHERE ip_address IS NOT NULL;

-- Dedicated user bot-flag table (some older migrations drop user_play_statistics).
CREATE TABLE IF NOT EXISTS public.user_bot_flags (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_flagged boolean NOT NULL DEFAULT false,
  reason text,
  flagged_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_bot_flags_flagged
  ON public.user_bot_flags(is_flagged)
  WHERE is_flagged = true;

ALTER TABLE public.user_bot_flags ENABLE ROW LEVEL SECURITY;

-- Admins can view flags
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_bot_flags'
      AND policyname = 'Admins can view bot flags'
  ) THEN
    CREATE POLICY "Admins can view bot flags"
      ON public.user_bot_flags FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.users
          WHERE public.users.id = auth.uid()
            AND public.users.role IN ('admin', 'manager')
        )
      );
  END IF;
END $$;

-- Service role can manage flags
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_bot_flags'
      AND policyname = 'Service role can manage bot flags'
  ) THEN
    CREATE POLICY "Service role can manage bot flags"
      ON public.user_bot_flags FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Extend the cached fraud detection function without changing its interface.
CREATE OR REPLACE FUNCTION public.detect_fraud_patterns_cached(
  p_user_id uuid,
  p_content_id uuid,
  p_content_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cached_result record;
  v_plays_last_5_min int := 0;
  v_duplicate_plays int := 0;
  v_is_fraudulent boolean := false;
  v_fraud_reason text := '';
  v_validation_score numeric := 1.0;

  -- New pattern detection helpers
  v_interval_count int := 0;
  v_median_delta_s numeric := NULL;
  v_stddev_delta_s numeric := NULL;

  v_lastN_count int := 0;
  v_same_content_share numeric := NULL;

  v_recent_24h_count int := 0;
  v_max_gap_s numeric := NULL;

  v_ip_address text := NULL;
  v_user_agent text := NULL;
BEGIN
  -- Check cache first (5 min TTL table already exists).
  SELECT * INTO v_cached_result
  FROM public.fraud_detection_cache
  WHERE user_id = p_user_id
    AND content_id = p_content_id
    AND content_type = p_content_type
    AND expires_at > now();

  IF FOUND THEN
    RETURN jsonb_build_object(
      'is_fraudulent', v_cached_result.is_fraudulent,
      'reason', v_cached_result.reason,
      'validation_score', CASE WHEN v_cached_result.is_fraudulent THEN 0.0 ELSE 1.0 END,
      'cached', true
    );
  END IF;

  -- =========================================================
  -- Baseline checks (existing behavior)
  -- =========================================================

  -- Check plays in last 5 minutes (indexed lookups)
  IF p_content_type IN ('song', 'audio') THEN
    SELECT COUNT(*) INTO v_plays_last_5_min
    FROM public.listening_history
    WHERE user_id = p_user_id
      AND listened_at > now() - interval '5 minutes';
  ELSE
    SELECT COUNT(*) INTO v_plays_last_5_min
    FROM public.video_playback_history
    WHERE user_id = p_user_id
      AND watched_at > now() - interval '5 minutes';
  END IF;

  IF v_plays_last_5_min > 20 THEN
    v_is_fraudulent := true;
    v_fraud_reason := 'Too many plays in 5 minutes';
    v_validation_score := 0.0;
  END IF;

  -- Check duplicate plays in last hour
  IF NOT v_is_fraudulent THEN
    IF p_content_type IN ('song', 'audio') THEN
      SELECT COUNT(*) INTO v_duplicate_plays
      FROM public.listening_history
      WHERE user_id = p_user_id
        AND song_id = p_content_id
        AND listened_at > now() - interval '1 hour';
    ELSE
      SELECT COUNT(*) INTO v_duplicate_plays
      FROM public.video_playback_history
      WHERE user_id = p_user_id
        AND content_id = p_content_id
        AND watched_at > now() - interval '1 hour';
    END IF;

    -- Updated threshold: >10 duplicates in 1 hour
    IF v_duplicate_plays > 10 THEN
      v_is_fraudulent := true;
      v_fraud_reason := 'Too many duplicate plays in 1 hour';
      v_validation_score := 0.3;
    END IF;
  END IF;

  -- =========================================================
  -- New check 1: "Perfectly every 30 seconds" (highly regular intervals)
  -- Bounded to last 12 plays within last 30 minutes.
  -- =========================================================
  IF NOT v_is_fraudulent THEN
    IF p_content_type IN ('song', 'audio') THEN
      WITH last_plays AS (
        SELECT listened_at
        FROM public.listening_history
        WHERE user_id = p_user_id
          AND listened_at > now() - interval '30 minutes'
        ORDER BY listened_at DESC
        LIMIT 12
      ),
      deltas AS (
        SELECT EXTRACT(EPOCH FROM (listened_at - LAG(listened_at) OVER (ORDER BY listened_at))) AS delta_s
        FROM last_plays
      )
      SELECT
        COUNT(*) FILTER (WHERE delta_s IS NOT NULL),
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY delta_s),
        STDDEV_SAMP(delta_s)
      INTO v_interval_count, v_median_delta_s, v_stddev_delta_s
      FROM deltas;
    ELSE
      WITH last_plays AS (
        SELECT watched_at AS played_at
        FROM public.video_playback_history
        WHERE user_id = p_user_id
          AND watched_at > now() - interval '30 minutes'
        ORDER BY watched_at DESC
        LIMIT 12
      ),
      deltas AS (
        SELECT EXTRACT(EPOCH FROM (played_at - LAG(played_at) OVER (ORDER BY played_at))) AS delta_s
        FROM last_plays
      )
      SELECT
        COUNT(*) FILTER (WHERE delta_s IS NOT NULL),
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY delta_s),
        STDDEV_SAMP(delta_s)
      INTO v_interval_count, v_median_delta_s, v_stddev_delta_s
      FROM deltas;
    END IF;

    -- Thresholds: >=10 intervals, median ~30s, very low stddev
    IF v_interval_count >= 10
       AND v_median_delta_s BETWEEN 27 AND 33
       AND COALESCE(v_stddev_delta_s, 999999) <= 2 THEN
      v_is_fraudulent := true;
      v_fraud_reason := 'Highly regular playback interval pattern (bot-like)';
      v_validation_score := 0.0;
    END IF;
  END IF;

  -- =========================================================
  -- New check 2: "1 song getting 100% of streams" (same-content dominance)
  -- Bounded to last 50 plays within last 24 hours.
  -- =========================================================
  IF NOT v_is_fraudulent THEN
    IF p_content_type IN ('song', 'audio') THEN
      WITH lastN AS (
        SELECT song_id AS cid
        FROM public.listening_history
        WHERE user_id = p_user_id
          AND listened_at > now() - interval '24 hours'
        ORDER BY listened_at DESC
        LIMIT 50
      )
      SELECT
        COUNT(*),
        (SUM(CASE WHEN cid = p_content_id THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*)::numeric, 0))
      INTO v_lastN_count, v_same_content_share
      FROM lastN;
    ELSE
      WITH lastN AS (
        SELECT content_id AS cid
        FROM public.video_playback_history
        WHERE user_id = p_user_id
          AND watched_at > now() - interval '24 hours'
        ORDER BY watched_at DESC
        LIMIT 50
      )
      SELECT
        COUNT(*),
        (SUM(CASE WHEN cid = p_content_id THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*)::numeric, 0))
      INTO v_lastN_count, v_same_content_share
      FROM lastN;
    END IF;

    IF v_lastN_count >= 50 AND COALESCE(v_same_content_share, 0) >= 0.95 THEN
      v_is_fraudulent := true;
      v_fraud_reason := 'Extreme same-content dominance (bot-like)';
      v_validation_score := 0.0;
    END IF;
  END IF;

  -- =========================================================
  -- New check 3: "24 hours nonstop" (continuous playback approximation)
  -- Bounded gap analysis over last 200 plays (24h window).
  -- =========================================================
  IF NOT v_is_fraudulent THEN
    IF p_content_type IN ('song', 'audio') THEN
      WITH plays AS (
        SELECT listened_at AS played_at
        FROM public.listening_history
        WHERE user_id = p_user_id
          AND listened_at > now() - interval '24 hours'
        ORDER BY listened_at
        LIMIT 200
      ),
      gaps AS (
        SELECT EXTRACT(EPOCH FROM (played_at - LAG(played_at) OVER (ORDER BY played_at))) AS gap_s
        FROM plays
      )
      SELECT
        (SELECT COUNT(*) FROM plays),
        MAX(gap_s)
      INTO v_recent_24h_count, v_max_gap_s
      FROM gaps;
    ELSE
      WITH plays AS (
        SELECT watched_at AS played_at
        FROM public.video_playback_history
        WHERE user_id = p_user_id
          AND watched_at > now() - interval '24 hours'
        ORDER BY watched_at
        LIMIT 200
      ),
      gaps AS (
        SELECT EXTRACT(EPOCH FROM (played_at - LAG(played_at) OVER (ORDER BY played_at))) AS gap_s
        FROM plays
      )
      SELECT
        (SELECT COUNT(*) FROM plays),
        MAX(gap_s)
      INTO v_recent_24h_count, v_max_gap_s
      FROM gaps;
    END IF;

    -- Threshold: lots of plays and no long gaps (<=10 minutes)
    IF v_recent_24h_count >= 200 AND COALESCE(v_max_gap_s, 999999) <= 600 THEN
      v_is_fraudulent := true;
      v_fraud_reason := 'Continuous playback behavior detected (nonstop)';
      v_validation_score := 0.0;
    END IF;
  END IF;

  -- Cache the result (same behavior as before)
  INSERT INTO public.fraud_detection_cache (user_id, content_id, content_type, is_fraudulent, reason)
  VALUES (p_user_id, p_content_id, p_content_type, v_is_fraudulent, v_fraud_reason)
  ON CONFLICT (user_id, content_id, content_type)
  DO UPDATE SET
    is_fraudulent = EXCLUDED.is_fraudulent,
    reason = EXCLUDED.reason,
    cached_at = now(),
    expires_at = now() + interval '5 minutes';

  -- Persist a user-level bot flag when we decide it's fraudulent.
  -- This is used by Contributor Score gating and admin review tooling.
  IF v_is_fraudulent THEN
    -- Best-effort: capture most recent request metadata for audit/review.
    IF p_content_type IN ('song', 'audio') THEN
      SELECT lh.ip_address, lh.user_agent
      INTO v_ip_address, v_user_agent
      FROM public.listening_history lh
      WHERE lh.user_id = p_user_id
      ORDER BY lh.listened_at DESC
      LIMIT 1;
    ELSE
      SELECT vh.ip_address, vh.user_agent
      INTO v_ip_address, v_user_agent
      FROM public.video_playback_history vh
      WHERE vh.user_id = p_user_id
      ORDER BY vh.watched_at DESC
      LIMIT 1;
    END IF;

    -- Append an event row (safe no-op if table not present in some envs).
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'flagged_play_events'
    ) THEN
      INSERT INTO public.flagged_play_events (
        user_id,
        content_id,
        content_type,
        reason,
        ip_address,
        user_agent
      )
      VALUES (
        p_user_id,
        p_content_id,
        p_content_type,
        v_fraud_reason,
        v_ip_address,
        v_user_agent
      );
    END IF;

    INSERT INTO public.user_bot_flags (user_id, is_flagged, reason, flagged_at, updated_at)
    VALUES (p_user_id, true, v_fraud_reason, now(), now())
    ON CONFLICT (user_id)
    DO UPDATE SET
      is_flagged = true,
      reason = EXCLUDED.reason,
      flagged_at = COALESCE(public.user_bot_flags.flagged_at, now()),
      updated_at = now();

    -- Enqueue 30-day clawback (safe no-op if queue not present).
    PERFORM public.enqueue_bot_contribution_clawback(
      p_user_id,
      'Invalidated due to suspicious/bot-like behavior (30-day clawback)'
    );
  END IF;

  RETURN jsonb_build_object(
    'is_fraudulent', v_is_fraudulent,
    'reason', v_fraud_reason,
    'validation_score', v_validation_score,
    'cached', false
  );
END;
$$;

-- Ensure grants remain (idempotent).
GRANT EXECUTE ON FUNCTION public.detect_fraud_patterns_cached(uuid, uuid, text) TO anon, authenticated, service_role;

