import { createClient, processLock } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { cache } from './cache';
import { smartCache } from './smartCache';
import { enhancedFetch, cacheInvalidation } from './enhancedDataFetching';
import { favoritesCache } from './favoritesCache';
import { followsCache } from './followsCache';
import { logger } from './logger';
import { sanitizeForFilter } from './filterSecurity';

// Utility function to format treat amounts
export const formatTreats = (amount: number): string => {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(1)}M`;
  } else if (amount >= 1000) {
    return `${(amount / 1000).toFixed(1)}K`;
  } else {
    return amount.toString();
  }
};

// Environment variables from .env file
// These must be set in .env file - no fallback credentials for security
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[Supabase] CRITICAL: Missing required environment variables VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  throw new Error('Supabase configuration missing. Please check your .env file.');
}

/**
 * Google OAuth "Authorized redirect URI" for the **Web** OAuth client whose Client ID + secret
 * are pasted in Supabase Dashboard → Authentication → Providers → Google.
 * (If you use a Supabase custom auth domain, copy the callback URL from that Google provider page instead.)
 */
export const SUPABASE_GOOGLE_OAUTH_REDIRECT_URI = `${String(supabaseUrl).replace(/\/$/, '')}/auth/v1/callback`;

/** Set in sessionStorage while browser/Custom-Tab OAuth is in flight so App can close the auth modal after `SIGNED_IN` even if the WebView remounts (Capacitor). */
export const SESSION_KEY_PENDING_BROWSER_OAUTH = 'airaplay_pending_browser_oauth';

const SB_AUTH_PREF_PREFIX = 'sb.auth.';

/** Native-only: PKCE `code_verifier` + session must survive WebView reload after `airaplay://` OAuth return (localStorage is often cleared). */
const capacitorSupabaseAuthStorage = {
  getItem: (key: string) =>
    Preferences.get({ key: SB_AUTH_PREF_PREFIX + key }).then(({ value }) => value ?? null),
  setItem: (key: string, value: string) => Preferences.set({ key: SB_AUTH_PREF_PREFIX + key, value }),
  removeItem: (key: string) => Preferences.remove({ key: SB_AUTH_PREF_PREFIX + key }),
};

function resolveAuthStorage() {
  if (typeof window === 'undefined') return undefined;
  try {
    if (Capacitor.isNativePlatform()) {
      return capacitorSupabaseAuthStorage;
    }
  } catch {
    /* ignore */
  }
  return window.localStorage;
}

/** In-browser auth lock. Avoids navigator.locks, which React Strict Mode can orphan and block login. */
function resolveAuthLock() {
  if (typeof window === 'undefined') return undefined;
  return processLock;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    // Required for email confirmation and OAuth: parse tokens from URL hash/query after redirect
    detectSessionInUrl: true,
    // Use PKCE so redirects use `?code=` instead of URL fragments (`#...`).
    // Android app links commonly drop URL fragments, breaking auth/recovery flows in-app.
    flowType: 'pkce',
    // Increase session refresh buffer to prevent premature expiration
    storage: resolveAuthStorage(),
    lock: resolveAuthLock(),
  },
});

/**
 * Refresh the current session if it's expired or about to expire
 * This helps prevent authentication state loss in mobile apps
 * In mobile apps, users stay signed in until they explicitly log out
 */
export const refreshSessionIfNeeded = async (): Promise<boolean> => {
  try {
    // First, try to get the current session
    let { data: { session }, error } = await supabase.auth.getSession();
    
    // If there's an error getting session, try refreshing anyway (might be expired)
    if (error && !error.message?.includes('Invalid Refresh Token')) {
      const refreshResult = await supabase.auth.refreshSession();
      if (refreshResult.data.session) {
        return true;
      }
    }

    if (!session) {
      // No session at all - user is truly not signed in
      return false;
    }

    // Check if session is expired or will expire in the next 10 minutes
    const expiresAt = session.expires_at;
    if (expiresAt) {
      const expiresIn = expiresAt - Math.floor(Date.now() / 1000);
      
      // Refresh if expired or expiring within 10 minutes (more aggressive)
      if (expiresIn < 600) {
        const { data, error: refreshError } = await supabase.auth.refreshSession();

        if (refreshError) {
          if (refreshError.message?.includes('Invalid Refresh Token') ||
              refreshError.message?.includes('refresh_token_not_found')) {
            logger.error('Auth: Refresh token invalid - user must sign in again', refreshError);
            return false;
          }
          logger.warn('Auth: Session refresh had error but continuing', refreshError.message);
          return true;
        }

        if (data.session) {
          return true;
        }
      }
    }

    return true;
  } catch (error) {
    logger.error('Auth: Error refreshing session', error);
    return true;
  }
};

/**
 * Get authenticated session with automatic refresh
 * This ensures users stay signed in in mobile apps
 */
export const getAuthenticatedSession = async () => {
  // First try to refresh if needed
  await refreshSessionIfNeeded();
  
  // Then get the session
  const { data: { session }, error } = await supabase.auth.getSession();
  
  if (error) {
    // If error is not about invalid refresh token, try one more refresh
    if (!error.message?.includes('Invalid Refresh Token') &&
        !error.message?.includes('refresh_token_not_found')) {
      const refreshResult = await supabase.auth.refreshSession();
      if (refreshResult.data.session) {
        return { session: refreshResult.data.session, error: null };
      }
    }
  }
  
  return { session, error };
};

// Helper function to validate UUID format
const isValidUUID = (uuid: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

// Cache keys
const CACHE_KEYS = {
  USER_ROLE: 'user_role',
  ARTIST_PROFILE: 'artist_profile',
  TRENDING_SONGS: 'trending_songs',
  NEW_RELEASES: 'new_releases',
  RANDOM_VIDEOS: 'random_videos',
  ACTIVE_BANNERS: 'active_banners',
};

// User and Authentication Functions
export const getUserRole = async (): Promise<string | null> => {
  return enhancedFetch(
    CACHE_KEYS.USER_ROLE,
    async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) return null;

      const { data, error: roleError } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();

      if (roleError) {
        console.error('Error fetching user role:', roleError);
        return null;
      }

      return data?.role || null;
    },
    {
      ttl: 5 * 60 * 1000, // 5 minutes
      staleWhileRevalidate: true,
      tags: ['user', 'auth'],
      priority: 'high',
    }
  ).catch((error) => {
    console.error('Error in getUserRole:', error);
    return null;
  });
};

export const getArtistProfile = async (): Promise<any | null> => {
  return enhancedFetch(
    CACHE_KEYS.ARTIST_PROFILE,
    async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) return null;

      const { data, error: profileError } = await supabase
        .from('artist_profiles')
        .select('id, user_id, stage_name, artist_id, bio, hometown, country, profile_image_url, profile_photo_url, cover_photo_url, is_verified, weekly_growth_percentage, created_at, updated_at')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileError) {
        console.error('Error fetching artist profile:', profileError);
        return null;
      }

      return data || null;
    },
    {
      ttl: 10 * 60 * 1000, // 10 minutes
      staleWhileRevalidate: true,
      tags: ['artist', 'profile'],
      priority: 'high',
    }
  ).catch((error) => {
    console.error('Error in getArtistProfile:', error);
    return null;
  });
};

