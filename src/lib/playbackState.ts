import { supabase } from './supabase';

interface PlaybackState {
  songId: string;
  playbackPosition: number;
  playlist: string[];
  currentIndex: number;
  playlistContext: string;
  isShuffleEnabled: boolean;
  repeatMode: 'off' | 'one' | 'all';
}

export const loadPlaybackState = async (): Promise<PlaybackState | null> => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return null;

    const { data, error } = await supabase
      .from('user_playback_state')
      .select('*')
      .eq('user_id', session.user.id)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      songId: data.song_id,
      playbackPosition: data.playback_position || 0,
      playlist: Array.isArray(data.playlist) ? data.playlist : [],
      currentIndex: data.current_index || 0,
      playlistContext: data.playlist_context || 'unknown',
      isShuffleEnabled: data.is_shuffle_enabled || false,
      repeatMode: data.repeat_mode || 'off',
    };
  } catch (error) {
    console.warn('Error loading playback state:', error);
    return null;
  }
};

export const clearPlaybackState = async (): Promise<void> => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    await supabase
      .from('user_playback_state')
      .delete()
      .eq('user_id', session.user.id);
  } catch (error) {
    console.warn('Error clearing playback state:', error);
  }
};

export const getSongsFromIds = async (songIds: string[]) => {
  if (songIds.length === 0) return [];

  try {
    const { data, error } = await supabase
      .from('songs')
      .select('id, title, artist_id, cover_image_url, audio_url, duration_seconds, play_count, artists:artist_id(id, name, artist_profiles!artist_profiles_artist_id_fkey(stage_name, user_id, users:user_id(display_name)))')
      .in('id', songIds);

    if (error) {
      console.error('Error fetching songs:', error);
      return [];
    }

    console.log('📀 getSongsFromIds result:', data);

    return (data || []).map((song: any) => {
      // Extract artist name from nested structure
      let artistName = 'Unknown Artist';
      if (song.artists) {
        const artist = Array.isArray(song.artists) ? song.artists[0] : song.artists;
        const artistProfiles = artist?.artist_profiles;
        if (artistProfiles && Array.isArray(artistProfiles) && artistProfiles.length > 0) {
          artistName = artistProfiles[0]?.stage_name ||
                      artistProfiles[0]?.users?.display_name ||
                      artist?.name ||
                      'Unknown Artist';
        } else {
          artistName = artist?.name || 'Unknown Artist';
        }
      }

      return {
        id: song.id,
        title: song.title,
        artist: artistName,
        artistId: song.artist_id,
        coverImageUrl: song.cover_image_url,
        audioUrl: song.audio_url,
        duration: song.duration_seconds,
        playCount: song.play_count,
      };
    });
  } catch (error) {
    console.error('Error in getSongsFromIds:', error);
    return [];
  }
};
