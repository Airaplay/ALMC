import React, { useState, useEffect, useRef } from 'react';
import { X, Music, Play, Pause, Heart, Edit, Trash2, Share2, Plus, UserPlus, UserMinus, Check, ThumbsDown, MessageCircle } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { supabase, getPlaylistDetails, isSongFavorited, toggleSongFavorite, isFollowing, followUser, unfollowUser, getUserPlaylistsForSong, toggleSongInPlaylist, recordShareEvent } from '../lib/supabase';
import { shareSong, sharePlaylist } from '../lib/shareService';
import { useAuth } from '../contexts/AuthContext';
import { useMusicPlayer } from '../contexts/MusicPlayerContext';
import { EditPlaylistModal } from './EditPlaylistModal';
import { Link } from 'react-router-dom';
import { CreatePlaylistModal } from './CreatePlaylistModal';
import { CommentsModal } from './CommentsModal';
import { Spinner } from './Spinner';
import { AuthModal } from './AuthModal';
import { useAlert } from '../contexts/AlertContext';

interface PlaylistDetailModalProps {
  playlistId: string;
  onClose: () => void;
  onDelete?: () => void;
  onOpenMusicPlayer?: (_track: Song) => void;
}

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

interface PlaylistSong {
  id: string;
  title: string;
  artist_name: string;
  artistId?: string | null;
  duration_seconds: number;
  cover_image_url: string | null;
  audio_url: string | null;
  playlist_song_id: string;
  position: number;
  isFavorited?: boolean;
}

interface Playlist {
  id: string;
  title: string;
  coverImageUrl: string | null;
  hasSong: boolean;
}