export const getArtistSocialLinks = async (artistProfileId: string): Promise<any[]> => {
  try {
    const { data, error } = await supabase
      .from('artist_social_links')
      .select('id, platform, handle, url')
      .eq('artist_profile_id', artistProfileId)
      .limit(20); // Reasonable limit for social links

    if (error) {
      console.error('Error fetching social links:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in getArtistSocialLinks:', error);
    return [];
  }
};

export const getFollowerCount = async (userId: string): Promise<number> => {
  try {
    const { data, error } = await supabase.rpc('get_follower_count', {
      user_uuid: userId
    });

    if (error) {
      logger.warn('getFollowerCount: RPC failed, trying direct query', error.message);
      const { count, error: countError } = await supabase
        .from('user_follows')
        .select('*', { count: 'exact', head: true })
        .eq('following_id', userId);

      if (countError) {
        logger.error('getFollowerCount: Direct query error', countError);
        return 0;
      }

      return count || 0;
    }

    return data || 0;
  } catch (error) {
    logger.error('getFollowerCount: Unexpected error', error);
    return 0;
  }
};

export const getFollowingCount = async (userId: string): Promise<number> => {
  try {
    // Use RPC function which is SECURITY DEFINER and bypasses RLS
    const { data, error } = await supabase.rpc('get_following_count', {
      user_uuid: userId
    });

    if (error) {
      logger.error('Error fetching following count via RPC', error);
      // Fallback to direct query if RPC fails
      const { count, error: countError } = await supabase
        .from('user_follows')
        .select('*', { count: 'exact', head: true })
        .eq('follower_id', userId);
      
      if (countError) {
        console.error('Error fetching following count via direct query:', countError);
        return 0;
      }
      
      return count || 0;
    }

    return data || 0;
  } catch (error) {
    console.error('Error in getFollowingCount:', error);
    return 0;
  }
};

// Album Functions
export const getAlbumDetails = async (albumId: string): Promise<any> => {
  try {
    // Fetch album details with artist information
    const { data: albumData, error: albumError } = await supabase
      .from('albums')
      .select(`
        id,
        title,
        artist_id,
        cover_image_url,
        release_date,
        description,
        created_at,
        artists:artist_id (
          id,
          name,
          verified,
          artist_profiles (
            id,
            user_id,
            stage_name,
            is_verified
          )
        )
      `)
      .eq('id', albumId)
      .single();

    if (albumError) {
      logger.error('Error fetching album', albumError);
      throw new Error(`Album not found: ${albumError.message}`);
    }

    if (!albumData) {
      throw new Error('Album data is null');
    }

    // Fetch album tracks
    const { data: tracksData, error: tracksError } = await supabase
      .from('songs')
      .select(`
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
      `)
      .eq('album_id', albumId)
      .order('created_at', { ascending: true });

    if (tracksError) {
      logger.error('Error fetching album tracks', tracksError);
      throw new Error(`Failed to load album tracks: ${tracksError.message}`);
    }

    if (!tracksData || tracksData.length === 0) {
      throw new Error('No tracks found for this album');
    }

    // Type assertion for album artists data
    const albumArtists = albumData.artists as any;
    
    // Get artist user ID for profile linking
    const artistUserId = Array.isArray(albumArtists) 
      ? albumArtists[0]?.artist_profiles?.[0]?.user_id || null
      : albumArtists?.artist_profiles?.[0]?.user_id || null;
    
    // Get follower count for the artist
    let followerCount = 0;
    if (artistUserId) {
      followerCount = await getFollowerCount(artistUserId);
    }

    // Format tracks data
    const tracks = tracksData.map((track: any, index: number) => ({
      id: track.id,
      title: track.title,
      artist: Array.isArray(albumArtists) 
        ? albumArtists[0]?.name || 'Unknown Artist'
        : albumArtists?.name || 'Unknown Artist',
      artistId: artistUserId,
      duration: track.duration_seconds || 0,
      audioUrl: track.audio_url,
      coverImageUrl: track.cover_image_url || albumData.cover_image_url,
      trackNumber: index + 1,
      featuredArtists: [],
      playCount: track.play_count || 0
    }));

    // Calculate total duration
    const totalDuration = tracks.reduce((sum, track) => sum + track.duration, 0);

    // Calculate total play count for the album
    const totalPlayCount = tracks.reduce((sum, track) => sum + (track.playCount || 0), 0);

    // Format final album data
    const formattedAlbumData = {
      id: albumData.id,
      title: albumData.title,
      artist: Array.isArray(albumArtists) 
        ? albumArtists[0]?.name || 'Unknown Artist'
        : albumArtists?.name || 'Unknown Artist',
      artistId: artistUserId,
      coverImageUrl: albumData.cover_image_url,
      releaseDate: albumData.release_date,
      description: albumData.description,
      tracks,
      totalDuration,
      playCount: totalPlayCount,
      followerCount
    };

    return formattedAlbumData;
  } catch (error) {
    logger.error('Error in getAlbumDetails', error);
    throw error;
  }
};

// Content Functions
export const getTrendingSongs = async (days: number = 7, limit: number = 25): Promise<any[]> => {
  try {
    // Check cache first
    const cacheKey = `${CACHE_KEYS.TRENDING_SONGS}_${days}_${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await supabase
      .from('songs')
      .select(`
        id,
        title,
        duration_seconds,
        artist_id,
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
            is_verified
          )
        )
      `)
      .not('audio_url', 'is', null)
      .gte('created_at', startDate.toISOString())
      .order('play_count', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const formattedSongs = data?.map((song: any) => ({
      id: song.id,
      title: song.title,
      artist: song.artists?.artist_profiles?.[0]?.stage_name || song.artists?.name || 'Unknown Artist',
      artist_id: song.artists?.id || song.artist_id,
      artist_user_id: song.artists?.artist_profiles?.[0]?.user_id,
      cover_image_url: song.cover_image_url,
      audio_url: '', // Fetched when playing
      duration_seconds: song.duration_seconds || 0,
      play_count: song.play_count || 0
    })) || [];

    // Cache for 5 minutes
    cache.set(cacheKey, formattedSongs, 5 * 60 * 1000);
    
    return formattedSongs;
  } catch (error) {
    console.error('Error fetching trending songs:', error);
    throw error;
  }
};

export const getRandomSongs = async (limit: number = 10): Promise<any[]> => {
  try {
    const { data, error } = await supabase
      .from('songs')
      .select(`
        id,
        title,
        duration_seconds,
        artist_id,
        cover_image_url,
        play_count,
        artists:artist_id (
          id,
          name,
          artist_profiles (
            id,
            user_id,
            stage_name,
            is_verified
          )
        )
      `)
      .not('audio_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(Math.ceil(limit * 1.5)); // Reduced from 3x to 1.5x for efficiency

    if (error) throw error;

    // Shuffle and limit
    const shuffled = (data || []).sort(() => Math.random() - 0.5).slice(0, limit);

    return shuffled.map((song: any) => ({
      id: song.id,
      title: song.title,
      artist: song.artists?.artist_profiles?.[0]?.stage_name || song.artists?.name || 'Unknown Artist',
      artistId: song.artists?.artist_profiles?.[0]?.user_id,
      artist_id: song.artists?.id || song.artist_id,
      coverImageUrl: song.cover_image_url,
      audioUrl: '', // Fetched when playing
      duration: song.duration_seconds || 0,
      playCount: song.play_count || 0
    }));
  } catch (error) {
    console.error('Error fetching random songs:', error);
    return [];
  }
};

export const getRandomVideosAndClips = async (limit: number = 15): Promise<any[]> => {
  try {
    // Check cache first
    const cached = cache.get(CACHE_KEYS.RANDOM_VIDEOS);
    if (cached) return cached;

    const { data, error } = await supabase
      .from('content_uploads')
      .select(`
        id,
        title,
        description,
        content_type,
        metadata,
        play_count,
        created_at,
        user_id,
        users!inner (
          id,
          display_name,
          avatar_url
        )
      `)
      .in('content_type', ['video', 'short_clip'])
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(limit * 2); // Get more to randomize from

    if (error) throw error;

    // Shuffle and format
    const shuffled = (data || []).sort(() => Math.random() - 0.5).slice(0, limit);

    const formattedContent = shuffled.map((content: any) => ({
      id: content.id,
      title: content.title,
      description: content.description,
      contentType: content.content_type,
      videoUrl: content.metadata?.video_url || content.metadata?.file_url,
      thumbnailUrl: content.metadata?.thumbnail_url,
      playCount: content.play_count || 0,
      duration: content.metadata?.duration_seconds || 0,
      createdAt: content.created_at,
      creator: {
        id: content.user_id,
        name: content.users?.display_name || 'Unknown Creator',
        avatar: content.users?.avatar_url
      }
    }));

    // Cache for 10 minutes
    cache.set(CACHE_KEYS.RANDOM_VIDEOS, formattedContent, 10 * 60 * 1000);
    
    return formattedContent;
  } catch (error) {
    console.error('Error fetching random videos and clips:', error);
    return [];
  }
};


export const getActiveBanners = async (userCountry?: string): Promise<any[]> => {
  try {
    const cacheKey = userCountry ? `${CACHE_KEYS.ACTIVE_BANNERS}_${userCountry}` : CACHE_KEYS.ACTIVE_BANNERS;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const { data, error } = await supabase
      .from('banners')
      .select('id, title, subtitle, image_url, gradient_from, gradient_to, url, order_index, target_countries')
      .eq('is_active', true)
      .order('order_index', { ascending: true })
      .limit(20);

    if (error) throw error;

    let filtered = data || [];
    if (userCountry && filtered.length > 0) {
      filtered = filtered.filter((banner: any) =>
        !banner.target_countries ||
        banner.target_countries.length === 0 ||
        banner.target_countries.includes(userCountry)
      );
    }

    cache.set(cacheKey, filtered, 10 * 60 * 1000);

    return filtered;
  } catch (error) {
    console.error('Error fetching active banners:', error);
    return [];
  }
};

export const searchUsersByUsername = async (query: string): Promise<any[]> => {
  try {
    if (!query.trim() || query.length < 2) return [];

    const safe = sanitizeForFilter(query.trim());
    if (!safe) return [];

    const { data, error } = await supabase
      .from('users')
      .select(`
        id,
        username,
        display_name,
        avatar_url,
        role,
        show_artist_badge
      `)
      .or(`username.ilike.%${safe}%,display_name.ilike.%${safe}%`)
      .eq('is_active', true)
      .limit(20);

    if (error) throw error;

    return data || [];
  } catch (error) {
    logger.error('Error searching users by username', error);
    return [];
  }
};
// Search Functions
export const searchAllContent = async (query: string): Promise<any> => {
  try {
    const safe = sanitizeForFilter(query.trim());
    const searchTerm = safe ? `%${safe}%` : '%';

    // Search users by username/display name (uses sanitized query internally)
    const users = await searchUsersByUsername(query);

    // Search songs
    const { data: songsData } = await supabase
      .from('songs')
      .select(`
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
            is_verified
          )
        )
      `)
      .ilike('title', searchTerm)
      .not('audio_url', 'is', null)
      .limit(20);

    // Search artists
    const { data: artistsData } = await supabase
      .from('artists')
      .select(`
        id,
        name,
        verified,
        artist_profiles (
          id,
          user_id,
          stage_name,
          is_verified
        )
      `)
      .ilike('name', searchTerm)
      .limit(10);

    // Search videos
    const { data: videosData } = await supabase
      .from('content_uploads')
      .select(`
        id,
        title,
        content_type,
        metadata,
        play_count,
        user_id,
        users (
          display_name
        )
      `)
      .in('content_type', ['video', 'short_clip'])
      .eq('status', 'approved')
      .ilike('title', searchTerm)
      .limit(15);

    // Search albums
    const { data: albumsData } = await supabase
      .from('albums')
      .select(`
        id,
        title,
        cover_image_url,
        artists:artist_id (
          id,
          name,
          artist_profiles ( user_id )
        )
      `)
      .ilike('title', searchTerm)
      .limit(10);

    // Format results
    const songs = songsData?.map((song: any) => ({
      id: song.id,
      title: song.title,
      artist: song.artists?.artist_profiles?.[0]?.stage_name || song.artists?.name || 'Unknown Artist',
      artistId: song.artists?.artist_profiles?.[0]?.user_id,
      duration: song.duration_seconds || 0,
      audioUrl: song.audio_url,
      coverImageUrl: song.cover_image_url,
      playCount: song.play_count || 0
    })) || [];

    const artists = artistsData
      ?.map((artist: any) => ({
        id: artist.id,
        name: artist.name,
        imageUrl: '', // Lazy loaded
        verified: artist.verified,
        userId: artist.artist_profiles?.[0]?.user_id
      }))
      .filter((artist: any) => {
        if (!artist.userId) {
          console.warn(`Artist "${artist.name}" (ID: ${artist.id}) has no linked user profile`);
          return false;
        }
        return true;
      }) || [];

    const videos = videosData?.map((video: any) => ({
      id: video.id,
      title: video.title,
      contentType: video.content_type,
      thumbnailUrl: video.metadata?.thumbnail_url,
      videoUrl: video.metadata?.video_url || video.metadata?.file_url,
      duration: video.metadata?.duration_seconds || 0,
      playCount: video.play_count || 0,
      artist: video.users?.display_name || 'Unknown Creator',
      artistId: video.user_id
    })) || [];

    // Combine artists and users into creators, deduplicating by user ID
    const creatorsMap = new Map();

    // Add users first (they have more complete profile data)
    users.forEach((user: any) => {
      creatorsMap.set(user.id, {
        id: user.id,
        name: user.display_name || user.username,
        username: user.username,
        imageUrl: user.avatar_url,
        verified: user.show_artist_badge || false,
        userId: user.id,
        type: 'user'
      });
    });

    // Add artists, but only if not already in map
    artists.forEach((artist: any) => {
      if (!creatorsMap.has(artist.userId)) {
        creatorsMap.set(artist.userId, {
          id: artist.userId,
          name: artist.name,
          imageUrl: artist.imageUrl,
          verified: artist.verified,
          userId: artist.userId,
          type: 'artist'
        });
      }
    });

    const creators = Array.from(creatorsMap.values());

    const albums = (albumsData || []).map((album: any) => ({
      id: album.id,
      title: album.title,
      coverImageUrl: album.cover_image_url,
      artist: album.artists?.artist_profiles?.[0] ? (album.artists?.name || 'Unknown Artist') : (album.artists?.name || 'Unknown Artist'),
      artistId: album.artists?.artist_profiles?.[0]?.user_id,
    }));

    // Combine all results
    const all = [...songs, ...creators, ...videos, ...albums];

    return {
      all,
      songs,
      creators,
      videos,
      albums
    };
  } catch (error) {
    console.error('Error in searchAllContent:', error);
    throw error;
  }
};

// Playlist Functions
export const getUserPlaylists = async (): Promise<any[]> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return [];

    const { data, error } = await supabase
      .from('playlists')
      .select(`
        id,
        title,
        description,
        cover_image_url,
        is_public,
        created_at,
        updated_at,
        playlist_songs (
          id,
          song_id
        )
      `)
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('Error fetching user playlists:', error);
    return [];
  }
};

export const getPlaylistDetails = async (playlistId: string): Promise<any> => {
  try {
    const { data: playlist, error: playlistError } = await supabase
      .from('playlists')
      .select('*')
      .eq('id', playlistId)
      .maybeSingle();

    if (playlistError) throw playlistError;
    if (!playlist) throw new Error('Playlist not found');

    // Fetch playlist songs with simplified query
    const { data: playlistSongs, error: songsError } = await supabase
      .from('playlist_songs')
      .select('id, position, song_id')
      .eq('playlist_id', playlistId)
      .order('position');

    if (songsError) throw songsError;

    if (!playlistSongs || playlistSongs.length === 0) {
      return {
        ...playlist,
        songs: []
      };
    }

    // Fetch song details separately
    const songIds = playlistSongs.map(ps => ps.song_id);
    const { data: songs, error: songDetailsError } = await supabase
      .from('songs')
      .select(`
        id,
        title,
        duration_seconds,
        cover_image_url,
        audio_url,
        artist_id
      `)
      .in('id', songIds);

    if (songDetailsError) throw songDetailsError;

    // Fetch artist details for all songs
    const artistIds = songs?.map(s => s.artist_id).filter(Boolean) || [];
    const uniqueArtistIds = [...new Set(artistIds)];

    let artistsMap: Record<string, any> = {};
    if (uniqueArtistIds.length > 0) {
      const { data: artists } = await supabase
        .from('artists')
        .select('id, name')
        .in('id', uniqueArtistIds);

      if (artists) {
        artistsMap = artists.reduce((acc, artist) => {
          acc[artist.id] = artist;
          return acc;
        }, {} as Record<string, any>);
      }

      // Fetch artist profiles for user_id
      const { data: artistProfiles } = await supabase
        .from('artist_profiles')
        .select('id, stage_name, user_id')
        .in('id', uniqueArtistIds);

      if (artistProfiles) {
        artistProfiles.forEach(profile => {
          if (artistsMap[profile.id]) {
            artistsMap[profile.id].stage_name = profile.stage_name;
            artistsMap[profile.id].user_id = profile.user_id;
          }
        });
      }
    }

    // Map songs to playlist positions
    const songsMap = songs?.reduce((acc, song) => {
      acc[song.id] = song;
      return acc;
    }, {} as Record<string, any>) || {};

    const formattedSongs = playlistSongs.map((ps) => {
      const song = songsMap[ps.song_id];
      const artist = song?.artist_id ? artistsMap[song.artist_id] : null;

      return {
        id: ps.id,
        position: ps.position,
        song: {
          id: song?.id || ps.song_id,
          title: song?.title || 'Unknown Title',
          artist: artist?.stage_name || artist?.name || 'Unknown Artist',
          artistId: artist?.user_id || artist?.id,
          duration: song?.duration_seconds || 0,
          coverUrl: song?.cover_image_url,
          audioUrl: song?.audio_url
        }
      };
    });

    return {
      ...playlist,
      songs: formattedSongs
    };
  } catch (error) {
    console.error('Error fetching playlist details:', error);
    throw error;
  }
};

export const addSongToPlaylist = async (playlistId: string, songId: string): Promise<void> => {
  try {
    // Get the next position
    const { data: existingSongs, error: positionError } = await supabase
      .from('playlist_songs')
      .select('position')
      .eq('playlist_id', playlistId)
      .order('position', { ascending: false })
      .limit(1);

    if (positionError) throw positionError;

    const nextPosition = existingSongs && existingSongs.length > 0 
      ? existingSongs[0].position + 1 
      : 0;

    const { error } = await supabase
      .from('playlist_songs')
      .insert({
        playlist_id: playlistId,
        song_id: songId,
        position: nextPosition
      });

    if (error) throw error;
  } catch (error) {
    console.error('Error adding song to playlist:', error);
    throw error;
  }
};

export const getUserPlaylistsForSong = async (songId: string): Promise<any[]> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return [];

    const { data, error } = await supabase
      .from('playlists')
      .select(`
        id,
        title,
        cover_image_url,
        playlist_songs!left (
          song_id
        )
      `)
      .eq('user_id', user.id);

    if (error) throw error;

    return data?.map((playlist: any) => ({
      id: playlist.id,
      title: playlist.title,
      coverImageUrl: playlist.cover_image_url,
      hasSong: playlist.playlist_songs.some((ps: any) => ps.song_id === songId)
    })) || [];
  } catch (error) {
    console.error('Error fetching user playlists for song:', error);
    return [];
  }
};

export const toggleSongInPlaylist = async (playlistId: string, songId: string): Promise<void> => {
  try {
    // Check if song is already in playlist
    const { data: existing, error: checkError } = await supabase
      .from('playlist_songs')
      .select('id')
      .eq('playlist_id', playlistId)
      .eq('song_id', songId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      throw checkError;
    }

    if (existing) {
      // Remove from playlist
      const { error: deleteError } = await supabase
        .from('playlist_songs')
        .delete()
        .eq('id', existing.id);

      if (deleteError) throw deleteError;
    } else {
      // Add to playlist
      await addSongToPlaylist(playlistId, songId);
    }
  } catch (error) {
    console.error('Error toggling song in playlist:', error);
    throw error;
  }
};

// Favorites Functions
export const isSongFavorited = async (songId: string): Promise<boolean> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return false;

    const { data, error } = await supabase
      .from('user_favorites')
      .select('id')
      .eq('user_id', user.id)
      .eq('song_id', songId)
      .maybeSingle();

    if (error) {
      console.error('Error checking favorite status:', error);
      return false;
    }

    return !!data;
  } catch (error) {
    console.error('Error in isSongFavorited:', error);
    return false;
  }
};

export const getBatchSongsFavoriteStatus = async (songIds: string[]): Promise<Record<string, boolean>> => {
  try {
    if (songIds.length === 0) return {};

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return {};

    const { data, error } = await supabase
      .from('user_favorites')
      .select('song_id')
      .eq('user_id', user.id)
      .in('song_id', songIds);

    if (error) {
      console.error('Error checking batch favorite status:', error);
      return {};
    }

    const favoritesMap: Record<string, boolean> = {};
    songIds.forEach(id => { favoritesMap[id] = false; });
    data?.forEach(fav => { favoritesMap[fav.song_id] = true; });

    return favoritesMap;
  } catch (error) {
    console.error('Error in getBatchSongsFavoriteStatus:', error);
    return {};
  }
};

// In-flight guard to prevent duplicate like/favorite requests (rate-limit / debounce)
const favoriteInFlight = new Map<string, Promise<boolean>>();

export const toggleSongFavorite = async (songId: string): Promise<boolean> => {
  const existing = favoriteInFlight.get(songId);
  if (existing) return existing;
  const promise = toggleSongFavoriteImpl(songId);
  favoriteInFlight.set(songId, promise);
  promise.finally(() => favoriteInFlight.delete(songId));
  return promise;
};

const toggleSongFavoriteImpl = async (songId: string): Promise<boolean> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('User not authenticated');

    // Check current status
    const { data: existing } = await supabase
      .from('user_favorites')
      .select('id')
      .eq('user_id', user.id)
      .eq('song_id', songId)
      .maybeSingle();

    if (existing) {
      // Remove from favorites
      const { error } = await supabase
        .from('user_favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('song_id', songId);

      if (error) throw error;
      favoritesCache.setSongFavorited(songId, false);
      return false;
    } else {
      // Add to favorites
      const { error } = await supabase
        .from('user_favorites')
        .insert({
          user_id: user.id,
          song_id: songId
        });

      // Ignore duplicate errors (23505 = unique violation)
      if (error && error.code !== '23505') {
        throw error;
      }
      favoritesCache.setSongFavorited(songId, true);
      return true;
    }
  } catch (error) {
    console.error('Error toggling song favorite:', error);
    throw error;
  }
};

// Album Favorites
export const toggleAlbumFavorite = async (albumId: string): Promise<boolean> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('User not authenticated');

    const { data: existing } = await supabase
      .from('album_favorites')
      .select('id')
      .eq('user_id', user.id)
      .eq('album_id', albumId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('album_favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('album_id', albumId);

      if (error) throw error;
      favoritesCache.setAlbumFavorited(albumId, false);
      return false;
    } else {
      const { error } = await supabase
        .from('album_favorites')
        .insert({
          user_id: user.id,
          album_id: albumId
        });

      if (error && error.code !== '23505') {
        throw error;
      }
      favoritesCache.setAlbumFavorited(albumId, true);
      return true;
    }
  } catch (error) {
    console.error('Error toggling album favorite:', error);
    throw error;
  }
};

export const isAlbumFavorited = async (albumId: string): Promise<boolean> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return false;

    const { data, error } = await supabase
      .from('album_favorites')
      .select('id')
      .eq('user_id', user.id)
      .eq('album_id', albumId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('Error checking album favorite status:', error);
      return false;
    }

    return !!data;
  } catch (error) {
    console.error('Error in isAlbumFavorited:', error);
    return false;
  }
};

// Video/Content Favorites
export const toggleContentFavorite = async (contentId: string): Promise<boolean> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('User not authenticated');

    const { data: existing } = await supabase
      .from('content_favorites')
      .select('id')
      .eq('user_id', user.id)
      .eq('content_upload_id', contentId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('content_favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('content_upload_id', contentId);

      if (error) throw error;
      favoritesCache.setVideoFavorited(contentId, false);
      return false;
    } else {
      const { error } = await supabase
        .from('content_favorites')
        .insert({
          user_id: user.id,
          content_upload_id: contentId
        });

      if (error && error.code !== '23505') {
        throw error;
      }
      favoritesCache.setVideoFavorited(contentId, true);
      return true;
    }
  } catch (error) {
    console.error('Error toggling content favorite:', error);
    throw error;
  }
};

export const isContentFavorited = async (contentId: string): Promise<boolean> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return false;

    const { data, error } = await supabase
      .from('content_favorites')
      .select('id')
      .eq('user_id', user.id)
      .eq('content_upload_id', contentId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('Error checking content favorite status:', error);
      return false;
    }

    return !!data;
  } catch (error) {
    console.error('Error in isContentFavorited:', error);
    return false;
  }
};

// Follow Functions
export const isFollowing = async (targetUserId: string): Promise<boolean> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return false;

    const { data, error } = await supabase
      .from('user_follows')
      .select('id')
      .eq('follower_id', user.id)
      .eq('following_id', targetUserId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('Error checking follow status:', error);
      return false;
    }

    return !!data;
  } catch (error) {
    console.error('Error in isFollowing:', error);
    return false;
  }
};

export const getBatchFollowingStatus = async (userIds: string[]): Promise<Record<string, boolean>> => {
  try {
    if (userIds.length === 0) return {};

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return {};

    const { data, error } = await supabase
      .from('user_follows')
      .select('following_id')
      .eq('follower_id', user.id)
      .in('following_id', userIds);

    if (error) {
      console.error('Error checking batch following status:', error);
      return {};
    }

    const followingMap: Record<string, boolean> = {};
    userIds.forEach(id => { followingMap[id] = false; });
    data?.forEach(follow => { followingMap[follow.following_id] = true; });

    return followingMap;
  } catch (error) {
    console.error('Error in getBatchFollowingStatus:', error);
    return {};
  }
};

export const followUser = async (targetUserId: string): Promise<void> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('User not authenticated');

    if (user.id === targetUserId) {
      throw new Error('Cannot follow yourself');
    }

    const { error } = await supabase
      .from('user_follows')
      .insert({
        follower_id: user.id,
        following_id: targetUserId
      })
      .select()
      .maybeSingle();

    if (error && error.code !== '23505') {
      throw error;
    }
    followsCache.setFollowing(targetUserId, true);
  } catch (error) {
    console.error('Error following user:', error);
    throw error;
  }
};

export const unfollowUser = async (targetUserId: string): Promise<void> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('User not authenticated');

    const { error } = await supabase
      .from('user_follows')
      .delete()
      .eq('follower_id', user.id)
      .eq('following_id', targetUserId);

    if (error) throw error;
    followsCache.setFollowing(targetUserId, false);
  } catch (error) {
    console.error('Error unfollowing user:', error);
    throw error;
  }
};

// Comments Functions
export const getClipComments = async (clipId: string): Promise<any[]> => {
  try {
    const { data, error } = await supabase
      .from('clip_comments')
      .select(`
        id,
        user_id,
        comment_text,
        created_at,
        parent_comment_id,
        users:user_id (
          display_name,
          avatar_url
        )
      `)
      .eq('clip_id', clipId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('Error fetching clip comments:', error);
    throw error;
  }
};

// In-flight guard to prevent duplicate comment submit (rate-limit / debounce)
const commentInFlight = new Map<string, Promise<any>>();

function commentKey(type: 'clip' | 'content', id: string, parentId?: string | null): string {
  return `${type}_comment:${id}:${parentId ?? 'root'}`;
}

export const addClipComment = async (clipId: string, commentText: string, parentCommentId?: string | null): Promise<any> => {
  const key = commentKey('clip', clipId, parentCommentId);
  const existing = commentInFlight.get(key);
  if (existing) return existing;
  const promise = addClipCommentImpl(clipId, commentText, parentCommentId);
  commentInFlight.set(key, promise);
  promise.finally(() => commentInFlight.delete(key));
  return promise;
};

const addClipCommentImpl = async (clipId: string, commentText: string, parentCommentId?: string | null): Promise<any> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('clip_comments')
      .insert({
        user_id: user.id,
        clip_id: clipId,
        comment_text: commentText,
        parent_comment_id: parentCommentId || null
      })
      .select(`
        id,
        user_id,
        comment_text,
        created_at,
        parent_comment_id,
        users:user_id (
          display_name,
          avatar_url
        )
      `)
      .single();

    if (error) throw error;

    return data;
  } catch (error) {
    console.error('Error adding clip comment:', error);
    throw error;
  }
};

export const addContentComment = async (
  contentId: string,
  contentType: string,
  commentText: string,
  parentCommentId?: string | null
): Promise<any> => {
  const key = commentKey('content', contentId, parentCommentId);
  const existing = commentInFlight.get(key);
  if (existing) return existing;
  const promise = addContentCommentImpl(contentId, contentType, commentText, parentCommentId);
  commentInFlight.set(key, promise);
  promise.finally(() => commentInFlight.delete(key));
  return promise;
};

const addContentCommentImpl = async (
  contentId: string,
  contentType: string,
  commentText: string,
  parentCommentId?: string | null
): Promise<any> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('content_comments')
      .insert({
        user_id: user.id,
        content_id: contentId,
        content_type: contentType,
        comment_text: commentText,
        parent_comment_id: parentCommentId || null
      })
      .select(`
        id,
        user_id,
        content_id,
        content_type,
        comment_text,
        created_at,
        updated_at,
        parent_comment_id,
        users:user_id (
          display_name,
          avatar_url
        )
      `)
      .single();

    if (error) throw error;

    return {
      ...data,
      likes_count: 0,
      is_liked: false
    };
  } catch (error) {
    console.error('Error adding content comment:', error);
    throw error;
  }
};

export const updateClipComment = async (commentId: string, commentText: string): Promise<any> => {
  try {
    const { data, error } = await supabase
      .from('clip_comments')
      .update({ comment_text: commentText })
      .eq('id', commentId)
      .select(`
        id,
        user_id,
        comment_text,
        created_at,
        parent_comment_id,
        users:user_id (
          display_name,
          avatar_url
        )
      `)
      .single();

    if (error) throw error;

    return data;
  } catch (error) {
    console.error('Error updating clip comment:', error);
    throw error;
  }
};

export const deleteClipComment = async (commentId: string): Promise<void> => {
  try {
    const { error } = await supabase
      .from('clip_comments')
      .delete()
      .eq('id', commentId);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting clip comment:', error);
    throw error;
  }
};

// Content Comments Functions (for songs, albums, videos, etc.)
export const getContentComments = async (contentId: string, contentType: string): Promise<any[]> => {
  try {
    // Get current user (may be null for anonymous users)
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id;

    const { data, error } = await supabase
      .from('content_comments')
      .select(`
        id,
        user_id,
        content_id,
        content_type,
        comment_text,
        created_at,
        updated_at,
        parent_comment_id,
        users:user_id (
          display_name,
          avatar_url
        )
      `)
      .eq('content_id', contentId)
      .eq('content_type', contentType)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Fetch like counts and user like status for all comments
    const comments = data || [];
    const commentIds = comments.map(c => c.id);

    if (commentIds.length === 0) return [];

    // Get like counts for all comments
    const { data: likeCounts } = await supabase
      .from('comment_likes')
      .select('comment_id')
      .in('comment_id', commentIds);

    // Get user's likes if authenticated
    let userLikes: string[] = [];
    if (userId) {
      const { data: userLikesData } = await supabase
        .from('comment_likes')
        .select('comment_id')
        .eq('user_id', userId)
        .in('comment_id', commentIds);

      userLikes = userLikesData?.map(l => l.comment_id) || [];
    }

    // Count likes per comment
    const likeCountMap: Record<string, number> = {};
    likeCounts?.forEach(like => {
      likeCountMap[like.comment_id] = (likeCountMap[like.comment_id] || 0) + 1;
    });

    // Add like counts and is_liked status to comments
    return comments.map(comment => ({
      ...comment,
      likes_count: likeCountMap[comment.id] || 0,
      is_liked: userLikes.includes(comment.id)
    }));
  } catch (error) {
    console.error('Error fetching content comments:', error);
    throw error;
  }
};

export const updateContentComment = async (commentId: string, commentText: string): Promise<any> => {
  try {
    const { data, error } = await supabase
      .from('content_comments')
      .update({ comment_text: commentText })
      .eq('id', commentId)
      .select(`
        id,
        user_id,
        content_id,
        content_type,
        comment_text,
        created_at,
        updated_at,
        parent_comment_id,
        users:user_id (
          display_name,
          avatar_url
        )
      `)
      .single();

    if (error) throw error;

    return data;
  } catch (error) {
    console.error('Error updating content comment:', error);
    throw error;
  }
};

export const deleteContentComment = async (commentId: string): Promise<void> => {
  try {
    const { error } = await supabase
      .from('content_comments')
      .delete()
      .eq('id', commentId);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting content comment:', error);
    throw error;
  }
};

export const getContentCommentsCount = async (contentId: string, contentType: string): Promise<number> => {
  try {
    const { count, error } = await supabase
      .from('content_comments')
      .select('*', { count: 'exact', head: true })
      .eq('content_id', contentId)
      .eq('content_type', contentType);

    if (error) throw error;

    return count || 0;
  } catch (error) {
    console.error('Error fetching content comments count:', error);
    return 0;
  }
};

// Likes Functions
export const getClipLikesCount = async (clipId: string): Promise<number> => {
  try {
    const { count, error } = await supabase
      .from('clip_likes')
      .select('*', { count: 'exact', head: true })
      .eq('clip_id', clipId);

    if (error) throw error;

    return count || 0;
  } catch (error) {
    console.error('Error fetching clip likes count:', error);
    return 0;
  }
};

export const isClipLiked = async (clipId: string): Promise<boolean> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return false;

    const { data, error } = await supabase
      .from('clip_likes')
      .select('id')
      .eq('user_id', user.id)
      .eq('clip_id', clipId)
      .maybeSingle();

    if (error) {
      console.error('Error checking clip like status:', error);
      return false;
    }

    return !!data;
  } catch (error) {
    console.error('Error in isClipLiked:', error);
    return false;
  }
};

export const toggleClipLike = async (clipId: string): Promise<boolean> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('User not authenticated');

    const { data: existing } = await supabase
      .from('clip_likes')
      .select('id')
      .eq('user_id', user.id)
      .eq('clip_id', clipId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('clip_likes')
        .delete()
        .eq('user_id', user.id)
        .eq('clip_id', clipId);

      if (error) throw error;
      favoritesCache.setVideoFavorited(clipId, false);
      return false;
    } else {
      const { error } = await supabase
        .from('clip_likes')
        .insert({
          user_id: user.id,
          clip_id: clipId
        });

      if (error && error.code !== '23505') throw error;
      favoritesCache.setVideoFavorited(clipId, true);
      return true;
    }
  } catch (error) {
    console.error('Error toggling clip like:', error);
    throw error;
  }
};

// Video Functions
export const getVideoDetails = async (videoId: string): Promise<any> => {
  try {
    // Don't use cache to ensure follower count is always up-to-date
    const { data, error } = await supabase
      .from('content_uploads')
      .select(`
        id,
        title,
        description,
        metadata,
        play_count,
        created_at,
        user_id,
        users!inner (
          id,
          display_name,
          avatar_url
        )
      `)
      .eq('id', videoId)
      .eq('content_type', 'video')
      .single();

    if (error) throw error;

    if (!data) {
      throw new Error('Video not found');
    }

    const followerCount = await getFollowerCount(data.user_id);

    // Type assertion for users data
    const userData = data.users as any;

    // Validate video URL
    const videoUrl = data.metadata?.video_url || data.metadata?.file_url;

    if (!videoUrl) {
      logger.error('getVideoDetails: Video URL missing', { videoId: data.id, title: data.title });
      throw new Error(`Video playback unavailable: Missing video URL for video ${videoId}`);
    }

    if (!videoUrl.startsWith('https://')) {
      logger.error('getVideoDetails: Invalid URL protocol', videoUrl);
      throw new Error(`Invalid video URL protocol: ${videoUrl}`);
    }

    const videoDetails = {
      id: data.id,
      title: data.title,
      description: data.description,
      videoUrl: videoUrl,
      thumbnailUrl: data.metadata?.thumbnail_url,
      playCount: data.play_count || 0,
      createdAt: data.created_at,
      releaseDate: data.metadata?.release_date ?? null,
      creator: {
        id: data.user_id,
        name: userData?.display_name || 'Unknown Creator',
        avatar: userData?.avatar_url,
        followerCount
      }
    };

    // Don't cache video details to ensure follower count is always fresh
    // The video metadata itself is cached elsewhere (videoCache)
    return videoDetails;
  } catch (error) {
    logger.error('Error fetching video details', error);
    throw error;
  }
};

export const getMoreVideos = async (excludeVideoId: string, limit: number = 10): Promise<any[]> => {
  try {
    // Check cache first
    const cacheKey = `more_videos_${excludeVideoId}_${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const { data, error } = await supabase
      .from('content_uploads')
      .select(`
        id,
        title,
        metadata,
        play_count,
        user_id,
        users!inner:user_id (
          display_name
        )
      `)
      .in('content_type', ['video', 'short_clip'])
      .eq('status', 'approved')
      .neq('id', excludeVideoId)
      .order('play_count', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const videos = data?.map((video: any) => ({
      id: video.id,
      title: video.title,
      thumbnailUrl: video.metadata?.thumbnail_url,
      creatorName: video.users?.display_name || 'Unknown Creator',
      userId: video.user_id,
      playCount: video.play_count || 0,
      duration: video.metadata?.duration_seconds || 0
    })) || [];

    // Cache for 3 minutes
    cache.set(cacheKey, videos, 3 * 60 * 1000);

    return videos;
  } catch (error) {
    console.error('Error fetching more videos:', error);
    return [];
  }
};

