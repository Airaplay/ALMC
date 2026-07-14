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

export const getTrendingFallbackSong = async (userCountry?: string): Promise<Song | null> => {
  try {
    let trendingSongs: Song[] = [];

    if (userCountry) {
      trendingSongs = await getTrendingNearYou(userCountry);
    }

    if (trendingSongs.length === 0) {
      trendingSongs = await getGlobalTrendingSongs();
    }

    if (trendingSongs.length > 0) {
      const nextSong = trendingSongs[0];
      console.log(`Trending fallback: "${nextSong.title}" by ${nextSong.artist}`);
      return nextSong;
    }

    console.log('No trending songs available for autoplay fallback');
    return null;
  } catch (error) {
    console.error('Error in getTrendingFallbackSong:', error);
    return null;
  }
};

const getTrendingNearYou = async (countryCode: string): Promise<Song[]> => {
  try {
    const { data, error } = await supabase
      .from('songs')
      .select(`
        id,
        title,
        duration_seconds,
        audio_url,
        cover_image_url,
        play_count,
        created_at,
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
      .not('audio_url', 'is', null)
      .eq('country', countryCode)
      .order('play_count', { ascending: false })
      .limit(5);

    if (error) {
      console.warn('Error fetching trending songs by country:', error);
      return [];
    }

    return (data || []).map((song: any) => ({
      id: song.id,
      title: song.title,
      artist: song.artists?.artist_profiles?.[0]?.stage_name || song.artists?.name || 'Unknown Artist',
      artistId: song.artists?.id,
      coverImageUrl: song.cover_image_url,
      audioUrl: song.audio_url,
      duration: song.duration_seconds || 0,
      playCount: song.play_count || 0
    }));
  } catch (error) {
    console.error('Error in getTrendingNearYou:', error);
    return [];
  }
};

const getGlobalTrendingSongs = async (): Promise<Song[]> => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data, error } = await supabase
      .from('songs')
      .select(`
        id,
        title,
        duration_seconds,
        audio_url,
        cover_image_url,
        play_count,
        created_at,
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
      .not('audio_url', 'is', null)
      .gte('created_at', sevenDaysAgo.toISOString())
      .order('play_count', { ascending: false })
      .limit(5);

    if (error) {
      console.error('Error fetching global trending songs:', error);
      return [];
    }

    return (data || []).map((song: any) => ({
      id: song.id,
      title: song.title,
      artist: song.artists?.artist_profiles?.[0]?.stage_name || song.artists?.name || 'Unknown Artist',
      artistId: song.artists?.id,
      coverImageUrl: song.cover_image_url,
      audioUrl: song.audio_url,
      duration: song.duration_seconds || 0,
      playCount: song.play_count || 0
    }));
  } catch (error) {
    console.error('Error in getGlobalTrendingSongs:', error);
    return [];
  }
};
