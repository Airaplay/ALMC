/*
  # Restore direct treat_tips INSERT (no Security PIN required)

  Re-enables authenticated users to insert their own tips via the client
  (TippingModal), after PIN-gated-only policy was added in 20260521140000.
*/

DROP POLICY IF EXISTS "Users can insert tips they send" ON public.treat_tips;

CREATE POLICY "Users can insert tips they send"
  ON public.treat_tips
  FOR INSERT
  TO authenticated
  WITH CHECK (sender_id = auth.uid());
