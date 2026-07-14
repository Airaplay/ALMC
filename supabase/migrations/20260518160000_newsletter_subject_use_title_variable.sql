/*
  # Marketing broadcast: use admin subject as inbox subject

  Newsletter template subject was static ("This week on Airaplay") while
  admin_queue_* passes the composed title as {{newsletter_title}} (body only).
*/

UPDATE public.email_templates
SET
  subject = '{{newsletter_title}}',
  updated_at = now()
WHERE template_type = 'newsletter'
  AND subject = 'This week on Airaplay';
