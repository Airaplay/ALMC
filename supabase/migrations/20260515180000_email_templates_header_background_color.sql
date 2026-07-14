/*
  # Email templates: header CSS explicitly uses background-color (white logo contrast)

  Aligns stored HTML with the same `.header` rule used by `enforceBlackEmailHeaderBackground`.
*/

UPDATE public.email_templates
SET
  html_content = replace(
    html_content,
    '.header { background: #000000; color: #ffffff; padding: 30px; text-align: center; }',
    '.header { background-color: #000000; background: #000000; color: #ffffff; padding: 30px; text-align: center; }'
  ),
  updated_at = now()
WHERE html_content LIKE '%.header { background: #000000; color: #ffffff%';
