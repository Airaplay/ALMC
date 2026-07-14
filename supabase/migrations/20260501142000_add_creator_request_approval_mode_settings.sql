/*
  # Add creator request approval mode settings

  1. New Table
    - `creator_request_settings`
      - `id` (uuid, primary key)
      - `single_row_marker` (int, constrained to value 1 for singleton row)
      - `approval_mode` (text: 'manual' | 'automatic')
      - `updated_at` (timestamptz)
      - `updated_by` (uuid, references auth.users)

  2. Security
    - Enable RLS
    - Authenticated users can read setting
    - Only admins can insert/update setting
*/

CREATE TABLE IF NOT EXISTS creator_request_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  single_row_marker integer NOT NULL DEFAULT 1 CHECK (single_row_marker = 1),
  approval_mode text NOT NULL DEFAULT 'manual' CHECK (approval_mode IN ('manual', 'automatic')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  UNIQUE(single_row_marker)
);

ALTER TABLE creator_request_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'creator_request_settings'
      AND policyname = 'Authenticated users can view creator request settings'
  ) THEN
    CREATE POLICY "Authenticated users can view creator request settings"
      ON creator_request_settings
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'creator_request_settings'
      AND policyname = 'Admins can insert creator request settings'
  ) THEN
    CREATE POLICY "Admins can insert creator request settings"
      ON creator_request_settings
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM users
          WHERE users.id = auth.uid()
            AND users.role = 'admin'
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'creator_request_settings'
      AND policyname = 'Admins can update creator request settings'
  ) THEN
    CREATE POLICY "Admins can update creator request settings"
      ON creator_request_settings
      FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM users
          WHERE users.id = auth.uid()
            AND users.role = 'admin'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM users
          WHERE users.id = auth.uid()
            AND users.role = 'admin'
        )
      );
  END IF;
END
$$;

INSERT INTO creator_request_settings (single_row_marker, approval_mode)
VALUES (1, 'manual')
ON CONFLICT (single_row_marker) DO NOTHING;
