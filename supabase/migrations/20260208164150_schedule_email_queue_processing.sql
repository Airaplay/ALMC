/*
  # Schedule Email Queue Processing with pg_cron
  
  Sets up automatic email queue processing every 5 minutes using pg_cron.
  
  ## What This Does
  
  1. Creates a scheduled job that runs every 5 minutes
  2. Calls process_email_queue() to send pending emails
  3. Processes up to 20 emails per run
  
  ## Schedule
  
  - Runs: Every 5 minutes
  - Function: process_email_queue(20)
  - Max emails per run: 20
  - Daily capacity: approximately 5,760 emails
  
  ## Monitoring
  
  Check job status:
  SELECT * FROM cron.job WHERE jobname = 'process-email-queue-every-5-minutes';
  
  Check recent job runs:
  SELECT * FROM cron.job_run_details 
  WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'process-email-queue-every-5-minutes')
  ORDER BY start_time DESC LIMIT 10;
*/

-- Remove existing job if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-email-queue-every-5-minutes') THEN
    PERFORM cron.unschedule('process-email-queue-every-5-minutes');
    RAISE NOTICE 'Removed existing email queue processing job';
  END IF;
END $$;

-- Schedule email queue processing every 5 minutes
SELECT cron.schedule(
  'process-email-queue-every-5-minutes',
  '*/5 * * * *',
  'SELECT process_email_queue(20);'
);

-- Verify job was created
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
    RAISE NOTICE '=================================================';
    RAISE NOTICE 'Email Queue Processing - SCHEDULED SUCCESSFULLY';
    RAISE NOTICE '=================================================';
    RAISE NOTICE 'Job ID: %', v_jobid;
    RAISE NOTICE 'Schedule: % (every 5 minutes)', v_schedule;
    RAISE NOTICE 'Command: %', v_command;
    RAISE NOTICE '';
    RAISE NOTICE 'Emails will be automatically processed every 5 minutes.';
    RAISE NOTICE 'Monitor with: SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;';
  ELSE
    RAISE WARNING 'Failed to schedule email queue processing job';
  END IF;
END $$;
