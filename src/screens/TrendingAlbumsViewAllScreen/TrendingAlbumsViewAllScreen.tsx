import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Play, Heart, Share2, Flame, Album as AlbumIcon } from 'lucide-react';
import { LazyImage } from '../../components/LazyImage';
import { Skeleton } from '../../components/ui/skeleton';
import { supabase, getFollowerCount } from '../../lib/supabase';
import { shareAlbum } from '../../lib/shareService';
import { favoritesCache } from '../../lib/favoritesCache';
import { useNavigate } from 'react-router-dom';
import { getPromotedContentForSection, recordPromotedContentClick } from '../../lib/promotionHelper';

interface AlbumTrack {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  duration: number;
  audioUrl: string | null;
  coverImageUrl?: string | null;
  featuredArtists?: string[];
  trackNumber: number;
  playCount: number;
}

interface TrendingAlbum {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  coverImageUrl: string | null;
  releaseDate?: string;
  description?: string;
  totalPlays: number;
  trackCount: number;
  totalDuration: number;
  tracks: AlbumTrack[];
  followerCount?: number;
  playCount: number;
  isPromoted?: boolean;
}

interface Genre {
  id: string;
  name: string;
}

export const TrendingAlbumsViewAllScreen = (): JSX.Element => {
  const navigate = useNavigate();
  const [topTenAlbums, setTopTenAlbums] = useState<TrendingAlbum[]>([]);
  const [additionalAlbums, setAdditionalAlbums] = useState<TrendingAlbum[]>([]);
  const [isLoadingTopTen, setIsLoadingTopTen] = useState(true);
  const [isLoadingAdditional, setIsLoadingAdditional] = useState(true);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string>('all');
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFavorited, setIsFavorited] = useState<Record<string, boolean>>(() => {
    return favoritesCache.getAllFavoritesMap().albums;
  });
  const carouselRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const mouseStartX = useRef<number>(0);
  const dragStartTime = useRef<number>(0);
  const hasMoved = useRef<boolean>(false);

  useEffect(() => {
    fetchGenres();
    fetchTopTenAlbums();
    fetchAdditionalAlbums();
    checkFavorites();
  }, []);

  useEffect(() => {
    fetchTopTenAlbums();
    fetchAdditionalAlbums();
  }, [selectedGenre]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkFavorites();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const fetchGenres = async () => {
    try {
      const { data, error } = await supabase
        .from('genres')
        .select('id, name')
        .order('name', { ascending: true });

      if (error) throw error;
      setGenres(data || []);
    } catch (err) {
      console.error('Error fetching genres:', err);
    }
  };

  const checkFavorites = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data, error } = await supabase
        .from('album_favorites')
        .select('album_id')
        .eq('user_id', session.user.id);

      if (error) throw error;

      const albumIds = data?.map(fav => fav.album_id) || [];
      favoritesCache.updateFromServer({ albums: albumIds });

      const favMap: Record<string, boolean> = {};
      data?.forEach(fav => {
        favMap[fav.album_id] = true;
      });
      setIsFavorited(favMap);
    } catch (err) {
      console.error('Error checking favorites:', err);
    }
  };

  const fetchTopTenAlbums = async () => {
    setIsLoadingTopTen(true);

    try {
      let query = supabase
        .from('albums')
        .select(`
          id,
          title,
          cover_image_url,
          release_date,
          description,
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
          ),
          songs:songs!album_id (
            id,
            title,
            duration_seconds,
            audio_url,
            cover_image_url,
            play_count,
            created_at
          )
        `)
        .order('created_at', { ascending: false })
        .limit(10);

      if (selectedGenre !== 'all') {
        const { data: albumGenres } = await supabase
          .from('album_genres')
          .select('album_id')
          .eq('genre_id', selectedGenre);

        if (albumGenres && albumGenres.length > 0) {
          const albumIds = albumGenres.map(ag => ag.album_id);
          query = query.in('id', albumIds);
        } else {
          setTopTenAlbums([]);
          setIsLoadingTopTen(false);
          return;
        }
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      const processedAlbums: TrendingAlbum[] = [];

      for (const album of data || []) {
        const albumArtists = album.artists as any;
        const artistUserId = Array.isArray(albumArtists)
          ? albumArtists[0]?.artist_profiles?.[0]?.user_id || null
          : albumArtists?.artist_profiles?.[0]?.user_id || null;
        const artistName = Array.isArray(albumArtists)
          ? albumArtists[0]?.name || 'Unknown Artist'
          : albumArtists?.name || 'Unknown Artist';

        const tracks: AlbumTrack[] = album.songs?.map((song: any, index: number) => ({
          id: song.id,
          title: song.title,
          artist: artistName,
          artistId: artistUserId,
          duration: song.duration_seconds || 0,
          audioUrl: song.audio_url,
          coverImageUrl: song.cover_image_url || album.cover_image_url,
          trackNumber: index + 1,
          featuredArtists: [],
          playCount: song.play_count || 0
        })) || [];

        const totalPlays = tracks.reduce((sum, track) => sum + track.playCount, 0);
        const totalDuration = tracks.reduce((sum, track) => sum + track.duration, 0);

        if (tracks.length > 0) {
          let followerCount = 0;
          if (artistUserId) {
            try {
              followerCount = await getFollowerCount(artistUserId);
            } catch (error) {
              console.warn('Error fetching follower count:', error);
            }
          }

          processedAlbums.push({
            id: album.id,
            title: album.title,
            artist: artistName,
            artistId: artistUserId,
            coverImageUrl: album.cover_image_url,
            releaseDate: album.release_date,
            description: album.description,
            totalPlays,
            trackCount: tracks.length,
            totalDuration,
            tracks,
            followerCount,
            playCount: totalPlays
          });
        }
      }

      const sortedAlbums = processedAlbums.sort((a, b) => b.totalPlays - a.totalPlays);

      const promotedAlbumIds = await getPromotedContentForSection('trending_album', 'album');

      const albumsWithPromotion = sortedAlbums.map(album => ({
        ...album,
        isPromoted: promotedAlbumIds.includes(album.id)
      }));

      setTopTenAlbums(albumsWithPromotion);
      setCurrentCardIndex(0);
    } catch (err) {
      console.error("Error fetching top 10 albums:", err);
    } finally {
      setIsLoadingTopTen(false);
    }
  };

  const fetchAdditionalAlbums = async () => {
    setIsLoadingAdditional(true);

    try {
      let query = supabase
        .from('albums')
        .select(`
          id,
          title,
          cover_image_url,
          release_date,
          description,
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
          ),
          songs:songs!album_id (
            id,
            title,
            duration_seconds,
            audio_url,
            cover_image_url,
            play_count,
            created_at
          )
        `)
        .order('created_at', { ascending: false })
        .range(10, 49);

      if (selectedGenre !== 'all') {
        const { data: albumGenres } = await supabase
          .from('album_genres')
          .select('album_id')
          .eq('genre_id', selectedGenre);

        if (albumGenres && albumGenres.length > 0) {
          const albumIds = albumGenres.map(ag => ag.album_id);
          query = query.in('id', albumIds);
        } else {
          setAdditionalAlbums([]);
          setIsLoadingAdditional(false);
          return;
        }
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      const processedAlbums: TrendingAlbum[] = [];

      for (const album of data || []) {
        const albumArtists = album.artists as any;
        const artistUserId = Array.isArray(albumArtists)
          ? albumArtists[0]?.artist_profiles?.[0]?.user_id || null
          : albumArtists?.artist_profiles?.[0]?.user_id || null;
        const artistName = Array.isArray(albumArtists)
          ? albumArtists[0]?.name || 'Unknown Artist'
          : albumArtists?.name || 'Unknown Artist';

        const tracks: AlbumTrack[] = album.songs?.map((song: any, index: number) => ({
          id: song.id,
          title: song.title,
          artist: artistName,
          artistId: artistUserId,
          duration: song.duration_seconds || 0,
          audioUrl: song.audio_url,
          coverImageUrl: song.cover_image_url || album.cover_image_url,
          trackNumber: index + 1,
          featuredArtists: [],
          playCount: song.play_count || 0
        })) || [];

        const totalPlays = tracks.reduce((sum, track) => sum + track.playCount, 0);
        const totalDuration = tracks.reduce((sum, track) => sum + track.duration, 0);

        if (tracks.length > 0) {
          let followerCount = 0;
          if (artistUserId) {
            try {
              followerCount = await getFollowerCount(artistUserId);
            } catch (error) {
              console.warn('Error fetching follower count:', error);
            }
          }

          processedAlbums.push({
            id: album.id,
            title: album.title,
            artist: artistName,
            artistId: artistUserId,
            coverImageUrl: album.cover_image_url,
            releaseDate: album.release_date,
            description: album.description,
            totalPlays,
            trackCount: tracks.length,
            totalDuration,
            tracks,
            followerCount,
            playCount: totalPlays
          });
        }
      }

      const sortedAlbums = processedAlbums.sort((a, b) => b.totalPlays - a.totalPlays);

      const promotedAlbumIds = await getPromotedContentForSection('trending_album', 'album');

      const albumsWithPromotion = sortedAlbums.map(album => ({
        ...album,
        isPromoted: promotedAlbumIds.includes(album.id)
      }));

      setAdditionalAlbums(albumsWithPromotion);
    } catch (err) {
      console.error("Error fetching additional albums:", err);
    } finally {
      setIsLoadingAdditional(false);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('svg') || target.closest('path')) {
      return;
    }
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = e.touches[0].clientX;
    dragStartTime.current = Date.now();
    hasMoved.current = false;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;

    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('svg') || target.closest('path')) {
      setIsDragging(false);
      setDragOffset(0);
      return;
    }

    touchEndX.current = e.touches[0].clientX;
    const diff = touchEndX.current - touchStartX.current;

    if (Math.abs(diff) > 5) {
      hasMoved.current = true;
    }

    const maxDrag = 200;
    const limitedDiff = Math.max(-maxDrag, Math.min(maxDrag, diff));

    setDragOffset(limitedDiff);
  };

  const handleTouchEnd = () => {
    if (!isDragging) return;

    const swipeThreshold = 75;
    const velocityThreshold = 5;
    const swipeDistance = touchStartX.current - touchEndX.current;
    const shouldSwipeNext = swipeDistance > swipeThreshold || (swipeDistance > 30 && Math.abs(dragOffset) > velocityThreshold);
    const shouldSwipePrev = swipeDistance < -swipeThreshold || (swipeDistance < -30 && Math.abs(dragOffset) > velocityThreshold);

    setIsDragging(false);

    if (hasMoved.current && (shouldSwipeNext || shouldSwipePrev)) {
      if (shouldSwipeNext) {
        handleNextCard();
      } else if (shouldSwipePrev) {
        handlePrevCard();
      }
    }

    setDragOffset(0);
    touchStartX.current = 0;
    touchEndX.current = 0;
    hasMoved.current = false;
  };

  const handleNextCard = () => {
    if (currentCardIndex < topTenAlbums.length - 1) {
      setCurrentCardIndex(prev => prev + 1);
    }
  };

  const handlePrevCard = () => {
    if (currentCardIndex > 0) {
      setCurrentCardIndex(prev => prev - 1);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('svg') || target.closest('path')) {
      return;
    }
    mouseStartX.current = e.clientX;
    touchStartX.current = e.clientX;
    dragStartTime.current = Date.now();
    hasMoved.current = false;
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;

    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('svg') || target.closest('path')) {
      setIsDragging(false);
      setDragOffset(0);
      return;
    }

    const diff = e.clientX - touchStartX.current;

    if (Math.abs(diff) > 5) {
      hasMoved.current = true;
    }

    const maxDrag = 200;
    const limitedDiff = Math.max(-maxDrag, Math.min(maxDrag, diff));

    setDragOffset(limitedDiff);
  };

  const handleMouseUp = () => {
    if (!isDragging) return;

    const swipeThreshold = 75;
    const velocityThreshold = 5;
    const swipeDistance = -dragOffset;
    const shouldSwipeNext = swipeDistance > swipeThreshold || (swipeDistance > 30 && Math.abs(dragOffset) > velocityThreshold);
    const shouldSwipePrev = swipeDistance < -swipeThreshold || (swipeDistance < -30 && Math.abs(dragOffset) > velocityThreshold);

    setIsDragging(false);

    if (hasMoved.current && (shouldSwipeNext || shouldSwipePrev)) {
      if (shouldSwipeNext) {
        handleNextCard();
      } else if (shouldSwipePrev) {
        handlePrevCard();
      }
    }

    setDragOffset(0);
    touchStartX.current = 0;
    hasMoved.current = false;
  };

  const handlePlayAlbum = async (album: TrendingAlbum) => {
    if (!album.tracks || album.tracks.length === 0) {
      alert('This album has no playable tracks.');
      return;
    }

    const playableTracks = album.tracks.filter(track => track.audioUrl);
    if (playableTracks.length === 0) {
      alert('This album is not available for playback.');
      return;
    }

    if (album.isPromoted) {
      await recordPromotedContentClick(album.id, 'trending_album', 'album');
    }

    // Navigate to AlbumPlayerScreen
    navigate(`/album/${album.id}`);
  };

  const handleToggleFavorite = async (albumId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const isFav = isFavorited[albumId];

      if (isFav) {
        await supabase
          .from('album_favorites')
          .delete()
          .eq('user_id', session.user.id)
          .eq('album_id', albumId);
      } else {
        await supabase
          .from('album_favorites')
          .insert({ user_id: session.user.id, album_id: albumId });
      }

      setIsFavorited(prev => ({ ...prev, [albumId]: !isFav }));
    } catch (err) {
      console.error('Error toggling favorite:', err);
    }
  };

  const handleShare = async (album: TrendingAlbum, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await shareAlbum(album.id, album.title, album.artist);
    } catch (error) {
      console.error('Error sharing album:', error);
    }
  };

  const formatPlayCount = (count: number): string => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  const currentAlbum = topTenAlbums[currentCardIndex];
  const prevAlbum = currentCardIndex > 0 ? topTenAlbums[currentCardIndex - 1] : null;
  const nextAlbum = currentCardIndex < topTenAlbums.length - 1 ? topTenAlbums[currentCardIndex + 1] : null;

  const getSelectedGenreName = () => {
    if (selectedGenre === 'all') return 'Overall';
    const genre = genres.find(g => g.id === selectedGenre);
    return genre ? genre.name : 'Overall';
  };

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav overflow-y-auto">
      <header className="w-full py-4 px-5 sticky top-0 z-20 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="p-2 hover:bg-white/10 rounded-full transition-all"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="font-bold text-lg">Trending Albums</h1>
          <div className="w-10"></div>
        </div>
      </header>

      <div className="px-5 py-4 overflow-x-auto scrollbar-hide">
        <div className="flex gap-3 min-w-max">
          <button
            onClick={() => setSelectedGenre('all')}
            className={`px-6 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
              selectedGenre === 'all'
                ? 'bg-white text-black'
                : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            All
          </button>
          {genres.map((genre) => (
            <button
              key={genre.id}
              onClick={() => setSelectedGenre(genre.id)}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                selectedGenre === genre.id
                  ? 'bg-white text-black'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              {genre.name}
            </button>
          ))}
        </div>
      </div>

      {isLoadingTopTen ? (
        <div className="px-5 py-6">
          <div className="relative h-[380px] mb-6">
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[85%] max-w-sm h-[360px]">
              <Skeleton variant="rectangular" className="w-full h-full rounded-3xl bg-white/10" />
            </div>
          </div>
          <div className="flex justify-center gap-2 mb-8">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} variant="rectangular" className="h-1.5 w-1.5 rounded-full bg-white/20" />
            ))}
          </div>
          <div className="mt-6">
            <Skeleton variant="text" className="h-6 w-48 mb-4 bg-white/10" />
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i}>
                  <Skeleton variant="rectangular" className="w-full aspect-square rounded-lg mb-2 bg-white/10" />
                  <Skeleton variant="text" className="h-3 w-full mb-1 bg-white/10" />
                  <Skeleton variant="text" className="h-2 w-3/4 bg-white/10" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : topTenAlbums.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center">
            <h3 className="font-semibold text-lg text-gray-300 mb-2">No Albums Found</h3>
            <p className="text-gray-500 text-sm">No albums available in this category</p>
          </div>
        </div>
      ) : (
        <>
          <div className="px-5 py-6 relative">
            <div
              ref={carouselRef}
              className="relative h-[380px] perspective-1000"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              {prevAlbum && (
                <div
                  key={`prev-${prevAlbum.id}`}
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-32 h-[300px] z-0 blur-sm"
                  style={{
                    opacity: dragOffset > 0 ? Math.min(0.8, 0.5 + (dragOffset / 200) * 0.3) : 0.5,
                    transform: `translateY(-50%) scale(${1 + Math.max(0, dragOffset / 400)})`,
                    transition: isDragging ? 'none' : 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  }}
                >
                  <LazyImage
                    src={prevAlbum.coverImageUrl || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
                    alt={prevAlbum.title}
                    className="w-full h-full object-cover rounded-2xl"
                  />
                </div>
              )}

              {currentAlbum && (
                <div
                  key={`current-${currentAlbum.id}`}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[85%] max-w-sm h-[360px] z-10 cursor-pointer"
                  style={{
                    transform: `translate(-50%, -50%) translateX(${dragOffset}px) rotate(${dragOffset * 0.05}deg)`,
                    transition: isDragging ? 'none' : 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  }}
                  onClick={() => !isDragging && handlePlayAlbum(currentAlbum)}
                >
                  <div className="relative w-full h-full rounded-3xl overflow-hidden shadow-2xl">
                    <LazyImage
                      src={currentAlbum.coverImageUrl || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
                      alt={currentAlbum.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent"></div>

                    {currentAlbum.isPromoted && (
                      <div className="absolute top-4 left-4 px-3 py-1.5 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full shadow-lg flex items-center gap-1.5">
                        <Flame className="w-3.5 h-3.5 text-white" />
                        <span className="text-xs font-semibold text-white">Promoted</span>
                      </div>
                    )}

                    <div className="absolute bottom-0 left-0 right-0 p-6">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex-1 pr-3">
                          <h2 className="text-white text-lg font-bold drop-shadow-lg line-clamp-1">{currentAlbum.title}</h2>
                          <p className="text-white/80 text-sm drop-shadow-lg line-clamp-1">{currentAlbum.artist}</p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handlePlayAlbum(currentAlbum);
                          }}
                          onTouchStart={(e) => e.stopPropagation()}
                          onTouchMove={(e) => e.stopPropagation()}
                          onTouchEnd={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handlePlayAlbum(currentAlbum);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="w-14 h-14 rounded-full bg-white flex items-center justify-center active:scale-95 transition-transform shadow-xl flex-shrink-0 z-20"
                        >
                          <Play className="w-6 h-6 text-black ml-1" fill="black" />
                        </button>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5 text-white/80">
                          <AlbumIcon className="w-4 h-4" />
                          <span className="text-sm">{currentAlbum.trackCount} tracks</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-white/80">
                          <Play className="w-4 h-4" />
                          <span className="text-sm">{formatPlayCount(currentAlbum.playCount)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {nextAlbum && (
                <div
                  key={`next-${nextAlbum.id}`}
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-32 h-[300px] z-0 blur-sm"
                  style={{
                    opacity: dragOffset < 0 ? Math.min(0.8, 0.5 + (Math.abs(dragOffset) / 200) * 0.3) : 0.5,
                    transform: `translateY(-50%) scale(${1 + Math.max(0, Math.abs(dragOffset) / 400)})`,
                    transition: isDragging ? 'none' : 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  }}
                >
                  <LazyImage
                    src={nextAlbum.coverImageUrl || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
                    alt={nextAlbum.title}
                    className="w-full h-full object-cover rounded-2xl"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-center gap-2 mt-6">
              {topTenAlbums.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentCardIndex(index)}
                  className={`h-1.5 rounded-full transition-all ${
                    index === currentCardIndex
                      ? 'w-8 bg-white'
                      : 'w-1.5 bg-white/30'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="px-5 py-6">
            <h2 className="text-xl font-bold mb-4">More Trending {getSelectedGenreName()} Albums</h2>
            {isLoadingAdditional ? (
              <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i}>
                    <Skeleton variant="rectangular" className="w-full aspect-square rounded-lg mb-2 bg-white/10" />
                    <Skeleton variant="text" className="h-3 w-full mb-1 bg-white/10" />
                    <Skeleton variant="text" className="h-2 w-3/4 bg-white/10" />
                  </div>
                ))}
              </div>
            ) : additionalAlbums.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-gray-500 text-sm">No more albums available</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {additionalAlbums.map((album) => (
                  <div
                    key={album.id}
                    onClick={() => handlePlayAlbum(album)}
                    className="cursor-pointer group"
                  >
                    <div className="relative w-full aspect-square rounded-lg overflow-hidden mb-2 bg-white/5">
                      <LazyImage
                        src={album.coverImageUrl || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
                        alt={album.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-300 flex items-center justify-center">
                        <Play className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300" fill="white" />
                      </div>
                      {album.isPromoted && (
                        <div className="absolute top-1.5 right-1.5 p-1 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full shadow-lg">
                          <Flame className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </div>

                    <div className="text-left">
                      <h3 className="text-xs font-semibold text-white truncate mb-0.5">{album.title}</h3>
                      <p className="text-[10px] text-gray-400 truncate">{album.artist}</p>
                      <p className="text-[10px] text-gray-500">{album.trackCount} tracks</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
