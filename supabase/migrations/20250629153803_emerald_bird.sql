/*
  # Add URL field to banners table

  1. Changes
    - Add `url` column to `banners` table for clickable banners
    - Column is nullable to maintain compatibility with existing records
    - Update get_active_banners function to include the url field

  2. Security
    - No changes to existing RLS policies
    - New column inherits existing security model
*/

-- Add url column to banners table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'banners' AND column_name = 'url'
  ) THEN
    ALTER TABLE banners 
    ADD COLUMN url text;
  END IF;
END $$;

-- Drop the existing function first to avoid return type errors
DROP FUNCTION IF EXISTS get_active_banners();

-- Recreate the function with the url field included
CREATE FUNCTION get_active_banners()
RETURNS TABLE (
  id uuid,
  title text,
  subtitle text,
  image_url text,
  gradient_from text,
  gradient_to text,
  order_index integer,
  url text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    b.id,
    b.title,
    b.subtitle,
    b.image_url,
    b.gradient_from,
    b.gradient_to,
    b.order_index,
    b.url
  FROM banners b
  WHERE b.is_active = true
  ORDER BY b.order_index ASC, b.created_at ASC;
END;
$$;

-- Grant execute permission to public
GRANT EXECUTE ON FUNCTION get_active_banners() TO public;