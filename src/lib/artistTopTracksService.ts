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
  albumId?: string | null;
  albumTitle?: string | null;
  featuredArtists?: string[] | null;
}

interface Album {
  id: string;
  title: string;
  coverImageUrl?: string | null;
  songCount?: number;
  songs?: Song[];
}

export interface ContentItem {
  type: 'album' | 'song';
  id: string;
  title: string;
  coverImageUrl?: string | null;
  album?: Album;
  song?: Song;
}

export const getArtistTopContent = async (
  artistId: string,
  excludeSongId?: string,
  limit: number = 10
): Promise<ContentItem[]> => {
  try {
    console.log('[ArtistTopTracksService] Fetching content for artist:', artistId, 'excluding:', excludeSongId);

    const contentItems: ContentItem[] = [];
    const albumIds = new Set<string>();

    // Fetch all albums by the artist
    const { data: albumsData, error: albumsError } = await supabase
      .from('albums')
      .select('id, title, cover_image_url, artist_id')
      .eq('artist_id', artistId);

    if (albumsError) {
      console.error('[ArtistTopTracksService] Albums query error:', albumsError);
    }

    console.log('[ArtistTopTracksService] Found', albumsData?.length || 0, 'albums');

    // Fetch artist name
    const { data: artistData } = await supabase
      .from('users')
      .select('id, display_name')
      .eq('id', artistId)
      .maybeSingle();

    const artistName = artistData?.display_name || 'Unknown Artist';

    // If albums exist, fetch their songs
    if (albumsData && albumsData.length > 0) {
      const albumIdsList = albumsData.map(a => a.id);

      let songsQuery = supabase
        .from('songs')
        .select('id, title, cover_image_url, audio_url, duration_seconds, play_count, album_id, artist_id, featured_artists')
        .in('album_id', albumIdsList)
        .not('audio_url', 'is', null);

      if (excludeSongId) {
        songsQuery = songsQuery.neq('id', excludeSongId);
      }

      const { data: albumSongsData } = await songsQuery;

      console.log('[ArtistTopTracksService] Found', albumSongsData?.length || 0, 'songs in albums');

      // Group songs by album
      const albumSongsMap = new Map<string, Song[]>();

      if (albumSongsData) {
        albumSongsData.forEach((song: any) => {
          if (song.album_id) {
            albumIds.add(song.album_id);
            if (!albumSongsMap.has(song.album_id)) {
              albumSongsMap.set(song.album_id, []);
            }
            albumSongsMap.get(song.album_id)!.push({
              id: song.id,
              title: song.title,
              artist: artistName,
              artistId: song.artist_id || artistId,
              coverImageUrl: song.cover_image_url,
              audioUrl: song.audio_url,
              duration: song.duration_seconds || 0,
              playCount: song.play_count || 0,
              albumId: song.album_id,
              featuredArtists: song.featured_artists || null,
            });
          }
        });
      }

      // Create album items
      albumsData.forEach((albumData: any) => {
        const songs = albumSongsMap.get(albumData.id) || [];
        const totalPlayCount = songs.reduce((sum, s) => sum + (s.playCount || 0), 0);

        contentItems.push({
          type: 'album',
          id: albumData.id,
          title: albumData.title,
          coverImageUrl: albumData.cover_image_url,
          album: {
            id: albumData.id,
            title: albumData.title,
            coverImageUrl: albumData.cover_image_url,
            songCount: songs.length,
            songs,
          },
        });

        (contentItems[contentItems.length - 1] as any).playCount = totalPlayCount;
      });
    }

    // Fetch standalone songs (not part of any album)
    let standaloneSongsQuery = supabase
      .from('songs')
      .select('id, title, cover_image_url, audio_url, duration_seconds, play_count, album_id, artist_id, featured_artists')
      .eq('artist_id', artistId)
      .is('album_id', null)
      .not('audio_url', 'is', null);

    if (excludeSongId) {
      standaloneSongsQuery = standaloneSongsQuery.neq('id', excludeSongId);
    }

    const { data: standaloneSongsData } = await standaloneSongsQuery
      .order('play_count', { ascending: false });

    console.log('[ArtistTopTracksService] Found', standaloneSongsData?.length || 0, 'standalone songs');

    if (standaloneSongsData) {
      standaloneSongsData.forEach((song: any) => {
        contentItems.push({
          type: 'song',
          id: song.id,
          title: song.title,
          coverImageUrl: song.cover_image_url,
          song: {
            id: song.id,
            title: song.title,
            artist: artistName,
            artistId: song.artist_id || artistId,
            coverImageUrl: song.cover_image_url,
            audioUrl: song.audio_url,
            duration: song.duration_seconds || 0,
            playCount: song.play_count || 0,
            albumId: null,
            featuredArtists: song.featured_artists || null,
          },
        });

        (contentItems[contentItems.length - 1] as any).playCount = song.play_count || 0;
      });
    }

    // Sort by play count and limit
    contentItems.sort((a, b) => ((b as any).playCount || 0) - ((a as any).playCount || 0));
    const limitedItems = contentItems.slice(0, limit);

    console.log('[ArtistTopTracksService] Returning', limitedItems.length, 'content items:',
      limitedItems.map(i => `${i.type}: ${i.title}`).join(', '));

    return limitedItems;
  } catch (error) {
    console.error('[ArtistTopTracksService] Exception:', error);
    return [];
  }
};

export const getArtistTopTracks = async (
  artistId: string,
  excludeSongId?: string,
  limit: number = 5
): Promise<Song[]> => {
  try {
    const contentItems = await getArtistTopContent(artistId, excludeSongId, limit);
    const songs: Song[] = [];

    contentItems.forEach((item) => {
      if (item.type === 'song' && item.song) {
        songs.push(item.song);
      } else if (item.type === 'album' && item.album?.songs) {
        songs.push(...item.album.songs);
      }
    });

    return songs.slice(0, limit);
  } catch (error) {
    console.error('[ArtistTopTracksService] Exception:', error);
    return [];
  }
};
