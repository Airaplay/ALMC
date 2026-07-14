import { useState, useEffect, useCallback } from 'react';
import { X, Play, Share2, Music } from 'lucide-react';
import { supabase, recordShareEvent } from '../lib/supabase';
import { shareSong } from '../lib/shareService';
import { LazyImage } from './LazyImage';

interface AlbumSong {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  duration: number;
  audioUrl: string | null;
  coverImageUrl?: string | null;
  trackNumber: number;
  playCount: number;
}

interface AlbumData {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  coverImageUrl?: string | null;
  releaseDate?: string;
  genre?: string;
}

interface AlbumDetailModalProps {
  albumId: string;
  onClose: () => void;
  onPlaySong?: (song: AlbumSong) => void;
}

export const AlbumDetailModal = ({ albumId, onClose, onPlaySong }: AlbumDetailModalProps): JSX.Element => {
  const [isLoading, setIsLoading] = useState(true);
  const [albumData, setAlbumData] = useState<AlbumData | null>(null);
  const [songs, setSongs] = useState<AlbumSong[]>([]);
  const [isMiniPlayerActive, setIsMiniPlayerActive] = useState(false);

  useEffect(() => {
    loadAlbumDetails();
  }, [albumId, loadAlbumDetails]);

  useEffect(() => {
    const checkMiniPlayer = () => {
      setIsMiniPlayerActive(document.body.classList.contains('mini-player-active'));
    };

    checkMiniPlayer();

    const observer = new MutationObserver(checkMiniPlayer);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  const loadAlbumDetails = useCallback(async () => {
    try {
      setIsLoading(true);

      // Fetch album data with artist (using correct artists table)
      const { data: album, error: albumError } = await supabase
        .from('albums')
        .select(`
          id,
          title,
          cover_image_url,
          release_date,
          description,
          artist_id,
          artists!albums_artist_id_fkey (
            name
          )
        `)
        .eq('id', albumId)
        .single();

      if (albumError) {
        console.error('Error fetching album:', albumError);
        throw albumError;
      }

      // Extract artist name from the joined data
      const artistName = album.artists?.name || 'Unknown Artist';

      setAlbumData({
        id: album.id,
        title: album.title,
        artist: artistName,
        artistId: album.artist_id,
        coverImageUrl: album.cover_image_url,
        releaseDate: album.release_date,
        genre: album.genre
      });

      // Fetch all songs in the album - songs have album_id directly
      const { data: albumSongs, error: songsError } = await supabase
        .from('songs')
        .select('id, title, audio_url, duration_seconds, cover_image_url, artist_id, play_count')
        .eq('album_id', albumId)
        .order('created_at', { ascending: true });

      if (songsError) {
        console.error('Error fetching songs:', songsError);
        throw songsError;
      }

      // Map songs with play count from songs table
      const songsWithData = (albumSongs || []).map((song, index: number) => ({
        id: song.id,
        title: song.title,
        artist: artistName,
        artistId: song.artist_id,
        duration: song.duration_seconds || 0,
        audioUrl: song.audio_url,
        coverImageUrl: song.cover_image_url || album.cover_image_url,
        trackNumber: index + 1,
        playCount: song.play_count || 0
      }));

      setSongs(songsWithData as AlbumSong[]);
    } catch (error) {
      console.error('Error loading album details:', error);
    } finally {
      setIsLoading(false);
    }
  }, [albumId]);

  const handlePlaySong = (song: AlbumSong) => {
    if (onPlaySong && song.audioUrl) {
      onPlaySong({
        id: song.id,
        title: song.title,
        artist: song.artist,
        artistId: song.artistId,
        coverImageUrl: song.coverImageUrl,
        audioUrl: song.audioUrl,
        duration: song.duration,
        playCount: song.playCount
      });
    }
  };

  const handleShareSong = async (song: AlbumSong, e: React.MouseEvent) => {
    e.stopPropagation();

    try {
      // Record share event
      await recordShareEvent(song.id, 'song');
      await shareSong(song.id, song.title, song.artist);
    } catch (error) {
      console.error('Error sharing song:', error);
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatPlayCount = (count: number): string => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  // Calculate proper spacing for mini player (now at absolute bottom)
  const miniPlayerHeight = '4.5rem';
  const modalPadding = '1rem';
  const safeArea = 'env(safe-area-inset-bottom, 0px)';

  const bottomOffset = isMiniPlayerActive
    ? `calc(${miniPlayerHeight} + ${safeArea} + ${modalPadding})`
    : `calc(${safeArea} + ${modalPadding})`;

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/80 backdrop-blur-sm">
      <div
        className="w-full max-w-2xl bg-gradient-to-b from-[#1a1a1a] to-[#0d0d0d] rounded-t-3xl shadow-2xl flex flex-col overflow-hidden transition-all duration-300"
        style={{
          maxHeight: `calc(100vh - ${bottomOffset})`,
          marginBottom: bottomOffset
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 flex-shrink-0">
          <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl">
            Album Details
          </h2>
          <button
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-white/10 hover:bg-white/20 active:bg-white/30 rounded-full transition-all active:scale-95"
            aria-label="Close"
          >
            <X className="w-6 h-6 text-white" strokeWidth={2.5} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6" style={{
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch'
        }}>
          {isLoading ? (
            <div className="space-y-6">
              {/* Album info skeleton */}
              <div className="flex items-center gap-4">
                <div className="w-24 h-24 bg-white/5 rounded-xl animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-6 w-48 bg-white/5 rounded animate-pulse" />
                  <div className="h-4 w-32 bg-white/5 rounded animate-pulse" />
                </div>
              </div>

              {/* Songs skeleton */}
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-16 bg-white/5 rounded-xl animate-pulse" />
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Album Info */}
              {albumData && (
                <div className="flex items-center gap-4">
                  <div className="w-24 h-24 rounded-xl overflow-hidden bg-white/5 flex-shrink-0">
                    {albumData.cover_image_url ? (
                      <LazyImage
                        src={albumData.cover_image_url}
                        alt={albumData.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Music className="w-10 h-10 text-white/40" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-['Inter',sans-serif] font-bold text-white text-lg truncate">
                      {albumData.title}
                    </h3>
                    <p className="font-['Inter',sans-serif] text-white/70 text-sm">
                      {albumData.artist_name}
                    </p>
                    <p className="font-['Inter',sans-serif] text-white/50 text-xs mt-1">
                      {songs.length} {songs.length === 1 ? 'song' : 'songs'}
                    </p>
                  </div>
                </div>
              )}

              {/* Songs List */}
              <div className="space-y-2">
                <h4 className="font-['Inter',sans-serif] font-semibold text-white text-sm mb-3">
                  Tracks
                </h4>
                {songs.length === 0 ? (
                  <div className="text-center py-8">
                    <Music className="w-12 h-12 text-white/40 mx-auto mb-3" />
                    <p className="font-['Inter',sans-serif] text-white/60 text-sm">
                      No songs in this album
                    </p>
                  </div>
                ) : (
                  songs.map((song) => (
                    <div
                      key={song.id}
                      className="group bg-white/5 hover:bg-white/10 rounded-xl p-4 transition-all cursor-pointer"
                      onClick={() => handlePlaySong(song)}
                    >
                      <div className="flex items-center gap-4">
                        {/* Track Number & Play Button */}
                        <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                          <span className="font-['Inter',sans-serif] text-white/60 text-sm group-hover:hidden">
                            {song.trackNumber}
                          </span>
                          <Play className="w-4 h-4 text-white hidden group-hover:block" fill="white" />
                        </div>

                        {/* Song Info */}
                        <div className="flex-1 min-w-0">
                          <p className="font-['Inter',sans-serif] font-medium text-white text-sm truncate">
                            {song.title}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="font-['Inter',sans-serif] text-white/60 text-xs">
                              {formatPlayCount(song.playCount)} plays
                            </span>
                            <span className="text-white/40">•</span>
                            <span className="font-['Inter',sans-serif] text-white/60 text-xs">
                              {formatDuration(song.duration)}
                            </span>
                          </div>
                        </div>

                        {/* Share Button */}
                        <button
                          onClick={(e) => handleShareSong(song, e)}
                          className="p-2 hover:bg-white/10 rounded-full transition-colors opacity-0 group-hover:opacity-100"
                          title="Share song"
                        >
                          <Share2 className="w-4 h-4 text-white/70 hover:text-white" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
