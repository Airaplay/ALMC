import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Play, Share2, Music, Edit, Trash2 } from 'lucide-react';
import { supabase, getPlaylistDetails, recordShareEvent, deletePlaylist } from '../../lib/supabase';
import { sharePlaylist } from '../../lib/shareService';
import { LazyImage } from '../../components/LazyImage';
import { useMusicPlayer } from '../../contexts/MusicPlayerContext';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { EditPlaylistModal } from '../../components/EditPlaylistModal';

interface PlaylistSong {
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

interface PlaylistData {
  id: string;
  title: string;
  cover_image_url: string | null;
  description: string | null;
  created_at: string | null;
  user_id: string;
}

export const PlaylistDetailScreen = (): JSX.Element => {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const { playSong } = useMusicPlayer();
  const { user } = useAuth();
  const confirm = useConfirm();

  const [isLoading, setIsLoading] = useState(true);
  const [playlistData, setPlaylistData] = useState<PlaylistData | null>(null);
  const [songs, setSongs] = useState<PlaylistSong[]>([]);
  const [isMiniPlayerActive, setIsMiniPlayerActive] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (playlistId) {
      loadPlaylistDetails();
    }
  }, [playlistId]);

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

  const loadPlaylistDetails = async () => {
    if (!playlistId) {
      setError('No playlist ID provided');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const playlistDetails = await getPlaylistDetails(playlistId);

      if (!playlistDetails) {
        throw new Error('Playlist not found');
      }

      const playlistWithDetails: PlaylistData = {
        id: playlistDetails.id,
        title: playlistDetails.title,
        cover_image_url: playlistDetails.cover_image_url,
        description: playlistDetails.description,
        created_at: playlistDetails.created_at,
        user_id: playlistDetails.user_id
      };

      setPlaylistData(playlistWithDetails);
      setIsOwner(user?.id === playlistDetails.user_id);

      // Safely handle songs array
      const songsArray = Array.isArray(playlistDetails.songs) ? playlistDetails.songs : [];

      const formattedSongs = songsArray
        .filter((item: any) => item && item.song && item.song.id)
        .map((item: any, index: number) => ({
          id: item.song.id,
          title: item.song.title || 'Unknown Title',
          artist: item.song.artist || 'Unknown Artist',
          artistId: item.song.artistId || null,
          duration: item.song.duration || 0,
          audioUrl: item.song.audioUrl || null,
          coverImageUrl: item.song.coverUrl || playlistDetails.cover_image_url || null,
          trackNumber: index + 1,
          playCount: 0
        }));

      setSongs(formattedSongs as PlaylistSong[]);
    } catch (err) {
      console.error('Error loading playlist details:', err);
      setError(err instanceof Error ? err.message : 'Failed to load playlist');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlaySong = (song: PlaylistSong) => {
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
        `playlist-${playlistId}`,
        null
      );
    }
  };

  const handleSharePlaylist = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!playlistData) return;

    try {
      await recordShareEvent(playlistId || '', 'playlist');
      await sharePlaylist(playlistId || '', playlistData.title);
    } catch (error) {
      console.error('Error sharing playlist:', error);
    }
  };

  const handleDeletePlaylist = async () => {
    if (!playlistData || !isOwner) return;

    const confirmed = await confirm.confirm({
      title: 'Delete Playlist',
      message: `Are you sure you want to delete "${playlistData.title}"? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger'
    });

    if (!confirmed) return;

    try {
      await deletePlaylist(playlistId || '');
      navigate('/library', { replace: true });
    } catch (error) {
      console.error('Error deleting playlist:', error);
      alert('Failed to delete playlist. Please try again.');
    }
  };

  const handleEditSuccess = () => {
    setShowEditModal(false);
    loadPlaylistDetails();
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
    <>
      <div className="flex flex-col min-h-screen bg-gradient-to-b from-[#0a0a0a] via-[#0d0d0d] to-[#111111]">
        {/* Header - Fixed at top */}
        <div className="sticky top-0 z-10 bg-gradient-to-b from-[#0a0a0a] to-transparent backdrop-blur-md">
          <div className="flex items-center justify-between p-4 pt-[calc(env(safe-area-inset-top,0px)+1rem)]">
            <button
              onClick={() => navigate(-1)}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-white/10 hover:bg-white/20 active:bg-white/30 rounded-full transition-all active:scale-95"
              aria-label="Go back"
            >
              <ArrowLeft className="w-6 h-6 text-white" strokeWidth={2.5} />
            </button>
            <h1 className="font-['Inter',sans-serif] font-bold text-white text-xl">
              Playlist Details
            </h1>
            <div className="w-[44px]" />
          </div>
        </div>

        {/* Scrollable Content Container */}
        <div
          className="flex-1 overflow-y-auto px-4 pb-4"
          style={{
            paddingBottom: isMiniPlayerActive
              ? 'calc(8.5rem + env(safe-area-inset-bottom, 0px))'
              : 'calc(4rem + env(safe-area-inset-bottom, 0px))'
          }}
        >
          {error ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
                <Music className="w-8 h-8 text-red-400" />
              </div>
              <h3 className="font-['Inter',sans-serif] font-semibold text-white text-lg mb-2">
                Failed to Load Playlist
              </h3>
              <p className="font-['Inter',sans-serif] text-white/60 text-sm text-center mb-6">
                {error}
              </p>
              <button
                onClick={() => loadPlaylistDetails()}
                className="px-6 py-3 bg-[#309605] hover:bg-[#3ba208] rounded-lg text-white font-medium transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={() => navigate(-1)}
                className="mt-3 px-6 py-3 bg-white/10 hover:bg-white/20 rounded-lg text-white font-medium transition-colors"
              >
                Go Back
              </button>
            </div>
          ) : isLoading ? (
            <div className="flex flex-col gap-6 py-4">
              {/* Loading Playlist Header */}
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
              {/* Playlist Header */}
              {playlistData && (
                <div className="flex items-start gap-4">
                  <div className="w-24 h-24 rounded-xl overflow-hidden bg-white/5 flex-shrink-0 shadow-lg">
                    {playlistData.cover_image_url ? (
                      <LazyImage
                        src={playlistData.cover_image_url}
                        alt={playlistData.title}
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
                      {playlistData.title}
                    </h3>
                    {playlistData.description && (
                      <p className="font-['Inter',sans-serif] text-white/70 text-sm leading-tight line-clamp-2">
                        {playlistData.description}
                      </p>
                    )}
                    <p className="font-['Inter',sans-serif] text-white/50 text-xs mt-1">
                      {songs.length} {songs.length === 1 ? 'song' : 'songs'}
                    </p>

                    {/* Action Buttons */}
                    {songs.length > 0 && (
                      <div className="flex items-center gap-2 mt-2">
                        {isOwner ? (
                          <>
                            <button
                              onClick={() => setShowEditModal(true)}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#309605] hover:bg-[#3ba208] rounded-lg text-white text-xs font-medium transition-colors"
                              aria-label="Edit playlist"
                            >
                              <Edit className="w-3.5 h-3.5" />
                              Edit
                            </button>
                            <button
                              onClick={handleDeletePlaylist}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-red-400 text-xs font-medium transition-colors"
                              aria-label="Delete playlist"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </button>
                          </>
                        ) : null}
                        <button
                          onClick={handleSharePlaylist}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-white/70 text-xs transition-colors"
                          aria-label="Share playlist"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          Share
                        </button>
                      </div>
                    )}
                  </div>
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
                      This playlist is empty
                    </p>
                    {isOwner && (
                      <button
                        onClick={() => setShowEditModal(true)}
                        className="mt-4 px-6 py-2 bg-[#309605] hover:bg-[#3ba208] rounded-lg text-white text-sm font-medium transition-colors"
                      >
                        Add Songs
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {songs.map((song) => (
                      <div
                        key={song.id}
                        className="group bg-white/5 hover:bg-white/10 active:bg-white/15 rounded-xl p-4 transition-all cursor-pointer"
                        onClick={() => handlePlaySong(song)}
                      >
                        <div className="flex items-center gap-3">
                          {/* Track Number / Play Icon */}
                          <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                            <span className="font-['Inter',sans-serif] text-white/60 text-sm group-hover:hidden">
                              {song.trackNumber}
                            </span>
                            <Play className="w-4 h-4 text-white hidden group-hover:block" fill="white" />
                          </div>

                          {/* Song Info */}
                          <div className="flex-1 flex flex-col gap-1 min-w-0">
                            <p className="font-['Inter',sans-serif] font-medium text-white text-sm truncate leading-tight">
                              {song.title}
                            </p>
                            <div className="flex items-center gap-2">
                              {song.artistId ? (
                                <Link
                                  to={`/user/${song.artistId}`}
                                  className="font-['Inter',sans-serif] text-white/60 text-xs hover:text-[#309605] hover:underline transition-colors"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {song.artist}
                                </Link>
                              ) : (
                                <span className="font-['Inter',sans-serif] text-white/60 text-xs">
                                  {song.artist}
                                </span>
                              )}
                              <span className="text-white/40">•</span>
                              <span className="font-['Inter',sans-serif] text-white/60 text-xs">
                                {formatDuration(song.duration)}
                              </span>
                            </div>
                          </div>

                          {/* Play Count */}
                          <div className="flex-shrink-0">
                            <span className="font-['Inter',sans-serif] text-white/50 text-xs">
                              {formatPlayCount(song.playCount)} plays
                            </span>
                          </div>
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

      {/* Edit Playlist Modal */}
      {showEditModal && playlistId && (
        <EditPlaylistModal
          playlistId={playlistId}
          onClose={() => setShowEditModal(false)}
          onSuccess={handleEditSuccess}
        />
      )}
    </>
  );
};