export const getRelatedVideos = async (
  currentVideoId: string,
  creatorId: string,
  limit: number = 6
): Promise<any[]> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();

    // Get list of already played video IDs for this user
    let playedVideoIds: string[] = [currentVideoId];

    if (user) {
      const { data: playbackHistory } = await supabase
        .from('video_playback_history')
        .select('content_id')
        .eq('user_id', user.id);

      if (playbackHistory && playbackHistory.length > 0) {
        playedVideoIds = [
          currentVideoId,
          ...playbackHistory
            .map(p => p.content_id)
            .filter(id => id !== null)
        ];
      }
    }

    // Strategy: Fetch videos based on multiple factors
    // 1. Same creator (weight: high)
    // 2. Popular videos (by play count)
    // 3. Recent videos
    // 4. Exclude already played videos (current video + watch history)

    // Build query for videos from the same creator
    let creatorQuery = supabase
      .from('content_uploads')
      .select(`
        id,
        title,
        metadata,
        play_count,
        created_at,
        user_id,
        users!user_id (
          display_name
        )
      `)
      .in('content_type', ['video', 'short_clip'])
      .eq('status', 'approved')
      .eq('user_id', creatorId);

    const { data: creatorVideosData } = await creatorQuery
      .order('play_count', { ascending: false })
      .limit(10); // Fetch more to account for filtering

    // Filter out excluded IDs in JavaScript (safer and more reliable)
    const excludedVideoIds = new Set(playedVideoIds);
    const creatorVideos = (creatorVideosData || []).filter((video: any) => 
      video.id && !excludedVideoIds.has(video.id)
    ).slice(0, 3);

    // Build query for popular videos from other creators
    let popularQuery = supabase
      .from('content_uploads')
      .select(`
        id,
        title,
        metadata,
        play_count,
        created_at,
        user_id,
        users!user_id (
          display_name
        )
      `)
      .in('content_type', ['video', 'short_clip'])
      .eq('status', 'approved')
      .neq('user_id', creatorId);


    const { data: popularVideosData } = await popularQuery
      .order('play_count', { ascending: false })
      .limit(limit);

    const popularVideos = popularVideosData || [];

    // Combine and deduplicate results
    const combinedVideos = [
      ...creatorVideos,
      ...popularVideos
    ];

    // Remove duplicates and take only required limit
    const uniqueVideos = Array.from(
      new Map(combinedVideos.map(v => [v.id, v])).values()
    ).slice(0, limit);

    const videos = uniqueVideos.map((video: any) => {
      const userData = Array.isArray(video.users) ? video.users[0] : video.users;
      return {
        id: video.id,
        title: video.title,
        thumbnailUrl: video.metadata?.thumbnail_url,
        creatorName: userData?.display_name || 'Unknown Creator',
        userId: video.user_id,
        playCount: video.play_count || 0,
        duration: video.metadata?.duration_seconds || 0,
        createdAt: video.created_at
      };
    });

    return videos;
  } catch (error) {
    console.error('Error fetching related videos:', error);
    return [];
  }
};

