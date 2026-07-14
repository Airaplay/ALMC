/*
  # Add PostgREST-visible relationships for Admin joins
 
  The Admin dashboard joins flagged tables to `public.users`.
  PostgREST relationships are discovered from foreign keys, but:
  - `user_bot_flags.user_id` references `auth.users`
  - `flagged_play_events.user_id` references `auth.users`
 
  This migration adds *additional* FKs to `public.users(id)` so the API schema cache
  exposes the relationships needed for `users!<constraint_name>(...)` joins.
*/
 
DO $$
BEGIN
  -- user_bot_flags(user_id) -> public.users(id)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_bot_flags'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'user_bot_flags'
        AND constraint_name = 'user_bot_flags_public_user_id_fkey'
    ) THEN
      ALTER TABLE public.user_bot_flags
        ADD CONSTRAINT user_bot_flags_public_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES public.users(id)
        ON DELETE CASCADE;
    END IF;
  END IF;
 
  -- flagged_play_events(user_id) -> public.users(id)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'flagged_play_events'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'flagged_play_events'
        AND constraint_name = 'flagged_play_events_public_user_id_fkey'
    ) THEN
      ALTER TABLE public.flagged_play_events
        ADD CONSTRAINT flagged_play_events_public_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES public.users(id)
        ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

