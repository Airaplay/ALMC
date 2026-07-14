/*
  # Fix Creator Weekly Report streams_count always 0

  Problems:
  1. Stream counts joined songs on `s.artist_id = artist_profiles.artist_id` only.
     Legacy uploads stored `artist_profiles.id` in `songs.artist_id`, so plays were never matched.
  2. Some listening_history rows may have NULL `listened_at` (client inserts omit it), which
     `listened_at::date BETWEEN ...` excludes.

  Fixes:
  - Resolve each creator's songs via artist_profiles (artist_id OR profile id) and user_id fallback.
  - Count plays with an inclusive timestamptz window on listened_at.
  - Default listened_at on insert when missing.
*/

-- Ensure new listening_history rows always get a play timestamp.
CREATE OR REPLACE FUNCTION public.set_listened_at_on_playback_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.listened_at IS NULL THEN
    NEW.listened_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'listening_history'
  ) THEN
    ALTER TABLE public.listening_history
      ALTER COLUMN listened_at SET DEFAULT now();

    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'tr_set_listened_at_listening_history'
    ) THEN
      CREATE TRIGGER tr_set_listened_at_listening_history
      BEFORE INSERT ON public.listening_history
      FOR EACH ROW
      EXECUTE FUNCTION public.set_listened_at_on_playback_history();
    END IF;
  END IF;
END $$;

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
  v_range_start timestamptz;
  v_range_end timestamptz;
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
  v_range_start := p_start_date::timestamptz;
  v_range_end := (p_end_date + interval '1 day')::timestamptz;

  WITH creators AS (
    SELECT u.id AS user_id,
           u.email,
           COALESCE(u.display_name, u.email) AS user_name,
           ap.artist_id AS profile_artist_id,
           ap.id AS profile_id,
           COALESCE(u.total_earnings, 0)::numeric AS live_balance_usd,
           COALESCE(tw.total_earned, 0)::bigint AS treat_total_earned
    FROM public.users u
    LEFT JOIN public.artist_profiles ap ON ap.user_id = u.id
    LEFT JOIN public.treat_wallets tw ON tw.user_id = u.id
    WHERE u.role = 'creator'
      AND u.email IS NOT NULL
      AND length(trim(u.email)) > 3
  ),
  creator_songs AS (
    SELECT
      c.user_id,
      array_agg(DISTINCT s.id) FILTER (WHERE s.id IS NOT NULL) AS song_ids
    FROM creators c
    LEFT JOIN public.songs s ON (
      (c.profile_artist_id IS NOT NULL AND s.artist_id = c.profile_artist_id)
      OR (c.profile_id IS NOT NULL AND s.artist_id = c.profile_id)
      OR s.artist_id = c.user_id
    )
    GROUP BY c.user_id
  ),
  per_creator AS (
    SELECT
      c.user_id,
      c.email,
      c.user_name,
      c.profile_artist_id,
      c.profile_id,
      c.live_balance_usd,
      c.treat_total_earned,
      COALESCE(cs.song_ids, ARRAY[]::uuid[]) AS song_ids,
      (
        SELECT count(*)::int
        FROM public.listening_history lh
        WHERE lh.song_id = ANY(COALESCE(cs.song_ids, ARRAY[]::uuid[]))
          AND lh.listened_at >= v_range_start
          AND lh.listened_at < v_range_end
      ) AS streams_count,
      (
        SELECT COALESCE(sum(acdp.payout_usd), 0)::numeric
        FROM public.ad_creator_daily_payouts acdp
        WHERE acdp.revenue_date BETWEEN p_start_date AND p_end_date
          AND (
            (c.profile_artist_id IS NOT NULL AND acdp.artist_id = c.profile_artist_id)
            OR (c.profile_id IS NOT NULL AND acdp.artist_id = c.profile_id)
          )
      ) AS earnings_usd,
      COALESCE(
        (
          SELECT s.title
          FROM public.listening_history lh
          JOIN public.songs s ON s.id = lh.song_id
          WHERE lh.song_id = ANY(COALESCE(cs.song_ids, ARRAY[]::uuid[]))
            AND lh.listened_at >= v_range_start
            AND lh.listened_at < v_range_end
          GROUP BY s.id, s.title
          ORDER BY count(*) DESC
          LIMIT 1
        ),
        (
          SELECT s.title
          FROM public.songs s
          WHERE s.id = ANY(COALESCE(cs.song_ids, ARRAY[]::uuid[]))
          ORDER BY COALESCE(s.play_count, 0) DESC, s.created_at DESC
          LIMIT 1
        ),
        '—'
      ) AS top_song
    FROM creators c
    LEFT JOIN creator_songs cs ON cs.user_id = c.user_id
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
      'stream_earnings', ('$' || trim(to_char(pc.live_balance_usd, 'FM9999999990.00'))),
      'treat_earnings',
        trim(to_char(pc.treat_total_earned::numeric, 'FM999,999,999')) || ' Treats',
      'top_song', pc.top_song,
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

COMMENT ON FUNCTION public.admin_queue_weekly_creator_reports(date, date) IS
  'Admin RPC: queue weekly_report emails for all creators. Stream counts match songs via artist_profiles.artist_id or legacy artist_profiles.id on songs.artist_id.';