// Genre Functions
export const getGenreDetails = async (genreId: string): Promise<any> => {
  try {
    const { data, error } = await supabase
      .from('genres')
      .select('id, name, description, image_url, image_path')
      .eq('id', genreId)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      throw new Error(`Genre with ID ${genreId} not found`);
    }

    return data;
  } catch (error) {
    console.error('Error fetching genre details:', error);
    throw error;
  }
};

export const getSongsByGenre = async (genreId: string, limit: number = 200): Promise<any[]> => {
  try {
    const { data, error } = await supabase
      .from('song_genres')
      .select(`
        songs:song_id (
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
              user_id
            )
          )
        )
      `)
      .eq('genre_id', genreId)
      .not('song_id', 'is', null)
      .order('song_id', { ascending: false })
      .limit(limit);

    if (error) throw error;

    // Filter out any items where songs data is null or undefined
    const validSongs = data?.filter((item: any) => item.songs && item.songs.id && item.songs.audio_url) || [];

    return validSongs.map((item: any) => ({
      id: item.songs.id,
      title: item.songs.title,
      artist: item.songs.artists?.name || 'Unknown Artist',
      artistId: item.songs.artists?.artist_profiles?.[0]?.user_id,
      duration: item.songs.duration_seconds || 0,
      audioUrl: item.songs.audio_url,
      coverImageUrl: item.songs.cover_image_url,
      playCount: item.songs.play_count || 0,
      created_at: item.songs.created_at
    }));
  } catch (error) {
    console.error('Error fetching songs by genre:', error);
    return [];
  }
};

