/*
  # Native Ad Audio Settings

  Admin-configurable cadence for audio ads between songs.
*/

CREATE TABLE IF NOT EXISTS public.native_ad_audio_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  insertion_interval_songs integer NOT NULL DEFAULT 5 CHECK (insertion_interval_songs IN (2, 3, 5, 6, 8, 10)),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.native_ad_audio_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read native ad audio settings"
  ON public.native_ad_audio_settings
  FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert native ad audio settings"
  ON public.native_ad_audio_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
    )
  );

CREATE POLICY "Admins can update native ad audio settings"
  ON public.native_ad_audio_settings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
    )
  );

INSERT INTO public.native_ad_audio_settings (id, insertion_interval_songs)
VALUES (true, 5)
ON CONFLICT (id) DO NOTHING;

