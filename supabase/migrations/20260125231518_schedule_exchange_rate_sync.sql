/*
  # Schedule Exchange Rate Sync Every Hour

  1. Configuration
    - Creates pg_cron job to sync exchange rates hourly
    - Calls auto-sync-exchange-rates edge function
    - Runs at minute 0 of every hour

  2. Purpose
    - Automatically fetches latest rates from exchangerate-api.com
    - Applies 3% reduction buffer
    - Updates withdrawal_exchange_rates table
*/

-- Schedule the cron job to sync exchange rates every hour
-- Note: pg_cron extension should already be enabled in Supabase
SELECT cron.schedule(
  'auto-sync-exchange-rates-hourly',
  '0 * * * *', -- At minute 0 of every hour
  $$
  SELECT
    net.http_post(
      url := 'https://vwcadgjaivvffxwgnkzy.supabase.co/functions/v1/auto-sync-exchange-rates',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('SUPABASE_SERVICE_ROLE_KEY', true)
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