// Genre Image Management Functions
export const uploadGenreImage = async (
  genreId: string,
  imageFile: File
): Promise<{ success: boolean; imageUrl?: string; error?: string }> => {
  try {
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(imageFile.type)) {
      return { success: false, error: 'Invalid file type. Only JPEG, PNG, and WebP images are allowed.' };
    }

    // Validate file size (5MB max)
    if (imageFile.size > 5 * 1024 * 1024) {
      return { success: false, error: 'File size exceeds 5MB limit.' };
    }

    // Get authenticated user and verify admin role
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: 'Authentication required.' };
    }

    const role = await getUserRole();
    if (role !== 'admin') {
      return { success: false, error: 'Admin access required.' };
    }

    // Generate unique filename
    const timestamp = Date.now();
    const fileExt = imageFile.name.split('.').pop();
    const filePath = `${genreId}/${timestamp}.${fileExt}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('genre-images')
      .upload(filePath, imageFile, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('Error uploading genre image:', uploadError);
      return { success: false, error: uploadError.message };
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('genre-images')
      .getPublicUrl(filePath);

    // Update genre record with new image URL
    const { error: updateError } = await supabase
      .from('genres')
      .update({
        image_url: publicUrl,
        image_path: filePath
      })
      .eq('id', genreId);

    if (updateError) {
      console.error('Error updating genre with image URL:', updateError);
      // Try to clean up uploaded file
      await supabase.storage.from('genre-images').remove([filePath]);
      return { success: false, error: updateError.message };
    }

    return { success: true, imageUrl: publicUrl };
  } catch (error) {
    console.error('Unexpected error uploading genre image:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload image'
    };
  }
};

export const deleteGenreImage = async (genreId: string): Promise<{ success: boolean; error?: string }> => {
  try {
    // Get authenticated user and verify admin role
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: 'Authentication required.' };
    }

    const role = await getUserRole();
    if (role !== 'admin') {
      return { success: false, error: 'Admin access required.' };
    }

    // Get genre to find image path
    const { data: genre, error: genreError } = await supabase
      .from('genres')
      .select('image_path')
      .eq('id', genreId)
      .maybeSingle();

    if (genreError) {
      return { success: false, error: genreError.message };
    }

    if (!genre?.image_path) {
      return { success: true }; // No image to delete
    }

    // Delete from storage
    const { error: deleteError } = await supabase.storage
      .from('genre-images')
      .remove([genre.image_path]);

    if (deleteError) {
      console.error('Error deleting genre image from storage:', deleteError);
    }

    // Update genre record to remove image references
    const { error: updateError } = await supabase
      .from('genres')
      .update({
        image_url: null,
        image_path: null
      })
      .eq('id', genreId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Unexpected error deleting genre image:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete image'
    };
  }
};

export const getAllGenres = async (): Promise<any[]> => {
  try {
    const { data, error } = await supabase
      .from('genres')
      .select('id, name, description, image_url, image_path')
      .order('name', { ascending: true });

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('Error fetching all genres:', error);
    return [];
  }
};

// Share Functions
export const recordShareEvent = async (contentId: string, contentType: string): Promise<void> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    // Record share event (works for both authenticated and anonymous users)
    const { error } = await supabase
      .from('share_events')
      .insert({
        content_id: contentId,
        content_type: contentType,
        user_id: user?.id || null,
        shared_at: new Date().toISOString()
      });

    if (error) {
      console.error('Error recording share event:', error);
      // Don't throw error as sharing should still work
    }
  } catch (error) {
    console.error('Error in recordShareEvent:', error);
    // Don't throw error as sharing should still work
  }
};

// Profile Functions
export const CREATOR_ACCESS_CHANGED_EVENT = 'airaplay:creator-access-changed';

export function notifyCreatorAccessChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CREATOR_ACCESS_CHANGED_EVENT));
}

const OWN_USER_PROFILE_SELECT =
  'id, email, display_name, username, avatar_url, bio, country, gender, ' +
  'role, show_artist_badge, profile_visibility, social_media_platform, ' +
  'social_media_url, username_changed, username_last_changed_at, ' +
  'country_last_changed_at, background_image_url, total_earnings, ' +
  'wallet_address, is_active, show_listening_history, ' +
  'email_notifications, push_notifications, notification_sound, ' +
  'quiet_hours_enabled, quiet_hours_start, quiet_hours_end, ' +
  'receive_new_follower_notifications, receive_content_notifications, ' +
  'receive_playlist_notifications, receive_system_notifications, ' +
  'date_of_birth, created_at, updated_at';

/** Load the signed-in user's full profile row (explicit column grant list). */
export async function fetchOwnUserProfile() {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return { data: null, error: authError ?? new Error('User not authenticated') };
  }

  return supabase
    .from('users')
    .select(OWN_USER_PROFILE_SELECT)
    .eq('id', user.id)
    .maybeSingle();
}

export const updateUserProfile = async (updates: any): Promise<any> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('User not authenticated');

    // Prepare the update object, removing any undefined values and handling null properly
    const cleanUpdates: any = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        cleanUpdates[key] = value;
      }
    }

    cleanUpdates.updated_at = new Date().toISOString();

    // Update user profile. Column-level grants on `public.users` mean
    // `.select()` (which translates to `RETURNING *`) fails — we must list
    // an explicit projection of granted columns.
    const { data, error } = await supabase
      .from('users')
      .update(cleanUpdates)
      .eq('id', user.id)
      .select(
        'id, email, display_name, username, avatar_url, bio, country, gender, ' +
        'role, show_artist_badge, profile_visibility, social_media_platform, ' +
        'social_media_url, username_changed, username_last_changed_at, ' +
        'country_last_changed_at, background_image_url, total_earnings, ' +
        'wallet_address, is_active, show_listening_history, ' +
        'email_notifications, push_notifications, notification_sound, ' +
        'quiet_hours_enabled, quiet_hours_start, quiet_hours_end, ' +
        'receive_new_follower_notifications, receive_content_notifications, ' +
        'receive_playlist_notifications, receive_system_notifications, ' +
        'date_of_birth, created_at, updated_at'
      )
      .single();

    if (error) {
      logger.error('Database update error (profile)', error);
      throw new Error(`Failed to update profile: ${error.message}`);
    }

    if (!data) {
      throw new Error('No data returned from profile update');
    }

    cache.delete(CACHE_KEYS.USER_ROLE);
    cache.delete(CACHE_KEYS.ARTIST_PROFILE);

    return { success: true, data };
  } catch (error) {
    logger.error('Error updating user profile', error);
    // Re-throw with more specific error message
    if (error instanceof Error) {
      throw error;
    } else {
      throw new Error('An unexpected error occurred while updating your profile');
    }
  }
};

export const getPublicUserProfile = async (userId: string): Promise<any> => {
  try {
    // Public profile screen — runs for anonymous visitors too. The select must
    // stay inside the anon column whitelist on `public.users`; `email` and
    // `role` are intentionally excluded (anonymous browsers no longer have
    // SELECT grants on those, and exposing role would advertise which accounts
    // are admins/managers). Creator detection is done by probing
    // `artist_profiles` instead of trusting `role`.
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select(`
        id,
        display_name,
        username,
        avatar_url,
        bio,
        country,
        show_artist_badge,
        profile_visibility,
        social_media_platform,
        social_media_url,
        created_at
      `)
      .eq('id', userId)
      .single();

    if (userError) {
      logger.error('Error fetching user data', userError);
      throw userError;
    }

    if (!userData) {
      throw new Error('User not found');
    }

    const isPrivateProfile = userData.profile_visibility === 'private';

    // Probe for an artist_profiles row instead of gating on `role`. If the
    // user has one, treat them as a creator (and fetch socials/badges).
    let artistProfile = null;
    let socialLinks: any[] = [];

    {
      const { data: artistData, error: artistError } = await supabase
        .from('artist_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (artistError) {
        logger.error(`Error fetching artist profile for user ${userId}`, artistError);
      } else if (artistData) {
        artistProfile = artistData;

        if (!isPrivateProfile) {
          socialLinks = await getArtistSocialLinks(artistData.id);
        }
      }
    }

    // Get user's uploads (only if profile is public)
    let uploadsData = null;
    if (!isPrivateProfile) {
      const { data: uploads, error: uploadsError } = await supabase
        .from('content_uploads')
        .select('id, title, content_type, status, created_at, metadata')
        .eq('user_id', userId)
        .eq('status', 'approved')
        .order('created_at', { ascending: false });

      if (uploadsError) {
        logger.error('Error fetching user uploads', uploadsError);
      } else {
        uploadsData = uploads;
      }
    }

    // Get verified badge config if user is a verified creator (public info, shown even for private profiles)
    let verifiedBadgeUrl: string | null = null;
    if (artistProfile?.is_verified) {
      const { data: badgeConfig, error: badgeError } = await supabase
        .from('verified_badge_config')
        .select('badge_url')
        .maybeSingle();

      if (badgeError) {
        logger.error('Error fetching verified badge config', badgeError);
      } else if (badgeConfig?.badge_url) {
        verifiedBadgeUrl = badgeConfig.badge_url;
      }
    }

    // Get follower and following counts (public info, shown even for private profiles)
    const [followerCount, followingCount] = await Promise.all([
      getFollowerCount(userId).catch((err) => {
        logger.error(`Error fetching follower count for user ${userId}`, err);
        return 0;
      }),
      getFollowingCount(userId).catch((err) => {
        logger.error(`Error fetching following count for user ${userId}`, err);
        return 0;
      })
    ]);

    return {
      user: {
        ...userData,
        bio: isPrivateProfile ? null : userData.bio // Hide bio for private profiles
      },
      artistProfile,
      socialLinks,
      uploads: uploadsData || [],
      followerCount: followerCount ?? 0,
      followingCount: followingCount ?? 0,
      verifiedBadgeUrl
    };
  } catch (error) {
    console.error('Error fetching public user profile:', error);
    throw error;
  }
};

// Content Management Functions
/** Optional upload shape when caller already has it (e.g. from Library) to avoid extra fetch. */
export type ContentUploadForDelete = { content_type: string; metadata?: { song_id?: string; album_id?: string } | null };

/**
 * Deletes a content upload from the library and automatically deletes the underlying
 * content from the database: single → song row; album → album + its songs; video/short_clip → content_uploads only.
 */
export const deleteContentUpload = async (
  contentId: string,
  upload?: ContentUploadForDelete | null
): Promise<void> => {
  try {
    let contentType: string;
    let metadata: { song_id?: string; album_id?: string } | null | undefined;

    if (upload?.content_type) {
      contentType = upload.content_type;
      metadata = upload.metadata ?? null;
    } else {
      const { data: row, error: fetchError } = await supabase
        .from('content_uploads')
        .select('content_type, metadata')
        .eq('id', contentId)
        .maybeSingle();
      if (fetchError) throw fetchError;
      if (!row) throw new Error('Content upload not found');
      contentType = row.content_type;
      metadata = row.metadata ?? null;
    }

    const songId = metadata?.song_id ?? null;
    const albumId = metadata?.album_id ?? null;

    // 1) Delete underlying content so it is removed from the database (not just the library entry)
    if (contentType === 'single' && songId) {
      const { error: songError } = await supabase.from('songs').delete().eq('id', songId);
      if (songError) {
        console.warn('Error deleting song (may be already removed or RLS):', songError);
        // Continue to remove content_upload so library is in sync
      }
    } else if (contentType === 'album' && albumId) {
      const { error: songsError } = await supabase.from('songs').delete().eq('album_id', albumId);
      if (songsError) console.warn('Error deleting album songs:', songsError);
      const { error: albumError } = await supabase.from('albums').delete().eq('id', albumId);
      if (albumError) {
        console.warn('Error deleting album:', albumError);
      }
    }
    // video / short_clip: no separate table; content_uploads row is the only record

    // 2) Always delete the content_uploads row so it disappears from the library
    const { error } = await supabase.from('content_uploads').delete().eq('id', contentId);
    if (error) throw error;
  } catch (error) {
    console.error('Error deleting content upload:', error);
    throw error;
  }
};

export const getTreatWallet = async (): Promise<any> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return null;

    const { data, error } = await supabase
      .from('treat_wallets')
      .select('*')
      .eq('user_id', user.id)
      .limit(1);

    if (error) {
      console.error('Error fetching treat wallet:', error);
      return null;
    }

    return data && data.length > 0 ? data[0] : null;
  } catch (error) {
    console.error('Error in getTreatWallet:', error);
    return null;
  }
};

export const getTreatTransactions = async (limit: number = 50): Promise<any[]> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return [];

    const { data, error } = await supabase
      .from('treat_transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('Error fetching treat transactions:', error);
    return [];
  }
};

export const sendTreatTip = async (
  recipientId: string,
  amount: number,
  securityPin: string,
  message?: string,
  contentId?: string,
  contentType?: string
): Promise<{ id: string }> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('User not authenticated');

    const { data, error } = await supabase.rpc('send_treat_tip_with_security_pin', {
      p_recipient_id: recipientId,
      p_amount: amount,
      p_message: message ?? null,
      p_content_id: contentId ?? null,
      p_content_type: contentType ?? null,
      p_security_pin: securityPin,
    });

    if (error) throw error;

    const row = data as { success?: boolean; id?: string; error?: string } | null;
    if (!row?.success) {
      throw new Error(row?.error || 'Failed to send tip');
    }
    if (!row.id) throw new Error('Tip did not return an id');

    return { id: row.id };
  } catch (error) {
    console.error('Error sending treat tip:', error);
    throw error;
  }
};

function parseSecurityPinRpcResult(data: unknown): { success?: boolean; error?: string } | null {
  if (data == null) return null;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as { success?: boolean; error?: string };
    } catch {
      return null;
    }
  }
  if (typeof data === 'object') return data as { success?: boolean; error?: string };
  return null;
}

export const setSecurityPinRpc = async (pin: string, confirm: string): Promise<void> => {
  const { data, error } = await supabase.rpc('set_security_pin', {
    p_pin: pin,
    p_confirm: confirm,
  });
  if (error) {
    const msg = [error.message, (error as { details?: string }).details].filter(Boolean).join(' — ');
    throw new Error(msg || 'Could not set Security PIN');
  }
  const row = parseSecurityPinRpcResult(data);
  if (!row?.success) {
    throw new Error(row?.error || 'Could not set Security PIN');
  }
};

/** Requires `change_security_pin` RPC — apply CHANGE_SECURITY_PIN_RPC.sql in Supabase. */
export const changeSecurityPinRpc = async (
  currentPin: string,
  newPin: string,
  confirm: string
): Promise<void> => {
  const { data, error } = await supabase.rpc('change_security_pin', {
    p_current_pin: currentPin,
    p_new_pin: newPin,
    p_confirm: confirm,
  });
  if (error) {
    const msg = [error.message, (error as { details?: string }).details].filter(Boolean).join(' — ');
    throw new Error(msg || 'Could not change Security PIN');
  }
  const row = parseSecurityPinRpcResult(data);
  if (!row?.success) {
    throw new Error(row?.error || 'Could not change Security PIN');
  }
};

export const fetchHasSecurityPin = async (): Promise<boolean> => {
  const { data, error } = await supabase.rpc('has_security_pin');
  if (error) throw error;
  return Boolean(data);
};

export interface MyAgeInfo {
  date_of_birth: string | null;
  age_years: number | null;
  is_adult: boolean;
  is_signup_eligible: boolean;
}

export const getMyAgeInfo = async (): Promise<MyAgeInfo> => {
  const { data, error } = await supabase.rpc('get_my_age_info');
  if (error) throw error;
  const row = (data || {}) as Partial<MyAgeInfo>;
  return {
    date_of_birth: typeof row.date_of_birth === 'string' ? row.date_of_birth : null,
    age_years: typeof row.age_years === 'number' ? row.age_years : null,
    is_adult: row.is_adult === true,
    is_signup_eligible: row.is_signup_eligible === true,
  };
};

export const requestAccountDeletion = async (reason?: string): Promise<{
  success: boolean;
  already_pending: boolean;
  request_id: string | null;
}> => {
  const { data, error } = await supabase.rpc('request_account_deletion', {
    p_reason: reason?.trim() || null,
  });
  if (error) throw error;
  const row = (data || {}) as {
    success?: boolean;
    already_pending?: boolean;
    request_id?: string | null;
  };
  return {
    success: row.success === true,
    already_pending: row.already_pending === true,
    request_id: typeof row.request_id === 'string' ? row.request_id : null,
  };
};

/** Server-side PIN check (uses `verify_security_pin_for_session` RPC). Apply VERIFY_SECURITY_PIN_SESSION_RPC.sql if missing. */
export const verifySecurityPinForSession = async (pin: string): Promise<void> => {
  const { data, error } = await supabase.rpc('verify_security_pin_for_session', {
    p_pin: pin,
  });
  if (error) {
    const msg = [error.message, (error as { details?: string }).details].filter(Boolean).join(' — ');
    throw new Error(msg || 'Could not verify Security PIN');
  }
  const row = parseSecurityPinRpcResult(data);
  if (!row?.success) {
    throw new Error(row?.error || 'Incorrect Security PIN');
  }
};

export const createTreatPromotion = async (
  promotionType: 'song_promotion' | 'profile_promotion',
  targetId: string,
  targetTitle: string,
  treatsSpent: number,
  durationHours: number,
  targetImpressions: number
): Promise<any> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('User not authenticated');

    const endsAt = new Date();
    endsAt.setHours(endsAt.getHours() + durationHours);

    const { data, error } = await supabase
      .from('treat_promotions')
      .insert({
        user_id: user.id,
        promotion_type: promotionType,
        target_id: targetId,
        target_title: targetTitle,
        treats_spent: treatsSpent,
        duration_hours: durationHours,
        target_impressions: targetImpressions,
        ends_at: endsAt.toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    return data;
  } catch (error) {
    console.error('Error creating treat promotion:', error);
    throw error;
  }
};

export const getUserTreatPromotions = async (): Promise<any[]> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return [];

    const { data, error } = await supabase
      .from('treat_promotions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('Error fetching user treat promotions:', error);
    return [];
  }
};

export const deletePlaylist = async (playlistId: string): Promise<void> => {
  try {
    const { error } = await supabase
      .from('playlists')
      .delete()
      .eq('id', playlistId);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting playlist:', error);
    throw error;
  }
};

// Admin Functions
export const adminUpdateUserStatus = async (userId: string, isActive: boolean): Promise<any> => {
  try {
    // Validate userId format
    if (!userId || !isValidUUID(userId)) {
      throw new Error('Invalid user ID format');
    }
    
    const { data, error } = await supabase.rpc('admin_update_user_status', {
      target_user_id: userId,
      new_status: isActive
    });

    if (error) throw error;

    // Check if the function returned an error
    if (data && !data.success) {
      throw new Error(data.error || 'Failed to update user status');
    }

    return data;
  } catch (error) {
    console.error('Error updating user status:', error);
    throw error;
  }
};

export const adminAdjustUserEarnings = async (
  userId: string,
  amount: number,
  operation: 'add' | 'subtract' | 'set'
): Promise<any> => {
  try {
    // Validate userId format
    if (!userId || !isValidUUID(userId)) {
      throw new Error('Invalid user ID format');
    }
    
    // Validate amount
    if (typeof amount !== 'number' || isNaN(amount) || amount < 0) {
      throw new Error('Invalid amount: must be a positive number');
    }
    
    const { data, error } = await supabase.rpc('admin_adjust_user_earnings', {
      target_user_id: userId,
      adjustment_amount: amount,
      operation_type: operation
    });

    if (error) throw error;

    // Check if the function returned an error
    if (data && !data.success) {
      throw new Error(data.error || 'Failed to adjust user earnings');
    }

    return data;
  } catch (error) {
    console.error('Error adjusting user earnings:', error);
    throw error;
  }
};

export const adminGeneratePasswordResetLink = async (userId: string): Promise<any> => {
  try {
    // Validate userId format
    if (!userId || !isValidUUID(userId)) {
      throw new Error('Invalid user ID format');
    }
    // First validate that the current user is an admin and get the target user's email
    const { data, error } = await supabase.rpc('admin_generate_password_reset', {
      target_user_id: userId
    });

    if (error) throw error;

    // Check if the function returned an error
    if (data && !data.success) {
      throw new Error(data.error || 'Failed to generate password reset');
    }

    // Send password reset email using the standard auth flow
    // This works with the anon key and is the proper way to trigger password resets
    const resetRedirectBase =
      import.meta.env.VITE_PUBLIC_WEB_URL ||
      (typeof window !== 'undefined' ? window.location.origin : '');
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${resetRedirectBase}/reset-password`
    });

    if (resetError) throw resetError;

    return { ...data, success: true };
  } catch (error) {
    console.error('Error generating password reset link:', error);
    throw error;
  }
};

