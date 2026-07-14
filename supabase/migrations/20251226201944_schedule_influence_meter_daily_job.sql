/*
  # Schedule Daily Cron Job for Fan Influence Meter

  ## Overview
  Schedules a daily automated task to scan for trending content and award
  influence points to early discoverers. Runs every day at 3 AM UTC.

  ## Changes
  
  Creates daily cron job:
  - Job name: `update_trending_discoveries_daily`
  - Schedule: Every day at 3:00 AM UTC (0 3 * * *)
  - Action: Calls `update_trending_discoveries()` function
  - Purpose: Awards points to users who discovered content early that has now become trending (10K+ plays)

  ## How It Works
  
  - Runs automatically every 24 hours at 3 AM UTC
  - Scans songs and videos that crossed 10,000 plays
  - Identifies users who discovered them early (<1000 plays)
  - Awards 100 influence points to each early discoverer
  - Updates user ranks based on new scores
  
  ## Monitoring
  
  Check cron job status:
  ```sql
  SELECT * FROM cron.job WHERE jobname = 'update_trending_discoveries_daily';
  ```
  
  View execution history:
  ```sql
  SELECT * FROM cron.job_run_details 
  WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'update_trending_discoveries_daily')
  ORDER BY start_time DESC LIMIT 10;
  ```
  
  Manual trigger (for testing):
  ```sql
  SELECT update_trending_discoveries();
  ```
*/

-- Remove existing job if it exists (to allow re-running migration)
DO $$
BEGIN
  PERFORM cron.unschedule('update_trending_discoveries_daily')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'update_trending_discoveries_daily'
  );
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- Schedule daily job to update trending discoveries and award points
-- Runs every day at 3:00 AM UTC
SELECT cron.schedule(
  'update_trending_discoveries_daily',
  '0 3 * * *',
  $$SELECT update_trending_discoveries()$$
);