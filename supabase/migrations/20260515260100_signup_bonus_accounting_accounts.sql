/*
  # Sign-up Treat Bonus — Chart of Accounts

  Adds two new accounts so the cost of the sign-up bonus shows up in the
  Accounting / Trial Balance views automatically (AccountingSection.tsx
  iterates accounting_accounts).

    - 5100 SignupBonus_Expense_USD       (expense,   normal: debit)
        Marketing/acquisition cost when we credit a new user with promo
        Treats.
    - 2400 UnredeemedPromoCredits_USD    (liability, normal: credit)
        Obligation to honour the bonus inside the platform (user can spend
        promo treats on platform features, but cannot cash out).

  Idempotent: ON CONFLICT (code) DO NOTHING.
*/

INSERT INTO public.accounting_accounts (code, name, type, normal_balance)
VALUES
  ('5100', 'SignupBonus_Expense_USD',     'expense',   'debit'),
  ('2400', 'UnredeemedPromoCredits_USD',  'liability', 'credit')
ON CONFLICT (code) DO NOTHING;

COMMENT ON COLUMN public.accounting_accounts.code IS
  '1000=Cash, 2000=CreatorBalancesPayable, 2050=ListenerBalancesPayable, '
  '2100=CuratorBalancesPayable, 2400=UnredeemedPromoCredits, '
  '4000=PlatformAdRevenue, 4010=TreatRevenue, 4020=ExternalRevenue '
  '(+4021-4023 sub-sources), 5100=SignupBonus_Expense.';
