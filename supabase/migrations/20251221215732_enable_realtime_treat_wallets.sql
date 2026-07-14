/*
  # Enable Realtime for Treat Wallets

  ## Problem
  The TreatWalletWidget subscribes to real-time updates on the treat_wallets table,
  but realtime is not enabled for this table. This means balance updates don't
  appear in real-time in the UI.

  ## Solution
  - Enable realtime for the treat_wallets table
  - Set replica identity to FULL so all column changes are broadcast

  ## Changes
  1. Add treat_wallets to the supabase_realtime publication
  2. Set replica identity to FULL for complete change tracking
*/

-- Enable realtime for treat_wallets table
ALTER PUBLICATION supabase_realtime ADD TABLE treat_wallets;

-- Set replica identity to FULL to broadcast all column changes
-- This ensures the real-time listener receives the complete updated row
ALTER TABLE treat_wallets REPLICA IDENTITY FULL;

COMMENT ON TABLE treat_wallets IS 'User treat wallet balances with realtime updates enabled';
