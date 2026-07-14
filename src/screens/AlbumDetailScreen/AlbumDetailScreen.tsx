import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Share2, Music, Calendar } from 'lucide-react';
import { supabase, recordShareEvent } from '../../lib/supabase';
import { shareSong } from '../../lib/shareService';
import { LazyImage } from '../../components/LazyImage';
import { useMusicPlayer } from '../../contexts/MusicPlayerContext';
import { useEngagementSync } from '../../hooks/useEngagementSync';
import { isReleased, formatReleaseDateDisplay } from '../../lib/releaseDateUtils';
import { cn } from '../../lib/utils';

interface AlbumSong {
  id: string;
  title: string;
  artist: string;
  artistId: string | null;
  duration: number;
  audioUrl: string | null;
  coverImageUrl: string | null;
  trackNumber: number;
  playCount: number;
}

interface AlbumData {
  id: string;
  title: string;
  cover_image_url: string | null;
  release_date: string | null;
  description: string | null;
  artist_id: string;
  artist_name: string;
}

export const AlbumDetailScreen = (): JSX.Element => {
  const { albumId } = useParams<{ albumId: string }>();
  const navigate = useNavigate();
  const { playSong } = useMusicPlayer();
  const [isLoading, setIsLoading] = useState(true);
  const [albumData, setAlbumData] = useState<AlbumData | null>(null);
  const [songs, setSongs] = useState<AlbumSong[]>([]);
  const [isMiniPlayerActive, setIsMiniPlayerActive] = useState(false);
  const [isUnreleasedForVisitor, setIsUnreleasedForVisitor] = useState(false);

  useEngagementSync(useCallback((update) => {
    if (update.metric === 'play_count' && update.contentType === 'song') {
      setSongs(prev => prev.map(s => s.id === update.contentId ? { ...s, playCount: update.value } : s));
    }
  }, []));

  useEffect(() => {
    if (albumId) {
      loadAlbumDetails();
    }
  }, [albumId]);

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

  const loadAlbumDetails = async () => {
    if (!albumId) return;

    try {
      setIsLoading(true);

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

      const artistName = album.artists?.name || 'Unknown Artist';
      const albumWithArtistName: AlbumData = {
        ...album,
        artist_name: artistName
      };

      setAlbumData(albumWithArtistName);

      if (album.release_date && !isReleased(album.release_date)) {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (!currentUser) {
          setIsUnreleasedForVisitor(true);
        } else {
          const { data: profile } = await supabase
            .from('artist_profiles')
            .select('artist_id')
            .eq('user_id', currentUser.id)
            .maybeSingle();
          const isOwner = profile?.artist_id === album.artist_id;
          if (!isOwner) setIsUnreleasedForVisitor(true);
        }
      }

      const { data: albumSongs, error: songsError } = await supabase
        .from('songs')
        .select('id, title, audio_url, duration_seconds, cover_image_url, artist_id, play_count')
        .eq('album_id', albumId)
        .order('created_at', { ascending: true });

      if (songsError) {
        console.error('Error fetching songs:', songsError);
        throw songsError;
      }

      const songsWithData = (albumSongs || []).map((song: any, index: number) => ({
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
  };

  const handlePlaySong = (song: AlbumSong) => {
    if (isUnreleasedForVisitor) return;
    if (song.audioUrl) {
      playSong(
        {
          id: song.id,
          title: song.title,
          artist: song.artist,
          artistId: song.artistId,
          coverImageUrl: song.coverImageUrl,
          audioUrl: song.audioUrl,
          duration: song.duration,
          playCount: song.playCount
        },
        false,
        songs.map(s => ({
          id: s.id,
          title: s.title,
          artist: s.artist,
          artistId: s.artistId,
          coverImageUrl: s.coverImageUrl,
          audioUrl: s.audioUrl,
          duration: s.duration,
          playCount: s.playCount
        })),
        songs.findIndex(s => s.id === song.id),
        'album',
        albumId || null
      );
    }
  };

  const handleShareSong = async (song: AlbumSong, e: React.MouseEvent) => {
    e.stopPropagation();

    try {
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

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-[#0a0a0a] via-[#0d0d0d] to-[#111111]">
      {/* Header - Fixed at top */}
      <div className="sticky top-0 z-10 bg-gradient-to-b from-[#0a0a0a] to-transparent backdrop-blur-md">
        <div className="flex items-center justify-between p-4" style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px) * 0.25)', paddingBottom: '1.25rem' }}>
          <button
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-white/10 hover:bg-white/20 active:bg-white/30 rounded-full transition-all active:scale-95"
            aria-label="Go back"
          >
            <ArrowLeft className="w-6 h-6 text-white" strokeWidth={2.5} />
          </button>
          <h1 className="font-['Inter',sans-serif] font-bold text-white text-xl">
            Album Details
          </h1>
          <div className="w-[44px]" />
        </div>
      </div>

      {/* Scrollable Content Container */}
      <div
        className="flex-1 overflow-y-auto px-4 pb-4"
        style={{
          paddingBottom: isMiniPlayerActive
            ? 'calc(12.5rem + env(safe-area-inset-bottom, 0px))'
            : 'calc(8rem + env(safe-area-inset-bottom, 0px))'
        }}
      >
        {isLoading ? (
          <div className="flex flex-col gap-6 py-4">
            {/* Loading Album Header */}
            <div className="flex items-center gap-4">
              <div className="w-24 h-24 bg-white/5 rounded-xl animate-pulse flex-shrink-0" />
              <div className="flex-1 flex flex-col gap-2 min-w-0">
                <div className="h-6 w-3/4 bg-white/5 rounded animate-pulse" />
                <div className="h-4 w-1/2 bg-white/5 rounded animate-pulse" />
                <div className="h-3 w-1/3 bg-white/5 rounded animate-pulse" />
              </div>
            </div>

            {/* Loading Track List */}
            <div className="flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 bg-white/5 rounded-xl animate-pulse" />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6 py-4">
            {/* Album Header */}
            {albumData && (
              <div className="flex items-start gap-4">
                <div className="w-24 h-24 rounded-xl overflow-hidden bg-white/5 flex-shrink-0 shadow-lg">
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
                <div className="flex-1 flex flex-col gap-1 min-w-0">
                  <h3 className="font-['Inter',sans-serif] font-bold text-white text-lg leading-tight truncate">
                    {albumData.title}
                  </h3>
                  <p className="font-['Inter',sans-serif] text-white/70 text-sm leading-tight">
                    {albumData.artist_name}
                  </p>
                  <p className="font-['Inter',sans-serif] text-white/50 text-xs mt-1">
                    {songs.length} {songs.length === 1 ? 'song' : 'songs'}
                  </p>
                </div>
              </div>
            )}

            {isUnreleasedForVisitor && albumData?.release_date && (
              <div className="flex items-center gap-3 rounded-xl bg-amber-500/15 border border-amber-500/30 px-4 py-3">
                <Calendar className="w-5 h-5 text-amber-400 flex-shrink-0" />
                <p className="font-['Inter',sans-serif] text-amber-200 text-sm">
                  This album releases on {formatReleaseDateDisplay(albumData.release_date)}. You can't play it until then.
                </p>
              </div>
            )}

            {/* Track List */}
            <div className="flex flex-col gap-2">
              <h4 className="font-['Inter',sans-serif] font-semibold text-white text-sm px-1 mb-1">
                Tracks
              </h4>
              {songs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Music className="w-12 h-12 text-white/40 mb-3" />
                  <p className="font-['Inter',sans-serif] text-white/60 text-sm">
                    No songs in this album
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {songs.map((song) => (
                    <div
                      key={song.id}
                      className={cn(
                        'group rounded-xl p-4 transition-all',
                        isUnreleasedForVisitor ? 'bg-white/5 cursor-not-allowed opacity-75' : 'bg-white/5 hover:bg-white/10 active:bg-white/15 cursor-pointer'
                      )}
                      onClick={() => handlePlaySong(song)}
                    >
                      <div className="flex items-center gap-3">
                        {/* Track Number / Play Icon */}
                        <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                          <span className="font-['Inter',sans-serif] text-white/60 text-sm group-hover:hidden">
                            {song.trackNumber}
                          </span>
                          {!isUnreleasedForVisitor && <Play className="w-4 h-4 text-white hidden group-hover:block" fill="white" />}
                        </div>

                        {/* Song Info */}
                        <div className="flex-1 flex flex-col gap-1 min-w-0">
                          <p className="font-['Inter',sans-serif] font-medium text-white text-sm truncate leading-tight">
                            {song.title}
                          </p>
                          <div className="flex items-center gap-2">
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
                          className="min-w-[40px] min-h-[40px] flex items-center justify-center hover:bg-white/10 rounded-full transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                          aria-label="Share song"
                        >
                          <Share2 className="w-4 h-4 text-white/70 hover:text-white" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
