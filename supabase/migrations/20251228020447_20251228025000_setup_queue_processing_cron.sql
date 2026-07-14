/*
  # Setup Automated Queue Processing with Supabase Cron

  ## Purpose
  Automatically process the job queue every minute using Supabase's built-in pg_cron extension.

  ## What It Does
  - Calls the process-job-queue edge function every minute
  - Processes up to 100 queued jobs per run
  - Automatically cleans up old jobs and expired cache
  
  ## Performance
  - Runs every 60 seconds
  - Processes 100 jobs per batch
  - Can handle 6,000+ jobs per hour

  ## Setup Instructions
  After running this migration, you need to set these values in Supabase SQL Editor:
  
  1. Get your Supabase URL and Service Role Key from Project Settings
  2. Run these commands (replace with your actual values):
  
  ALTER DATABASE postgres SET app.settings.supabase_url = 'https://your-project-id.supabase.co';
  ALTER DATABASE postgres SET app.settings.service_role_key = 'your-service-role-key-here';
  
  3. Reload config:
  
  SELECT pg_reload_conf();
*/

-- Create a stored procedure to process the queue directly
-- This can be called by pg_cron without needing HTTP calls
CREATE OR REPLACE FUNCTION process_queue_cron_job()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Process the queue batch
  PERFORM process_job_queue_batch(100, NULL);
  
  -- Cleanup old jobs
  PERFORM cleanup_old_job_queue();
  
  -- Cleanup expired cache
  PERFORM cleanup_fraud_detection_cache();
  
  -- Log the run
  INSERT INTO cron_job_logs (job_name, executed_at, status)
  VALUES ('process_queue_cron_job', NOW(), 'success')
  ON CONFLICT DO NOTHING;
  
EXCEPTION WHEN OTHERS THEN
  -- Log errors
  INSERT INTO cron_job_logs (job_name, executed_at, status, error_message)
  VALUES ('process_queue_cron_job', NOW(), 'failed', SQLERRM)
  ON CONFLICT DO NOTHING;
END;
$$;

-- Create a table to log cron job executions
CREATE TABLE IF NOT EXISTS cron_job_logs (
  id bigserial PRIMARY KEY,
  job_name text NOT NULL,
  executed_at timestamptz NOT NULL DEFAULT NOW(),
  status text NOT NULL,
  error_message text,
  created_at timestamptz DEFAULT NOW()
);

-- Index for querying logs
CREATE INDEX IF NOT EXISTS idx_cron_job_logs_executed 
  ON cron_job_logs (job_name, executed_at DESC);

-- Enable RLS
ALTER TABLE cron_job_logs ENABLE ROW LEVEL SECURITY;

-- Service role can manage logs
CREATE POLICY "Service role manages cron logs" ON cron_job_logs
  FOR ALL USING (auth.role() = 'service_role');

-- Authenticated users can view logs (for admin dashboard)
CREATE POLICY "Authenticated can view cron logs" ON cron_job_logs
  FOR SELECT USING (auth.role() = 'authenticated');

-- Schedule the cron job using pg_cron
-- This will run every minute
DO $$
BEGIN
  PERFORM cron.schedule(
    'process-job-queue-every-minute',
    '* * * * *',
    'SELECT process_queue_cron_job();'
  );
EXCEPTION WHEN OTHERS THEN
  -- If cron job already exists, update it
  PERFORM cron.unschedule('process-job-queue-every-minute');
  PERFORM cron.schedule(
    'process-job-queue-every-minute',
    '* * * * *',
    'SELECT process_queue_cron_job();'
  );
END $$;