export const getPublicWebUrl = (): string => {
  const raw =
    import.meta.env.VITE_PUBLIC_WEB_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '');
  return String(raw || '').trim().replace(/\/+$/, '');
};

export const adminDeletePayoutSetting = async (settingId: string): Promise<any> => {
  try {
    const { data, error } = await supabase.rpc('admin_delete_payout_setting', {
      setting_id: settingId
    });

    if (error) throw error;

    return data;
  } catch (error) {
    console.error('Error deleting payout setting:', error);
    throw error;
  }
};

export const withdrawUserFunds = async (
  amount: number,
  methodId: string | undefined,
  securityPin: string
): Promise<any> => {
  try {
    const { data, error } = await supabase.rpc('withdraw_user_funds', {
      withdrawal_amount: amount,
      method_id: methodId || null,
      security_pin: securityPin,
    });

    if (error) throw error;

    const row = data as { success?: boolean; error?: string } | null;
    if (row && row.success === false) {
      throw new Error(row.error || 'Withdrawal failed');
    }

    return data;
  } catch (error) {
    console.error('Error withdrawing user funds:', error);
    throw error;
  }
};

export const submitReport = async (
  reportedItemType: 'song' | 'video' | 'album' | 'comment' | 'user' | 'playlist',
  reportedItemId: string,
  reason: string,
  description?: string,
  reportedUserId?: string | null
): Promise<void> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      throw new Error('You must be signed in to report content');
    }

    const { error } = await supabase
      .from('reports')
      .insert({
        reporter_id: user.id,
        reported_item_type: reportedItemType,
        reported_item_id: reportedItemId,
        reported_user_id: reportedUserId,
        reason,
        description: description || null,
        status: 'pending'
      });

    if (error) throw error;
  } catch (error) {
    console.error('Error submitting report:', error);
    throw error;
  }
};

export const getUserReports = async (): Promise<any[]> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      throw new Error('You must be signed in to view reports');
    }

    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .eq('reporter_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('Error fetching user reports:', error);
    throw error;
  }
};

// Analytics Functions for Creators
export interface CreatorAnalytics {
  totalPlays: number;
  uniqueListeners: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  playlistAdds: number;
  topContent: TopContent[];
  topLocations: LocationStats[];
  recentGrowth: GrowthStats;
}

export interface TopContent {
  id: string;
  title: string;
  type: 'song' | 'album' | 'video' | 'short_clip';
  playCount: number;
  coverUrl?: string;
  growthRate: number;
}

export interface LocationStats {
  country: string;
  percentage: number;
  count: number;
}

export interface GrowthStats {
  playsGrowth: number;
  listenersGrowth: number;
  period: 'week' | 'month';
}

