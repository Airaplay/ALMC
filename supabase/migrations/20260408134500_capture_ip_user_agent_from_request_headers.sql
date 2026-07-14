/*
  # Capture IP/User-Agent server-side for playback history

  Problem:
  - Client currently sends p_ip_address = null for playback RPCs and direct inserts
  - IP-based bot detection needs ip_address populated reliably

  Solution:
  - Extract IP and User-Agent from PostgREST request headers when available:
    current_setting('request.headers', true)::jsonb
  - BEFORE INSERT triggers populate ip_address/user_agent if missing on:
    - listening_history
    - video_playback_history

  Notes:
  - Works for authenticated + anon inserts through PostgREST.
  - If headers are unavailable (non-HTTP context, batch jobs), leaves fields unchanged.
*/

-- Helper: get headers as jsonb (safe).
CREATE OR REPLACE FUNCTION public._request_headers()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb)
$$;

-- Helper: best-effort client IP from headers.
CREATE OR REPLACE FUNCTION public.get_request_ip_address()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_headers jsonb;
  v_xff text;
  v_ip text;
BEGIN
  v_headers := public._request_headers();

  -- Prefer X-Forwarded-For (first IP in list)
  v_xff := COALESCE(v_headers->>'x-forwarded-for', v_headers->>'X-Forwarded-For');
  IF v_xff IS NOT NULL AND length(btrim(v_xff)) > 0 THEN
    v_ip := split_part(v_xff, ',', 1);
    v_ip := btrim(v_ip);
    IF length(v_ip) > 0 THEN
      RETURN v_ip;
    END IF;
  END IF;

  -- Fallbacks sometimes present in edge/proxy setups
  v_ip := COALESCE(
    NULLIF(btrim(v_headers->>'x-real-ip'), ''),
    NULLIF(btrim(v_headers->>'X-Real-IP'), ''),
    NULLIF(btrim(v_headers->>'cf-connecting-ip'), ''),
    NULLIF(btrim(v_headers->>'CF-Connecting-IP'), '')
  );

  RETURN v_ip;
END;
$$;

-- Helper: user agent from headers.
CREATE OR REPLACE FUNCTION public.get_request_user_agent()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(public._request_headers()->>'user-agent', '')
$$;

-- Trigger function to populate request metadata
CREATE OR REPLACE FUNCTION public.set_request_metadata_on_playback_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ip_address IS NULL THEN
    NEW.ip_address := public.get_request_ip_address();
  END IF;

  IF NEW.user_agent IS NULL THEN
    NEW.user_agent := public.get_request_user_agent();
  END IF;

  RETURN NEW;
END;
$$;

-- Attach triggers (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='listening_history') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_set_request_metadata_listening_history') THEN
      CREATE TRIGGER tr_set_request_metadata_listening_history
      BEFORE INSERT ON public.listening_history
      FOR EACH ROW
      EXECUTE FUNCTION public.set_request_metadata_on_playback_history();
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='video_playback_history') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_set_request_metadata_video_playback_history') THEN
      CREATE TRIGGER tr_set_request_metadata_video_playback_history
      BEFORE INSERT ON public.video_playback_history
      FOR EACH ROW
      EXECUTE FUNCTION public.set_request_metadata_on_playback_history();
    END IF;
  END IF;
END $$;

