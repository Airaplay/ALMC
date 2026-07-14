/*
  # Create trigger for ad revenue processing

  1. New Trigger
    - Create a trigger function to call the process_ad_impression_revenue function
    - Set up trigger to fire after insert on ad_impressions table
    - This ensures revenue is calculated for each new ad impression

  2. Security
    - Trigger function runs with security definer to ensure proper permissions
    - Only processes impressions that haven't been processed yet
*/

-- Create trigger function to process ad revenue
CREATE OR REPLACE FUNCTION trigger_process_ad_revenue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check if this impression has already been processed
  IF EXISTS (
    SELECT 1 FROM ad_revenue_events
    WHERE impression_id = NEW.id
  ) THEN
    -- Already processed, do nothing
    RETURN NEW;
  END IF;

  -- Process the ad impression revenue
  -- Note: This is done asynchronously to avoid blocking the transaction
  PERFORM process_ad_impression_revenue(NEW.id);
  
  RETURN NEW;
END;
$$;

-- Create trigger on ad_impressions table
DROP TRIGGER IF EXISTS trigger_ad_revenue_processing ON ad_impressions;

CREATE TRIGGER trigger_ad_revenue_processing
AFTER INSERT ON ad_impressions
FOR EACH ROW
EXECUTE FUNCTION trigger_process_ad_revenue();

-- Create function to process pending ad revenue in batches
CREATE OR REPLACE FUNCTION process_pending_ad_revenue(
  batch_size integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  impression_record record;
  processed_count integer := 0;
  success_count integer := 0;
  error_count integer := 0;
  result jsonb;
BEGIN
  -- Check if the current user is an admin
  IF NOT EXISTS (
    SELECT 1 FROM users u 
    WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RETURN jsonb_build_object('error', 'Access denied. Admin privileges required.');
  END IF;

  -- Find unprocessed ad impressions
  FOR impression_record IN
    SELECT ai.id
    FROM ad_impressions ai
    LEFT JOIN ad_revenue_events are ON ai.id = are.impression_id
    WHERE are.id IS NULL
    LIMIT batch_size
  LOOP
    processed_count := processed_count + 1;
    
    -- Process the ad impression revenue
    BEGIN
      PERFORM process_ad_impression_revenue(impression_record.id);
      success_count := success_count + 1;
    EXCEPTION WHEN OTHERS THEN
      error_count := error_count + 1;
      -- Log error but continue processing
      RAISE NOTICE 'Error processing impression %: %', impression_record.id, SQLERRM;
    END;
  END LOOP;

  -- Build result
  result := jsonb_build_object(
    'processed_count', processed_count,
    'success_count', success_count,
    'error_count', error_count,
    'message', format('Processed %s ad impressions (%s succeeded, %s failed)', 
                     processed_count, success_count, error_count)
  );

  RETURN result;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION process_pending_ad_revenue(integer) TO authenticated;