export const PlaylistDetailModal: React.FC<PlaylistDetailModalProps> = ({
  playlistId,
  onClose,
  onDelete,
  onOpenMusicPlayer
}) => {
  const alert = useAlert();
  const { user, isAuthenticated } = useAuth();
  const { playSong } = useMusicPlayer();
  const [playlist, setPlaylist] = useState<any>(null);
  const [playlistSongs, setPlaylistSongs] = useState<PlaylistSong[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentlyPlayingSong, setCurrentlyPlayingSong] = useState<string | null>(null);
  const [audioElement] = useState<HTMLAudioElement | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [followingArtists, setFollowingArtists] = useState<Record<string, boolean>>({});
  const [showCreatePlaylistModal, setShowCreatePlaylistModal] = useState(false);
  const [selectedSongForPlaylist, setSelectedSongForPlaylist] = useState<string | null>(null);
  const [showPlaylistsDropdown, setShowPlaylistsDropdown] = useState<string | null>(null);
  const [userPlaylists, setUserPlaylists] = useState<Playlist[]>([]);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);
  const [showCommentsModal, setShowCommentsModal] = useState(false);
  const [selectedSongForComments, setSelectedSongForComments] = useState<{ id: string; title: string } | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [curationStatus, setCurationStatus] = useState<string>('none');

  // Dropdown ref for clicking outside to close
  const playlistsDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadPlaylist();

    // Cleanup audio on unmount
    return () => {
      if (audioElement) {
        audioElement.pause();
        audioElement.src = '';
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId]);

  // Effect for handling clicks outside the playlists dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (playlistsDropdownRef.current && !playlistsDropdownRef.current.contains(event.target as Node)) {
        setShowPlaylistsDropdown(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const loadPlaylist = async () => {
    setIsLoading(true);
    try {
      // Use the enhanced getPlaylistDetails function
      const playlistData = await getPlaylistDetails(playlistId);
      setPlaylist(playlistData);

      // Check if current user is the owner
      setIsOwner(user?.id === playlistData.user_id);

      // Get curation status
      setCurationStatus(playlistData.curation_status || 'none');

      // Format the songs data
      const formattedSongs = await Promise.all(playlistData.songs.map(async (item: any) => {
        const isFavorited = isAuthenticated ? await isSongFavorited(item.song.id) : false;
        
        return {
          playlist_song_id: item.id,
          position: item.position,
          id: item.song.id,
          title: item.song.title,
          artist_name: item.song.artist,
          artistId: item.song.artistId, // Include the artist's user_id for profile linking
          duration_seconds: item.song.duration,
          cover_image_url: item.song.coverUrl,
          audio_url: item.song.audioUrl,
          isFavorited
        };
      }));

      // Sort by position
      formattedSongs.sort((a: any, b: any) => a.position - b.position);
      setPlaylistSongs(formattedSongs);
      
      // Check following status for artists
      if (isAuthenticated) {
        const artistIds = formattedSongs
          .map(song => song.artistId)
          .filter((id): id is string => !!id);
        
        const uniqueArtistIds = [...new Set(artistIds)];
        
        const followingStatus: Record<string, boolean> = {};
        for (const artistId of uniqueArtistIds) {
          followingStatus[artistId] = await isFollowing(artistId);
        }
        
        setFollowingArtists(followingStatus);
      }
    } catch (err) {
      console.error('Error loading playlist:', err);
      setError(err instanceof Error ? err.message : 'Failed to load playlist');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlaySong = (songId: string, audioUrl: string | null) => {
    if (!audioUrl) {
      console.error('No audio URL available for this song');
      return;
    }

    // Find the song in the playlist
    const song = playlistSongs.find(s => s.id === songId);
    if (!song) return;

    const formattedSong = {
      id: song.id,
      title: song.title,
      artist: song.artist_name,
      artistId: song.artistId,
      coverImageUrl: song.cover_image_url,
      audioUrl: song.audio_url,
      duration: song.duration_seconds,
      playCount: 0
    };

    // Format all playlist songs
    const formattedPlaylist = playlistSongs.map(s => ({
      id: s.id,
      title: s.title,
      artist: s.artist_name,
      artistId: s.artistId,
      coverImageUrl: s.cover_image_url,
      audioUrl: s.audio_url,
      duration: s.duration_seconds,
      playCount: 0
    }));

    const songIndex = playlistSongs.findIndex(s => s.id === songId);

    // Use MusicPlayerContext for proper playlist handling
    playSong(
      formattedSong,
      false,
      formattedPlaylist,
      songIndex,
      `playlist-${playlistId}`,
      null
    );

    // Fallback to callback if provided (for backward compatibility)
    if (onOpenMusicPlayer) {
      onOpenMusicPlayer(formattedSong);
    }
  };

  const handleToggleFavorite = async (songId: string) => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    try {
      const isFavorited = await toggleSongFavorite(songId);
      
      // Update the songs state to reflect the new favorite status
      setPlaylistSongs(prevSongs => 
        prevSongs.map(song => 
          song.id === songId ? { ...song, isFavorited } : song
        )
      );
    } catch (error) {
      console.error('Error toggling favorite:', error);
      alert('Error', 'Failed to update favorite status');
    }
  };

  const handleToggleFollow = async (artistId: string | undefined | null) => {
    if (!artistId) {
      return;
    }
    
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    try {
      const isFollowingArtist = followingArtists[artistId] || false;
      
      if (isFollowingArtist) {
        await unfollowUser(artistId);
      } else {
        await followUser(artistId);
      }
      
      // Update following status
      setFollowingArtists(prev => ({
        ...prev,
        [artistId]: !isFollowingArtist
      }));
    } catch (error) {
      console.error('Error toggling follow status:', error);
      alert('Error', 'Failed to update follow status');
    }
  };

  const handleAddToPlaylist = async (songId: string) => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    setSelectedSongForPlaylist(songId);
    
    // Load user's playlists
    setIsLoadingPlaylists(true);
    try {
      const playlists = await getUserPlaylistsForSong(songId);
      setUserPlaylists(playlists);
      setShowPlaylistsDropdown(songId);
    } catch (error) {
      console.error('Error loading playlists:', error);
    } finally {
      setIsLoadingPlaylists(false);
    }
  };

  const handleToggleSongInPlaylist = async (playlistId: string, songId: string) => {
    try {
      await toggleSongInPlaylist(playlistId, songId);
      
      // Update playlists state to reflect the change
      setUserPlaylists(prevPlaylists => 
        prevPlaylists.map(playlist => 
          playlist.id === playlistId 
            ? { ...playlist, hasSong: !playlist.hasSong } 
            : playlist
        )
      );
    } catch (error) {
      console.error('Error toggling song in playlist:', error);
      alert('Error', 'Failed to update playlist');
    }
  };

  const handleDislikeToggle = async (songId: string) => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    // Find the song and check if it's favorited
    const song = playlistSongs.find(s => s.id === songId);
    if (song?.isFavorited) {
      try {
        const isFavorited = await toggleSongFavorite(songId);
        
        // Update the songs state to reflect the new favorite status
        setPlaylistSongs(prevSongs => 
          prevSongs.map(song => 
            song.id === songId ? { ...song, isFavorited } : song
          )
        );
      } catch (error) {
        console.error('Error removing favorite:', error);
        alert('Error', 'Failed to update favorite status');
      }
    }
    // Note: We don't have a separate dislike system, so this just removes favorites
  };

  const handleOpenComments = (songId: string, songTitle: string) => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    setSelectedSongForComments({ id: songId, title: songTitle });
    setShowCommentsModal(true);
  };

  const handleShareSong = async (songId: string, songTitle: string, artistName: string) => {
    // Record share event in database
    try {
      await recordShareEvent(songId, 'song');
    } catch (error) {
      console.error('Error recording share event:', error);
      // Don't block sharing if analytics fails
    }

    try {
      await shareSong(songId, songTitle, artistName);
    } catch (error) {
      console.error('Error sharing song:', error);
    }
  };

  const handleSharePlaylist = async () => {
    if (!playlist) return;

    // Record share event in database
    try {
      await recordShareEvent(playlistId, 'playlist');
    } catch (error) {
      console.error('Error recording share event:', error);
      // Don't block sharing if analytics fails
    }

    try {
      await sharePlaylist(playlistId, playlist.title);
    } catch (error) {
      console.error('Error sharing playlist:', error);
    }
  };

  const handleDeletePlaylist = async () => {
    if (!playlist || !isOwner) return;

    if (window.confirm(`Are you sure you want to delete the playlist "${playlist.title}"?`)) {
      try {
        const { error } = await supabase
          .from('playlists')
          .delete()
          .eq('id', playlistId);

        if (error) {
          throw new Error(`Failed to delete playlist: ${error.message}`);
        }

        onDelete?.();
        onClose();
      } catch (err) {
        console.error('Error deleting playlist:', err);
        setError(err instanceof Error ? err.message : 'Failed to delete playlist');
      }
    }
  };

  const handleEditSuccess = () => {
    setShowEditModal(false);
    loadPlaylist();
  };

  const handleCreatePlaylistSuccess = () => {
    setShowCreatePlaylistModal(false);
    // Refresh playlists if dropdown is open
    if (showPlaylistsDropdown) {
      handleAddToPlaylist(showPlaylistsDropdown);
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getTotalDuration = (): string => {
    const totalSeconds = playlistSongs.reduce((total, song) => total + (song.duration_seconds || 0), 0);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    
    return hours > 0 
      ? `${hours} hr ${minutes} min` 
      : `${minutes} min`;
  };

  if (isLoading) {
    return (
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[110] flex items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <Card
          className="w-full max-w-md bg-gradient-to-b from-gray-900/95 to-black/95 backdrop-blur-xl border border-white/20 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <CardContent className="p-6 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-[#309605] border-t-transparent rounded-full animate-spin"></div>
            <p className="font-['Inter',sans-serif] text-white/70 text-sm ml-3">
              Loading playlist...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[110] flex items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <Card
          className="w-full max-w-md bg-gradient-to-b from-gray-900/95 to-black/95 backdrop-blur-xl border border-white/20 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <CardContent className="p-6 text-center">
            <h3 className="font-['Inter',sans-serif] font-bold text-white text-xl mb-4">
              Error Loading Playlist
            </h3>
            <p className="font-['Inter',sans-serif] text-red-400 text-sm mb-6">
              {error || 'Playlist not found'}
            </p>
            <button
              onClick={onClose}
              className="px-6 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-['Inter',sans-serif] font-medium text-white transition-all duration-200"
            >
              Close
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[110] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <Card
          className="w-full max-w-md bg-gradient-to-b from-gray-900/95 to-black/95 backdrop-blur-xl border border-white/20 shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <CardContent className="p-0 flex-1 flex flex-col">
            {/* Header with cover image */}
            <div className="relative">
              <div className="h-48 bg-gradient-to-r from-[#309605]/20 to-[#3ba208]/20 w-full">
                {playlist.cover_image_url && (
                  <img 
                    src={playlist.cover_image_url} 
                    alt={playlist.title}
                    className="w-full h-full object-cover"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent"></div>
              </div>
              
              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors duration-200"
              >
                <X className="w-5 h-5 text-white" />
              </button>
              
              {/* Playlist info */}
              <div className="absolute bottom-4 left-6 right-6">
                <h2 className="font-['Inter',sans-serif] font-bold text-white text-2xl mb-1 line-clamp-2">
                  {playlist.title}
                </h2>
                {playlist.description && (
                  <p className="font-['Inter',sans-serif] text-white/80 text-sm mb-2 line-clamp-2">
                    {playlist.description}
                  </p>
                )}
                <div className="flex items-center gap-4 text-white/60 text-xs">
                  <span>{playlistSongs.length} songs</span>
                  <span>•</span>
                  <span>{getTotalDuration()}</span>
                </div>
              </div>
            </div>
            
            {/* Action buttons */}
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              {isOwner ? (
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={() => setShowEditModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-[#309605] hover:bg-[#3ba208] rounded-lg text-white text-sm font-medium transition-all duration-200"
                  >
                    <Edit className="w-4 h-4" />
                    Edit
                  </button>
                  {curationStatus === 'pending' && (
                    <span className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/20 border border-yellow-500/30 rounded-lg text-yellow-400 text-xs font-medium">
                      Under Review
                    </span>
                  )}
                  {curationStatus === 'approved' && (
                    <span className="flex items-center gap-2 px-3 py-1.5 bg-green-500/20 border border-green-500/30 rounded-lg text-green-400 text-xs font-medium">
                      <Check className="w-3.5 h-3.5" />
                      Featured
                    </span>
                  )}
                  {curationStatus === 'rejected' && (
                    <span className="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-xs font-medium">
                      <X className="w-3.5 h-3.5" />
                      Rejected
                    </span>
                  )}
                  <button
                    onClick={handleDeletePlaylist}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-red-400 text-sm font-medium transition-all duration-200"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              ) : (
                <button
                  className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm font-medium transition-all duration-200"
                >
                  <Heart className="w-4 h-4" />
                  Like
                </button>
              )}
              
              <button
                onClick={handleSharePlaylist}
                className="p-2 hover:bg-white/10 rounded-full transition-colors duration-200"
              >
                <Share2 className="w-5 h-5 text-white/60" />
              </button>
            </div>
            
            {/* Songs list */}
            <div className="flex-1 overflow-y-auto p-4">
              {playlistSongs.length === 0 ? (
                <div className="p-4 bg-white/5 rounded-lg text-center">
                  <p className="font-['Inter',sans-serif] text-white/70 text-sm">
                    This playlist is empty
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {playlistSongs.map((song) => (
                    <div
                      key={song.playlist_song_id}
                      className="relative flex items-center justify-between p-2 hover:bg-white/10 rounded-lg transition-colors duration-200 z-0"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <button
                          onClick={() => handlePlaySong(song.id, song.audio_url)}
                          disabled={!song.audio_url}
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-200 ${
                            currentlyPlayingSong === song.id
                              ? 'bg-[#309605] text-white'
                              : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white'
                          } ${!song.audio_url ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          {currentlyPlayingSong === song.id ? (
                            <Pause className="w-4 h-4" />
                          ) : (
                            <Play className="w-4 h-4 ml-0.5" />
                          )}
                        </button>
                        <div className="w-8 h-8 rounded-md bg-white/10 flex-shrink-0 overflow-hidden">
                          {song.cover_image_url ? (
                            <img 
                              src={song.cover_image_url} 
                              alt={song.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Music className="w-4 h-4 text-white/60" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-['Inter',sans-serif] text-white text-sm font-medium truncate">
                            {song.title}
                          </p>
                          <p className="font-['Inter',sans-serif] text-white/60 text-xs truncate">
                            {song.artistId ? (
                              <Link 
                                to={`/user/${song.artistId}`}
                                className="hover:text-[#309605] hover:underline transition-colors duration-200"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {song.artist_name}
                              </Link>
                            ) : (
                              song.artist_name
                            )}
                            {song.artistId && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  handleToggleFollow(song.artistId);
                                }}
                                className="ml-2 inline-flex items-center"
                              >
                                {isAuthenticated && followingArtists[song.artistId] ? (
                                  <UserMinus className="w-3 h-3 text-[#309605]" />
                                ) : (
                                  <UserPlus className="w-3 h-3 text-white/60 hover:text-[#309605]" />
                                )}
                              </button>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-['Inter',sans-serif] text-white/60 text-xs">
                          {formatDuration(song.duration_seconds)}
                        </span>
                        
                        {isAuthenticated && (
                          <>
                            <button 
                              onClick={() => handleToggleFavorite(song.id)}
                              className="p-1 hover:bg-white/10 rounded-full transition-colors duration-200"
                            >
                              <Heart className={`w-4 h-4 ${song.isFavorited ? 'text-red-500 fill-red-500' : 'text-white'}`} />
                            </button>
                            
                            <button 
                              onClick={() => handleDislikeToggle(song.id)}
                              className="p-1 hover:bg-white/10 rounded-full transition-colors duration-200"
                            >
                              <ThumbsDown className="w-4 h-4 text-white/60" />
                            </button>
                            
                            <div className="relative z-50">
                              <button
                                onClick={() => handleAddToPlaylist(song.id)}
                                className="p-1 hover:bg-white/10 rounded-full transition-colors duration-200"
                              >
                                <Plus className="w-4 h-4 text-white/60" />
                              </button>

                              {showPlaylistsDropdown === song.id && (
                                <div
                                  ref={playlistsDropdownRef}
                                  className="absolute right-0 mt-1 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-[9999] py-1"
                                >
                                  {isLoadingPlaylists ? (
                                    <div className="px-4 py-2 flex items-center justify-center">
                                      <Spinner size={20} className="text-white" />
                                    </div>
                                  ) : userPlaylists.length === 0 ? (
                                    <div className="px-4 py-2 text-white/70 text-sm">
                                      No playlists found
                                    </div>
                                  ) : (
                                    <>
                                      <div className="px-4 py-2 text-white/90 text-xs font-semibold border-b border-gray-700">
                                        Your Playlists
                                      </div>
                                      {userPlaylists.map(playlist => (
                                        <button
                                          key={playlist.id}
                                          onClick={() => handleToggleSongInPlaylist(playlist.id, song.id)}
                                          className="w-full px-4 py-2 text-left text-white/80 text-sm hover:bg-white/10 flex items-center justify-between"
                                        >
                                          <span className="truncate">{playlist.title}</span>
                                          {playlist.hasSong && <Check className="w-4 h-4 text-[#309605]" />}
                                        </button>
                                      ))}
                                    </>
                                  )}
                                  <div className="border-t border-gray-700 mt-1 pt-1">
                                    <button
                                      onClick={() => {
                                        setShowPlaylistsDropdown(null);
                                        setShowCreatePlaylistModal(true);
                                        setSelectedSongForPlaylist(song.id);
                                      }}
                                      className="w-full px-4 py-2 text-left text-[#309605] text-sm hover:bg-white/10 flex items-center"
                                    >
                                      <Plus className="w-4 h-4 mr-2" />
                                      Create New Playlist
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                            
                            <button 
                              onClick={() => handleShareSong(song.id, song.title, song.artist_name)}
                              className="p-1 hover:bg-white/10 rounded-full transition-colors duration-200"
                            >
                              <Share2 className="w-4 h-4 text-white/60" />
                            </button>
                            
                            <button 
                              onClick={() => handleOpenComments(song.id, song.title)}
                              className="p-1 hover:bg-white/10 rounded-full transition-colors duration-200"
                            >
                              <MessageCircle className="w-4 h-4 text-white/60" />
                            </button>
                          </>
                        )}
                        
                        {isOwner && (
                          <button
                            onClick={async () => {
                              if (currentlyPlayingSong === song.id && audioElement) {
                                audioElement.pause();
                                setCurrentlyPlayingSong(null);
                              }
                              // Remove song from playlist
                              try {
                                const { error } = await supabase
                                  .from('playlist_songs')
                                  .delete()
                                  .eq('id', song.playlist_song_id);
                                  
                                if (error) {
                                  console.error('Error removing song:', error);
                                  return;
                                }
                                
                                setPlaylistSongs(prev => 
                                  prev.filter(s => s.playlist_song_id !== song.playlist_song_id)
                                );
                              } catch (err) {
                                console.error('Error removing song:', err);
                              }
                            }}
                            className="p-1 hover:bg-red-500/20 rounded-full transition-colors duration-200"
                          >
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Edit Modal */}
      {showEditModal && (
        <EditPlaylistModal
          playlistId={playlistId}
          onClose={() => setShowEditModal(false)}
          onSuccess={handleEditSuccess}
        />
      )}

      {/* Create Playlist Modal */}
      {showCreatePlaylistModal && (
        <CreatePlaylistModal
          onClose={() => setShowCreatePlaylistModal(false)}
          onSuccess={handleCreatePlaylistSuccess}
          initialSongId={selectedSongForPlaylist}
        />
      )}

      {/* Comments Modal */}
      {showCommentsModal && selectedSongForComments && (
        <CommentsModal
          contentId={selectedSongForComments.id}
          contentType="song"
          contentTitle={selectedSongForComments.title}
          onClose={() => {
            setShowCommentsModal(false);
            setSelectedSongForComments(null);
          }}
        />
      )}

      {/* Auth Modal */}
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => {
            setShowAuthModal(false);
          }}
        />
      )}
    </>
  );
};