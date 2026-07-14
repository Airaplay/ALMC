/*
  # Fix creator request automatic approval

  ## Problem
  - Automatic mode updates `creator_request_settings` only.
  - `approve_creator_request` rejects non-admins, so client-side auto-approve after insert fails.
  - Pending requests are not approved when an admin switches to automatic mode.

  ## Solution
  1. Shared approval routine (`apply_creator_request_approval`)
  2. `approve_creator_request`: admins always; request owner when automatic mode is on
  3. AFTER INSERT trigger approves new requests when automatic mode is on
  4. `auto_approve_pending_creator_requests`: admin backfill for existing pending rows
*/

CREATE OR REPLACE FUNCTION public.is_creator_request_auto_approval_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT approval_mode = 'automatic'
      FROM public.creator_request_settings
      WHERE single_row_marker = 1
      LIMIT 1
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.apply_creator_request_approval(
  p_request_id uuid,
  p_reviewed_by uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_artist_name text;
  v_bio text;
  v_country text;
  v_status text;
BEGIN
  SELECT user_id, artist_name, bio, country, status
  INTO v_user_id, v_artist_name, v_bio, v_country, v_status
  FROM public.creator_requests
  WHERE id = p_request_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Creator request not found';
  END IF;

  IF v_status <> 'pending' THEN
    RETURN;
  END IF;

  UPDATE public.creator_requests
  SET
    status = 'approved',
    reviewed_at = now(),
    reviewed_by = COALESCE(p_reviewed_by, auth.uid())
  WHERE id = p_request_id;

  UPDATE public.users
  SET
    role = 'creator',
    show_artist_badge = true
  WHERE id = v_user_id;

  INSERT INTO public.artist_profiles (
    user_id,
    stage_name,
    bio,
    country,
    is_verified
  )
  VALUES (
    v_user_id,
    v_artist_name,
    v_bio,
    v_country,
    true
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    is_verified = true,
    stage_name = COALESCE(artist_profiles.stage_name, EXCLUDED.stage_name),
    bio = COALESCE(artist_profiles.bio, EXCLUDED.bio),
    country = COALESCE(artist_profiles.country, EXCLUDED.country);

  INSERT INTO public.notifications (user_id, title, type, message)
  VALUES (
    v_user_id,
    'Creator Request Approved',
    'system',
    'Congratulations! Your creator request has been approved. You now have creator privileges and a verified badge.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_creator_request(request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_user_id uuid;
  v_is_admin boolean;
BEGIN
  SELECT user_id
  INTO v_request_user_id
  FROM public.creator_requests
  WHERE id = request_id;

  IF v_request_user_id IS NULL THEN
    RAISE EXCEPTION 'Creator request not found';
  END IF;

  v_is_admin := EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'
  );

  IF NOT v_is_admin THEN
    IF NOT public.is_creator_request_auto_approval_enabled()
       OR auth.uid() IS DISTINCT FROM v_request_user_id THEN
      RAISE EXCEPTION 'Only admins can approve creator requests';
    END IF;
  END IF;

  PERFORM public.apply_creator_request_approval(request_id, auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_auto_approve_creator_request_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_creator_request_auto_approval_enabled() THEN
    RETURN NEW;
  END IF;

  PERFORM public.apply_creator_request_approval(NEW.id, NEW.user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_approve_creator_request_on_insert ON public.creator_requests;
CREATE TRIGGER trigger_auto_approve_creator_request_on_insert
  AFTER INSERT ON public.creator_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_auto_approve_creator_request_on_insert();

CREATE OR REPLACE FUNCTION public.auto_approve_pending_creator_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request record;
  v_count integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can run auto-approve for creator requests';
  END IF;

  IF NOT public.is_creator_request_auto_approval_enabled() THEN
    RETURN 0;
  END IF;

  FOR v_request IN
    SELECT id
    FROM public.creator_requests
    WHERE status = 'pending'
  LOOP
    PERFORM public.apply_creator_request_approval(v_request.id, auth.uid());
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_creator_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auto_approve_pending_creator_requests() TO authenticated;

COMMENT ON FUNCTION public.approve_creator_request(uuid) IS
  'Approves a creator request. Admins always; request owners when automatic approval mode is enabled.';

COMMENT ON FUNCTION public.auto_approve_pending_creator_requests() IS
  'Admin-only: approves all pending creator requests when automatic approval mode is enabled.';
