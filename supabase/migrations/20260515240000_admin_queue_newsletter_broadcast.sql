/*
  # Admin: queue newsletter broadcast

  Lets admins enqueue one `newsletter` email per matching user with shared title + HTML body.
  Audience: all users with a valid email, or listeners only, or creators only.
*/

CREATE OR REPLACE FUNCTION public.admin_queue_newsletter_broadcast(
  p_newsletter_title text,
  p_newsletter_content text,
  p_unsubscribe_url text DEFAULT NULL,
  p_audience text DEFAULT 'all'
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
  v_unsub text;
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

  IF p_newsletter_title IS NULL OR length(trim(p_newsletter_title)) = 0 THEN
    RAISE EXCEPTION 'newsletter title is required';
  END IF;

  IF p_newsletter_content IS NULL OR length(trim(p_newsletter_content)) = 0 THEN
    RAISE EXCEPTION 'newsletter content is required';
  END IF;

  IF p_audience IS NULL OR p_audience NOT IN ('all', 'listener', 'creator') THEN
    RAISE EXCEPTION 'invalid audience';
  END IF;

  v_unsub := COALESCE(nullif(trim(p_unsubscribe_url), ''), 'https://airaplay.com/unsubscribe');

  WITH recipients AS (
    SELECT
      u.id AS user_id,
      u.email,
      COALESCE(u.display_name, u.email) AS user_name
    FROM public.users u
    WHERE u.email IS NOT NULL
      AND length(trim(u.email)) > 3
      AND (
        p_audience = 'all'
        OR (p_audience = 'listener' AND u.role = 'listener')
        OR (p_audience = 'creator' AND u.role = 'creator')
      )
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
  SELECT count(*)::int INTO v_queued FROM ins;

  RETURN jsonb_build_object(
    'success', true,
    'queued', v_queued
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_queue_newsletter_broadcast(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_queue_newsletter_broadcast(text, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.admin_queue_newsletter_broadcast(text, text, text, text) IS
  'Admin RPC: enqueue newsletter template for each user in audience (all | listener | creator).';
