import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";

/**
 * Hook that returns a function to navigate to an artist's public profile.
 *
 * Accepts either:
 *   - `userId` (auth user id) → navigates directly to /user/:userId
 *   - `artistId` (artists table id) → looks up user_id from artist_profiles, then navigates
 *
 * Usage:
 *   const navigateToArtist = useArtistNavigation();
 *   <span onClick={(e) => { e.stopPropagation(); navigateToArtist({ artistId }); }}>
 */
export function useArtistNavigation() {
  const navigate = useNavigate();

  return useCallback(
    async (opts: { userId?: string | null; artistId?: string | null }) => {
      if (opts.userId) {
        navigate(`/user/${opts.userId}`);
        return;
      }
      if (!opts.artistId) return;

      try {
        const { data } = await supabase
          .from("artist_profiles")
          .select("user_id")
          .eq("artist_id", opts.artistId)
          .maybeSingle();

        if (data?.user_id) {
          navigate(`/user/${data.user_id}`);
        }
      } catch {
        // silently fail
      }
    },
    [navigate]
  );
}
