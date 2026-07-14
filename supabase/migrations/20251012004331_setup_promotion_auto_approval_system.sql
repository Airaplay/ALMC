/*
  # Setup Promotion Auto-Approval System

  ## Overview
  This migration sets up an automated system to approve pending promotions when auto-approval is enabled.
  The system runs every 10 minutes and automatically approves promotions that are in pending_approval status.

  ## Changes Made

  1. Enable pg_cron Extension
     - Required for scheduling periodic jobs in PostgreSQL

  2. Create Auto-Approval Function
     - auto_approve_pending_promotions() - Automatically approves pending promotions when auto-approval setting is enabled
     - Checks the promotion_global_settings.auto_approval_enabled flag
     - Updates promotion status from pending_approval to active
     - Sets the start_date to the current timestamp

  3. Schedule Cron Job
     - Runs every 10 minutes
     - Executes the auto-approval function
     - Named: auto-approve-promotions

  ## Security
  - Function runs with security definer privileges to ensure proper execution
  - Only affects promotions in pending_approval status
  - Respects the global auto_approval_enabled setting

  ## Notes
  - The cron job runs continuously in the background
  - Admin can enable/disable auto-approval via the settings toggle
  - When disabled, pending promotions remain in pending_approval status until manually approved
*/

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create function to auto-approve pending promotions
CREATE OR REPLACE FUNCTION auto_approve_pending_promotions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  auto_approval_enabled boolean;
  approved_count integer := 0;
BEGIN
  -- Check if auto-approval is enabled
  SELECT pgs.auto_approval_enabled INTO auto_approval_enabled
  FROM promotion_global_settings pgs
  LIMIT 1;

  -- If auto-approval is not enabled, exit early
  IF auto_approval_enabled IS NULL OR auto_approval_enabled = false THEN
    RAISE NOTICE 'Auto-approval is disabled. Skipping auto-approval process.';
    RETURN;
  END IF;

  -- Auto-approve all pending promotions
  UPDATE promotions
  SET 
    status = 'active',
    start_date = now(),
    updated_at = now()
  WHERE status = 'pending_approval'
    AND (end_date IS NULL OR end_date > now());

  GET DIAGNOSTICS approved_count = ROW_COUNT;

  RAISE NOTICE 'Auto-approved % promotion(s)', approved_count;
END;
$$;

-- Schedule the cron job to run every 10 minutes
DO $$
BEGIN
  -- Remove existing job if it exists
  PERFORM cron.unschedule('auto-approve-promotions') 
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'auto-approve-promotions'
  );
END $$;

-- Create new cron job to run every 10 minutes
SELECT cron.schedule(
  'auto-approve-promotions',
  '*/10 * * * *',
  'SELECT auto_approve_pending_promotions()'
);

-- Grant necessary permissions
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;
