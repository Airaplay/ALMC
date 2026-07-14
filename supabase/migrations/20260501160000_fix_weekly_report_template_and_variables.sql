/*
  # Fix weekly report placeholders + wording

  User-facing fixes:
  - Replace unreplaced placeholders by aligning queue payload with template variables.
  - Change "Earnings" label to "Estimated Earnings".
  - Remove "View Full Report" button.
  - Ensure top song is actual title from data.
*/

-- 1) Update template HTML + declared variables
UPDATE public.email_templates
SET
  subject = 'Your Weekly Performance Report',
  variables = '["user_name","date_range","streams_count","earnings_week","top_song"]'::jsonb,
  html_content = '<!DOCTYPE html>
<html>
<head>
<style>
body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
.container { max-width: 600px; margin: 0 auto; background: #ffffff; }
.header { background: #000000; color: white; padding: 30px; text-align: center; }
.header img { max-width: 200px; height: auto; margin-bottom: 10px; }
.content { background: #ffffff; padding: 30px; }
.footer { background: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666; }
.stats-box { background: #f9f9f9; padding: 20px; margin: 20px 0; border-radius: 5px; }
.stat-item { margin: 10px 0; font-size: 16px; }
</style>
</head>
<body>
<div class="container">
<div class="header">
<img src="https://vwcadgjaivvffxwgnkzy.supabase.co/storage/v1/object/public/app-assets/official_airaplay_logo.png" alt="Airaplay Logo">
<h1 style="margin: 10px 0 0 0;">Your Weekly Report</h1>
</div>
<div class="content">
<p>Hi {{user_name}},</p>
<p>Here is your performance summary for {{date_range}}:</p>
<div class="stats-box">
<div class="stat-item">📊 <strong>Total Streams:</strong> {{streams_count}}</div>
<div class="stat-item">💰 <strong>Estimated Earnings:</strong> {{earnings_week}}</div>
<div class="stat-item">🎵 <strong>Top Song:</strong> {{top_song}}</div>
</div>
<p>Keep up the great work!</p>
</div>
<div class="footer">
<p>&copy; 2026 Airaplay. All rights reserved.</p>
</div>
</div>
</body>
</html>',
  updated_at = now()
WHERE template_type = 'weekly_report';

-- 2) Update queue function to provide matching variables
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
      (
        SELECT COALESCE(sum(tt.amount), 0)::numeric
        FROM public.treat_tips tt
        WHERE tt.recipient_id = c.user_id
          AND tt.status = 'completed'
          AND tt.created_at::date BETWEEN p_start_date AND p_end_date
      ) AS earnings_treats,
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
      'earnings_week', ('Treats ' || trim(to_char(pc.earnings_treats, 'FM9999999990.00'))),
      'top_song', pc.top_song,
      -- Backward compatibility keys for older templates still in cache/history
      'plays', pc.streams_count::text,
      'top_track', pc.top_song,
      'earnings', ('Treats ' || trim(to_char(pc.earnings_treats, 'FM9999999990.00')))
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

