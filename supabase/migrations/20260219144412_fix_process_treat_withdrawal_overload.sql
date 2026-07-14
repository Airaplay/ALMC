/*
  # Fix process_treat_withdrawal function overload conflict

  Removes the integer-parameter overload of process_treat_withdrawal, keeping only
  the numeric version to resolve the PGRST203 ambiguity error.
*/

DROP FUNCTION IF EXISTS public.process_treat_withdrawal(p_user_id uuid, p_treats_amount integer);
