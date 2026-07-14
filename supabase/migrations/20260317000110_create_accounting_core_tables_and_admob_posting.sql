/*
  # Accounting Core (USD, Cash Basis) + AdMob Daily Cash Posting

  Creates:
  - accounting_accounts
  - accounting_journal_entries
  - accounting_journal_lines

  Adds:
  - admin_get_trial_balance()
  - admin_post_admob_daily_cash(p_revenue_date date)

  Safe default:
  - One combined cash account (1000) for all cash-basis postings.
*/

-- ----------------------------------------------------------------------------
-- 1) Chart of accounts
-- ----------------------------------------------------------------------------
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='accounting_accounts' AND policyname='Admins manage accounting accounts'
  ) THEN
    CREATE POLICY "Admins manage accounting accounts"
    ON public.accounting_accounts
    FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role='admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role='admin'));
  END IF;
END $$;

-- Seed minimal accounts (idempotent)
INSERT INTO public.accounting_accounts (code, name, type, normal_balance)
VALUES
  ('1000', 'Cash_USD', 'asset', 'debit'),
  ('2000', 'CreatorPayable_USD', 'liability', 'credit'),
  ('4000', 'PlatformAdRevenue_USD', 'revenue', 'credit'),
  ('4010', 'TreatRevenue_USD', 'revenue', 'credit')
ON CONFLICT (code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2) Journal entries + lines
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounting_journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  memo text,
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_accounting_journal_entries_date ON public.accounting_journal_entries(entry_date DESC);

ALTER TABLE public.accounting_journal_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='accounting_journal_entries' AND policyname='Admins read journal entries'
  ) THEN
    CREATE POLICY "Admins read journal entries"
    ON public.accounting_journal_entries
    FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role='admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='accounting_journal_entries' AND policyname='Admins manage journal entries'
  ) THEN
    CREATE POLICY "Admins manage journal entries"
    ON public.accounting_journal_entries
    FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role='admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role='admin'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.accounting_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.accounting_journal_entries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounting_accounts(id) ON DELETE RESTRICT,
  debit_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (debit_usd >= 0),
  credit_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (credit_usd >= 0),
  artist_id uuid NULL REFERENCES public.artists(id) ON DELETE SET NULL,
  user_id uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  revenue_date date NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (debit_usd > 0 AND credit_usd > 0))
);

CREATE INDEX IF NOT EXISTS idx_accounting_journal_lines_entry ON public.accounting_journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_accounting_journal_lines_account ON public.accounting_journal_lines(account_id);

ALTER TABLE public.accounting_journal_lines ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='accounting_journal_lines' AND policyname='Admins read journal lines'
  ) THEN
    CREATE POLICY "Admins read journal lines"
    ON public.accounting_journal_lines
    FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role='admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='accounting_journal_lines' AND policyname='Admins manage journal lines'
  ) THEN
    CREATE POLICY "Admins manage journal lines"
    ON public.accounting_journal_lines
    FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role='admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role='admin'));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3) Trial balance RPC
-- ----------------------------------------------------------------------------
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
STABLE
SET search_path TO public, pg_temp
AS $$
  SELECT
    a.code AS account_code,
    a.name AS account_name,
    a.type AS account_type,
    COALESCE(SUM(l.debit_usd), 0) AS debit_total,
    COALESCE(SUM(l.credit_usd), 0) AS credit_total,
    COALESCE(SUM(l.debit_usd), 0) - COALESCE(SUM(l.credit_usd), 0) AS net_balance
  FROM public.accounting_accounts a
  LEFT JOIN public.accounting_journal_lines l ON l.account_id = a.id
  GROUP BY a.code, a.name, a.type
  ORDER BY a.code;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_trial_balance() TO authenticated;

-- ----------------------------------------------------------------------------
-- 4) Post AdMob daily cash (cash basis)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_post_admob_daily_cash(p_revenue_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_is_admin boolean;
  v_input record;
  v_caps record;
  v_usable_revenue numeric;
  v_creator_pct numeric;
  v_creator_pool numeric;
  v_platform_share numeric;
  v_entry_id uuid;
  v_cash_account_id uuid;
  v_creator_payable_id uuid;
  v_platform_rev_id uuid;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role='admin') INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Access denied. Admin privileges required.');
  END IF;

  SELECT * INTO v_input
  FROM public.ad_daily_revenue_input
  WHERE revenue_date = p_revenue_date
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No ad_daily_revenue_input row for date', 'revenue_date', p_revenue_date);
  END IF;

  IF COALESCE(v_input.is_locked, false) = false THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Daily input must be locked before posting', 'revenue_date', p_revenue_date);
  END IF;

  -- Idempotency (per day)
  IF EXISTS (
    SELECT 1 FROM public.accounting_journal_entries
    WHERE source_type = 'admob_daily_input'
      AND source_id = p_revenue_date::text
  ) THEN
    RETURN jsonb_build_object('ok', true, 'status', 'already_posted', 'revenue_date', p_revenue_date);
  END IF;

  SELECT * INTO v_caps
  FROM public.ad_safety_caps
  WHERE is_active = true
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ad_safety_caps active row not found');
  END IF;

  v_creator_pct := COALESCE(v_caps.artist_revenue_percentage, 50.0);
  v_usable_revenue := COALESCE(v_input.total_revenue_usd, 0) * (COALESCE(v_input.safety_buffer_percentage, 0) / 100.0);
  v_creator_pool := ROUND(v_usable_revenue * (v_creator_pct / 100.0), 6);
  v_platform_share := ROUND(v_usable_revenue - v_creator_pool, 6);

  SELECT id INTO v_cash_account_id FROM public.accounting_accounts WHERE code='1000' LIMIT 1;
  SELECT id INTO v_creator_payable_id FROM public.accounting_accounts WHERE code='2000' LIMIT 1;
  SELECT id INTO v_platform_rev_id FROM public.accounting_accounts WHERE code='4000' LIMIT 1;

  IF v_cash_account_id IS NULL OR v_creator_payable_id IS NULL OR v_platform_rev_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing required accounting accounts (1000/2000/4000)');
  END IF;

  INSERT INTO public.accounting_journal_entries (entry_date, source_type, source_id, memo)
  VALUES (
    p_revenue_date,
    'admob_daily_input',
    p_revenue_date::text,
    'AdMob cash (usable) posted from locked daily input; split to creator payable and platform ad revenue.'
  )
  RETURNING id INTO v_entry_id;

  -- Debit Cash
  INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, revenue_date)
  VALUES (v_entry_id, v_cash_account_id, v_usable_revenue, 0, p_revenue_date);

  -- Credit Creator Payable
  INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, revenue_date)
  VALUES (v_entry_id, v_creator_payable_id, 0, v_creator_pool, p_revenue_date);

  -- Credit Platform Ad Revenue
  INSERT INTO public.accounting_journal_lines (entry_id, account_id, debit_usd, credit_usd, revenue_date)
  VALUES (v_entry_id, v_platform_rev_id, 0, v_platform_share, p_revenue_date);

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'posted',
    'revenue_date', p_revenue_date,
    'usable_revenue_usd', v_usable_revenue,
    'creator_pool_usd', v_creator_pool,
    'platform_share_usd', v_platform_share,
    'journal_entry_id', v_entry_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_post_admob_daily_cash(date) TO authenticated;
COMMENT ON FUNCTION public.admin_post_admob_daily_cash(date) IS
  'Admin-only cash-basis posting: Debits Cash (1000) for usable AdMob revenue, credits Creator Payable (2000) and Platform Ad Revenue (4000). Idempotent per revenue_date.';

