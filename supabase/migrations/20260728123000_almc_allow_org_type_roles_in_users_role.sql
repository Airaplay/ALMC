-- ALMC: allow org-type values in platform profile role
--
-- Requirement:
-- When a user sets up their organization as:
--   label | management | distributor | entertainment
-- we mirror that choice into public.users.role (for profile display / downstream logic).
--
-- Note: production constraint is named users_role_valid (not users_role_check).

DO $$
BEGIN
  ALTER TABLE public.users
    DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE public.users
    DROP CONSTRAINT IF EXISTS users_role_valid;

  ALTER TABLE public.users
    ADD CONSTRAINT users_role_valid
    CHECK (
      role IS NULL
      OR role = ANY (
        ARRAY[
          'listener'::text,
          'creator'::text,
          'admin'::text,
          'manager'::text,
          'editor'::text,
          'account'::text,
          'waitlist_admin'::text,
          -- ALMC org-type roles (mirrored into platform role)
          'label'::text,
          'management'::text,
          'distributor'::text,
          'entertainment'::text
        ]
      )
    );
END $$;
