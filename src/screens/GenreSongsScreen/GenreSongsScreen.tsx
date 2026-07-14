import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Music, Play, Pause, Heart, Share2, UserPlus, UserMinus, PlayCircle } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/card';
import { supabase, getSongsByGenre, getGenreDetails, getBatchSongsFavoriteStatus, toggleSongFavorite, getBatchFollowingStatus, followUser, unfollowUser, recordShareEvent } from '../../lib/supabase';
import { shareSong } from '../../lib/shareService';
import { useAuth } from '../../contexts/AuthContext';
import { useMusicPlayer } from '../../contexts/MusicPlayerContext';
import { AuthModal } from '../../components/AuthModal';
import { getCachedGenreSongs, setCachedGenreSongs } from '../../lib/genreCache';

interface Song {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  duration: number;
  audioUrl: string | null;
  coverImageUrl: string | null;
  playCount: number;
  isFavorited?: boolean;
}

export const GenreSongsScreen: React.FC = () => {
  const { genreId } = useParams<{ genreId: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated, isInitialized } = useAuth();
  const [genre, setGenre] = useState<any>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [followingArtists, setFollowingArtists] = useState<Record<string, boolean>>({});
  const [showAuthModal, setShowAuthModal] = useState(false);

  const { currentSong, isPlaying, togglePlayPause, playSong, isMiniPlayerVisible } = useMusicPlayer();

  // Fisher-Yates shuffle algorithm for randomizing song order
  const shuffleArray = <T,>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  const bottomPadding = useMemo(() => {
    const navBarHeight = 64;
    const miniPlayerHeight = 56;
    const adBannerHeight = 50;
    const baseSpacing = 32;

    let totalPadding = navBarHeight + baseSpacing;

    if (isMiniPlayerVisible) {
      totalPadding += miniPlayerHeight;

      if (document.body.classList.contains('ad-banner-active')) {
        totalPadding += adBannerHeight;
      }
    }

    return totalPadding;
  }, [isMiniPlayerVisible]);

  useEffect(() => {
    if (isInitialized && genreId) {
      loadData();
    }
  }, [genreId, isInitialized, isAuthenticated]);

  const loadData = async () => {
    if (!genreId) return;

    setIsLoading(true);
    setError(null);

    try {
      // Check cache first
      const cached = getCachedGenreSongs(genreId);
      if (cached) {
        console.log(`[GenreSongsScreen] Using cached data for genre: ${genreId}`);
        setGenre(cached.genreData);

        // Still need to fetch user-specific data (favorites, following)
        if (isAuthenticated) {
          const songIds = cached.songs.map(song => song.id);
          const artistIds = [...new Set(
            cached.songs
              .map(song => song.artistId)
              .filter((id): id is string => !!id)
          )];

          const [favoritesMap, followingStatus] = await Promise.all([
            getBatchSongsFavoriteStatus(songIds),
            getBatchFollowingStatus(artistIds)
          ]);

          const songsWithFavoriteStatus = cached.songs.map(song => ({
            ...song,
            isFavorited: favoritesMap[song.id] || false
          }));

          setSongs(songsWithFavoriteStatus);
          setFollowingArtists(followingStatus);
        } else {
          setSongs(cached.songs);
        }

        setIsLoading(false);
        return;
      }

      // Fetch genre and songs in parallel
      const [genreData, songsData] = await Promise.all([
        getGenreDetails(genreId),
        getSongsByGenre(genreId, 100)
      ]);

      if (!genreData) {
        throw new Error('Genre not found');
      }

      console.log(`[GenreSongsScreen] Loading songs for genre: ${genreData.name} (ID: ${genreId})`);
      setGenre(genreData);

      console.log(`[GenreSongsScreen] Found ${songsData.length} songs for genre: ${genreData.name}`);

      // Shuffle songs for fresh experience every time
      const shuffledSongs = shuffleArray(songsData);

      // Filter to only one song per artist for variety (limit to 80 for performance)
      const uniqueArtistSongs: Song[] = [];
      const seenArtists = new Set<string>();

      for (const song of shuffledSongs) {
        if (uniqueArtistSongs.length >= 80) break;

        const artistKey = song.artistId || song.artist;
        if (!seenArtists.has(artistKey)) {
          uniqueArtistSongs.push(song as Song);
          seenArtists.add(artistKey);
        }
      }

      console.log(`[GenreSongsScreen] Filtered to ${uniqueArtistSongs.length} unique artists from ${shuffledSongs.length} songs`);

      // Cache the processed data
      setCachedGenreSongs(genreId, uniqueArtistSongs, genreData);

      if (isAuthenticated) {
        const songIds = uniqueArtistSongs.map(song => song.id);
        const artistIds = [...new Set(
          uniqueArtistSongs
            .map(song => song.artistId)
            .filter((id): id is string => !!id)
        )];

        // Fetch favorites and following status in parallel
        const [favoritesMap, followingStatus] = await Promise.all([
          getBatchSongsFavoriteStatus(songIds),
          getBatchFollowingStatus(artistIds)
        ]);

        const songsWithFavoriteStatus = uniqueArtistSongs.map(song => ({
          ...song,
          isFavorited: favoritesMap[song.id] || false
        }));

        setSongs(songsWithFavoriteStatus);
        setFollowingArtists(followingStatus);
      } else {
        setSongs(uniqueArtistSongs);
      }
    } catch (err) {
      console.error("Error loading genre data:", err);
      setError(err instanceof Error ? err.message : "Failed to load genre data");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlaySong = (song: Song) => {
    if (!song.audioUrl) {
      alert('This song is not available for playback.');
      return;
    }

    if (currentSong && currentSong.id === song.id) {
      togglePlayPause();
      return;
    }

    playSong(song, true, songs, songs.findIndex(s => s.id === song.id), `genre-${genreId}`);
  };

  const handlePlayAll = () => {
    const playableSongs = songs.filter(song => song.audioUrl);

    if (playableSongs.length === 0) {
      alert('No songs available for playback in this genre.');
      return;
    }

    const genreContext = `genre-${genreId}`;
    playSong(playableSongs[0], true, playableSongs, 0, genreContext);
  };

  const handleToggleFavorite = async (songId: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setShowAuthModal(true);
      return;
    }

    try {
      const isFavorited = await toggleSongFavorite(songId);

      setSongs(prevSongs =>
        prevSongs.map(song =>
          song.id === songId ? { ...song, isFavorited } : song
        )
      );
    } catch (error: any) {
      console.error('Error toggling favorite:', error);
      const errorMessage = error?.message || 'Failed to update favorite status. Please try again.';
      alert(errorMessage);
    }
  };

  const handleShareSong = async (songId: string, songTitle: string, artistName: string) => {
    try {
      await recordShareEvent(songId, 'song');
    } catch (error) {
      console.error('Error recording share event:', error);
    }

    try {
      await shareSong(songId, songTitle, artistName);
    } catch (error) {
      console.error('Error sharing song:', error);
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

      setFollowingArtists(prev => ({
        ...prev,
        [artistId]: !isFollowingArtist
      }));
    } catch (error: any) {
      console.error('Error toggling follow status:', error);
      const errorMessage = error?.message || 'Failed to update follow status. Please try again.';
      alert(errorMessage);
    }
  };

  const getGenrePlaceholderImage = (genreImageUrl?: string | null): string => {
    if (genreImageUrl) {
      return genreImageUrl;
    }

    const placeholders = [
      "https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400",
      "https://images.pexels.com/photos/167636/pexels-photo-167636.jpeg?auto=compress&cs=tinysrgb&w=400",
      "https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=400",
      "https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=400",
      "https://images.pexels.com/photos/164821/pexels-photo-164821.jpeg?auto=compress&cs=tinysrgb&w=400"
    ];
    return placeholders[Math.floor(Math.random() * placeholders.length)];
  };

  return (
    <>
      <div className="flex flex-col min-h-screen bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav">
        {/* Header with genre image */}
        <div className="relative w-full">
          <div className="h-64 w-full relative overflow-hidden">
            <img
              src={getGenrePlaceholderImage(genre?.image_url)}
              alt={genre?.name || 'Genre'}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0d0d0d] via-[#0d0d0d]/60 to-transparent"></div>
          </div>

          <div className="absolute top-6 left-6 right-6 flex items-center justify-between">
            <button
              onClick={() => navigate(-1)}
              className="p-2.5 bg-black/70 hover:bg-black/90 backdrop-blur-sm rounded-full transition-all duration-200 active:scale-95 shadow-lg"
            >
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>

            {!isLoading && songs.length > 0 && (
              <button
                onClick={handlePlayAll}
                className="p-2.5 bg-white hover:bg-white/90 backdrop-blur-sm rounded-full transition-all duration-200 active:scale-95 shadow-lg flex items-center gap-2"
                title="Play All"
              >
                <PlayCircle className="w-5 h-5 text-[#309605]" />
              </button>
            )}
          </div>

          <div className="absolute bottom-0 left-0 right-0 p-6 pb-4">
            {isLoading ? (
              <div className="h-8 w-40 bg-white/20 animate-pulse rounded-lg"></div>
            ) : (
              <>
                <h2 className="font-['Inter',sans-serif] font-bold text-white text-3xl mb-2 tracking-tight">
                  {genre?.name || 'Genre'}
                </h2>
                {genre?.description && (
                  <p className="font-['Inter',sans-serif] text-white/70 text-sm mb-3 line-clamp-2">
                    {genre.description}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <span className="font-['Inter',sans-serif] text-white/60 text-sm font-medium">
                    {songs.length} {songs.length === 1 ? 'song' : 'songs'}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Songs list */}
        <div
          className="px-6 pt-4"
          style={{
            paddingBottom: `${bottomPadding}px`
          }}
        >
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <p className="font-['Inter',sans-serif] text-white/70 text-sm ml-3">
                  
                </p>
              </div>
            ) : error ? (
              <Card className="bg-red-500/20 border border-red-500/30 shadow-lg">
                <CardContent className="p-6 text-center">
                  <p className="font-['Inter',sans-serif] text-red-400 text-sm mb-4">{error}</p>
                  <button
                    onClick={loadData}
                    className="px-5 py-2.5 bg-red-500/30 hover:bg-red-500/40 rounded-xl text-red-400 text-sm font-['Inter',sans-serif] font-semibold transition-all duration-200 active:scale-95 shadow-md"
                  >
                    Try Again
                  </button>
                </CardContent>
              </Card>
            ) : songs.length === 0 ? (
              <Card className="bg-white/5 backdrop-blur-sm border border-white/10 shadow-lg">
                <CardContent className="p-8 text-center">
                  <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
                    <Music className="w-10 h-10 text-white/60" />
                  </div>
                  <h3 className="font-['Inter',sans-serif] font-bold text-white text-lg mb-2 tracking-tight">
                    No songs found
                  </h3>
                  <p className="font-['Inter',sans-serif] text-white/70 text-sm">
                    This genre doesn&apos;t have any songs yet
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {songs.map((song) => (
                  <Card
                    key={song.id}
                    className="bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 active:scale-[0.99] shadow-lg hover:shadow-xl"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => handlePlaySong(song)}
                          disabled={!song.audioUrl}
                          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 shadow-md ${
                            !song.audioUrl
                              ? 'opacity-50 cursor-not-allowed bg-white/10 text-white/60'
                              : currentSong?.id === song.id && isPlaying
                                ? 'bg-[#309605] text-white hover:bg-[#3ba208] active:scale-95'
                                : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white active:scale-95'
                          }`}
                        >
                          {currentSong?.id === song.id && isPlaying ? (
                            <Pause className="w-5 h-5 fill-white" />
                          ) : (
                            <Play className="w-5 h-5 ml-1 fill-current" />
                          )}
                        </button>

                        <div className="w-12 h-12 rounded-lg bg-white/10 flex-shrink-0 overflow-hidden shadow-md">
                          {song.coverImageUrl ? (
                            <img
                              src={song.coverImageUrl}
                              alt={song.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Music className="w-6 h-6 text-white/60" />
                            </div>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <h4 className="font-['Inter',sans-serif] font-semibold text-white text-base line-clamp-1">
                            {song.title}
                          </h4>
                          <div className="font-['Inter',sans-serif] text-white/70 text-sm flex items-center gap-2 line-clamp-1">
                            {song.artistId ? (
                              <Link
                                to={`/user/${song.artistId}`}
                                className="hover:text-white hover:underline transition-colors duration-200 truncate"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {song.artist}
                              </Link>
                            ) : (
                              <span className="truncate">{song.artist}</span>
                            )}
                            {song.artistId && isAuthenticated && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  handleToggleFollow(song.artistId);
                                }}
                                className="inline-flex flex-shrink-0"
                              >
                                {followingArtists[song.artistId] ? (
                                  <UserMinus className="w-3.5 h-3.5 text-[#309605] hover:text-[#3ba208] transition-colors duration-200" />
                                ) : (
                                  <UserPlus className="w-3.5 h-3.5 text-white/60 hover:text-[#309605] transition-colors duration-200" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              handleToggleFavorite(song.id);
                            }}
                            className="p-2 hover:bg-white/10 rounded-full transition-colors duration-200 active:scale-95"
                          >
                            <Heart className={`w-4 h-4 ${song.isFavorited ? 'text-red-500 fill-red-500' : 'text-white'}`} />
                          </button>

                          <button
                            onClick={() => handleShareSong(song.id, song.title, song.artist)}
                            className="p-2 hover:bg-white/10 rounded-full transition-colors duration-200 active:scale-95"
                          >
                            <Share2 className="w-4 h-4 text-white/60" />
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
      </div>

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => setShowAuthModal(false)}
        />
      )}
    </>
  );
};
