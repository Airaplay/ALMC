/*
  # Fix Treat Tip Wallet Updates

  This migration addresses the issue where treat/tip transactions are not properly 
  reflecting in users' treat wallet balances.

  ## Problem
  - Tips are recorded in `treat_tips` table
  - But no corresponding entries are created in `treat_transactions` table
  - The `treat_transactions` table has the trigger that updates wallet balances
  - Without `treat_transactions` entries, wallet balances don't update

  ## Solution
  1. Create a trigger function that processes tip transactions
  2. Add an AFTER INSERT trigger on `treat_tips` table
  3. The trigger creates corresponding debit/credit entries in `treat_transactions`
  4. Existing `trigger_treat_wallet_update` then updates the actual wallet balances

  ## Changes
  1. New trigger function: `process_treat_tip_transactions()`
  2. New trigger: `trg_process_treat_tip_transactions` on `treat_tips` table
  3. Automatic wallet creation for users who don't have one yet
*/

-- Create the trigger function to process treat tip transactions
CREATE OR REPLACE FUNCTION public.process_treat_tip_transactions()
RETURNS TRIGGER AS $$
DECLARE
    sender_current_balance numeric;
    recipient_current_balance numeric;
    sender_display_name text;
    recipient_display_name text;
BEGIN
    -- Get display names for better transaction descriptions
    SELECT display_name INTO sender_display_name 
    FROM public.users 
    WHERE id = NEW.sender_id;
    
    SELECT display_name INTO recipient_display_name 
    FROM public.users 
    WHERE id = NEW.recipient_id;
    
    -- Use email as fallback if display_name is null
    IF sender_display_name IS NULL THEN
        SELECT email INTO sender_display_name 
        FROM public.users 
        WHERE id = NEW.sender_id;
    END IF;
    
    IF recipient_display_name IS NULL THEN
        SELECT email INTO recipient_display_name 
        FROM public.users 
        WHERE id = NEW.recipient_id;
    END IF;

    -- Ensure sender's treat_wallet exists and get current balance
    INSERT INTO public.treat_wallets (
        user_id, 
        balance, 
        total_purchased, 
        total_spent, 
        total_earned, 
        total_withdrawn
    )
    VALUES (NEW.sender_id, 0, 0, 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;
    
    SELECT balance INTO sender_current_balance 
    FROM public.treat_wallets 
    WHERE user_id = NEW.sender_id;

    -- Ensure recipient's treat_wallet exists and get current balance
    INSERT INTO public.treat_wallets (
        user_id, 
        balance, 
        total_purchased, 
        total_spent, 
        total_earned, 
        total_withdrawn
    )
    VALUES (NEW.recipient_id, 0, 0, 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;
    
    SELECT balance INTO recipient_current_balance 
    FROM public.treat_wallets 
    WHERE user_id = NEW.recipient_id;

    -- Validate sender has sufficient balance
    IF sender_current_balance < NEW.amount THEN
        RAISE EXCEPTION 'Insufficient balance. User has % treats but tried to send %', 
            sender_current_balance, NEW.amount;
    END IF;

    -- Insert transaction for sender (spending treats)
    INSERT INTO public.treat_transactions (
        user_id,
        transaction_type,
        amount,
        balance_before,
        balance_after,
        description,
        metadata,
        status,
        created_at
    ) VALUES (
        NEW.sender_id,
        'tip_sent',
        NEW.amount,
        sender_current_balance,
        sender_current_balance - NEW.amount,
        COALESCE(
            'Sent tip to ' || recipient_display_name,
            'Sent tip to user'
        ),
        jsonb_build_object(
            'tip_id', NEW.id,
            'recipient_id', NEW.recipient_id,
            'recipient_name', recipient_display_name,
            'message', NEW.message,
            'content_id', NEW.content_id,
            'content_type', NEW.content_type,
            'tip_created_at', NEW.created_at
        ),
        NEW.status,
        NEW.created_at
    );

    -- Insert transaction for recipient (receiving treats)
    INSERT INTO public.treat_transactions (
        user_id,
        transaction_type,
        amount,
        balance_before,
        balance_after,
        description,
        metadata,
        status,
        created_at
    ) VALUES (
        NEW.recipient_id,
        'tip_received',
        NEW.amount,
        recipient_current_balance,
        recipient_current_balance + NEW.amount,
        COALESCE(
            'Received tip from ' || sender_display_name,
            'Received tip from user'
        ),
        jsonb_build_object(
            'tip_id', NEW.id,
            'sender_id', NEW.sender_id,
            'sender_name', sender_display_name,
            'message', NEW.message,
            'content_id', NEW.content_id,
            'content_type', NEW.content_type,
            'tip_created_at', NEW.created_at
        ),
        NEW.status,
        NEW.created_at
    );

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Log the error and re-raise it
        RAISE EXCEPTION 'Error processing treat tip transaction: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger on treat_tips table
DROP TRIGGER IF EXISTS trg_process_treat_tip_transactions ON public.treat_tips;

CREATE TRIGGER trg_process_treat_tip_transactions
    AFTER INSERT ON public.treat_tips
    FOR EACH ROW 
    EXECUTE FUNCTION public.process_treat_tip_transactions();

-- Add helpful comment to the trigger
COMMENT ON TRIGGER trg_process_treat_tip_transactions ON public.treat_tips IS 
'Automatically creates corresponding treat_transactions entries when a tip is sent, enabling proper wallet balance updates';

-- Add helpful comment to the function
COMMENT ON FUNCTION public.process_treat_tip_transactions() IS 
'Processes treat tip transactions by creating debit/credit entries in treat_transactions table, which triggers wallet balance updates';