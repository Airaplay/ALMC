/*
  # Admin: Queue Creator Weekly Reports

  Weekly creator reports existed as an email template (`weekly_report`) but were never queued anywhere,
  so they could not be delivered (no `email_queue` rows, no `email_logs` for weekly_report).

  This migration adds:
  - `public.admin_queue_weekly_creator_reports(start_date, end_date)`
    - Admin-only RPC to enqueue one weekly_report per creator (users.role='creator')
    - Computes a best-effort summary from existing tables:
      - plays: listening_history rows for creator's songs in date range
      - likes: user_favorites rows for creator's songs in date range (treated as "likes")
      - shares: 0 (no share table in schema)
      - earnings: sum(user_daily_earnings.total_points_earned) in date range (points as a proxy)
      - new_followers: user_follows for creator in date range
      - top_track: most played song (by listening_history in date range), fallback highest lifetime play_count
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
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'manager')
  ) INTO v_is_admin;

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
      -- Plays for songs belonging to this artist within date range
      (
        SELECT count(*)::int
        FROM public.listening_history lh
        JOIN public.songs s ON s.id = lh.song_id
        WHERE c.artist_id IS NOT NULL
          AND s.artist_id = c.artist_id
          AND lh.created_at::date BETWEEN p_start_date AND p_end_date
      ) AS plays,
      -- Likes proxy: favorites on songs in date range
      (
        SELECT count(*)::int
        FROM public.user_favorites uf
        JOIN public.songs s ON s.id = uf.song_id
        WHERE c.artist_id IS NOT NULL
          AND s.artist_id = c.artist_id
          AND uf.created_at::date BETWEEN p_start_date AND p_end_date
      ) AS likes,
      -- New followers for the creator user within date range
      (
        SELECT count(*)::int
        FROM public.user_follows f
        WHERE f.following_id = c.user_id
          AND f.created_at::date BETWEEN p_start_date AND p_end_date
      ) AS new_followers,
      -- Earnings proxy: contribution points in date range
      (
        SELECT COALESCE(sum(ude.total_points_earned), 0)::int
        FROM public.user_daily_earnings ude
        WHERE ude.user_id = c.user_id
          AND ude.earning_date BETWEEN p_start_date AND p_end_date
      ) AS points_earned,
      -- Top track title within date range, fallback to highest lifetime play_count
      COALESCE(
        (
          SELECT s.title
          FROM public.listening_history lh
          JOIN public.songs s ON s.id = lh.song_id
          WHERE c.artist_id IS NOT NULL
            AND s.artist_id = c.artist_id
            AND lh.created_at::date BETWEEN p_start_date AND p_end_date
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
      ) AS top_track
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
      'plays', pc.plays::text,
      'likes', pc.likes::text,
      'shares', '0',
      'earnings', ('Points ' || pc.points_earned::text),
      'new_followers', pc.new_followers::text,
      'top_track', pc.top_track
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

REVOKE ALL ON FUNCTION public.admin_queue_weekly_creator_reports(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_queue_weekly_creator_reports(date, date) TO authenticated;

COMMENT ON FUNCTION public.admin_queue_weekly_creator_reports(date, date) IS
  'Admin RPC: queue weekly_report emails for all creators for a date range.';

