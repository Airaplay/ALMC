/*
  # File Deduplication System
  
  This migration creates a file hash index table to prevent duplicate file uploads.
  When a file with the same hash is uploaded, the system will reuse the existing file
  instead of uploading a duplicate, saving storage and bandwidth.
  
  1. New Table
    - `file_hash_index` - Stores file hashes and their URLs
    - Tracks file metadata (size, content type, storage path)
    - Links to user who uploaded the file
  
  2. Functions
    - `get_file_by_hash()` - Check if file exists by hash
    - `insert_file_hash()` - Store file hash after upload
  
  3. Security
    - Enable RLS on file_hash_index table
    - Users can view all file hashes (for deduplication)
    - Users can insert their own file hashes
    - Admins can manage all file hashes
*/

-- Create file_hash_index table
CREATE TABLE IF NOT EXISTS file_hash_index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_hash text NOT NULL UNIQUE,
  file_url text NOT NULL,
  file_size bigint NOT NULL,
  content_type text NOT NULL,
  storage_path text NOT NULL,
  storage_type text DEFAULT 'bunny_storage', -- 'bunny_storage' | 'bunny_stream'
  created_at timestamptz DEFAULT now(),
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  access_count integer DEFAULT 0,
  last_accessed_at timestamptz
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_file_hash_index_hash ON file_hash_index(file_hash);
CREATE INDEX IF NOT EXISTS idx_file_hash_index_url ON file_hash_index(file_url);
CREATE INDEX IF NOT EXISTS idx_file_hash_index_content_type ON file_hash_index(content_type);
CREATE INDEX IF NOT EXISTS idx_file_hash_index_uploaded_by ON file_hash_index(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_file_hash_index_created_at ON file_hash_index(created_at DESC);

-- Enable RLS
ALTER TABLE file_hash_index ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view file hashes" ON file_hash_index;
DROP POLICY IF EXISTS "Users can insert file hashes" ON file_hash_index;
DROP POLICY IF EXISTS "Users can update access count" ON file_hash_index;
DROP POLICY IF EXISTS "Admins can manage all file hashes" ON file_hash_index;

-- Policy: Users can view all file hashes (needed for deduplication check)
CREATE POLICY "Users can view file hashes"
ON file_hash_index
FOR SELECT
TO authenticated
USING (true);

-- Policy: Users can insert file hashes
CREATE POLICY "Users can insert file hashes"
ON file_hash_index
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL AND
  (uploaded_by IS NULL OR uploaded_by = auth.uid())
);

-- Policy: Users can update access count for any file (for tracking)
CREATE POLICY "Users can update access count"
ON file_hash_index
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Policy: Admins can manage all file hashes
CREATE POLICY "Admins can manage all file hashes"
ON file_hash_index
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  )
);

-- Function to check if file hash exists
CREATE OR REPLACE FUNCTION get_file_by_hash(hash_param text)
RETURNS TABLE (
  id uuid,
  file_hash text,
  file_url text,
  file_size bigint,
  content_type text,
  storage_path text,
  storage_type text,
  created_at timestamptz,
  uploaded_by uuid,
  access_count integer,
  last_accessed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    f.id,
    f.file_hash,
    f.file_url,
    f.file_size,
    f.content_type,
    f.storage_path,
    f.storage_type,
    f.created_at,
    f.uploaded_by,
    f.access_count,
    f.last_accessed_at
  FROM file_hash_index f
  WHERE f.file_hash = hash_param
  LIMIT 1;
  
  -- Update access count if file found
  UPDATE file_hash_index
  SET 
    access_count = access_count + 1,
    last_accessed_at = now()
  WHERE file_hash = hash_param;
END;
$$;

-- Function to insert file hash after upload
CREATE OR REPLACE FUNCTION insert_file_hash(
  hash_param text,
  url_param text,
  size_param bigint,
  content_type_param text,
  storage_path_param text,
  storage_type_param text DEFAULT 'bunny_storage',
  user_id_param uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  file_id uuid;
BEGIN
  INSERT INTO file_hash_index (
    file_hash,
    file_url,
    file_size,
    content_type,
    storage_path,
    storage_type,
    uploaded_by
  ) VALUES (
    hash_param,
    url_param,
    size_param,
    content_type_param,
    storage_path_param,
    storage_type_param,
    COALESCE(user_id_param, auth.uid())
  )
  ON CONFLICT (file_hash) DO UPDATE SET
    access_count = file_hash_index.access_count + 1,
    last_accessed_at = now()
  RETURNING id INTO file_id;
  
  RETURN file_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_file_by_hash(text) TO authenticated;
GRANT EXECUTE ON FUNCTION insert_file_hash(text, text, bigint, text, text, text, uuid) TO authenticated;

-- Add comment to table
COMMENT ON TABLE file_hash_index IS 'Index of file hashes to prevent duplicate uploads and enable file deduplication';
COMMENT ON COLUMN file_hash_index.file_hash IS 'SHA-256 hash of the file content';
COMMENT ON COLUMN file_hash_index.file_url IS 'Public URL of the stored file';
COMMENT ON COLUMN file_hash_index.storage_type IS 'Type of storage: bunny_storage or bunny_stream';
COMMENT ON COLUMN file_hash_index.access_count IS 'Number of times this file hash was found during deduplication';

