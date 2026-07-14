/*
  # Newsletter: subject only in inbox, not repeated in body

  {{newsletter_title}} is used for the email subject (template + send-email).
  Body is only {{newsletter_content}} plus greeting and footer.
*/

UPDATE public.email_templates
SET
  html_content = regexp_replace(
    html_content,
    '<h1>\{\{newsletter_title\}\}</h1>\s*',
    '',
    'g'
  ),
  updated_at = now()
WHERE template_type = 'newsletter'
  AND html_content LIKE '%{{newsletter_title}}%';
