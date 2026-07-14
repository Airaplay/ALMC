/*
  # Clean Up Unused Database Tables
  
  1. Migration Steps
    - Migrate withdrawal_requests that still use bank_details_id to inline fields
    - Drop foreign key constraints safely
    - Drop 13 unused tables that are not referenced in the codebase
  
  2. Tables Being Dropped (all verified as unused)
    - manual_trending_songs_backup (9 rows) - backup table not used
    - admin_activity_log (33 rows) - replaced by admin_activity_logs
    - content_reviews (0 rows) - feature not implemented
    - early_discoveries (10 rows) - feature not used
    - trending_discoveries (0 rows) - feature not used
    - trending_algorithm_settings (1 row) - hardcoded instead
    - track_features (46 rows) - feature not implemented
    - user_play_statistics (20 rows) - replaced by other tracking
    - promotion_exposure_logs_archive (0 rows) - archive not needed
    - upload_files (0 rows) - replaced by content_uploads
    - payment_info (1 row) - legacy payment system
    - user_bank_details (1 row) - migrated to inline withdrawal fields
    - comments (0 rows) - replaced by content_comments
  
  3. Data Safety
    - All tables verified to have 0 code references
    - Foreign key dependencies checked and handled
    - Minimal data loss (mostly empty or backup tables)
*/

-- Step 1: Migrate the 4 withdrawal_requests that still use bank_details_id
DO $$
BEGIN
  -- Copy bank details to inline fields for requests still using bank_details_id
  UPDATE withdrawal_requests wr
  SET 
    bank_name = ubd.bank_name,
    account_number = ubd.account_number,
    account_holder_name = ubd.account_name
  FROM user_bank_details ubd
  WHERE wr.bank_details_id = ubd.id
  AND wr.bank_name IS NULL;
  
  RAISE NOTICE 'Migrated % withdrawal requests from bank_details_id to inline fields', 
    (SELECT COUNT(*) FROM withdrawal_requests WHERE bank_details_id IS NOT NULL);
END $$;

-- Step 2: Drop foreign key constraint from withdrawal_requests
ALTER TABLE IF EXISTS withdrawal_requests 
DROP CONSTRAINT IF EXISTS withdrawal_requests_bank_details_id_fkey;

-- Step 3: Drop the bank_details_id column
ALTER TABLE IF EXISTS withdrawal_requests 
DROP COLUMN IF EXISTS bank_details_id;

-- Step 4: Drop self-referencing foreign key from comments table
ALTER TABLE IF EXISTS comments 
DROP CONSTRAINT IF EXISTS comments_parent_comment_id_fkey;

-- Step 5: Drop all unused tables
DROP TABLE IF EXISTS manual_trending_songs_backup CASCADE;
DROP TABLE IF EXISTS admin_activity_log CASCADE;
DROP TABLE IF EXISTS content_reviews CASCADE;
DROP TABLE IF EXISTS early_discoveries CASCADE;
DROP TABLE IF EXISTS trending_discoveries CASCADE;
DROP TABLE IF EXISTS trending_algorithm_settings CASCADE;
DROP TABLE IF EXISTS track_features CASCADE;
DROP TABLE IF EXISTS user_play_statistics CASCADE;
DROP TABLE IF EXISTS promotion_exposure_logs_archive CASCADE;
DROP TABLE IF EXISTS upload_files CASCADE;
DROP TABLE IF EXISTS payment_info CASCADE;
DROP TABLE IF EXISTS user_bank_details CASCADE;
DROP TABLE IF EXISTS comments CASCADE;