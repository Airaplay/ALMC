/*
  # Admin Notification Deletion Functions

  Adds admin-only RPC functions to delete notifications from `public.admin_action_notifications`.
  Used by the Admin dashboard notifications UI for single-delete and bulk-delete (Select All).
*/

-- Delete a single admin action notification (admin only)
CREATE OR REPLACE FUNCTION public.delete_admin_action_notification(p_notification_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can delete admin notifications';
  END IF;

  DELETE FROM public.admin_action_notifications
  WHERE id = p_notification_id;
END;
$$;

-- Delete multiple admin action notifications (admin only)
CREATE OR REPLACE FUNCTION public.delete_admin_action_notifications(p_notification_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can delete admin notifications';
  END IF;

  DELETE FROM public.admin_action_notifications
  WHERE id = ANY(p_notification_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_admin_action_notification(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_admin_action_notifications(uuid[]) TO authenticated;

-- Mark all admin notifications as read (admin only)
CREATE OR REPLACE FUNCTION public.mark_all_admin_action_notifications_read()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can mark admin notifications as read';
  END IF;

  UPDATE public.admin_action_notifications
  SET
    is_read = true,
    read_at = COALESCE(read_at, now()),
    read_by = COALESCE(read_by, auth.uid())
  WHERE is_read = false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_all_admin_action_notifications_read() TO authenticated;

