/*
  # Enable Realtime for Promotions Table

  1. Changes
    - Enable realtime publication for promotions table
    - This allows clients to subscribe to live updates when clicks/impressions change
  
  2. Purpose
    - Ensures Promotion Center screen shows live click/impression counts
    - Automatically updates UI when promoted content is clicked
*/

-- Enable realtime for promotions table (if not already enabled)
DO $$
BEGIN
  -- Check if the table is already in the publication
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND schemaname = 'public' 
    AND tablename = 'promotions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE promotions;
  END IF;
END $$;
