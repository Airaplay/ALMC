/*
  # Fix treat packages policy creation issue

  1. Policy Management
    - Drop existing policy if it exists
    - Create new policy with proper definition
    - Ensure idempotent operation

  2. Security
    - Maintain RLS protection
    - Ensure only admins can manage treat packages
    - Use proper authentication checks

  3. Changes
    - Remove conflicting policy
    - Create standardized policy definition
    - Use consistent naming convention
*/

-- Drop the existing policy if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'treat_packages' 
    AND policyname = 'Admins can manage treat packages'
  ) THEN
    DROP POLICY "Admins can manage treat packages" ON public.treat_packages;
  END IF;
END $$;

-- Create the policy with a standardized approach
CREATE POLICY "treat_packages_admin_management"
  ON public.treat_packages
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

-- Also ensure there's a policy for public read access to active packages
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'treat_packages' 
    AND policyname = 'treat_packages_public_read'
  ) THEN
    CREATE POLICY "treat_packages_public_read"
      ON public.treat_packages
      FOR SELECT
      TO authenticated
      USING (is_active = true);
  END IF;
END $$;