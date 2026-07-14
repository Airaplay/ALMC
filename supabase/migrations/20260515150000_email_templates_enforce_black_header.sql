/*
  # Email templates: enforce black logo header background

  Normalizes every row in `email_templates` so `.header { ... }` uses a solid black
  background (matches official Airaplay header). Complements runtime enforcement in
  the `send-email` edge function for admin-edited HTML.
*/

UPDATE public.email_templates
SET
  html_content = regexp_replace(
    html_content,
    E'\\.header\\s*\\{[\\s\\S]*?\\}',
    '.header { background: #000000; color: #ffffff; padding: 30px; text-align: center; }',
    'g'
  ),
  updated_at = now()
WHERE html_content ~ E'\\.header\\s*\\{';
