/*
  # Add INSERT policy for songs table

  1. New Policy
    - Allow authenticated users to insert songs for their own artist profiles
    - Users can only create songs where the artist_id matches their artist profile's artist_id
    - Ensures proper ownership and security for song uploads

  2. Security
    - Policy checks that the artist_id being inserted matches the user's artist profile
    - Only authenticated users can insert songs
    - Maintains data integrity and prevents unauthorized song creation
*/

-- Add INSERT policy for songs table
CREATE POLICY "Authenticated users can insert their own songs"
ON public.songs
FOR INSERT
TO authenticated
WITH CHECK (
  artist_id = (
    SELECT artist_id 
    FROM public.artist_profiles 
    WHERE user_id = auth.uid()
  )
);

-- Also add UPDATE policy to allow users to update their own songs
CREATE POLICY "Authenticated users can update their own songs"
ON public.songs
FOR UPDATE
TO authenticated
USING (
  artist_id = (
    SELECT artist_id 
    FROM public.artist_profiles 
    WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  artist_id = (
    SELECT artist_id 
    FROM public.artist_profiles 
    WHERE user_id = auth.uid()
  )
);

-- Add DELETE policy to allow users to delete their own songs
CREATE POLICY "Authenticated users can delete their own songs"
ON public.songs
FOR DELETE
TO authenticated
USING (
  artist_id = (
    SELECT artist_id 
    FROM public.artist_profiles 
    WHERE user_id = auth.uid()
  )
);