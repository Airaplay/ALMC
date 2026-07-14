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

interface ListeningHistoryEntry {
  song_id: string;
  listened_at: string;
  songs?: {
    id: string;
    title: string;
    duration_seconds: number;
    audio_url: string;
    cover_image_url: string;
    play_count: number;
    artists?: {
      id: string;
      name: string;
      artist_profiles?: Array<{
        id: string;
        user_id: string;
        stage_name: string;
        profile_photo_url: string;
        is_verified: boolean;
      }>;
    };
  };
}

export const getNextSongFromHistory = async (currentSong: Song): Promise<Song | null> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      console.log('User not authenticated, cannot fetch listening history');
      return null;
    }

    const { data: history, error } = await supabase
      .from('listening_history')
      .select(`
        song_id,
        listened_at,
        songs (
          id,
          title,
          duration_seconds,
          audio_url,
          cover_image_url,
          play_count,
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
      .eq('user_id', user.id)
      .order('listened_at', { ascending: false })
      .limit(100) as { data: ListeningHistoryEntry[] | null; error: any };

    if (error) {
      console.error('Error fetching listening history:', error);
      return null;
    }

    if (!history || history.length === 0) {
      console.log('No listening history found');
      return null;
    }

    const currentIndex = history.findIndex(entry => entry.song_id === currentSong.id);

    if (currentIndex === -1) {
      console.log('Current song not found in listening history, returning first song');
      const nextEntry = history[history.length - 1];
      if (nextEntry?.songs) {
        return formatSongFromHistory(nextEntry.songs);
      }
      return null;
    }

    if (currentIndex === 0) {
      console.log('Current song is the most recently played, no next song in history');
      return null;
    }

    const nextEntry = history[currentIndex - 1];

    if (nextEntry?.songs) {
      const nextSong = formatSongFromHistory(nextEntry.songs);
      console.log(`Recently played fallback: "${nextSong.title}" by ${nextSong.artist}`);
      return nextSong;
    }

    return null;
  } catch (error) {
    console.error('Error in getNextSongFromHistory:', error);
    return null;
  }
};

const formatSongFromHistory = (songData: any): Song => {
  return {
    id: songData.id,
    title: songData.title,
    artist: songData.artists?.artist_profiles?.[0]?.stage_name || songData.artists?.name || 'Unknown Artist',
    artistId: songData.artists?.id,
    coverImageUrl: songData.cover_image_url,
    audioUrl: songData.audio_url,
    duration: songData.duration_seconds || 0,
    playCount: songData.play_count || 0
  };
};
