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

export const getCreatorAlbumTracks = async (userId: string): Promise<{ tracks: Song[]; artistName: string }> => {
  try {
    const { data: artistProfile, error: profileError } = await supabase
      .from('artist_profiles')
      .select('artist_id, stage_name')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError || !artistProfile || !artistProfile.artist_id) {
      console.log('[getCreatorAlbumTracks] No artist profile found for user:', userId);
      return { tracks: [], artistName: '' };
    }

    const { data: albums, error: albumsError } = await supabase
      .from('albums')
      .select('id, title, cover_image_url, release_date')
      .eq('artist_id', artistProfile.artist_id)
      .order('release_date', { ascending: false });

    if (albumsError) {
      console.error('[getCreatorAlbumTracks] Error fetching albums:', albumsError);
      return { tracks: [], artistName: artistProfile.stage_name || '' };
    }

    if (!albums || albums.length === 0) {
      console.log('[getCreatorAlbumTracks] No albums found for artist:', artistProfile.artist_id);
      return { tracks: [], artistName: artistProfile.stage_name || '' };
    }

    console.log('[getCreatorAlbumTracks] Found', albums.length, 'albums for artist');

    const allTracks: Song[] = [];

    for (const album of albums) {
      const { data: songs, error: songsError } = await supabase
        .from('songs')
        .select('id, title, duration_seconds, audio_url, play_count, track_number')
        .eq('album_id', album.id)
        .order('track_number', { ascending: true });

      if (songsError) {
        console.error('[getCreatorAlbumTracks] Error fetching songs for album', album.id, ':', songsError);
        continue;
      }

      if (songs && songs.length > 0) {
        const formattedTracks = songs.map((song: any) => ({
          id: song.id,
          title: song.title,
          artist: artistProfile.stage_name || 'Unknown Artist',
          artistId: artistProfile.artist_id,
          coverImageUrl: album.cover_image_url,
          audioUrl: song.audio_url,
          duration: song.duration_seconds,
          playCount: song.play_count || 0,
        }));

        allTracks.push(...formattedTracks);
      }
    }

    console.log('[getCreatorAlbumTracks] Total tracks fetched:', allTracks.length);

    return { tracks: allTracks, artistName: artistProfile.stage_name || '' };
  } catch (error) {
    console.error('[getCreatorAlbumTracks] Unexpected error:', error);
    return { tracks: [], artistName: '' };
  }
};

export const getCreatorInfo = async (userId: string): Promise<{ stageName: string; displayName: string }> => {
  try {
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle();

    const { data: artistProfile, error: profileError } = await supabase
      .from('artist_profiles')
      .select('stage_name')
      .eq('user_id', userId)
      .maybeSingle();

    return {
      stageName: artistProfile?.stage_name || '',
      displayName: user?.display_name || 'Unknown Artist',
    };
  } catch (error) {
    console.error('[getCreatorInfo] Error:', error);
    return {
      stageName: '',
      displayName: 'Unknown Artist',
    };
  }
};
