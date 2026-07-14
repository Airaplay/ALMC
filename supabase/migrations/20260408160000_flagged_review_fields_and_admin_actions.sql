/*
  # Flagged review fields + admin actions
 
  Adds review metadata and reasons for:
  - `user_bot_flags` (flagged accounts)
  - `referrals` (flagged referral abuse)
 
  Adds SECURITY DEFINER admin RPCs so the Admin dashboard can:
  - Clear/unflag a user bot flag
  - Review/clear a referral abuse flag
*/
 
-- ----------------------------------------------------------------------------
-- 1) Add review metadata to user_bot_flags
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_bot_flags'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_bot_flags' AND column_name = 'review_status'
    ) THEN
      ALTER TABLE public.user_bot_flags
        ADD COLUMN review_status text NOT NULL DEFAULT 'pending', -- pending | cleared | confirmed
        ADD COLUMN reviewed_at timestamptz,
        ADD COLUMN reviewed_by uuid REFERENCES public.users(id),
        ADD COLUMN review_notes text;
    END IF;
  END IF;
END $$;
 
CREATE INDEX IF NOT EXISTS idx_user_bot_flags_review_status
  ON public.user_bot_flags(review_status);
 
-- ----------------------------------------------------------------------------
-- 2) Add abuse reason + review metadata to referrals
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'referrals'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'referrals' AND column_name = 'abuse_reason'
    ) THEN
      ALTER TABLE public.referrals
        ADD COLUMN abuse_reason text,
        ADD COLUMN abuse_flagged_at timestamptz,
        ADD COLUMN abuse_review_status text NOT NULL DEFAULT 'pending', -- pending | cleared | confirmed
        ADD COLUMN abuse_reviewed_at timestamptz,
        ADD COLUMN abuse_reviewed_by uuid REFERENCES public.users(id),
        ADD COLUMN abuse_review_notes text;
    END IF;
  END IF;
END $$;
 
CREATE INDEX IF NOT EXISTS idx_referrals_abuse_review_status
  ON public.referrals(abuse_review_status)
  WHERE flagged_for_abuse = true;
 
-- ----------------------------------------------------------------------------
-- 3) Admin RPCs (verify admin via public.users.role)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_clear_user_bot_flag(
  p_user_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id
  FROM public.users
  WHERE id = auth.uid()
    AND role IN ('admin', 'manager');
 
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;
 
  UPDATE public.user_bot_flags
  SET
    is_flagged = false,
    review_status = 'cleared',
    reviewed_at = now(),
    reviewed_by = v_admin_id,
    review_notes = p_notes,
    updated_at = now()
  WHERE user_id = p_user_id;
END;
$$;
 
GRANT EXECUTE ON FUNCTION public.admin_clear_user_bot_flag(uuid, text) TO authenticated;
 
CREATE OR REPLACE FUNCTION public.admin_review_referral_abuse_flag(
  p_referral_id uuid,
  p_clear_flag boolean,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id
  FROM public.users
  WHERE id = auth.uid()
    AND role IN ('admin', 'manager');
 
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;
 
  UPDATE public.referrals
  SET
    flagged_for_abuse = CASE WHEN p_clear_flag THEN false ELSE flagged_for_abuse END,
    abuse_review_status = CASE WHEN p_clear_flag THEN 'cleared' ELSE 'confirmed' END,
    abuse_reviewed_at = now(),
    abuse_reviewed_by = v_admin_id,
    abuse_review_notes = p_notes
  WHERE id = p_referral_id;
END;
$$;
 
GRANT EXECUTE ON FUNCTION public.admin_review_referral_abuse_flag(uuid, boolean, text) TO authenticated;

