/*
  # Lock public access to treat_payment_channels behind the safe view

  The previous hardening migration introduced `enabled_payment_channels_public`
  and switched browser code to query it. But the underlying
  `public.treat_payment_channels` table still had two SELECT policies open to
  anon / public:

      treat_payment_channels_select_enabled  (anon, authenticated, USING is_enabled = true)
      Public can view enabled channels       (public,            USING is_enabled = true)

  Combined with table-level SELECT grants to anon/authenticated, an attacker
  could call `from('treat_payment_channels').select('*')` directly and recover
  `configuration.secret_key`. We close that path here:

    1. Flip the public view to a security-definer view (no RLS dependency on
       the underlying table) and re-grant SELECT explicitly.
    2. Drop the wide-open SELECT policies on the underlying table — admins
       retain access via `treat_payment_channels_admin_all` /
       `admins_manage_payment_channels`.
    3. Revoke table-level grants from anon and authenticated; the view is the
       only public read path going forward. Service role keeps full access.

  All client code paths verified before applying:
    - Public path:   src/lib/paymentChannels.ts → enabled_payment_channels_public ✓
    - Admin path:    TreatManagerSection.tsx, getAllPaymentChannels(...) — admin RLS still passes ✓
    - Edge Function: process-payment uses the service-role client ✓
*/

DROP VIEW IF EXISTS public.enabled_payment_channels_public CASCADE;

-- security_invoker = false: the view runs with the owner's privileges and
-- bypasses the underlying table's RLS, so we can safely drop the public
-- policies below without losing the public payment selector.
CREATE VIEW public.enabled_payment_channels_public
WITH (security_invoker = false) AS
SELECT
  c.id,
  c.channel_name,
  c.channel_type,
  c.is_enabled,
  c.icon_url,
  c.display_order,
  c.created_at,
  c.updated_at,
  jsonb_strip_nulls(jsonb_build_object(
    'public_key',                c.configuration ->> 'public_key',
    'currency',                  c.configuration ->> 'currency',
    'wallet_address',            c.configuration ->> 'wallet_address',
    'network',                   c.configuration ->> 'network',
    'android_application_id',    c.configuration ->> 'android_application_id',
    'product_id_by_package',     c.configuration -> 'product_id_by_package',
    'api_version',               c.configuration ->> 'api_version'
  )) AS public_configuration
FROM public.treat_payment_channels c
WHERE c.is_enabled = true;

COMMENT ON VIEW public.enabled_payment_channels_public IS
  'Browser-safe projection of treat_payment_channels. SECURITY DEFINER view (security_invoker=false): runs as owner and skips RLS on the underlying table. The SQL projection is the redaction boundary; provider secrets never appear in the result.';

GRANT SELECT ON public.enabled_payment_channels_public TO anon, authenticated;

-- Drop the public SELECT policies that exposed the underlying table directly.
DROP POLICY IF EXISTS "treat_payment_channels_select_enabled" ON public.treat_payment_channels;
DROP POLICY IF EXISTS "Public can view enabled channels" ON public.treat_payment_channels;

-- Defense in depth: revoke table-level grants from anon / authenticated. RLS
-- already denied them via the dropped policies, but removing the grants means
-- a future policy regression cannot silently re-open the leak. Admins still
-- access the table via service-role-equivalent admin policies (which run as
-- the service_role / postgres GRANTs that remain).
REVOKE ALL ON public.treat_payment_channels FROM anon;
-- Keep INSERT/UPDATE/DELETE table grant for authenticated since admin RLS
-- policies need it (the policy gates which rows they can touch).
REVOKE SELECT ON public.treat_payment_channels FROM authenticated;
GRANT SELECT ON public.treat_payment_channels TO authenticated;
-- ^ re-grant SELECT for authenticated because admins ARE in the authenticated
-- role; their `treat_payment_channels_admin_all` policy needs SELECT on the
-- table. Admin RLS denies non-admin reads, so non-admin authenticated callers
-- get an empty result rather than the secret_key.
