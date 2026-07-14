/*
  # Add Auto Generate to Daily Mix Config

  ## Summary
  Adds an `auto_generate` boolean column to the `daily_mix_config` table to control
  whether the Daily Mix AI system should automatically generate mixes on a schedule.

  ## Changes
  - `daily_mix_config` table: adds `auto_generate` column (boolean, default false)
  - Updates the existing config row to have auto_generate = false by default

  ## Notes
  - Default is false (off) to preserve existing manual-only behavior
  - When true, the cron job will trigger mix generation at the configured refresh_hour
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_mix_config' AND column_name = 'auto_generate'
  ) THEN
    ALTER TABLE daily_mix_config ADD COLUMN auto_generate boolean NOT NULL DEFAULT false;
  END IF;
END $$;
