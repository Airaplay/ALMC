/*
  # Admin content management for user accounts

  Allows admins and managers to upload and update content on behalf of creators
  from the admin dashboard (content_uploads, songs, albums, and related tables).
*/

CREATE OR REPLACE FUNCTION public.is_admin_or_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT COALESCE(get_user_role(), '') = ANY (ARRAY['admin'::text, 'manager'::text]);
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_or_manager() TO authenticated;

-- content_uploads
CREATE POLICY "Admins and managers can upload content for users"
  ON public.content_uploads
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_or_manager());

CREATE POLICY "Admins and managers can update any content"
  ON public.content_uploads
  FOR UPDATE
  TO authenticated
  USING (is_admin_or_manager())
  WITH CHECK (is_admin_or_manager());

-- songs
CREATE POLICY "Admins and managers can insert songs for any artist"
  ON public.songs
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_or_manager());

CREATE POLICY "Admins and managers can update any songs"
  ON public.songs
  FOR UPDATE
  TO authenticated
  USING (is_admin_or_manager())
  WITH CHECK (is_admin_or_manager());

-- albums
CREATE POLICY "Admins and managers can insert albums for any artist"
  ON public.albums
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_or_manager());

CREATE POLICY "Admins and managers can update any albums"
  ON public.albums
  FOR UPDATE
  TO authenticated
  USING (is_admin_or_manager())
  WITH CHECK (is_admin_or_manager());

-- song_genres
CREATE POLICY "Admins and managers can link genres to any song"
  ON public.song_genres
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_or_manager());

-- song_subgenres
CREATE POLICY "Admins and managers can link subgenres to any song"
  ON public.song_subgenres
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin_or_manager());

-- song_moods (existing policy is admin-only via users.role)
CREATE POLICY "Managers can manage song moods"
  ON public.song_moods
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role = 'manager'::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role = 'manager'::text
    )
  );

-- artist_profiles (link artist_id after create-artist during admin upload)
CREATE POLICY "Admins and managers can update any artist profile"
  ON public.artist_profiles
  FOR UPDATE
  TO authenticated
  USING (is_admin_or_manager())
  WITH CHECK (is_admin_or_manager());
