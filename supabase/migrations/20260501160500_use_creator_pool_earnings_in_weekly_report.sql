/*
  # Weekly report: use creator pool earnings (stream distribution)

  Switch `earnings_week` from tips to creator-pool payout totals so
  "Estimated Earnings" reflects stream-based creator distribution.
*/

CREATE OR REPLACE FUNCTION public.admin_queue_weekly_creator_reports(
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  v_queued int := 0;
  v_date_range text;
  v_uid uuid;
  v_role text;
BEGIN
  v_uid := auth.uid();
  v_role := auth.role();

  IF v_role = 'service_role' OR current_user = 'postgres' THEN
    v_is_admin := true;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = v_uid
        AND u.role IN ('admin', 'manager')
    ) INTO v_is_admin;
  END IF;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid date range';
  END IF;

  v_date_range := to_char(p_start_date, 'Mon DD, YYYY') || ' - ' || to_char(p_end_date, 'Mon DD, YYYY');

  WITH creators AS (
    SELECT u.id AS user_id,
           u.email,
           COALESCE(u.display_name, u.email) AS user_name,
           ap.artist_id
    FROM public.users u
    LEFT JOIN public.artist_profiles ap ON ap.user_id = u.id
    WHERE u.role = 'creator'
      AND u.email IS NOT NULL
      AND length(trim(u.email)) > 3
  ),
  per_creator AS (
    SELECT
      c.user_id,
      c.email,
      c.user_name,
      c.artist_id,
      (
        SELECT count(*)::int
        FROM public.listening_history lh
        JOIN public.songs s ON s.id = lh.song_id
        WHERE c.artist_id IS NOT NULL
          AND s.artist_id = c.artist_id
          AND lh.listened_at::date BETWEEN p_start_date AND p_end_date
      ) AS streams_count,
      -- Creator pool distribution earnings from streams (USD)
      (
        SELECT COALESCE(sum(acdp.payout_usd), 0)::numeric
        FROM public.ad_creator_daily_payouts acdp
        WHERE c.artist_id IS NOT NULL
          AND acdp.artist_id = c.artist_id
          AND acdp.revenue_date BETWEEN p_start_date AND p_end_date
      ) AS earnings_usd,
      COALESCE(
        (
          SELECT s.title
          FROM public.listening_history lh
          JOIN public.songs s ON s.id = lh.song_id
          WHERE c.artist_id IS NOT NULL
            AND s.artist_id = c.artist_id
            AND lh.listened_at::date BETWEEN p_start_date AND p_end_date
          GROUP BY s.id, s.title
          ORDER BY count(*) DESC
          LIMIT 1
        ),
        (
          SELECT s.title
          FROM public.songs s
          WHERE c.artist_id IS NOT NULL
            AND s.artist_id = c.artist_id
          ORDER BY COALESCE(s.play_count, 0) DESC, s.created_at DESC
          LIMIT 1
        ),
        '—'
      ) AS top_song
    FROM creators c
  )
  INSERT INTO public.email_queue (
    template_type,
    recipient_email,
    recipient_user_id,
    variables,
    scheduled_for
  )
  SELECT
    'weekly_report',
    pc.email,
    pc.user_id,
    jsonb_build_object(
      'user_name', pc.user_name,
      'date_range', v_date_range,
      'streams_count', pc.streams_count::text,
      'earnings_week', ('$' || trim(to_char(pc.earnings_usd, 'FM9999999990.00'))),
      'top_song', pc.top_song,
      -- Backward compatibility keys for older templates still in cache/history
      'plays', pc.streams_count::text,
      'top_track', pc.top_song,
      'earnings', ('$' || trim(to_char(pc.earnings_usd, 'FM9999999990.00')))
    ),
    now()
  FROM per_creator pc;

  GET DIAGNOSTICS v_queued = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'queued', v_queued,
    'date_range', v_date_range
  );
END;
$$;

