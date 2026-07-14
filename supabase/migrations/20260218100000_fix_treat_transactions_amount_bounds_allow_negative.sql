/*
  Fix: treat_transactions amount check – allow negative amounts

  Error when promoting content:
    new row for relation "treat_transactions" violates check constraint
    "treat_transactions_amount_bounds"

  Cause: Promotion trigger inserts negative amount. Constraint likely allows only amount > 0.

  This migration drops every check constraint on treat_transactions that
  restricts amount to positive only, then adds a single bounds constraint
  that allows both credits (positive) and debits (negative).
*/

-- Drop known constraint name
ALTER TABLE public.treat_transactions
  DROP CONSTRAINT IF EXISTS treat_transactions_amount_bounds;

-- Drop common alternate name (column-level check often gets this name)
ALTER TABLE public.treat_transactions
  DROP CONSTRAINT IF EXISTS treat_transactions_amount_check;

-- Drop any check that only restricts amount to positive/non-negative
-- (avoids touching constraints that mention other columns)
DO $$
DECLARE
  r RECORD;
  def text;
BEGIN
  FOR r IN
    SELECT c.conname, pg_get_constraintdef(c.oid) AS cdef
    FROM pg_constraint c
    WHERE c.conrelid = 'public.treat_transactions'::regclass
      AND c.contype = 'c'
  LOOP
    def := r.cdef;
    IF def ~ 'amount\s*>\s*0' AND def !~ 'balance|earned|purchased|total' THEN
      EXECUTE format('ALTER TABLE public.treat_transactions DROP CONSTRAINT IF EXISTS %I', r.conname);
      RAISE NOTICE 'Dropped amount-positive constraint: %', r.conname;
    ELSIF def ~ 'amount\s*>=\s*0' AND def !~ 'balance|earned|purchased|total|-' THEN
      EXECUTE format('ALTER TABLE public.treat_transactions DROP CONSTRAINT IF EXISTS %I', r.conname);
      RAISE NOTICE 'Dropped amount-non-negative constraint: %', r.conname;
    END IF;
  END LOOP;
END $$;

-- Add single constraint: allow amount in [-999999999, 999999999]
ALTER TABLE public.treat_transactions
  ADD CONSTRAINT treat_transactions_amount_bounds
  CHECK (amount >= -999999999 AND amount <= 999999999);
