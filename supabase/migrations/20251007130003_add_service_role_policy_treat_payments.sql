/*
  # Add Service Role Policy for Treat Payments
  
  This migration adds a policy to allow the service role (used by edge functions)
  to update treat_payments records when webhooks are received.
  
  1. Changes
    - Add policy for service role to update treat_payments status
    - This enables webhook handlers to update payment status after verification
  
  2. Security
    - Only the service role (edge functions) can use this policy
    - Regular users cannot bypass their existing policies
    - Service role updates are logged via updated_at timestamp
*/

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Service role can update payments" ON public.treat_payments;

-- Create policy for service role to update payments
CREATE POLICY "Service role can update payments"
  ON public.treat_payments
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add comment
COMMENT ON POLICY "Service role can update payments" ON public.treat_payments IS 
'Allows edge functions using service role to update payment status when processing webhooks';
