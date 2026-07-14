/*
  # Support tickets: ticket numbers and ZeptoMail emails

  Uses the existing Announcements > Emails pipeline:
  - email_templates
  - email_queue
  - process-email-queue / send-email Edge Functions
  - zeptomail_config

  Adds:
  - Human-readable support ticket numbers.
  - Confirmation email queued when a user submits a ticket.
  - Admin email replies queued to the user's email address.
  - Admin-only support ticket RPCs with user email in list/detail results.
*/

-- ---------------------------------------------------------------------------
-- 1. Ensure support ticket storage exists and has ticket numbers
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.support_ticket_number_seq START WITH 1000;

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ticket_number text,
  subject text NOT NULL,
  message text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  status text NOT NULL DEFAULT 'pending',
  priority text NOT NULL DEFAULT 'medium',
  admin_notes text,
  assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS ticket_number text;

UPDATE public.support_tickets
SET ticket_number = 'AIR-' || to_char(COALESCE(created_at, now()), 'YYYYMMDD') || '-' || lpad(nextval('public.support_ticket_number_seq')::text, 6, '0')
WHERE ticket_number IS NULL OR length(trim(ticket_number)) = 0;

ALTER TABLE public.support_tickets
  ALTER COLUMN ticket_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_support_tickets_ticket_number
  ON public.support_tickets(ticket_number);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON public.support_tickets(created_at DESC);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_tickets_select_own ON public.support_tickets;
CREATE POLICY support_tickets_select_own
  ON public.support_tickets
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS support_tickets_admin_select ON public.support_tickets;
CREATE POLICY support_tickets_admin_select
  ON public.support_tickets
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE TABLE IF NOT EXISTS public.support_ticket_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  is_staff boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_replies_ticket_id
  ON public.support_ticket_replies(ticket_id, created_at);

ALTER TABLE public.support_ticket_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_ticket_replies_admin_all ON public.support_ticket_replies;
CREATE POLICY support_ticket_replies_admin_all
  ON public.support_ticket_replies
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. Register support email templates in the existing ZeptoMail template system
-- ---------------------------------------------------------------------------
ALTER TABLE public.email_templates
  DROP CONSTRAINT IF EXISTS email_templates_template_type_check;

ALTER TABLE public.email_templates
  ADD CONSTRAINT email_templates_template_type_check
  CHECK (template_type IN (
    'welcome',
    'purchase_treat',
    'approved_withdrawal',
    'completed_withdrawal',
    'newsletter',
    'weekly_report',
    'creator_approved',
    'promotion_active',
    'support_ticket_received',
    'support_ticket_reply'
  ));

