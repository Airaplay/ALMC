/*
  # Harden Treat tip sending (follow-up)

  After 20260520140000_fix_treat_tip_send_failures, tips can still fail when:
  1) treat_wallets rows violate balance = earned_balance + purchased_balance
     (wallet UPDATE in trigger_update_treat_wallet then aborts the tip).
  2) Side-effect notification triggers on treat_transactions raise errors.
  3) authenticated role lacks table-level GRANT on treat_tips (RLS alone is not enough).

  This migration is idempotent and safe to re-run.
*/

-- ---------------------------------------------------------------------------
-- 1) Table privileges (RLS policies require underlying GRANT)
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, DELETE ON public.treat_tips TO authenticated;
GRANT ALL ON public.treat_tips TO service_role;

-- ---------------------------------------------------------------------------
-- 2) RLS: ensure INSERT/SELECT policies exist (recreate if misconfigured)
-- ---------------------------------------------------------------------------
ALTER TABLE public.treat_tips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert tips they send" ON public.treat_tips;
CREATE POLICY "Users can insert tips they send"
  ON public.treat_tips
  FOR INSERT
  TO authenticated
  WITH CHECK (sender_id = auth.uid());

DROP POLICY IF EXISTS "Users can view tips they sent or received" ON public.treat_tips;
CREATE POLICY "Users can view tips they sent or received"
  ON public.treat_tips
  FOR SELECT
  TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3) Repair wallets that violate balance = earned + purchased
-- ---------------------------------------------------------------------------
UPDATE public.treat_wallets
SET
  balance = COALESCE(earned_balance, 0) + COALESCE(purchased_balance, 0),
  updated_at = NOW()
WHERE balance IS DISTINCT FROM (COALESCE(earned_balance, 0) + COALESCE(purchased_balance, 0));

-- ---------------------------------------------------------------------------
-- 4) Notification side-effects must not roll back tips
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_treat_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sender_name text;
  notification_message text;
BEGIN
  IF NEW.transaction_type IN ('tip_received', 'earned', 'reward', 'referral_bonus', 'daily_checkin')
     AND NEW.amount > 0 THEN

    IF NEW.transaction_type = 'tip_received' AND NEW.metadata ? 'sender_id' THEN
      SELECT display_name INTO sender_name
      FROM public.users
      WHERE id = (NEW.metadata->>'sender_id')::uuid;

      notification_message := 'You received ' || NEW.amount || ' Treats from ' || COALESCE(sender_name, 'someone') || '!';
    ELSIF NEW.transaction_type = 'daily_checkin' THEN
      notification_message := 'Daily check-in reward! You earned ' || NEW.amount || ' Treats.';
    ELSIF NEW.transaction_type = 'reward' THEN
      notification_message := 'Congratulations! You earned ' || NEW.amount || ' Treats as a reward.';
    ELSIF NEW.transaction_type = 'referral_bonus' THEN
      notification_message := 'Referral bonus! You earned ' || NEW.amount || ' Treats.';
    ELSE
      notification_message := 'You earned ' || NEW.amount || ' Treats! Your new balance is ' || COALESCE(NEW.balance_after, 0) || ' Treats.';
    END IF;

    BEGIN
      INSERT INTO public.notifications (user_id, type, message, metadata)
      VALUES (
        NEW.user_id,
        'tip',
        notification_message,
        jsonb_build_object(
          'transaction_id', NEW.id,
          'transaction_type', NEW.transaction_type,
          'amount', NEW.amount,
          'balance_after', NEW.balance_after,
          'sender_id', NEW.metadata->>'sender_id',
          'timestamp', NEW.created_at
        )
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'notify_treat_received skipped: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_treat_sent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recipient_name text;
  notification_message text;
BEGIN
  IF NEW.transaction_type = 'tip_sent' AND NEW.amount < 0 THEN
    IF NEW.metadata ? 'recipient_id' THEN
      SELECT display_name INTO recipient_name
      FROM public.users
      WHERE id = (NEW.metadata->>'recipient_id')::uuid;

      notification_message := 'You sent ' || ABS(NEW.amount) || ' Treats to ' || COALESCE(recipient_name, 'someone') || '.';
    ELSE
      notification_message := 'You sent ' || ABS(NEW.amount) || ' Treats. Your new balance is ' || COALESCE(NEW.balance_after, 0) || ' Treats.';
    END IF;

    BEGIN
      INSERT INTO public.notifications (user_id, type, message, metadata)
      VALUES (
        NEW.user_id,
        'tip',
        notification_message,
        jsonb_build_object(
          'transaction_id', NEW.id,
          'transaction_type', NEW.transaction_type,
          'amount', ABS(NEW.amount),
          'balance_after', NEW.balance_after,
          'recipient_id', NEW.metadata->>'recipient_id',
          'timestamp', NEW.created_at
        )
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'notify_treat_sent skipped: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Ensure only one wallet-update trigger on treat_transactions
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS update_treat_wallet_on_transaction ON public.treat_transactions;
