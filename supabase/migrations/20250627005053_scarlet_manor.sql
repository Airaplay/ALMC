/*
  # Add RLS policies for albums table

  1. New Policies
    - Allow authenticated users to insert albums for their own artist profiles
    - Allow authenticated users to update their own albums
    - Allow authenticated users to delete their own albums
    - Maintain existing SELECT policy for public read access

  2. Security
    - Users can only create/modify albums where artist_id matches their artist profile
    - Ensures proper ownership and prevents unauthorized album operations
    - Maintains data integrity for album management
*/

-- Add INSERT policy for albums table
CREATE POLICY "Authenticated users can insert their own albums"
ON public.albums
FOR INSERT
TO authenticated
WITH CHECK (
  artist_id = (
    SELECT artist_id 
    FROM public.artist_profiles 
    WHERE user_id = auth.uid()
  )
);

-- Add UPDATE policy for albums table
CREATE POLICY "Authenticated users can update their own albums"
ON public.albums
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

-- Add DELETE policy for albums table
CREATE POLICY "Authenticated users can delete their own albums"
ON public.albums
FOR DELETE
TO authenticated
USING (
  artist_id = (
    SELECT artist_id 
    FROM public.artist_profiles 
    WHERE user_id = auth.uid()
  )
);