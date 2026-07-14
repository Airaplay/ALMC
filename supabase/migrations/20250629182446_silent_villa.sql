/*
  # Create announcements system for admin notifications

  1. New Tables
    - `announcements` - Store admin-created announcements
      - `id` (uuid, primary key)
      - `title` (text, required)
      - `message` (text, required)
      - `link_url` (text, optional)
      - `embedded_media_url` (text, optional)
      - `target_type` (text, e.g., 'all', 'listener', 'creator', 'country')
      - `target_country_code` (text, optional)
      - `scheduled_at` (timestamptz, optional)
      - `sent_at` (timestamptz, nullable)
      - `status` (text, e.g., 'draft', 'scheduled', 'sent', 'failed')
      - `created_at` (timestamptz)
      - `created_by` (uuid, references users.id)

  2. Security
    - Enable RLS on announcements table
    - Only admins can manage announcements
    - Functions to create and send announcements

  3. Functions
    - `admin_create_announcement` - Create a new announcement
    - `admin_send_announcement` - Send an announcement to targeted users
    - `admin_get_announcements` - Get list of announcements
*/

-- Create announcements table
CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message text NOT NULL,
  link_url text,
  embedded_media_url text,
  target_type text NOT NULL CHECK (target_type IN ('all', 'listener', 'creator', 'country')),
  target_country_code text, -- NULL unless target_type = 'country'
  scheduled_at timestamptz, -- NULL for immediate delivery
  sent_at timestamptz, -- NULL until sent
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sent', 'failed')),
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES users(id)
);

-- Enable Row Level Security (RLS)
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status);
CREATE INDEX IF NOT EXISTS idx_announcements_scheduled_at ON announcements(scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_announcements_target_type ON announcements(target_type);
CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at);

-- RLS Policies for announcements table
-- Only admins can manage announcements
CREATE POLICY "Admins can manage announcements"
ON announcements
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
);

-- Function to create a new announcement
CREATE OR REPLACE FUNCTION admin_create_announcement(
  title_param text,
  message_param text,
  target_type_param text,
  target_country_code_param text DEFAULT NULL,
  link_url_param text DEFAULT NULL,
  embedded_media_url_param text DEFAULT NULL,
  scheduled_at_param timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  is_admin boolean;
  new_announcement_id uuid;
  announcement_status text;
  result jsonb;
BEGIN
  -- Check if user is an admin
  SELECT (role = 'admin') INTO is_admin
  FROM users
  WHERE id = current_user_id;
  
  IF NOT is_admin THEN
    RETURN jsonb_build_object('error', 'Only administrators can create announcements');
  END IF;

  -- Validate target_type
  IF target_type_param NOT IN ('all', 'listener', 'creator', 'country') THEN
    RETURN jsonb_build_object('error', 'Invalid target type. Must be all, listener, creator, or country');
  END IF;

  -- Validate country code is provided when target_type is 'country'
  IF target_type_param = 'country' AND (target_country_code_param IS NULL OR target_country_code_param = '') THEN
    RETURN jsonb_build_object('error', 'Country code is required when target type is country');
  END IF;

  -- Determine status based on scheduled_at
  IF scheduled_at_param IS NULL OR scheduled_at_param <= now() THEN
    announcement_status := 'sent'; -- Will be sent immediately
  ELSE
    announcement_status := 'scheduled';
  END IF;

  -- Create the announcement
  INSERT INTO announcements (
    title,
    message,
    link_url,
    embedded_media_url,
    target_type,
    target_country_code,
    scheduled_at,
    status,
    created_by
  ) VALUES (
    title_param,
    message_param,
    link_url_param,
    embedded_media_url_param,
    target_type_param,
    target_country_code_param,
    scheduled_at_param,
    announcement_status,
    current_user_id
  )
  RETURNING id INTO new_announcement_id;

  -- If announcement is to be sent immediately, send it now
  IF announcement_status = 'sent' THEN
    PERFORM admin_send_announcement(new_announcement_id);
  END IF;

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'message', CASE 
      WHEN announcement_status = 'sent' THEN 'Announcement created and sent successfully'
      ELSE 'Announcement scheduled successfully'
    END,
    'announcement_id', new_announcement_id,
    'status', announcement_status
  );
