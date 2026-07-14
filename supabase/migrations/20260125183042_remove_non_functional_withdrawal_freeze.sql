/*
  # Remove Non-Functional Withdrawal Freeze Control

  1. Changes
    - Removes the `withdrawal_freeze` control from `platform_financial_controls` table
    - This control was not being used in the actual withdrawal flow
    - The functional withdrawal control is `withdrawals_enabled` in the `withdrawal_settings` table

  2. Reasoning
    - The UI calls `admin_approve_withdrawal()` which doesn't check `withdrawal_freeze`
    - Only `admin_approve_withdrawal_with_reserve_check()` checks it, but it's never called
    - Removing redundant control to avoid confusion
    - Admins should use the Master Withdrawal Control in Withdrawal Settings instead
*/

-- Remove the non-functional withdrawal_freeze control
DELETE FROM platform_financial_controls
WHERE control_name = 'withdrawal_freeze';

-- Add a note to help admins understand where to control withdrawals
COMMENT ON TABLE platform_financial_controls IS 'Platform-wide financial controls. Note: To control withdrawal access, use the withdrawals_enabled field in the withdrawal_settings table (accessible via Earnings & Payout Settings → Withdrawal Settings in the admin dashboard).';