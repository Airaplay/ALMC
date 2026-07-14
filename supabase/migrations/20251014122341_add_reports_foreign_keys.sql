/*
  # Add Foreign Key Relationships to Reports Table

  1. Changes
    - Add foreign key constraint for `reporter_id` referencing `users(id)`
    - Add foreign key constraint for `reviewed_by` referencing `users(id)`
    
  2. Security
    - No changes to RLS policies
    - Maintains existing access controls
    
  3. Notes
    - These foreign keys enable Supabase's automatic relationship queries
    - Both relationships point to the users table
    - Uses CASCADE delete to remove reports when users are deleted
*/

-- Add foreign key for reporter_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'reports_reporter_id_fkey' 
    AND table_name = 'reports'
  ) THEN
    ALTER TABLE reports
      ADD CONSTRAINT reports_reporter_id_fkey
      FOREIGN KEY (reporter_id)
      REFERENCES users(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Add foreign key for reviewed_by
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'reports_reviewed_by_fkey' 
    AND table_name = 'reports'
  ) THEN
    ALTER TABLE reports
      ADD CONSTRAINT reports_reviewed_by_fkey
      FOREIGN KEY (reviewed_by)
      REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
END $$;