END;
$$;

-- Function to send an announcement to targeted users
CREATE OR REPLACE FUNCTION admin_send_announcement(announcement_id_param uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  is_admin boolean;
  announcement_record record;
  target_users_count integer := 0;
  result jsonb;
BEGIN
  -- Check if user is an admin
  SELECT (role = 'admin') INTO is_admin
  FROM users
  WHERE id = current_user_id;
  
  IF NOT is_admin THEN
    RETURN jsonb_build_object('error', 'Only administrators can send announcements');
  END IF;

  -- Get the announcement
  SELECT * INTO announcement_record
  FROM announcements
  WHERE id = announcement_id_param;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Announcement not found');
  END IF;

  -- Check if announcement is already sent
  IF announcement_record.status = 'sent' THEN
    RETURN jsonb_build_object('error', 'Announcement has already been sent');
  END IF;

  -- Check if scheduled time has arrived (if scheduled)
  IF announcement_record.scheduled_at IS NOT NULL AND announcement_record.scheduled_at > now() THEN
    RETURN jsonb_build_object('error', 'Scheduled time has not arrived yet');
  END IF;

  -- Create notifications for targeted users
  CASE announcement_record.target_type
    WHEN 'all' THEN
      -- Send to all users
      INSERT INTO notifications (
        user_id,
        type,
        message,
        metadata
      )
      SELECT 
        id,
        'announcement',
        announcement_record.message,
        jsonb_build_object(
          'announcement_id', announcement_record.id,
          'title', announcement_record.title,
          'link_url', announcement_record.link_url,
          'embedded_media_url', announcement_record.embedded_media_url
        )
      FROM users
      WHERE is_active = true;
      
      GET DIAGNOSTICS target_users_count = ROW_COUNT;

    WHEN 'listener' THEN
      -- Send to listeners only
      INSERT INTO notifications (
        user_id,
        type,
        message,
        metadata
      )
      SELECT 
        id,
        'announcement',
        announcement_record.message,
        jsonb_build_object(
          'announcement_id', announcement_record.id,
          'title', announcement_record.title,
          'link_url', announcement_record.link_url,
          'embedded_media_url', announcement_record.embedded_media_url
        )
      FROM users
      WHERE role = 'listener' AND is_active = true;
      
      GET DIAGNOSTICS target_users_count = ROW_COUNT;

    WHEN 'creator' THEN
      -- Send to creators only
      INSERT INTO notifications (
        user_id,
        type,
        message,
        metadata
      )
      SELECT 
        id,
        'announcement',
        announcement_record.message,
        jsonb_build_object(
          'announcement_id', announcement_record.id,
          'title', announcement_record.title,
          'link_url', announcement_record.link_url,
          'embedded_media_url', announcement_record.embedded_media_url
        )
      FROM users
      WHERE role = 'creator' AND is_active = true;
      
      GET DIAGNOSTICS target_users_count = ROW_COUNT;

    WHEN 'country' THEN
      -- Send to users in specific country
      INSERT INTO notifications (
        user_id,
        type,
        message,
        metadata
      )
      SELECT 
        id,
        'announcement',
        announcement_record.message,
        jsonb_build_object(
          'announcement_id', announcement_record.id,
          'title', announcement_record.title,
          'link_url', announcement_record.link_url,
          'embedded_media_url', announcement_record.embedded_media_url
        )
      FROM users
      WHERE country = announcement_record.target_country_code AND is_active = true;
      
      GET DIAGNOSTICS target_users_count = ROW_COUNT;
  END CASE;

  -- Update announcement status
  UPDATE announcements
  SET 
    status = 'sent',
    sent_at = now()
  WHERE id = announcement_id_param;

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Announcement sent successfully',
    'target_users_count', target_users_count
  );
