/*
  # Flagged Content / Plays
 
  Adds an append-only table of suspicious play events, so Admin can review:
  - which content is being abused
  - which users are involved
  - the reason + request metadata (ip/user-agent) when available
*/
 
CREATE TABLE IF NOT EXISTS public.flagged_play_events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_id uuid NOT NULL,
  content_type text NOT NULL, -- e.g. song | audio | video
  reason text,
  ip_address text,
  user_agent text,
  detected_at timestamptz NOT NULL DEFAULT now(),
 
  review_status text NOT NULL DEFAULT 'pending', -- pending | cleared | confirmed
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.users(id),
  review_notes text
);
 
CREATE INDEX IF NOT EXISTS idx_flagged_play_events_detected_at
  ON public.flagged_play_events(detected_at DESC);
 
CREATE INDEX IF NOT EXISTS idx_flagged_play_events_review_status
  ON public.flagged_play_events(review_status, detected_at DESC);
 
CREATE INDEX IF NOT EXISTS idx_flagged_play_events_user
  ON public.flagged_play_events(user_id, detected_at DESC);
 
CREATE INDEX IF NOT EXISTS idx_flagged_play_events_content
  ON public.flagged_play_events(content_type, content_id, detected_at DESC);
 
ALTER TABLE public.flagged_play_events ENABLE ROW LEVEL SECURITY;
 
-- Admins/managers can view flagged play events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'flagged_play_events'
      AND policyname = 'Admins can view flagged play events'
  ) THEN
    CREATE POLICY "Admins can view flagged play events"
      ON public.flagged_play_events FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.users
          WHERE public.users.id = auth.uid()
            AND public.users.role IN ('admin', 'manager')
        )
      );
  END IF;
END $$;
 
-- Service role can manage events (for automated insertion)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'flagged_play_events'
      AND policyname = 'Service role can manage flagged play events'
  ) THEN
    CREATE POLICY "Service role can manage flagged play events"
      ON public.flagged_play_events FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
 
-- Admin RPC: review/clear flagged play event
CREATE OR REPLACE FUNCTION public.admin_review_flagged_play_event(
  p_event_id bigint,
  p_clear boolean,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id
  FROM public.users
  WHERE id = auth.uid()
    AND role IN ('admin', 'manager');
 
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;
 
  UPDATE public.flagged_play_events
  SET
    review_status = CASE WHEN p_clear THEN 'cleared' ELSE 'confirmed' END,
    reviewed_at = now(),
    reviewed_by = v_admin_id,
    review_notes = p_notes
  WHERE id = p_event_id;
END;
$$;
 
GRANT EXECUTE ON FUNCTION public.admin_review_flagged_play_event(bigint, boolean, text) TO authenticated;

