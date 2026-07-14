/*
  # Marketing email drafts (admin composer)

  Save broadcast subject/body/audience to reuse later without re-composing.
*/

CREATE TABLE IF NOT EXISTS public.marketing_email_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  title text NOT NULL DEFAULT '',
  html_content text NOT NULL DEFAULT '',
  audience text NOT NULL DEFAULT 'all'
    CHECK (audience IN ('all', 'listener', 'creator', 'custom')),
  custom_emails_raw text NOT NULL DEFAULT '',
  unsubscribe_url text NOT NULL DEFAULT 'https://airaplay.com/unsubscribe',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_email_drafts_updated
  ON public.marketing_email_drafts (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_email_drafts_created_by
  ON public.marketing_email_drafts (created_by);

ALTER TABLE public.marketing_email_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and managers can view marketing email drafts"
  ON public.marketing_email_drafts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admins and managers can create marketing email drafts"
  ON public.marketing_email_drafts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admins and managers can update marketing email drafts"
  ON public.marketing_email_drafts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admins and managers can delete marketing email drafts"
  ON public.marketing_email_drafts
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'manager')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_email_drafts TO authenticated;

COMMENT ON TABLE public.marketing_email_drafts IS
  'Saved marketing broadcast drafts from the admin email composer (subject, body, audience).';
