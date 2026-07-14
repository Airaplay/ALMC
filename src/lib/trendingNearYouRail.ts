import { supabase, getManualTrendingSongs } from "@/lib/supabase";
import { getPromotedContentForSection } from "@/lib/promotionHelper";
import { isReleased, releaseDatePublicFilter } from "@/lib/releaseDateUtils";

/** Song shape for the home "Trending Near You" rail (shared by app + web). */
export interface TrendingNearYouRailSong {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  coverImageUrl?: string | null;
  audioUrl?: string | null;
  duration?: number;
  playCount?: number;
  country?: string;
  isPromoted?: boolean;
  featured_artists?: string[] | null;
}

export const TRENDING_NEAR_YOU_RAIL_CACHE_PREFIX = "trending_near_you_section_processed_v2";

export function trendingNearYouRailCacheKey(countryCode: string): string {
  return countryCode
    ? `${TRENDING_NEAR_YOU_RAIL_CACHE_PREFIX}_${countryCode}`
    : TRENDING_NEAR_YOU_RAIL_CACHE_PREFIX;
}

/**
 * Loads the home rail list: manual (by country) → promoted → auto RPC.
 * Matches TrendingNearYouSection on mobile; do not duplicate logic elsewhere.
 */
export async function fetchTrendingNearYouRailSongs(
  countryCode: string
): Promise<TrendingNearYouRailSong[]> {
  const userCountryCode = countryCode;

  const { data: thresholdConfig } = await supabase
    .from("content_section_thresholds")
    .select("time_window_days")
    .eq("section_key", "trending_near_you")
    .maybeSingle();
  const adminTimeWindowDays = thresholdConfig?.time_window_days ?? null;

  const promotedSongIds = await getPromotedContentForSection("trending_near_you", "song", 3);

  const manualSongs = await getManualTrendingSongs("trending_near_you", userCountryCode);

  const formattedManualSongs: TrendingNearYouRailSong[] = manualSongs.map((mts: any) => {
    const song = mts.songs;
    const artistUserId = song.artists?.artist_profiles?.[0]?.user_id || null;

    let artistName = "Unknown Artiste";
    if (song.artists?.name) {
      artistName = song.artists.name;
    } else if (song.artists?.artist_profiles?.[0]?.stage_name) {
      artistName = song.artists.artist_profiles[0].stage_name;
    } else if (song.artists?.artist_profiles?.[0]?.users?.display_name) {
      artistName = song.artists.artist_profiles[0].users.display_name;
    }

    return {
      id: song.id,
      title: song.title,
      artist: artistName,
      artistId: artistUserId,
      duration: song.duration_seconds || 0,
      audioUrl: song.audio_url,
      coverImageUrl: song.cover_image_url,
      playCount: song.play_count || 0,
      country: song.country,
      isPromoted: promotedSongIds.includes(song.id),
      featured_artists: song.featured_artists || null,
    };
  });

  const { data, error } = await supabase.rpc("get_trending_near_you_songs", {
    country_param: userCountryCode,
    days_param: adminTimeWindowDays,
    limit_param: 8,
  });

  if (error) throw error;

  const released = (data || []).filter((s: any) => isReleased(s.release_date));
  const formattedSongs: TrendingNearYouRailSong[] = released.map((song: any) => ({
    id: song.id,
    title: song.title,
    artist: song.artist || "Unknown Artiste",
    artistId: song.artist_user_id || null,
    duration: song.duration_seconds || 0,
    audioUrl: song.audio_url,
    coverImageUrl: song.cover_image_url,
    playCount: song.play_count || 0,
    country: song.country,
    isPromoted: promotedSongIds.includes(song.id),
    featured_artists: song.featured_artists || null,
  }));

  const promotedSongsNotInList = promotedSongIds.filter(
    (id) => !formattedSongs.some((s) => s.id === id)
  );
  let promotedSongsData: TrendingNearYouRailSong[] = [];

  if (promotedSongsNotInList.length > 0) {
    const { data: promotedData, error: promoError } = await supabase
      .from("songs")
      .select(
        `
            id,
            title,
            duration_seconds,
            audio_url,
            cover_image_url,
            play_count,
            country,
            release_date,
            artists:artist_id (
              id,
              name,
              artist_profiles(
                id,
                user_id,
                stage_name,
                profile_photo_url,
                is_verified,
                users:user_id(display_name)
              )
            )
          `
      )
      .in("id", promotedSongsNotInList)
      .or(releaseDatePublicFilter());

    if (!promoError && promotedData) {
      promotedSongsData = promotedData
        .filter((s: any) => isReleased(s.release_date))
        .map((song: any) => {
          const artistUserId = song.artists?.artist_profiles?.[0]?.user_id || null;
          let artistName = "Unknown Artiste";
          if (song.artists?.name) {
            artistName = song.artists.name;
          } else if (song.artists?.artist_profiles?.[0]?.stage_name) {
            artistName = song.artists.artist_profiles[0].stage_name;
          } else if (song.artists?.artist_profiles?.[0]?.users?.display_name) {
            artistName = song.artists.artist_profiles[0].users.display_name;
          }
          return {
            id: song.id,
            title: song.title,
            artist: artistName,
            artistId: artistUserId,
            duration: song.duration_seconds || 0,
            audioUrl: song.audio_url,
            coverImageUrl: song.cover_image_url,
            playCount: song.play_count || 0,
            country: song.country,
            isPromoted: true,
            featured_artists: song.featured_artists || null,
          };
        });
    }
  }

  const nonPromotedSongs = formattedSongs.filter((s) => !s.isPromoted);
  const existingPromotedSongs = formattedSongs.filter((s) => s.isPromoted);

  const manualSongIds = new Set(formattedManualSongs.map((s) => s.id));
  const promotedSongIdsSet = new Set([
    ...promotedSongsData.map((s) => s.id),
    ...existingPromotedSongs.map((s) => s.id),
  ]);
  const autoSongsFiltered = nonPromotedSongs.filter(
    (s) => !manualSongIds.has(s.id) && !promotedSongIdsSet.has(s.id)
  );

  const finalSongs = [
    ...formattedManualSongs,
    ...promotedSongsData,
    ...existingPromotedSongs,
    ...autoSongsFiltered,
  ];

  return finalSongs.filter((song) => !!song.coverImageUrl);
}