INSERT INTO public.email_templates (
  template_type,
  subject,
  html_content,
  variables,
  is_active
) VALUES
(
  'support_ticket_received',
  'Support Ticket {{ticket_number}} Received',
  '<!DOCTYPE html>
<html>
<head>
<style>
body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
.container { max-width: 600px; margin: 0 auto; background: #ffffff; }
.header { background: #000000; color: #ffffff; padding: 30px; text-align: center; }
.content { background: #ffffff; padding: 30px; }
.ticket-box { background: #f8fff9; border: 1px solid #cdeed7; border-left: 4px solid #00ad74; border-radius: 8px; padding: 16px; margin: 16px 0; }
.footer { background: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1 style="margin: 0;">Support Ticket Received</h1>
  </div>
  <div class="content">
    <p>Hi {{user_name}},</p>
    <p>We received your support request. Please keep this ticket number for reference:</p>
    <div class="ticket-box">
      <p><strong>Ticket Number:</strong> {{ticket_number}}</p>
      <p><strong>Subject:</strong> {{ticket_subject}}</p>
      <p><strong>Category:</strong> {{ticket_category}}</p>
      <p><strong>Status:</strong> {{ticket_status}}</p>
    </div>
    <p>Our support team will review your request and reply to this email address.</p>
  </div>
  <div class="footer">
    <p>&copy; 2026 Airaplay. All rights reserved.</p>
  </div>
</div>
</body>
</html>',
  '["user_name","user_email","ticket_number","ticket_subject","ticket_category","ticket_status"]'::jsonb,
  true
),
(
  'support_ticket_reply',
  'Reply to Support Ticket {{ticket_number}}',
  '<!DOCTYPE html>
<html>
<head>
<style>
body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
.container { max-width: 600px; margin: 0 auto; background: #ffffff; }
.header { background: #000000; color: #ffffff; padding: 30px; text-align: center; }
.content { background: #ffffff; padding: 30px; }
.reply-box { background: #f8fff9; border: 1px solid #cdeed7; border-left: 4px solid #00ad74; border-radius: 8px; padding: 16px; margin: 16px 0; white-space: pre-wrap; }
.meta { background: #f7f7f7; border-radius: 8px; padding: 12px; margin: 16px 0; }
.footer { background: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1 style="margin: 0;">Support Reply</h1>
  </div>
  <div class="content">
    <p>Hi {{user_name}},</p>
    <p>Our support team replied to your ticket.</p>
    <div class="meta">
      <p><strong>Ticket Number:</strong> {{ticket_number}}</p>
      <p><strong>Subject:</strong> {{ticket_subject}}</p>
    </div>
    <div class="reply-box">{{reply_message}}</div>
    <p>If you still need help, reply with this ticket number: <strong>{{ticket_number}}</strong>.</p>
  </div>
  <div class="footer">
    <p>&copy; 2026 Airaplay. All rights reserved.</p>
  </div>
</div>
</body>
</html>',
  '["user_name","user_email","ticket_number","ticket_subject","reply_message"]'::jsonb,
  true
)
ON CONFLICT (template_type) DO UPDATE SET
  subject = EXCLUDED.subject,
  html_content = EXCLUDED.html_content,
  variables = EXCLUDED.variables,
  is_active = EXCLUDED.is_active,
  updated_at = now();

DROP FUNCTION IF EXISTS public.create_support_ticket(text, text, text);
DROP FUNCTION IF EXISTS public.admin_get_support_tickets(text, integer, integer);
DROP FUNCTION IF EXISTS public.admin_get_support_ticket_replies(uuid);
DROP FUNCTION IF EXISTS public.admin_reply_support_ticket(uuid, text);

-- ---------------------------------------------------------------------------
-- 3. User ticket creation with auto ticket number + confirmation email queue
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_support_ticket(
  p_subject text,
  p_message text,
  p_category text DEFAULT 'general'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket_id uuid;
  v_ticket_number text;
  v_user_id uuid;
  v_user_email text;
  v_user_name text;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  IF p_subject IS NULL OR length(trim(p_subject)) = 0 THEN
    RAISE EXCEPTION 'Subject is required';
  END IF;

  IF p_message IS NULL OR length(trim(p_message)) = 0 THEN
    RAISE EXCEPTION 'Message is required';
  END IF;

  SELECT email, COALESCE(display_name, email)
  INTO v_user_email, v_user_name
  FROM public.users
  WHERE id = v_user_id;

  IF v_user_email IS NULL OR length(trim(v_user_email)) <= 3 THEN
    RAISE EXCEPTION 'A valid email address is required to submit a support ticket';
  END IF;

  v_ticket_number := 'AIR-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('public.support_ticket_number_seq')::text, 6, '0');

  INSERT INTO public.support_tickets (
    user_id,
    ticket_number,
    subject,
    message,
    category,
    status,
    priority
  ) VALUES (
    v_user_id,
    v_ticket_number,
    trim(p_subject),
    trim(p_message),
    COALESCE(NULLIF(trim(p_category), ''), 'general'),
    'pending',
    'medium'
  )
  RETURNING id INTO v_ticket_id;

  INSERT INTO public.admin_action_notifications (
    notification_type,
    title,
    message,
    reference_id,
    reference_type
  ) VALUES (
    'support_ticket',
    'New Support Ticket',
    'Ticket ' || v_ticket_number || ': ' || trim(p_subject),
    v_ticket_id,
    'support_ticket'
  );

  PERFORM public.queue_email(
    'support_ticket_received',
    v_user_email,
    v_user_id,
    jsonb_build_object(
      'user_name', v_user_name,
      'user_email', v_user_email,
      'ticket_number', v_ticket_number,
      'ticket_subject', trim(p_subject),
      'ticket_category', COALESCE(NULLIF(trim(p_category), ''), 'general'),
      'ticket_status', 'Pending'
    )
  );

  RETURN jsonb_build_object(
    'ticket_id', v_ticket_id,
    'ticket_number', v_ticket_number
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Admin support RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_support_tickets(
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  ticket_number text,
  user_id uuid,
  user_email text,
  user_display_name text,
  subject text,
  message text,
  category text,
  status text,
  priority text,
  admin_notes text,
  assigned_to uuid,
  assigned_to_name text,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    st.id,
    st.ticket_number,
    st.user_id,
    u.email AS user_email,
    u.display_name AS user_display_name,
    st.subject,
    st.message,
    st.category,
    st.status,
    st.priority,
    st.admin_notes,
    st.assigned_to,
    admin_user.display_name AS assigned_to_name,
    st.created_at,
    st.updated_at,
    st.resolved_at
  FROM public.support_tickets st
  INNER JOIN public.users u ON st.user_id = u.id
  LEFT JOIN public.users admin_user ON st.assigned_to = admin_user.id
  WHERE (p_status IS NULL OR st.status = p_status)
  ORDER BY
    CASE st.status
      WHEN 'pending' THEN 1
      WHEN 'in_progress' THEN 2
      WHEN 'resolved' THEN 3
      ELSE 4
    END,
    st.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_support_ticket(
  p_ticket_id uuid,
  p_status text,
  p_priority text DEFAULT NULL,
  p_admin_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_status NOT IN ('pending', 'in_progress', 'resolved') THEN
    RAISE EXCEPTION 'Invalid support ticket status';
  END IF;

  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  UPDATE public.support_tickets
  SET
    status = p_status,
    priority = COALESCE(NULLIF(p_priority, ''), priority),
    admin_notes = p_admin_notes,
    assigned_to = COALESCE(assigned_to, v_admin_id),
    updated_at = now(),
    resolved_at = CASE
      WHEN p_status = 'resolved' AND resolved_at IS NULL THEN now()
      WHEN p_status <> 'resolved' THEN NULL
      ELSE resolved_at
    END
  WHERE id = p_ticket_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Support ticket not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_support_ticket_replies(p_ticket_id uuid)
RETURNS TABLE (
  id uuid,
  body text,
  is_staff boolean,
  author_id uuid,
  author_display_name text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.body,
    r.is_staff,
    r.author_id,
    u.display_name AS author_display_name,
    r.created_at
  FROM public.support_ticket_replies r
  LEFT JOIN public.users u ON u.id = r.author_id
  WHERE r.ticket_id = p_ticket_id
  ORDER BY r.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reply_support_ticket(
  p_ticket_id uuid,
  p_message text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id uuid;
  v_user_id uuid;
  v_user_email text;
  v_user_name text;
  v_subject text;
  v_ticket_number text;
  v_trim text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated';
  END IF;

  v_trim := trim(p_message);
  IF v_trim = '' THEN
    RAISE EXCEPTION 'Reply message is required';
  END IF;

  SELECT
    st.user_id,
    u.email,
    COALESCE(u.display_name, u.email),
    st.subject,
    st.ticket_number
  INTO
    v_user_id,
    v_user_email,
    v_user_name,
    v_subject,
    v_ticket_number
  FROM public.support_tickets st
  INNER JOIN public.users u ON u.id = st.user_id
  WHERE st.id = p_ticket_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Support ticket not found';
  END IF;

  IF v_user_email IS NULL OR length(trim(v_user_email)) <= 3 THEN
    RAISE EXCEPTION 'User does not have a valid email address';
  END IF;

  INSERT INTO public.support_ticket_replies (ticket_id, author_id, body, is_staff)
  VALUES (p_ticket_id, v_admin_id, v_trim, true);

  UPDATE public.support_tickets
  SET
    status = CASE WHEN status = 'pending' THEN 'in_progress' ELSE status END,
    assigned_to = COALESCE(assigned_to, v_admin_id),
    updated_at = now()
  WHERE id = p_ticket_id;

  PERFORM public.queue_email(
    'support_ticket_reply',
    v_user_email,
    v_user_id,
    jsonb_build_object(
      'user_name', v_user_name,
      'user_email', v_user_email,
      'ticket_number', v_ticket_number,
      'ticket_subject', v_subject,
      'reply_message', v_trim
    )
  );

  RETURN jsonb_build_object(
    'ticket_number', v_ticket_number,
    'recipient_email', v_user_email
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_support_ticket(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_support_tickets(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_support_ticket(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_support_ticket_replies(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reply_support_ticket(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_support_ticket(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_support_tickets(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_support_ticket(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_support_ticket_replies(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reply_support_ticket(uuid, text) TO authenticated;
