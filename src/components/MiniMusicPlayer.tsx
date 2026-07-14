import React from 'react';
import { Play, Pause, Share2, X } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { recordShareEvent } from '../lib/supabase';
import { shareSong } from '../lib/shareService';

interface Song {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  coverImageUrl?: string | null;
  audioUrl?: string | null;
  duration?: number;
  playCount?: number;
  featuredArtists?: string[] | null;
}

interface MiniMusicPlayerProps {
  song: Song | null;
  isVisible: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  error: string | null;
  albumId?: string | null;
  playlistContext?: string;
  onTogglePlayPause: () => void;
  onExpand?: () => void;
  onClose?: () => void;
}

export const MiniMusicPlayer: React.FC<MiniMusicPlayerProps> = ({
  song,
  isVisible,
  isPlaying,
  error,
  albumId,
  playlistContext,
  onTogglePlayPause,
  onExpand,
  onClose,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isOnMessageThread = location.pathname.startsWith('/messages/');

  const handleShare = async () => {
    if (!song) return;

    try {
      await recordShareEvent(song.id, 'song');
    } catch (error) {
      console.error('Error recording share event:', error);
    }

    try {
      await shareSong(song.id, song.title, song.artist);
    } catch (error) {
      console.error('Error sharing song:', error);
    }
  };

  const handlePlayerClick = () => {
    if (playlistContext && playlistContext.startsWith('playlist-')) {
      const playlistId = playlistContext.replace('playlist-', '');
      navigate(`/playlist/${playlistId}`);
      return;
    }

    // If playback started from an album/EP, return to the album player screen
    if (playlistContext && playlistContext.startsWith('album-')) {
      const albumIdFromContext = playlistContext.replace('album-', '');
      if (albumIdFromContext) {
        navigate(`/album/${albumIdFromContext}`);
        return;
      }
    }

    if (albumId) {
      navigate(`/album/${albumId}`);
      return;
    }

    if (onExpand) {
      onExpand();
    }
  };

  const handleCoverClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    handlePlayerClick();
  };

  if (!isVisible || !song || isOnMessageThread) {
    return null;
  }

  const NAV_BAR_HEIGHT_PX = 72;
  const miniPlayerBottom = `calc(${NAV_BAR_HEIGHT_PX}px + env(safe-area-inset-bottom, 0px))`;

  return (
    <>
      <div
        className="mini-music-player fixed left-0 right-0 w-full z-[61] transition-[bottom] duration-300 ease-out"
        style={{
          bottom: miniPlayerBottom
        }}
      >
        <div className="bg-gradient-to-br from-[#1a1a1a]/95 via-[#0d0d0d]/95 to-[#000000]/95 backdrop-blur-xl shadow-2xl border-t border-white/10 w-full max-w-[390px] mx-auto">
        {/* Player Content */}
        <div className="flex items-center px-3 py-2 gap-2">
          {/* Album Art */}
          <div
            className="flex-shrink-0 cursor-pointer group"
            onClick={handleCoverClick}
          >
            <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-800 shadow-lg transform group-active:scale-95 transition-transform duration-200">
              {song.coverImageUrl ? (
                <img
                  src={song.coverImageUrl}
                  alt={song.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-white text-xl font-bold">♪</span>
                </div>
              )}
            </div>
          </div>

          {/* Song Info */}
          <div
            className="flex-1 min-w-0 cursor-pointer"
            onClick={handlePlayerClick}
          >
            <h3 className="font-semibold text-white text-sm truncate leading-tight">
              {song.title}
            </h3>
            <p className="text-xs text-white/70 truncate leading-tight mt-0.5">
              {song.artist}
              {song.featuredArtists && song.featuredArtists.length > 0 && (
                <span> • Ft {song.featuredArtists.join(', ')}</span>
              )}
            </p>
          </div>

          {/* Control Buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Play/Pause Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTogglePlayPause();
              }}
              disabled={!!error || !song.audioUrl}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="w-11 h-11 rounded-full bg-white flex items-center justify-center shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-[#309605] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 text-black fill-black" />
              ) : (
                <Play className="w-5 h-5 ml-0.5 text-black fill-black" />
              )}
            </button>

            {/* Share Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleShare();
              }}
              aria-label="Share song"
              className="min-w-11 min-h-11 rounded-full flex items-center justify-center hover:bg-white/10 active:bg-white/15 active:scale-95 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-[#309605] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              <Share2 className="w-5 h-5 text-white/70" />
            </button>

            {/* Close Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose?.();
              }}
              aria-label="Close player"
              className="min-w-11 min-h-11 rounded-full flex items-center justify-center hover:bg-white/10 active:bg-white/15 active:scale-95 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-[#309605] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              <X className="w-4 h-4 text-white/70" />
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="px-3 pb-2">
            <div className="px-2 py-1.5 bg-red-500/20 border border-red-500/30 rounded-lg backdrop-blur-sm">
              <p className="text-red-400 text-xs text-center truncate">
                {error}
              </p>
            </div>
          </div>
        )}
      </div>
      </div>
    </>
  );
};
