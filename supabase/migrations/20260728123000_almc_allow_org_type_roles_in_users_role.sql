-- ALMC: allow org-type values in platform profile role
--
-- Requirement:
-- When a user sets up their organization as:
--   label | management | distributor | entertainment
-- we mirror that choice into public.users.role (for profile display / downstream logic).
--
-- Security:
-- This only extends the CHECK constraint. RLS for role updates remains the same.
-- The ALMC UI should set these values at account/profile creation time.

DO $$
BEGIN
  ALTER TABLE public.users
    DROP CONSTRAINT IF EXISTS users_role_check;

  ALTER TABLE public.users
    ADD CONSTRAINT users_role_check
    CHECK (
      role = ANY (
        ARRAY[
          'listener'::text,
          'creator'::text,
          'admin'::text,
          'manager'::text,
          'editor'::text,
          'account'::text,
          -- ALMC org-type roles (mirrored into platform role)
          'label'::text,
          'management'::text,
          'distributor'::text,
          'entertainment'::text
        ]
      )
    );
END $$;