-- Create helper functions for monitoring
CREATE OR REPLACE FUNCTION get_cron_job_status()
RETURNS TABLE (
  job_name text,
  schedule text,
  active boolean,
  last_run timestamptz,
  last_status text,
  runs_last_hour bigint,
  errors_last_hour bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    'process-job-queue-every-minute'::text as job_name,
    '* * * * *'::text as schedule,
    (SELECT active FROM cron.job WHERE jobname = 'process-job-queue-every-minute' LIMIT 1) as active,
    (SELECT executed_at FROM cron_job_logs WHERE job_name = 'process_queue_cron_job' ORDER BY executed_at DESC LIMIT 1) as last_run,
    (SELECT status FROM cron_job_logs WHERE job_name = 'process_queue_cron_job' ORDER BY executed_at DESC LIMIT 1) as last_status,
    (SELECT COUNT(*) FROM cron_job_logs WHERE job_name = 'process_queue_cron_job' AND executed_at > NOW() - INTERVAL '1 hour') as runs_last_hour,
    (SELECT COUNT(*) FROM cron_job_logs WHERE job_name = 'process_queue_cron_job' AND status = 'failed' AND executed_at > NOW() - INTERVAL '1 hour') as errors_last_hour;
$$;

CREATE OR REPLACE FUNCTION get_cron_job_history(p_hours int DEFAULT 24, p_limit int DEFAULT 100)
RETURNS TABLE (
  executed_at timestamptz,
  status text,
  error_message text,
  jobs_processed bigint,
  jobs_failed bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.executed_at,
    l.status,
    l.error_message,
    (SELECT COUNT(*) FROM job_queue WHERE status = 'completed' AND completed_at BETWEEN l.executed_at - INTERVAL '1 minute' AND l.executed_at + INTERVAL '1 minute') as jobs_processed,
    (SELECT COUNT(*) FROM job_queue WHERE status = 'failed' AND completed_at BETWEEN l.executed_at - INTERVAL '1 minute' AND l.executed_at + INTERVAL '1 minute') as jobs_failed
  FROM cron_job_logs l
  WHERE l.job_name = 'process_queue_cron_job'
    AND l.executed_at > NOW() - (p_hours || ' hours')::interval
  ORDER BY l.executed_at DESC
  LIMIT p_limit;
$$;

-- Create a comprehensive monitoring view
CREATE OR REPLACE VIEW queue_health_dashboard AS
SELECT
  -- Queue stats
  (SELECT COUNT(*) FROM job_queue WHERE status = 'pending') as pending_jobs,
  (SELECT COUNT(*) FROM job_queue WHERE status = 'processing') as processing_jobs,
  (SELECT COUNT(*) FROM job_queue WHERE status = 'retry') as retry_jobs,
  (SELECT COUNT(*) FROM job_queue WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '1 hour') as completed_last_hour,
  (SELECT COUNT(*) FROM job_queue WHERE status = 'failed' AND completed_at > NOW() - INTERVAL '1 hour') as failed_last_hour,
  
  -- Cache stats
  (SELECT COUNT(*) FROM fraud_detection_cache WHERE expires_at > NOW()) as active_cache_entries,
  
  -- Cron stats
  (SELECT active FROM cron.job WHERE jobname = 'process-job-queue-every-minute' LIMIT 1) as cron_active,
  (SELECT executed_at FROM cron_job_logs WHERE job_name = 'process_queue_cron_job' ORDER BY executed_at DESC LIMIT 1) as last_cron_run,
  (SELECT status FROM cron_job_logs WHERE job_name = 'process_queue_cron_job' ORDER BY executed_at DESC LIMIT 1) as last_cron_status,
  (SELECT COUNT(*) FROM cron_job_logs WHERE job_name = 'process_queue_cron_job' AND executed_at > NOW() - INTERVAL '1 hour') as cron_runs_last_hour,
  
  -- Oldest pending job
  (SELECT MIN(created_at) FROM job_queue WHERE status IN ('pending', 'retry')) as oldest_pending_job,
  
  -- Performance indicator
  CASE
    WHEN (SELECT COUNT(*) FROM job_queue WHERE status = 'pending') > 10000 THEN 'CRITICAL - High backlog'
    WHEN (SELECT COUNT(*) FROM job_queue WHERE status = 'pending') > 5000 THEN 'WARNING - Growing backlog'
    WHEN (SELECT COUNT(*) FROM job_queue WHERE status = 'failed' AND completed_at > NOW() - INTERVAL '1 hour') > 50 THEN 'WARNING - High failure rate'
    WHEN (SELECT active FROM cron.job WHERE jobname = 'process-job-queue-every-minute' LIMIT 1) = false THEN 'CRITICAL - Cron disabled'
    ELSE 'HEALTHY'
  END as health_status;

-- Grant permissions
GRANT EXECUTE ON FUNCTION process_queue_cron_job TO service_role;
GRANT EXECUTE ON FUNCTION get_cron_job_status TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_cron_job_history TO authenticated, service_role;
GRANT SELECT ON queue_health_dashboard TO authenticated, service_role;

-- Auto-cleanup old logs (keep last 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_cron_logs()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM cron_job_logs
  WHERE created_at < NOW() - INTERVAL '7 days';
  
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Schedule cleanup of old logs (runs daily at 3 AM)
DO $$
BEGIN
  PERFORM cron.schedule(
    'cleanup-cron-logs-daily',
    '0 3 * * *',
    'SELECT cleanup_old_cron_logs();'
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM cron.unschedule('cleanup-cron-logs-daily');
  PERFORM cron.schedule(
    'cleanup-cron-logs-daily',
    '0 3 * * *',
    'SELECT cleanup_old_cron_logs();'
  );
END $$;