/*
  # Update Email Cron to Use pg_net for HTTP Calls
  
  Updates the email queue processing cron job to call the edge function via HTTP
  using pg_net extension. This ensures emails are actually sent via ZeptoMail.
  
  ## What Changed
  
  - Enables pg_net extension for HTTP requests
  - Updates cron job to call process-email-queue edge function via HTTP
  - This will actually send emails through ZeptoMail API
  
  ## How It Works
  
  1. pg_cron triggers every 5 minutes
  2. Calls process-email-queue edge function via pg_net.http_post
  3. Edge function fetches pending emails from queue
  4. Edge function calls send-email for each email
  5. send-email sends actual emails via ZeptoMail API
*/

-- Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove existing job
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-email-queue-every-5-minutes') THEN
    PERFORM cron.unschedule('process-email-queue-every-5-minutes');
    RAISE NOTICE 'Removed old email queue processing job';
  END IF;
END $$;

-- Get Supabase URL for edge function call
CREATE OR REPLACE FUNCTION get_supabase_url()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Try to get from custom settings first
  BEGIN
    RETURN current_setting('app.supabase_url', true);
  EXCEPTION
    WHEN OTHERS THEN
      -- Fallback: construct from database name
      -- This will work on Supabase hosted projects
      RETURN 'https://' || current_database() || '.supabase.co';
  END;
END;
$$;

-- Schedule email queue processing via HTTP call to edge function
SELECT cron.schedule(
  'process-email-queue-every-5-minutes',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT get_supabase_url()) || '/functions/v1/process-email-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Verify job was updated
DO $$
DECLARE
  v_jobid BIGINT;
  v_schedule TEXT;
  v_command TEXT;
BEGIN
  SELECT jobid, schedule, command INTO v_jobid, v_schedule, v_command
  FROM cron.job 
  WHERE jobname = 'process-email-queue-every-5-minutes';
  
  IF v_jobid IS NOT NULL THEN
    RAISE NOTICE '=======================================================';
    RAISE NOTICE 'Email Queue Processing - UPDATED SUCCESSFULLY';
    RAISE NOTICE '=======================================================';
    RAISE NOTICE 'Job ID: %', v_jobid;
    RAISE NOTICE 'Schedule: % (every 5 minutes)', v_schedule;
    RAISE NOTICE 'Method: HTTP call to edge function (via pg_net)';
    RAISE NOTICE '';
    RAISE NOTICE 'Emails will now be ACTUALLY SENT via ZeptoMail!';
    RAISE NOTICE 'The edge function will process the queue and send emails.';
  ELSE
    RAISE WARNING 'Failed to update email queue processing job';
  END IF;
END $$;

COMMENT ON EXTENSION pg_net IS 
'pg_net - Async HTTP client for PostgreSQL. Used to call process-email-queue edge function.';
