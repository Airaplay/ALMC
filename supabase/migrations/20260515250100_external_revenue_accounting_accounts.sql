/*
  # External Revenue Sharing — Chart of Accounts + transaction type

  Adds:
    - COA accounts 2050 (ListenerBalancesPayable), 4020 (ExternalRevenue) and
      optional sub-revenue accounts 4021-4023.
    - Extends treat_transactions.transaction_type CHECK to allow
      'external_revenue_reward' for direct-credit listener payouts (Mode B).

  Notes:
    - Trial balance and AccountingSection.tsx automatically pick up new
      accounts (they iterate accounting_accounts).
    - We do NOT modify any existing constraint behaviour beyond extending the
      allowed transaction_type list.
*/

-- ============================================================================
-- 1) New COA accounts (idempotent)
-- ============================================================================

INSERT INTO public.accounting_accounts (code, name, type, normal_balance)
VALUES
  ('2050', 'ListenerBalancesPayable_USD', 'liability', 'credit'),
  ('4020', 'ExternalRevenue_USD',         'revenue',   'credit'),
  ('4021', 'SubscriptionRevenue_USD',     'revenue',   'credit'),
  ('4022', 'SponsorshipRevenue_USD',      'revenue',   'credit'),
  ('4023', 'PartnershipRevenue_USD',      'revenue',   'credit')
ON CONFLICT (code) DO NOTHING;

COMMENT ON COLUMN public.accounting_accounts.code IS
  '1000=Cash, 2000=CreatorBalancesPayable, 2050=ListenerBalancesPayable, 2100=CuratorBalancesPayable, '
  '4000=PlatformAdRevenue, 4010=TreatRevenue, 4020=ExternalRevenue (+4021-4023 sub-sources).';

-- ============================================================================
-- 2) Extend treat_transactions.transaction_type to allow external_revenue_reward
--    (and preserve every existing allowed type — superset, not replacement).
-- ============================================================================

DO $$
DECLARE
  v_constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'treat_transactions_transaction_type_check'
      AND conrelid = 'public.treat_transactions'::regclass
  ) INTO v_constraint_exists;

  IF v_constraint_exists THEN
    ALTER TABLE public.treat_transactions
      DROP CONSTRAINT treat_transactions_transaction_type_check;
  END IF;

  ALTER TABLE public.treat_transactions
    ADD CONSTRAINT treat_transactions_transaction_type_check
    CHECK (transaction_type IN (
      'purchase',
      'spend',
      'earn',
      'withdraw',
      'withdrawal',
      'tip_sent',
      'tip_received',
      'daily_checkin',
      'referral_bonus',
      'promotion_refund',
      'ad_revenue',
      'stream_revenue',
      'promotion_spent',
      'contribution_reward',
      'external_revenue_reward'
    ));
END $$;

COMMENT ON CONSTRAINT treat_transactions_transaction_type_check
  ON public.treat_transactions IS
  'Allowed treat transaction types. Extended for external_revenue_reward (Mode B direct credit) without removing any prior allowed value.';
