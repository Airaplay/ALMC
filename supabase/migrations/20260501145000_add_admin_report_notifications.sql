/*
  # Add admin notifications for submitted reports

  1. New function
    - `notify_report_submitted()` creates an admin action notification when a report is created

  2. Trigger
    - `on_report_created_notify_admin` on `reports` AFTER INSERT

  3. Notification payload
    - `notification_type`: `report_submitted`
    - `reference_id`: report id
    - `reference_type`: `report`
*/

CREATE OR REPLACE FUNCTION public.notify_report_submitted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.admin_action_notifications (
    notification_type,
    title,
    message,
    reference_id,
    reference_type
  ) VALUES (
    'report_submitted',
    'New Content Report',
    'A new ' || COALESCE(NEW.reported_item_type, 'content') || ' report was submitted.',
    NEW.id,
    'report'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_report_created_notify_admin ON public.reports;
CREATE TRIGGER on_report_created_notify_admin
  AFTER INSERT ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_report_submitted();
