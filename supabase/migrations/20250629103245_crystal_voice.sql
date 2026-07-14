/*
  # Create admin mixes functionality

  1. New Functions
    - `get_admin_mixes` - Get mixes created by admin users
    - Returns album-like content grouped by admins of the platform
    - Includes cover image, title, and other metadata

  2. Security
    - Function is security definer to ensure proper access
    - Public can access admin-created mixes
    - Results are limited to 25 mixes for performance

  3. Sorting
    - Mixes are sorted by play count (popularity) and creation date
    - Only approved content is returned
*/

-- Function to get mixes created by admin users
CREATE OR REPLACE FUNCTION get_admin_mixes()
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  cover_image_url text,
  creator_name text,
  creator_id uuid,
  play_count integer,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cu.id,
    cu.title,
    cu.description,
    cu.metadata->>'cover_url' as cover_image_url,
    u.display_name as creator_name,
    u.id as creator_id,
    COALESCE(cu.play_count, 0) as play_count,
    cu.created_at
  FROM 
    content_uploads cu
  JOIN 
    users u ON cu.user_id = u.id
  WHERE 
    u.role = 'admin'
    AND cu.status = 'approved'
    AND (cu.content_type = 'album' OR cu.content_type = 'mix')
    AND cu.metadata->>'cover_url' IS NOT NULL
  ORDER BY 
    cu.play_count DESC NULLS LAST,
    cu.created_at DESC
  LIMIT 25;
END;
$$;

-- Grant execute permissions to public
GRANT EXECUTE ON FUNCTION get_admin_mixes TO authenticated;
GRANT EXECUTE ON FUNCTION get_admin_mixes TO anon;