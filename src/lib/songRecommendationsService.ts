import { supabase } from './supabase';

interface Song {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  coverImageUrl?: string | null;
  audioUrl?: string | null;
  duration?: number;
  playCount?: number;
}

interface SimilarSongResult {
  song: Song;
  score: number;
  reason: string;
}

const findSimilarSongsForDisplay = async (song: Song, excludeIds: string[] = []): Promise<SimilarSongResult[]> => {
  try {
    console.log('[SimilarSongs] Starting search for song ID:', song.id);
    const results: SimilarSongResult[] = [];
    const allExcludedIds = [...excludeIds, song.id];

    if (song.id) {
      console.log('[SimilarSongs] Fetching genres for song');
      const { data: songWithGenres } = await supabase
        .from('songs')
        .select(`
          id,
          title,
          duration_seconds,
          audio_url,
          cover_image_url,
          play_count,
          song_genres (
            genre_id,
            genres (id, name)
          ),
          artists:artist_id (
            id,
            name,
            artist_profiles (
              id,
              user_id,
              stage_name,
              profile_photo_url,
              is_verified
            )
          )
        `)
        .eq('id', song.id)
        .maybeSingle();

      if (!songWithGenres) {
        return results;
      }

      const genreIds = songWithGenres.song_genres?.map((sg: any) => sg.genre_id) || [];

      if (genreIds.length > 0) {
        const { data: genreSongs } = await supabase
          .from('song_genres')
          .select(`
            song_id,
            songs (
              id,
              title,
              duration_seconds,
              audio_url,
              cover_image_url,
              play_count,
              artist_id,
              artists:artist_id (
                id,
                name,
                artist_profiles (
                  id,
                  user_id,
                  stage_name,
                  profile_photo_url,
                  is_verified
                )
              )
            )
          `)
          .in('genre_id', genreIds)
          .limit(70); // Fetch more to account for filtering

        if (genreSongs) {
          // Filter out excluded IDs in JavaScript (safer and more reliable)
          const excludedIds = new Set(allExcludedIds);
          const filteredGenreSongs = genreSongs.filter((entry: any) => 
            entry.song_id && !excludedIds.has(entry.song_id)
          );
          
          const genreSongMap = new Map<string, number>();
          filteredGenreSongs.forEach((entry: any) => {
            const songId = entry.song_id;
            genreSongMap.set(songId, (genreSongMap.get(songId) || 0) + 1);
          });

          // Deduplicate by song ID (not object reference)
          const seenIds = new Set<string>();
          const uniqueGenreSongs = filteredGenreSongs
            .map((sg: any) => sg.songs)
            .filter((s): s is any => {
              if (!s || s === undefined || s === null || !s.id) return false;
              if (allExcludedIds.includes(s.id)) return false;
              if (s.artist_id === song.artistId) return false;
              if (seenIds.has(s.id)) return false;
              seenIds.add(s.id);
              return true;
            })
            .sort((a, b) => (genreSongMap.get(b.id) || 0) - (genreSongMap.get(a.id) || 0))
            .slice(0, 15);

          uniqueGenreSongs.forEach((s: any) => {
            results.push({
              song: {
                id: s.id,
                title: s.title,
                artist: s.artists?.artist_profiles?.[0]?.stage_name || s.artists?.name || 'Unknown Artist',
                artistId: s.artists?.id,
                coverImageUrl: s.cover_image_url,
                audioUrl: s.audio_url,
                duration: s.duration_seconds || 0,
                playCount: s.play_count || 0
              },
              score: 100 + (genreSongMap.get(s.id) || 0) * 10,
              reason: 'Same genre'
            });
          });
        }
      }
    }

    return results.sort((a, b) => b.score - a.score);
  } catch (error) {
    console.error('Error finding similar songs:', error);
    return [];
  }
};

export const getSimilarSongsForDisplay = async (
  song: Song,
  limit: number = 8
): Promise<Song[]> => {
  try {
    console.log('[SimilarSongs] Finding similar songs for:', song.title, 'ID:', song.id);
    const results = await findSimilarSongsForDisplay(song, [song.id]);
    console.log('[SimilarSongs] Found', results.length, 'similar songs');
    const limited = results.slice(0, limit).map(r => r.song);
    console.log('[SimilarSongs] Returning', limited.length, 'songs');
    return limited;
  } catch (error) {
    console.error('[SimilarSongs] Error getting similar songs for display:', error);
    return [];
  }
};