END;
$$;

-- Function to get announcements for admin dashboard
CREATE OR REPLACE FUNCTION admin_get_announcements(
  status_filter text DEFAULT NULL,
  limit_param integer DEFAULT 100,
  offset_param integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  title text,
  message text,
  link_url text,
  embedded_media_url text,
  target_type text,
  target_country_code text,
  scheduled_at timestamptz,
  sent_at timestamptz,
  status text,
  created_at timestamptz,
  created_by uuid,
  admin_name text,
  target_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Access denied. Admin privileges required.';
  END IF;

  -- Return announcements with optional status filter
  RETURN QUERY
  SELECT 
    a.id,
    a.title,
    a.message,
    a.link_url,
    a.embedded_media_url,
    a.target_type,
    a.target_country_code,
    a.scheduled_at,
    a.sent_at,
    a.status,
    a.created_at,
    a.created_by,
    u.display_name as admin_name,
    CASE a.target_type
      WHEN 'all' THEN (SELECT COUNT(*) FROM users WHERE is_active = true)
      WHEN 'listener' THEN (SELECT COUNT(*) FROM users WHERE role = 'listener' AND is_active = true)
      WHEN 'creator' THEN (SELECT COUNT(*) FROM users WHERE role = 'creator' AND is_active = true)
      WHEN 'country' THEN (SELECT COUNT(*) FROM users WHERE country = a.target_country_code AND is_active = true)
      ELSE 0
    END as target_count
  FROM announcements a
  LEFT JOIN users u ON a.created_by = u.id
  WHERE 
    (status_filter IS NULL OR a.status = status_filter)
  ORDER BY 
    CASE a.status
      WHEN 'draft' THEN 1
      WHEN 'scheduled' THEN 2
      WHEN 'sent' THEN 3
      WHEN 'failed' THEN 4
    END,
    COALESCE(a.scheduled_at, a.created_at) DESC
  LIMIT limit_param
  OFFSET offset_param;
END;
$$;

-- Function to delete an announcement
CREATE OR REPLACE FUNCTION admin_delete_announcement(announcement_id_param uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  is_admin boolean;
  announcement_record record;
  result jsonb;
BEGIN
  -- Check if user is an admin
  SELECT (role = 'admin') INTO is_admin
  FROM users
  WHERE id = current_user_id;
  
  IF NOT is_admin THEN
    RETURN jsonb_build_object('error', 'Only administrators can delete announcements');
  END IF;

  -- Get the announcement
  SELECT * INTO announcement_record
  FROM announcements
  WHERE id = announcement_id_param;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Announcement not found');
  END IF;

  -- Check if announcement is already sent
  IF announcement_record.status = 'sent' THEN
    -- Delete related notifications
    DELETE FROM notifications
    WHERE type = 'announcement'
    AND metadata->>'announcement_id' = announcement_id_param::text;
  END IF;

  -- Delete the announcement
  DELETE FROM announcements
  WHERE id = announcement_id_param;

  -- Return success
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Announcement deleted successfully'
  );
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION admin_create_announcement(text, text, text, text, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_send_announcement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_announcements(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_announcement(uuid) TO authenticated;

-- Create a scheduled job to send scheduled announcements
-- Note: This would typically be handled by a cron job or a Supabase Edge Function
-- For now, we'll create a function that can be called manually or by a scheduled job
CREATE OR REPLACE FUNCTION process_scheduled_announcements()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  announcement_record record;
  processed_count integer := 0;
BEGIN
  -- Find scheduled announcements that are due
  FOR announcement_record IN
    SELECT id
    FROM announcements
    WHERE status = 'scheduled'
    AND scheduled_at <= now()
  LOOP
    -- Send the announcement
    PERFORM admin_send_announcement(announcement_record.id);
    processed_count := processed_count + 1;
  END LOOP;

  RETURN processed_count;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION process_scheduled_announcements() TO authenticated;