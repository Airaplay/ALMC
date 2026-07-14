/*
  # Fix admin_queue_marketing_email_list skipped count

  The skipped CTE was referenced after the WITH block ended, causing:
  relation "skipped" does not exist (42P01) on every custom-list queue.
*/

CREATE OR REPLACE FUNCTION public.admin_queue_marketing_email_list(
  p_emails text[],
  p_newsletter_title text,
  p_newsletter_content text,
  p_unsubscribe_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  v_uid uuid;
  v_role text;
  v_queued int := 0;
  v_skipped int := 0;
  v_unsub text;
  v_max int := 5000;
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

  IF p_emails IS NULL OR cardinality(p_emails) = 0 THEN
    RAISE EXCEPTION 'at least one email address is required';
  END IF;

  IF p_newsletter_title IS NULL OR length(trim(p_newsletter_title)) = 0 THEN
    RAISE EXCEPTION 'subject is required';
  END IF;

  IF p_newsletter_content IS NULL OR length(trim(p_newsletter_content)) = 0 THEN
    RAISE EXCEPTION 'email body is required';
  END IF;

  v_unsub := COALESCE(nullif(trim(p_unsubscribe_url), ''), 'https://airaplay.com/unsubscribe');

  WITH raw AS (
    SELECT DISTINCT lower(trim(e)) AS email
    FROM unnest(p_emails) AS e
    WHERE e IS NOT NULL
      AND length(trim(e)) > 3
  ),
  valid AS (
    SELECT r.email
    FROM raw r
    WHERE r.email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
  ),
  capped AS (
    SELECT v.email
    FROM valid v
    LIMIT v_max
  ),
  skipped_count AS (
    SELECT count(*)::int AS n
    FROM raw r
    WHERE r.email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
  ),
  recipients AS (
    SELECT
      c.email,
      u.id AS user_id,
      COALESCE(u.display_name, split_part(c.email, '@', 1)) AS user_name
    FROM capped c
    LEFT JOIN public.users u ON lower(trim(u.email)) = c.email
  ),
  ins AS (
    INSERT INTO public.email_queue (
      template_type,
      recipient_email,
      recipient_user_id,
      variables,
      scheduled_for
    )
    SELECT
      'newsletter',
      r.email,
      r.user_id,
      jsonb_build_object(
        'user_name', r.user_name,
        'newsletter_title', trim(p_newsletter_title),
        'newsletter_content', p_newsletter_content,
        'unsubscribe_url', v_unsub
      ),
      now()
    FROM recipients r
    RETURNING id
  )
  SELECT
    (SELECT count(*)::int FROM ins),
    (SELECT n FROM skipped_count)
  INTO v_queued, v_skipped;

  RETURN jsonb_build_object(
    'success', true,
    'queued', v_queued,
    'skipped_invalid', v_skipped,
    'max_per_request', v_max
  );
END;
$$;