export const getCreatorAnalytics = async (): Promise<CreatorAnalytics> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      throw new Error('You must be signed in to view analytics');
    }

    // Get artist profile to verify user is a creator
    const { data: artistProfile } = await supabase
      .from('artist_profiles')
      .select('id, artist_id')
      .eq('user_id', user.id)
      .single();

    if (!artistProfile) {
      throw new Error('Only creators can view analytics');
    }

    // Get total plays from songs
    const { data: songStats } = await supabase
      .from('songs')
      .select('play_count, id')
      .eq('artist_id', artistProfile.artist_id);

    const totalSongPlays = songStats?.reduce((sum, song) => sum + (song.play_count || 0), 0) || 0;

    // Get total plays from content uploads (videos, clips)
    const { data: contentStats } = await supabase
      .from('content_uploads')
      .select('play_count, id')
      .eq('user_id', user.id)
      .eq('status', 'approved');

    const totalContentPlays = contentStats?.reduce((sum, content) => sum + (content.play_count || 0), 0) || 0;

    const totalPlays = totalSongPlays + totalContentPlays;

    // Get unique listeners from listening history (songs)
    const { data: songListenerData } = await supabase
      .from('listening_history')
      .select('user_id')
      .in('song_id', songStats?.map(s => s.id) || []);

    // Get unique viewers from video playback history (videos/clips)
    const { data: videoViewerData } = await supabase
      .from('video_playback_history')
      .select('user_id')
      .in('content_id', contentStats?.map(c => c.id) || []);

    // Combine and count unique users across all content
    const allUserIds = [
      ...(songListenerData?.map(l => l.user_id) || []),
      ...(videoViewerData?.map(v => v.user_id) || [])
    ];
    const uniqueListeners = new Set(allUserIds.filter(id => id !== null)).size;

    // Get total likes from songs
    const { count: songLikesCount } = await supabase
      .from('song_likes')
      .select('*', { count: 'exact', head: true })
      .in('song_id', songStats?.map(s => s.id) || []);

    // Get total likes from content uploads
    const { count: contentLikesCount } = await supabase
      .from('clip_likes')
      .select('*', { count: 'exact', head: true })
      .in('clip_id', contentStats?.map(c => c.id) || []);

    const totalLikes = (songLikesCount || 0) + (contentLikesCount || 0);

    // Get total comments
    const { count: commentsCount } = await supabase
      .from('content_comments')
      .select('*', { count: 'exact', head: true })
      .in('content_id', [...(songStats?.map(s => s.id) || []), ...(contentStats?.map(c => c.id) || [])]);

    // Get playlist adds
    const { count: playlistAdds } = await supabase
      .from('playlist_songs')
      .select('*', { count: 'exact', head: true })
      .in('song_id', songStats?.map(s => s.id) || []);

    // Get top performing content - combine songs and content with proper details
    const songItems = songStats?.map(s => ({ id: s.id, play_count: s.play_count || 0, type: 'song' as const })) || [];
    const contentItems = contentStats?.map(c => ({ id: c.id, play_count: c.play_count || 0, type: 'video' as const })) || [];
    const allContentItems = [...songItems, ...contentItems];

    // Sort all content by play count and get top 5
    const topItems = allContentItems
      .sort((a, b) => b.play_count - a.play_count)
      .slice(0, 5);

    // Fetch details for top items
    const allTopContent: TopContent[] = [];

    for (const item of topItems) {
      if (item.type === 'song') {
        const { data } = await supabase
          .from('songs')
          .select('id, title, cover_image_url, play_count')
          .eq('id', item.id)
          .single();

        if (data) {
          allTopContent.push({
            id: data.id,
            title: data.title,
            type: 'song',
            playCount: data.play_count || 0,
            coverUrl: data.cover_image_url,
            growthRate: 0
          });
        }
      } else if (item.type === 'video') {
        const { data } = await supabase
          .from('content_uploads')
          .select('id, title, content_type, metadata, play_count')
          .eq('id', item.id)
          .single();

        if (data) {
          allTopContent.push({
            id: data.id,
            title: data.title,
            type: data.content_type as 'video' | 'short_clip',
            playCount: data.play_count || 0,
            coverUrl: data.metadata?.thumbnail_url || data.metadata?.cover_url,
            growthRate: 0
          });
        }
      }
    }

    // Get top locations from both user profiles and IP-detected locations
    // First, get data from listening_history (for songs)
    const { data: songLocationData } = await supabase
      .from('listening_history')
      .select(`
        user_id,
        detected_country,
        users!inner(country)
      `)
      .in('song_id', songStats?.map(s => s.id) || []);

    // Get data from video_playback_history (for videos)
    const { data: videoLocationData } = await supabase
      .from('video_playback_history')
      .select(`
        user_id,
        detected_country,
        users!inner(country)
      `)
      .in('content_id', contentStats?.map(c => c.id) || []);

    // Combine all location data
    const allLocationData = [...(songLocationData || []), ...(videoLocationData || [])];

    // Count listeners by country (prefer user profile country, fallback to detected_country)
    const countryMap = new Map<string, Set<string>>();
    allLocationData.forEach((entry: any) => {
      // Use user's profile country first, fallback to IP-detected country
      // Note: Supabase returns users as an array when using joins, so we access the first element
      const usersArray = Array.isArray(entry.users) ? entry.users : (entry.users ? [entry.users] : []);
      const country = usersArray[0]?.country || entry.detected_country;
      const userId = entry.user_id;

      if (country && country.trim() && userId) {
        if (!countryMap.has(country)) {
          countryMap.set(country, new Set());
        }
        const countrySet = countryMap.get(country);
        if (countrySet) {
          countrySet.add(userId);
        }
      }
    });

    // Convert to array and sort by listener count
    const locationStats = Array.from(countryMap.entries())
      .map(([country, userSet]) => ({
        country,
        count: userSet.size
      }))
      .sort((a, b) => b.count - a.count);

    // Calculate total listeners with country data
    const totalListenersWithLocation = locationStats.reduce((sum, stat) => sum + stat.count, 0);

    // Get top 5 locations and group others
    const top5Locations = locationStats.slice(0, 5);
    const othersCount = locationStats.slice(5).reduce((sum, stat) => sum + stat.count, 0);

    const topLocations: LocationStats[] = top5Locations.map(stat => ({
      country: stat.country,
      count: stat.count,
      percentage: totalListenersWithLocation > 0
        ? Math.round((stat.count / totalListenersWithLocation) * 100)
        : 0
    }));

    // Add "Others" if there are more than 5 locations
    if (othersCount > 0) {
      topLocations.push({
        country: 'Others',
        count: othersCount,
        percentage: totalListenersWithLocation > 0
          ? Math.round((othersCount / totalListenersWithLocation) * 100)
          : 0
      });
    }

    // If no location data, provide a helpful placeholder
    if (topLocations.length === 0) {
      topLocations.push({
        country: 'No location data available',
        count: 0,
        percentage: 0
      });
    }

    // Calculate growth (comparing last 7 days to previous 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    // Recent plays from songs
    const { data: recentSongPlays } = await supabase
      .from('listening_history')
      .select('listened_at')
      .in('song_id', songStats?.map(s => s.id) || [])
      .gte('listened_at', sevenDaysAgo.toISOString());

    // Recent plays from videos
    const { data: recentVideoPlays } = await supabase
      .from('video_playback_history')
      .select('watched_at')
      .in('content_id', contentStats?.map(c => c.id) || [])
      .gte('watched_at', sevenDaysAgo.toISOString());

    // Previous plays from songs
    const { data: previousSongPlays } = await supabase
      .from('listening_history')
      .select('listened_at')
      .in('song_id', songStats?.map(s => s.id) || [])
      .gte('listened_at', fourteenDaysAgo.toISOString())
      .lt('listened_at', sevenDaysAgo.toISOString());

    // Previous plays from videos
    const { data: previousVideoPlays } = await supabase
      .from('video_playback_history')
      .select('watched_at')
      .in('content_id', contentStats?.map(c => c.id) || [])
      .gte('watched_at', fourteenDaysAgo.toISOString())
      .lt('watched_at', sevenDaysAgo.toISOString());

    const recentPlaysCount = (recentSongPlays?.length || 0) + (recentVideoPlays?.length || 0);
    const previousPlaysCount = (previousSongPlays?.length || 0) + (previousVideoPlays?.length || 0) || 1; // Avoid division by zero

    const playsGrowth = ((recentPlaysCount - previousPlaysCount) / previousPlaysCount) * 100;

    // Recent listeners from songs
    const { data: recentSongListeners } = await supabase
      .from('listening_history')
      .select('user_id')
      .in('song_id', songStats?.map(s => s.id) || [])
      .gte('listened_at', sevenDaysAgo.toISOString());

    // Recent viewers from videos
    const { data: recentVideoViewers } = await supabase
      .from('video_playback_history')
      .select('user_id')
      .in('content_id', contentStats?.map(c => c.id) || [])
      .gte('watched_at', sevenDaysAgo.toISOString());

    // Previous listeners from songs
    const { data: previousSongListeners } = await supabase
      .from('listening_history')
      .select('user_id')
      .in('song_id', songStats?.map(s => s.id) || [])
      .gte('listened_at', fourteenDaysAgo.toISOString())
      .lt('listened_at', sevenDaysAgo.toISOString());

    // Previous viewers from videos
    const { data: previousVideoViewers } = await supabase
      .from('video_playback_history')
      .select('user_id')
      .in('content_id', contentStats?.map(c => c.id) || [])
      .gte('watched_at', fourteenDaysAgo.toISOString())
      .lt('watched_at', sevenDaysAgo.toISOString());

    // Combine recent listeners/viewers
    const recentAllUsers = [
      ...(recentSongListeners?.map(l => l.user_id) || []),
      ...(recentVideoViewers?.map(v => v.user_id) || [])
    ];
    const recentUniqueListeners = new Set(recentAllUsers.filter(id => id !== null)).size;

    // Combine previous listeners/viewers
    const previousAllUsers = [
      ...(previousSongListeners?.map(l => l.user_id) || []),
      ...(previousVideoViewers?.map(v => v.user_id) || [])
    ];
    const previousUniqueListeners = new Set(previousAllUsers.filter(id => id !== null)).size || 1;

    const listenersGrowth = ((recentUniqueListeners - previousUniqueListeners) / previousUniqueListeners) * 100;

    return {
      totalPlays,
      uniqueListeners,
      totalLikes,
      totalComments: commentsCount || 0,
      totalShares: 0, // Can be tracked separately if needed
      playlistAdds: playlistAdds || 0,
      topContent: allTopContent,
      topLocations,
      recentGrowth: {
        playsGrowth: Math.round(playsGrowth),
        listenersGrowth: Math.round(listenersGrowth),
        period: 'week'
      }
    };
  } catch (error) {
    console.error('Error fetching creator analytics:', error);
    throw error;
  }
};

/**
 * Normalizes country names to ensure consistency (e.g., "Nigeria" -> "NG")
 * This is a client-side fallback to ensure data consistency even if database normalization fails
 */
const normalizeCountryName = (country: string): string => {
  if (!country || typeof country !== 'string') {
    return country;
  }
  // Normalize "Nigeria" (any case) to "NG"
  if (country.toLowerCase() === 'nigeria') {
    return 'NG';
  }
  return country;
};

/**
 * Merges duplicate country entries in location stats (e.g., "NG" and "Nigeria")
 */
const mergeCountryLocations = (locations: LocationStats[]): LocationStats[] => {
  if (!locations || locations.length === 0) {
    return locations;
  }

  // Normalize all country names first
  const normalized = locations.map(loc => ({
    ...loc,
    country: normalizeCountryName(loc.country)
  }));

  // Group by normalized country name and merge counts
  const countryMap = new Map<string, { count: number; percentage: number }>();
  normalized.forEach(loc => {
    if (loc.country === 'No location data available' || loc.country === 'Others') {
      // Keep special entries as-is
      countryMap.set(loc.country, { count: loc.count, percentage: loc.percentage });
      return;
    }

    const existing = countryMap.get(loc.country);
    if (existing) {
      // Merge counts and recalculate percentage
      existing.count += loc.count;
      // Percentage will be recalculated after merging
    } else {
      countryMap.set(loc.country, { count: loc.count, percentage: loc.percentage });
    }
  });

  // Convert back to array and recalculate percentages
  // First, get total count excluding special entries
  const totalCount = Array.from(countryMap.entries())
    .filter(([country]) => country !== 'No location data available' && country !== 'Others')
    .reduce((sum, [, stats]) => sum + stats.count, 0);

  const merged: LocationStats[] = Array.from(countryMap.entries()).map(([country, stats]) => {
    if (country === 'No location data available' || country === 'Others') {
      return { country, count: stats.count, percentage: stats.percentage };
    }
    return {
      country,
      count: stats.count,
      percentage: totalCount > 0 ? Math.round((stats.count / totalCount) * 100) : 0
    };
  });

  // Sort by count (descending), but keep "Others" and "No location data available" at the end
  return merged.sort((a, b) => {
    if (a.country === 'No location data available') return 1;
    if (b.country === 'No location data available') return -1;
    if (a.country === 'Others') return 1;
    if (b.country === 'Others') return -1;
    return b.count - a.count;
  });
};

export const getCreatorAnalyticsOptimized = async (): Promise<CreatorAnalytics> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      throw new Error('You must be signed in to view analytics');
    }

    const { data, error } = await supabase.rpc('get_creator_analytics_optimized', {
      p_user_id: user.id
    });

    if (error) {
      console.error('Error fetching optimized analytics:', error);
      throw error;
    }

    if (!data) {
      throw new Error('No analytics data returned');
    }

    // Normalize and merge country locations as a client-side fallback
    const topLocations = data.topLocations || [{ country: 'No location data available', count: 0, percentage: 0 }];
    const normalizedLocations = mergeCountryLocations(topLocations);

    return {
      totalPlays: data.totalPlays || 0,
      uniqueListeners: data.uniqueListeners || 0,
      totalLikes: data.totalLikes || 0,
      totalComments: data.totalComments || 0,
      totalShares: data.totalShares || 0,
      playlistAdds: data.playlistAdds || 0,
      topContent: data.topContent || [],
      topLocations: normalizedLocations,
      recentGrowth: data.recentGrowth || { playsGrowth: 0, listenersGrowth: 0, period: 'week' }
    };
  } catch (error) {
    console.error('Error in getCreatorAnalyticsOptimized:', error);
    throw error;
  }
};

// Manual Trending Songs Functions

/**
 * Verify the manual_trending_songs table exists and has all required columns
 * Returns detailed verification results to help diagnose schema issues
 */
export const verifyManualTrendingSongsTable = async (): Promise<{
  tableExists: boolean;
  columnsExist: boolean;
  missingColumns: string[];
  error?: string;
  details?: any;
}> => {
  try {
    // Try to query the table with all expected columns
    const { error } = await supabase
      .from('manual_trending_songs')
      .select('id, song_id, trending_type, country_code, display_order, added_by, added_at, is_active, notes, created_at, updated_at')
      .limit(0);

    if (error) {
      // Check for table not found error
      if (error.code === '42P01' || error.message.includes('does not exist')) {
        return {
          tableExists: false,
          columnsExist: false,
          missingColumns: ['table does not exist'],
          error: 'The manual_trending_songs table does not exist. Please run the migration: 20251102000000_create_manual_trending_songs.sql',
          details: error
        };
      }

      // Check for column not found error
      if (error.code === '42703' || error.message.includes('column') || error.message.includes('schema cache')) {
        return {
          tableExists: true,
          columnsExist: false,
          missingColumns: ['schema cache error - column may not exist'],
          error: `Schema cache error: ${error.message}. The table exists but may be missing columns or the schema cache needs refresh.`,
          details: error
        };
      }

      return {
        tableExists: true,
        columnsExist: false,
        missingColumns: [],
        error: error.message,
        details: error
      };
    }

    // Table and columns exist if query succeeds
    return {
      tableExists: true,
      columnsExist: true,
      missingColumns: []
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during verification';
    return {
      tableExists: false,
      columnsExist: false,
      missingColumns: [],
      error: errorMessage,
      details: error
    };
  }
};

export const getManualTrendingSongs = async (trendingType: 'global_trending' | 'trending_near_you', countryCode?: string): Promise<any[]> => {
  try {
    let query = supabase
      .from('manual_trending_songs')
      .select(`
        *,
        songs:song_id (
          id,
          title,
          duration_seconds,
          audio_url,
          cover_image_url,
          play_count,
          artist_id,
          featured_artists,
          artists:artist_id (
            id,
            name,
            artist_profiles (
              id,
              user_id,
              stage_name,
              users:user_id(display_name)
            )
          )
        )
      `)
      .eq('trending_type', trendingType)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (trendingType === 'trending_near_you' && countryCode) {
      query = query.eq('country_code', countryCode);
    }

    const { data, error } = await query;
    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('Error fetching manual trending songs:', error);
    return [];
  }
};

export const addManualTrendingSong = async (
  songId: string,
  trendingType: 'global_trending' | 'trending_near_you',
  countryCode?: string,
  displayOrder?: number,
  notes?: string
): Promise<{ success: boolean; error?: string; details?: any }> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: 'User not authenticated', details: authError };
    }

    // Verify user is admin
    const role = await getUserRole();
    if (role !== 'admin' && role !== 'manager' && role !== 'editor') {
      return { success: false, error: 'Admin role required. Current role: ' + (role || 'none') };
    }

    // Verify table exists and has required columns
    const verification = await verifyManualTrendingSongsTable();
    if (!verification.tableExists || !verification.columnsExist) {
      return {
        success: false,
        error: verification.error || 'Table verification failed',
        details: {
          ...verification,
          migrationFile: 'supabase/migrations/20251102000000_create_manual_trending_songs.sql',
          instructions: verification.tableExists 
            ? 'The table exists but columns are missing or schema cache is stale. Try: 1) Refresh schema cache in Supabase dashboard, 2) Restart PostgREST service, 3) Re-run the migration'
            : 'Please apply the migration file to your Supabase database using the SQL Editor in your dashboard or Supabase CLI.'
        }
      };
    }

    // Get current max display_order for the type
    let maxOrder = 0;
    if (displayOrder === undefined) {
      let orderQuery = supabase
        .from('manual_trending_songs')
        .select('display_order')
        .eq('trending_type', trendingType)
        .eq('is_active', true)
        .order('display_order', { ascending: false })
        .limit(1);

      if (trendingType === 'trending_near_you' && countryCode) {
        orderQuery = orderQuery.eq('country_code', countryCode);
      }

      const { data: orderData, error: orderError } = await orderQuery;
      if (orderError) {
        console.error('Error fetching display order:', orderError);
        // Continue with maxOrder = 0 if query fails
      } else {
        maxOrder = orderData?.[0]?.display_order || 0;
      }
    }

    const insertData: any = {
      song_id: songId,
      trending_type: trendingType,
      display_order: displayOrder ?? maxOrder + 1,
      added_by: user.id,
      is_active: true,
      notes: notes || null
    };

    // Only add country_code if it's trending_near_you (required by constraint)
    if (trendingType === 'trending_near_you') {
      if (!countryCode) {
        return { success: false, error: 'Country code is required for trending_near_you' };
      }
      insertData.country_code = countryCode;
    } else {
      insertData.country_code = null; // Explicitly set to null for global_trending
    }

    const { error } = await supabase
      .from('manual_trending_songs')
      .insert(insertData)
      .select();

    if (error) {
      console.error('Database insert error:', error);
      console.error('Insert data attempted:', insertData);
      return { success: false, error: error.message, details: error };
    }

    return { success: true };
  } catch (error) {
    console.error('Error adding manual trending song:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage, details: error };
  }
};

