/*
  # Migrate Payment Channel Secrets to Supabase Vault
  
  This migration enhances security by moving sensitive payment channel secrets
  to Supabase Vault instead of storing them directly in the database.
  
  ## Security Improvements
  
  1. **Payment Channel Secrets** - Use Vault references instead of direct storage
  2. **Secret Rotation** - Enable easier secret rotation via Vault
  3. **Audit Trail** - Vault provides audit logging for secret access
  4. **Encryption at Rest** - Vault provides additional encryption layer
  
  ## Changes Made
  
  - Add `vault_secret_name` column to track Vault secret references
  - Add helper functions to retrieve secrets from Vault
  - Update configuration storage to use Vault references
  - Maintain backward compatibility with existing configurations
  
  ## Migration Notes
  
  - Existing secrets in `configuration` column remain intact
  - Admins should manually migrate secrets to Vault and update vault_secret_name
  - Function `get_payment_channel_config` retrieves secrets from Vault when available
  
  ## Usage Example
  
  After migration, admins should:
  1. Store secret in Vault: INSERT INTO vault.secrets (name, secret) VALUES ('paystack_secret_key', 'your_key')
  2. Update channel: UPDATE treat_payment_channels SET vault_secret_name = 'paystack_secret_key'
  3. Functions will automatically retrieve from Vault when vault_secret_name is set
*/

-- Add vault_secret_name column to track Vault references
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'treat_payment_channels' AND column_name = 'vault_secret_name'
  ) THEN
    ALTER TABLE treat_payment_channels
    ADD COLUMN vault_secret_name text;
    
    COMMENT ON COLUMN treat_payment_channels.vault_secret_name IS 
      'Reference to Supabase Vault secret name for sensitive configuration data';
  END IF;
END $$;

-- Create helper function to safely retrieve payment channel configuration
-- This function checks Vault first, falls back to configuration column
CREATE OR REPLACE FUNCTION get_payment_channel_config(channel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  channel_record RECORD;
  vault_secret text;
  final_config jsonb;
BEGIN
  SELECT 
    configuration,
    vault_secret_name
  INTO channel_record
  FROM treat_payment_channels
  WHERE id = channel_id AND is_enabled = true;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment channel not found or not enabled';
  END IF;
  
  final_config := channel_record.configuration;
  
  IF channel_record.vault_secret_name IS NOT NULL THEN
    BEGIN
      SELECT decrypted_secret INTO vault_secret
      FROM vault.decrypted_secrets
      WHERE name = channel_record.vault_secret_name;
      
      IF FOUND AND vault_secret IS NOT NULL THEN
        final_config := jsonb_build_object(
          'secret_key', vault_secret,
          'public_key', final_config->>'public_key',
          'currency', final_config->>'currency',
          'wallet_address', final_config->>'wallet_address',
          'network', final_config->>'network'
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to retrieve secret from Vault: %', SQLERRM;
    END;
  END IF;
  
  RETURN final_config;
END;
$$;

-- Grant execute permission to service_role for edge functions
GRANT EXECUTE ON FUNCTION get_payment_channel_config(uuid) TO service_role;

-- Create function to update payment channel with Vault secret
CREATE OR REPLACE FUNCTION update_payment_channel_vault_secret(
  channel_id uuid,
  secret_name text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO is_admin;
  
  IF NOT is_admin THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  
  UPDATE treat_payment_channels
  SET 
    vault_secret_name = secret_name,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = channel_id;
  
  RETURN FOUND;
END;
$$;

-- Grant execute permission to authenticated users (admin check is inside function)
GRANT EXECUTE ON FUNCTION update_payment_channel_vault_secret(uuid, text) TO authenticated;

-- Add index for faster Vault secret lookups
CREATE INDEX IF NOT EXISTS idx_payment_channels_vault_secret 
  ON treat_payment_channels(vault_secret_name) 
  WHERE vault_secret_name IS NOT NULL;

-- Add helpful comments
COMMENT ON FUNCTION get_payment_channel_config(uuid) IS 
  'Securely retrieves payment channel configuration, preferring Vault secrets over database storage';

COMMENT ON FUNCTION update_payment_channel_vault_secret(uuid, text) IS 
  'Admin function to link a payment channel to a Vault secret (requires admin role)';

-- Create view for admins to see which channels use Vault
CREATE OR REPLACE VIEW admin_payment_channels_security AS
SELECT 
  id,
  channel_name,
  channel_type,
  is_enabled,
  CASE 
    WHEN vault_secret_name IS NOT NULL THEN 'Using Vault'
    WHEN configuration->>'secret_key' IS NOT NULL THEN 'Direct Storage (Migrate to Vault)'
    ELSE 'No Secret Configured'
  END as secret_storage_method,
  vault_secret_name,
  created_at,
  updated_at
FROM treat_payment_channels
ORDER BY display_order;

-- Grant access to admins only
REVOKE ALL ON admin_payment_channels_security FROM PUBLIC;
GRANT SELECT ON admin_payment_channels_security TO authenticated;

-- Create RLS policy for the view
ALTER VIEW admin_payment_channels_security SET (security_invoker = on);

-- Add trigger to warn when secrets are stored directly
CREATE OR REPLACE FUNCTION warn_direct_secret_storage()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.configuration ? 'secret_key' AND 
     NEW.configuration->>'secret_key' != '' AND 
     NEW.vault_secret_name IS NULL THEN
    RAISE WARNING 'Payment channel % is storing secrets directly. Consider migrating to Vault for enhanced security.', NEW.channel_name;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_warn_direct_secret_storage ON treat_payment_channels;

CREATE TRIGGER trg_warn_direct_secret_storage
  BEFORE INSERT OR UPDATE ON treat_payment_channels
  FOR EACH ROW
  EXECUTE FUNCTION warn_direct_secret_storage();
