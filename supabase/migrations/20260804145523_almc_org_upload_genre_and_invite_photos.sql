-- ALMC: allow org members with content.upload to link genres/moods for roster artists,
-- and allow invite profile photos under the org member's own profile-photos folder prefix.

-- ---------------------------------------------------------------------------
-- song_genres / song_subgenres / song_moods
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Org members can link genres for linked artists" ON public.song_genres;
CREATE POLICY "Org members can link genres for linked artists"
  ON public.song_genres
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.songs s
      JOIN public.artist_profiles ap ON ap.artist_id = s.artist_id
      JOIN public.organization_artist_links oal
        ON oal.artist_profile_id = ap.id
       AND oal.status = 'active'
      WHERE s.id = song_genres.song_id
        AND public.org_can_manage_artist_user(oal.user_id)
    )
  );

DROP POLICY IF EXISTS "Org members can link subgenres for linked artists" ON public.song_subgenres;
CREATE POLICY "Org members can link subgenres for linked artists"
  ON public.song_subgenres
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.songs s
      JOIN public.artist_profiles ap ON ap.artist_id = s.artist_id
      JOIN public.organization_artist_links oal
        ON oal.artist_profile_id = ap.id
       AND oal.status = 'active'
      WHERE s.id = song_subgenres.song_id
        AND public.org_can_manage_artist_user(oal.user_id)
    )
  );

DROP POLICY IF EXISTS "Org members can link moods for linked artists" ON public.song_moods;
CREATE POLICY "Org members can link moods for linked artists"
  ON public.song_moods
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.songs s
      JOIN public.artist_profiles ap ON ap.artist_id = s.artist_id
      JOIN public.organization_artist_links oal
        ON oal.artist_profile_id = ap.id
       AND oal.status = 'active'
      WHERE s.id = song_moods.song_id
        AND public.org_can_manage_artist_user(oal.user_id)
    )
  );

-- ---------------------------------------------------------------------------
-- album_genres / album_subgenres (explicit org policies; safer than open ALL)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Org members can link album genres for linked artists" ON public.album_genres;
CREATE POLICY "Org members can link album genres for linked artists"
  ON public.album_genres
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.albums a
      JOIN public.artist_profiles ap ON ap.artist_id = a.artist_id
      JOIN public.organization_artist_links oal
        ON oal.artist_profile_id = ap.id
       AND oal.status = 'active'
      WHERE a.id = album_genres.album_id
        AND public.org_can_manage_artist_user(oal.user_id)
    )
  );

DROP POLICY IF EXISTS "Org members can link album subgenres for linked artists" ON public.album_subgenres;
CREATE POLICY "Org members can link album subgenres for linked artists"
  ON public.album_subgenres
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.albums a
      JOIN public.artist_profiles ap ON ap.artist_id = a.artist_id
      JOIN public.organization_artist_links oal
        ON oal.artist_profile_id = ap.id
       AND oal.status = 'active'
      WHERE a.id = album_subgenres.album_id
        AND public.org_can_manage_artist_user(oal.user_id)
    )
  );
