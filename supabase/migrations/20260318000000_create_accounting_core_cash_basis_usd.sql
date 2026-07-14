/*
  # Accounting Core (USD-only, Cash Basis)

  Provides:
  - Chart of accounts
  - Double-entry journal (entries + lines)
  - Admin-only posting RPCs for:
    - AdMob daily cash received (from ad_daily_revenue_input)
    - Treat payments cash received (from treat_payments)
    - Withdrawals paid (from withdrawal_requests)

  Safe defaults:
  - Single combined cash account for withdrawals (1000 Cash_USD)
*/

-- 1) Chart of accounts
CREATE TABLE IF NOT EXISTS public.accounting_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  normal_balance text NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounting_accounts ENABLE ROW LEVEL SECURITY;

-- 2) Journal entries (header)
CREATE TABLE IF NOT EXISTS public.accounting_journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  memo text,
  posted_by uuid DEFAULT auth.uid(),
  posted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id)
);

ALTER TABLE public.accounting_journal_entries ENABLE ROW LEVEL SECURITY;

-- 3) Journal lines (detail)
CREATE TABLE IF NOT EXISTS public.accounting_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.accounting_journal_entries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounting_accounts(id) ON DELETE RESTRICT,
  debit_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (debit_usd >= 0),
  credit_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (credit_usd >= 0),
  artist_id uuid NULL,
  user_id uuid NULL,
  revenue_date date NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounting_journal_lines_entry_id ON public.accounting_journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_accounting_journal_lines_account_id ON public.accounting_journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_accounting_journal_entries_date ON public.accounting_journal_entries(entry_date DESC);

ALTER TABLE public.accounting_journal_lines ENABLE ROW LEVEL SECURITY;

-- 4) RLS: admin-only access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='accounting_accounts' AND policyname='Admin manage accounting accounts'
  ) THEN
    CREATE POLICY "Admin manage accounting accounts"
    ON public.accounting_accounts
    FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='accounting_journal_entries' AND policyname='Admin manage journal entries'
  ) THEN
    CREATE POLICY "Admin manage journal entries"
    ON public.accounting_journal_entries
    FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='accounting_journal_lines' AND policyname='Admin manage journal lines'
  ) THEN
    CREATE POLICY "Admin manage journal lines"
    ON public.accounting_journal_lines
    FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;

-- 5) Seed minimal COA (idempotent)
INSERT INTO public.accounting_accounts (code, name, type, normal_balance)
VALUES
  ('1000', 'Cash_USD', 'asset', 'debit'),
  ('2000', 'CreatorBalancesPayable_USD', 'liability', 'credit'),
  ('2100', 'CuratorBalancesPayable_USD', 'liability', 'credit'),
  ('4000', 'PlatformAdRevenue_USD', 'revenue', 'credit'),
  ('4010', 'TreatRevenue_USD', 'revenue', 'credit')
ON CONFLICT (code) DO NOTHING;

-- Helper: get account id by code
CREATE OR REPLACE FUNCTION public.accounting_get_account_id(p_code text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT id FROM public.accounting_accounts WHERE code = p_code AND is_active = true LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.accounting_get_account_id(text) TO authenticated;

-- Helper: admin guard
CREATE OR REPLACE FUNCTION public.accounting_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin');
$$;

GRANT EXECUTE ON FUNCTION public.accounting_is_admin() TO authenticated;

-- 6) Posting: AdMob daily cash received (cash basis, usable revenue)
CREATE OR REPLACE FUNCTION public.admin_post_admob_daily_cash(p_revenue_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_input record;
  v_caps record;
  v_entry_id uuid;
  v_cash_id uuid;
  v_creator_payable_id uuid;
  v_platform_rev_id uuid;
  v_usable numeric;
  v_creator_pool numeric;
  v_platform_share numeric;
BEGIN
  IF NOT public.accounting_is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Access denied');
  END IF;

  SELECT * INTO v_input
  FROM public.ad_daily_revenue_input
  WHERE revenue_date = p_revenue_date
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No ad_daily_revenue_input for date');
  END IF;

  IF COALESCE(v_input.is_locked, false) = false THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Date must be locked before posting');
  END IF;

  -- Idempotent by (source_type, source_id)
  IF EXISTS (
    SELECT 1 FROM public.accounting_journal_entries
    WHERE source_type = 'admob_daily_cash' AND source_id = p_revenue_date::text
  ) THEN
    RETURN jsonb_build_object('ok', true, 'status', 'already_posted');
  END IF;

  SELECT * INTO v_caps
  FROM public.ad_safety_caps
  WHERE is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No active ad_safety_caps');
  END IF;

  v_cash_id := public.accounting_get_account_id('1000');
  v_creator_payable_id := public.accounting_get_account_id('2000');
  v_platform_rev_id := public.accounting_get_account_id('4000');

  IF v_cash_id IS NULL OR v_creator_payable_id IS NULL OR v_platform_rev_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing required accounts in COA');
  END IF;

  v_usable := COALESCE(v_input.total_revenue_usd, 0) * (COALESCE(v_input.safety_buffer_percentage, 0) / 100.0);
  v_creator_pool := v_usable * (COALESCE(v_caps.artist_revenue_percentage, 50.0) / 100.0);
  v_platform_share := v_usable - v_creator_pool;

  INSERT INTO public.accounting_journal_entries (entry_date, source_type, source_id, memo)
  VALUES (p_revenue_date, 'admob_daily_cash', p_revenue_date::text, 'AdMob cash received (usable) and split posted')
  RETURNING id INTO v_entry_id;

  -- Debit Cash
  INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, revenue_date)
  VALUES (v_entry_id, v_cash_id, v_usable, 0, p_revenue_date);

  -- Credit Platform Ad Revenue
  INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, revenue_date)
  VALUES (v_entry_id, v_platform_rev_id, 0, v_platform_share, p_revenue_date);

  -- Credit Creator Payable (liability)
  INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, revenue_date)
  VALUES (v_entry_id, v_creator_payable_id, 0, v_creator_pool, p_revenue_date);

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'posted',
    'entry_id', v_entry_id,
    'usable_usd', v_usable,
    'creator_pool_usd', v_creator_pool,
    'platform_share_usd', v_platform_share
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_post_admob_daily_cash(date) TO authenticated;

