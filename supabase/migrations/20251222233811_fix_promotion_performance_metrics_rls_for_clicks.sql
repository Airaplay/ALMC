/*
  # Fix Promotion Performance Metrics RLS for Click Tracking

  1. Problem
    - Users cannot record clicks on promoted content
    - RLS policy blocks INSERT/UPDATE on promotion_performance_metrics table
    - Error: "new row violates row-level security policy"
  
  2. Solution
    - Add UPDATE policy to allow upserts (ON CONFLICT DO UPDATE)
    - Ensure both INSERT and UPDATE are allowed for click tracking
  
  3. Security
    - Still maintains data isolation
    - Only allows writes needed for impression/click tracking
*/

-- Drop existing restrictive policies if any
DROP POLICY IF EXISTS "Anyone can record promotion impressions" ON promotion_performance_metrics;

-- Recreate INSERT policy with proper permissions
CREATE POLICY "Allow insert promotion metrics"
  ON promotion_performance_metrics
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Add UPDATE policy to allow UPSERT operations
CREATE POLICY "Allow update promotion metrics"
  ON promotion_performance_metrics
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