export const removeManualTrendingSong = async (id: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('manual_trending_songs')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error removing manual trending song:', error);
    return false;
  }
};

export const updateManualTrendingSongOrder = async (id: string, displayOrder: number): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('manual_trending_songs')
      .update({ display_order: displayOrder })
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error updating manual trending song order:', error);
    return false;
  }
};

export const toggleManualTrendingSongActive = async (id: string, isActive: boolean): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('manual_trending_songs')
      .update({ is_active: isActive })
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error toggling manual trending song active status:', error);
    return false;
  }
};

// ==================== Manual Blowing Up Artists Functions ====================

export const getManualBlowingUpArtists = async (): Promise<any[]> => {
  try {
    const { data, error } = await supabase
      .from('manual_blowing_up_artists')
      .select(`
        *,
        artists:artist_id (
          id,
          name,
          image_url,
          verified,
          artist_profiles (
            id,
            user_id,
            stage_name,
            profile_photo_url,
            country,
            users:user_id (
              id,
              display_name,
              email
            )
          )
        )
      `)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching manual blowing up artists:', error);
    return [];
  }
};

export const addManualBlowingUpArtist = async (
  artistId: string,
  displayOrder?: number,
  notes?: string
): Promise<{ success: boolean; error?: string; details?: any }> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: 'User not authenticated', details: authError };
    }

    // Verify user is admin
    const role = await getUserRole();
    if (role !== 'admin' && role !== 'manager' && role !== 'editor') {
      return { success: false, error: 'Admin role required. Current role: ' + (role || 'none') };
    }

    // Check if artist already exists
    const { data: existing } = await supabase
      .from('manual_blowing_up_artists')
      .select('id')
      .eq('artist_id', artistId)
      .eq('is_active', true)
      .single();

    if (existing) {
      return { success: false, error: 'This artist is already in the blowing up list' };
    }

    // Get current max display_order
    let maxOrder = 0;
    if (displayOrder === undefined) {
      const { data: orderData, error: orderError } = await supabase
        .from('manual_blowing_up_artists')
        .select('display_order')
        .eq('is_active', true)
        .order('display_order', { ascending: false })
        .limit(1);

      if (orderError) {
        console.error('Error fetching display order:', orderError);
      } else {
        maxOrder = orderData?.[0]?.display_order || 0;
      }
    }

    const insertData: any = {
      artist_id: artistId,
      display_order: displayOrder ?? maxOrder + 1,
      added_by: user.id,
      is_active: true,
      notes: notes || null
    };

    const { error } = await supabase
      .from('manual_blowing_up_artists')
      .insert(insertData)
      .select();

    if (error) {
      console.error('Database insert error:', error);
      return { success: false, error: error.message, details: error };
    }

    return { success: true };
  } catch (error) {
    console.error('Error adding manual blowing up artist:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage, details: error };
  }
};

export const removeManualBlowingUpArtist = async (id: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('manual_blowing_up_artists')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error removing manual blowing up artist:', error);
    return false;
  }
};

export const updateManualBlowingUpArtistOrder = async (id: string, displayOrder: number): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('manual_blowing_up_artists')
      .update({ display_order: displayOrder })
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error updating manual blowing up artist order:', error);
    return false;
  }
};

export const toggleManualBlowingUpArtistActive = async (id: string, isActive: boolean): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('manual_blowing_up_artists')
      .update({ is_active: isActive })
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error toggling manual blowing up artist active status:', error);
    return false;
  }
};

// ==================== Tracks Blowing Up Functions ====================

/**
 * Fetches tracks that are "blowing up" based on recent 30-minute activity
 * Uses admin-configured threshold with smart 4-tier fallback system
 */
export const getTracksBlowingUp = async (limit: number = 20, country?: string): Promise<any[]> => {
  try {
    const params: any = { limit_param: limit };
    if (country) params.country_param = country;

    const { data, error } = await supabase.rpc('get_tracks_blowing_up', params);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching tracks blowing up:', error);
    return [];
  }
};

// ==================== Manual Blowing Up Songs Functions ====================

export const getManualBlowingUpSongs = async (): Promise<any[]> => {
  try {
    const { data, error } = await supabase
      .from('manual_blowing_up_songs')
      .select(`
        *,
        songs:song_id (
          id,
          title,
          duration_seconds,
          audio_url,
          cover_image_url,
          play_count,
          artist_id,
          featured_artists,
          artists:artist_id (
            id,
            name,
            artist_profiles (
              id,
              user_id,
              stage_name,
              users:user_id (
                display_name
              )
            )
          )
        )
      `)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching manual blowing up songs:', error);
    return [];
  }
};

export const addManualBlowingUpSong = async (
  songId: string,
  displayOrder?: number,
  notes?: string
): Promise<{ success: boolean; error?: string; details?: any }> => {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      logger.error('addManualBlowingUpSong: Auth error', authError);
      return { success: false, error: `User not authenticated: ${authError?.message || 'No user'}`, details: authError };
    }

    const role = await getUserRole();
    if (role !== 'admin' && role !== 'manager' && role !== 'editor') {
      return { success: false, error: `Admin role required. Current role: ${role || 'none'}`, details: { role } };
    }

    // Verify song exists
    const { data: songCheck, error: songError } = await supabase
      .from('songs')
      .select('id, title')
      .eq('id', songId)
      .single();

    if (songError || !songCheck) {
      logger.error('addManualBlowingUpSong: Song not found', songError);
      return { success: false, error: `Song not found: ${songError?.message || 'Invalid song ID'}`, details: songError };
    }

    // Check if song already exists
    const { data: existing, error: existingError } = await supabase
      .from('manual_blowing_up_songs')
      .select('id')
      .eq('song_id', songId)
      .eq('is_active', true)
      .maybeSingle();

    if (existingError && existingError.code !== 'PGRST116') {
      logger.error('addManualBlowingUpSong: Error checking existing song', existingError);
      return { success: false, error: `Error checking existing song: ${existingError.message}`, details: existingError };
    }

    if (existing) {
      return { success: false, error: 'This song is already in the blowing up list' };
    }

    // Get current max display_order
    let maxOrder = 0;
    if (displayOrder === undefined) {
      const { data: orderData, error: orderError } = await supabase
        .from('manual_blowing_up_songs')
        .select('display_order')
        .eq('is_active', true)
        .order('display_order', { ascending: false })
        .limit(1);

      if (orderError && orderError.code !== 'PGRST116') {
        logger.error('addManualBlowingUpSong: Error fetching display order', orderError);
      } else {
        maxOrder = orderData?.[0]?.display_order || 0;
      }
    }

    const insertData: any = {
      song_id: songId,
      display_order: displayOrder ?? maxOrder + 1,
      added_by: user.id,
      is_active: true,
      notes: notes || null
    };

    const { data: insertedData, error } = await supabase
      .from('manual_blowing_up_songs')
      .insert(insertData)
      .select();

    if (error) {
      logger.error('addManualBlowingUpSong: Database insert error', error);
      return {
        success: false,
        error: `Database error: ${error.message || 'Unknown error'} (Code: ${error.code || 'N/A'})`,
        details: error
      };
    }

    return { success: true, details: insertedData };
  } catch (error) {
    logger.error('addManualBlowingUpSong: Unexpected error', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorDetails = error instanceof Error ? { message: error.message, stack: error.stack } : error;
    return { success: false, error: `Unexpected error: ${errorMessage}`, details: errorDetails };
  }
};

export const removeManualBlowingUpSong = async (id: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('manual_blowing_up_songs')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error removing manual blowing up song:', error);
    return false;
  }
};

export const updateManualBlowingUpSongOrder = async (id: string, displayOrder: number): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('manual_blowing_up_songs')
      .update({ display_order: displayOrder })
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error updating manual blowing up song order:', error);
    return false;
  }
};

export const toggleManualBlowingUpSongActive = async (id: string, isActive: boolean): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('manual_blowing_up_songs')
      .update({ is_active: isActive })
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error toggling manual blowing up song active status:', error);
    return false;
  }
};

// ==================== Messaging Functions ====================

export interface MessageThread {
  id: string;
  other_user: {
    id: string;
    display_name: string;
    username: string | null;
    avatar_url: string | null;
  };
  last_message_at: string;
  last_message_preview: string | null;
  unread_count: number;
  created_at: string;
}

export interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  message_text: string;
  is_deleted: boolean;
  is_read: boolean;
  created_at: string;
  sender: {
    id: string;
    display_name: string;
    username: string | null;
    avatar_url: string | null;
  };
}

/**
 * Get all message threads for the current user
 */
export const getUserMessageThreads = async (): Promise<MessageThread[]> => {
  try {
    const { data, error } = await supabase.rpc('get_user_threads');
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching message threads:', error);
    return [];
  }
};

/**
 * Get messages for a specific thread
 */
export const getThreadMessages = async (threadId: string): Promise<Message[]> => {
  try {
    const { data, error } = await supabase.rpc('get_thread_messages', {
      p_thread_id: threadId,
    });
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching thread messages:', error);
    return [];
  }
};

/**
 * Send a message to a user
 */
export const sendMessage = async (receiverId: string, messageText: string): Promise<string | null> => {
  try {
    const { data, error } = await supabase.rpc('send_message', {
      p_receiver_id: receiverId,
      p_message_text: messageText,
    });
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error sending message:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to send message');
  }
};

/**
 * Reply to a message in a thread
 */
export const replyToMessage = async (threadId: string, messageText: string): Promise<string | null> => {
  try {
    const { data, error } = await supabase.rpc('reply_to_message', {
      p_thread_id: threadId,
      p_message_text: messageText,
    });
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error replying to message:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to send reply');
  }
};

/**
 * Mark messages in a thread as read
 */
export const markMessagesAsRead = async (threadId: string): Promise<void> => {
  try {
    const { error } = await supabase.rpc('mark_messages_as_read', {
      p_thread_id: threadId,
    });
    if (error) throw error;
  } catch (error) {
    console.error('Error marking messages as read:', error);
  }
};

/**
 * Soft delete a message
 */
export const deleteMessage = async (messageId: string): Promise<void> => {
  try {
    const { error } = await supabase.rpc('delete_message', {
      p_message_id: messageId,
    });
    if (error) throw error;
  } catch (error) {
    console.error('Error deleting message:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to delete message');
  }
};

/**
 * Soft delete a thread (for current user)
 */
export const deleteThread = async (threadId: string): Promise<void> => {
  try {
    const { error } = await supabase.rpc('delete_thread', {
      p_thread_id: threadId,
    });
    if (error) throw error;
  } catch (error) {
    console.error('Error deleting thread:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to delete thread');
  }
};

/**
 * Get or create a thread between two users
 */
export const getOrCreateThread = async (userId1: string, userId2: string): Promise<string> => {
  try {
    const { data, error } = await supabase.rpc('get_or_create_thread', {
      p_user1_id: userId1,
      p_user2_id: userId2,
    });
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error getting or creating thread:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to get or create thread');
  }
};

// Re-export cache utilities for convenience
export { smartCache, cacheInvalidation, enhancedFetch };
export { cache } from './cache';
export { persistentCache } from './persistentCache';