-- 7) Posting: Treat payment received (cash basis)
CREATE OR REPLACE FUNCTION public.admin_post_treat_payment_cash(p_treat_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_payment record;
  v_entry_id uuid;
  v_cash_id uuid;
  v_rev_id uuid;
BEGIN
  IF NOT public.accounting_is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Access denied');
  END IF;

  SELECT * INTO v_payment
  FROM public.treat_payments
  WHERE id = p_treat_payment_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Treat payment not found');
  END IF;

  IF v_payment.status <> 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Treat payment must be completed');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.accounting_journal_entries
    WHERE source_type = 'treat_payment_cash' AND source_id = p_treat_payment_id::text
  ) THEN
    RETURN jsonb_build_object('ok', true, 'status', 'already_posted');
  END IF;

  v_cash_id := public.accounting_get_account_id('1000');
  v_rev_id := public.accounting_get_account_id('4010');

  INSERT INTO public.accounting_journal_entries (entry_date, source_type, source_id, memo)
  VALUES (v_payment.created_at::date, 'treat_payment_cash', p_treat_payment_id::text, 'Treat payment received')
  RETURNING id INTO v_entry_id;

  INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, user_id)
  VALUES (v_entry_id, v_cash_id, COALESCE(v_payment.amount_usd, 0), 0, v_payment.user_id);

  INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, user_id)
  VALUES (v_entry_id, v_rev_id, 0, COALESCE(v_payment.amount_usd, 0), v_payment.user_id);

  RETURN jsonb_build_object('ok', true, 'status', 'posted', 'entry_id', v_entry_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_post_treat_payment_cash(uuid) TO authenticated;

-- 8) Posting: Withdrawal paid (reduces creator payable, reduces cash)
CREATE OR REPLACE FUNCTION public.admin_post_withdrawal_paid(p_withdrawal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_w record;
  v_entry_id uuid;
  v_cash_id uuid;
  v_creator_payable_id uuid;
BEGIN
  IF NOT public.accounting_is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Access denied');
  END IF;

  SELECT * INTO v_w
  FROM public.withdrawal_requests
  WHERE id = p_withdrawal_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Withdrawal not found');
  END IF;

  IF v_w.status NOT IN ('approved', 'completed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Withdrawal must be approved/completed');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.accounting_journal_entries
    WHERE source_type = 'withdrawal_paid' AND source_id = p_withdrawal_id::text
  ) THEN
    RETURN jsonb_build_object('ok', true, 'status', 'already_posted');
  END IF;

  v_cash_id := public.accounting_get_account_id('1000');
  v_creator_payable_id := public.accounting_get_account_id('2000');

  INSERT INTO public.accounting_journal_entries (entry_date, source_type, source_id, memo)
  VALUES (COALESCE(v_w.updated_at, now())::date, 'withdrawal_paid', p_withdrawal_id::text, 'Withdrawal paid out')
  RETURNING id INTO v_entry_id;

  -- Debit liability (we owe less)
  INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, user_id)
  VALUES (v_entry_id, v_creator_payable_id, COALESCE(v_w.amount, 0), 0, v_w.user_id);

  -- Credit cash (cash decreases)
  INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, user_id)
  VALUES (v_entry_id, v_cash_id, 0, COALESCE(v_w.amount, 0), v_w.user_id);

  RETURN jsonb_build_object('ok', true, 'status', 'posted', 'entry_id', v_entry_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_post_withdrawal_paid(uuid) TO authenticated;

-- 9) Trial balance RPC (for dashboard)
CREATE OR REPLACE FUNCTION public.admin_get_trial_balance()
RETURNS TABLE (
  account_code text,
  account_name text,
  account_type text,
  debit_total numeric,
  credit_total numeric,
  net_balance numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT
    a.code,
    a.name,
    a.type,
    COALESCE(SUM(l.debit_usd), 0) AS debit_total,
    COALESCE(SUM(l.credit_usd), 0) AS credit_total,
    COALESCE(SUM(l.debit_usd), 0) - COALESCE(SUM(l.credit_usd), 0) AS net_balance
  FROM public.accounting_accounts a
  LEFT JOIN public.accounting_journal_lines l ON l.account_id = a.id
  GROUP BY a.code, a.name, a.type
  ORDER BY a.code;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_trial_balance() TO authenticated;

