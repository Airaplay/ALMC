import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "../../../../components/ui/card";
import { ScrollArea, ScrollBar } from "../../../../components/ui/scroll-area";
import { Album as AlbumIcon, RefreshCw, Flame } from "lucide-react";
import { LazyImage } from "../../../../components/LazyImage";
import { supabase } from "../../../../lib/supabase";
import { Link, useNavigate } from "react-router-dom";
import { getPromotedContentForSection, recordPromotedContentClick } from "../../../../lib/promotionHelper";
import { albumCache } from "../../../../lib/albumCache";
import { persistentCache } from "../../../../lib/persistentCache";
import { useEngagementSync } from "../../../../hooks/useEngagementSync";
import { useUserCountry } from "../../../../hooks/useUserCountry";

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

interface TrendingAlbumsSectionProps {
  // No props needed for this section
}

const CACHE_KEY = 'trending_albums_section';

const blinkStyle = `
  @keyframes lightBlink {
    0%, 49% {
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
    }
    50%, 100% {
      box-shadow: 0 10px 25px -5px rgba(255, 255, 255, 0.15);
    }
  }

  .blink-effect {
    animation: lightBlink 0.6s ease-out;
  }
`;

if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = blinkStyle;
  document.head.appendChild(style);
}

export const TrendingAlbumsSection = ({}: TrendingAlbumsSectionProps): JSX.Element => {
  const [trendingAlbums, setTrendingAlbums] = useState<TrendingAlbum[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [originalAlbums, setOriginalAlbums] = useState<TrendingAlbum[]>([]);
  const [activeBlink, setActiveBlink] = useState<string | null>(null);
  const isInitialMount = useRef(true);
  const navigate = useNavigate();
  const { countryCode } = useUserCountry();

  // Real-time engagement sync for album play counts
  useEngagementSync(useCallback((update) => {
    if (update.contentType === 'album' && update.metric === 'play_count') {
      setTrendingAlbums(prevAlbums =>
        prevAlbums.map(album =>
          album.id === update.contentId
            ? { ...album, playCount: update.value }
            : album
        )
      );
      setOriginalAlbums(prevAlbums =>
        prevAlbums.map(album =>
          album.id === update.contentId
            ? { ...album, playCount: update.value }
            : album
        )
      );
    }
  }, []));

  // Load cached albums on mount
  useEffect(() => {
    const loadCached = async () => {
      if (isInitialMount.current) {
        const cached = await persistentCache.get<TrendingAlbum[]>(CACHE_KEY);
        if (cached && cached.length > 0) {
          setTrendingAlbums(cached);
          setOriginalAlbums(cached);
          setIsLoading(false);
        }
        isInitialMount.current = false;
      }
    };

    loadCached();
  }, []);

  useEffect(() => {
    fetchTrendingAlbums();
  }, [countryCode]);

  useEffect(() => {
    if (originalAlbums.length === 0) return;

    const shuffleInterval = setInterval(() => {
      const shuffled = [...originalAlbums].sort(() => Math.random() - 0.5);
      setTrendingAlbums(shuffled);
    }, 10 * 60 * 1000);

    return () => clearInterval(shuffleInterval);
  }, [originalAlbums]);

  const fetchTrendingAlbums = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Use the RPC which reads min_play_count and time_window_days from admin threshold settings
      const { data: rpcData, error: rpcError } = await supabase
        .rpc('get_trending_albums', { days_param: null, limit_param: 50 });

      if (rpcError) throw rpcError;

      if (!rpcData || rpcData.length === 0) {
        setTrendingAlbums([]);
        return;
      }

      // Fetch track details for all returned albums in one query
      const albumIds = rpcData.map((a: any) => a.id);
      const { data: songsData } = await supabase
        .from('songs')
        .select('id, title, duration_seconds, audio_url, cover_image_url, play_count, album_id')
        .in('album_id', albumIds);

      const songsByAlbum: Record<string, any[]> = {};
      for (const song of songsData || []) {
        if (!songsByAlbum[song.album_id]) songsByAlbum[song.album_id] = [];
        songsByAlbum[song.album_id].push(song);
      }

      const processedAlbums: TrendingAlbum[] = rpcData.map((album: any) => {
        const albumSongs = songsByAlbum[album.id] || [];
        const tracks: AlbumTrack[] = albumSongs.map((song: any, index: number) => ({
          id: song.id,
          title: song.title,
          artist: album.artist_name || 'Unknown Artist',
          artistId: album.artist_user_id || null,
          duration: song.duration_seconds || 0,
          audioUrl: song.audio_url,
          coverImageUrl: song.cover_image_url || album.cover_image_url,
          trackNumber: index + 1,
          featuredArtists: [],
          playCount: song.play_count || 0
        }));

        const totalDuration = tracks.reduce((sum, t) => sum + t.duration, 0);

        return {
          id: album.id,
          title: album.title,
          artist: album.artist_name || 'Unknown Artist',
          artistId: album.artist_user_id || null,
          coverImageUrl: album.cover_image_url,
          releaseDate: album.release_date,
          description: album.description,
          totalPlays: Number(album.total_plays) || 0,
          trackCount: Number(album.track_count) || tracks.length,
          totalDuration,
          tracks,
          followerCount: 0,
          playCount: Number(album.total_plays) || 0,
        } as TrendingAlbum;
      });

      const promoted = await getPromotedContentForSection('trending_album', 'album');

      const sortedAlbums = processedAlbums.slice(0, 20);

      // Mark promoted albums
      const albumsWithPromotion = sortedAlbums.map(album => ({
        ...album,
        isPromoted: promoted.includes(album.id)
      }));

      // Separate promoted and non-promoted albums
      const promotedAlbums = albumsWithPromotion.filter(album => album.isPromoted);
      const nonPromotedAlbums = albumsWithPromotion.filter(album => !album.isPromoted);

      let finalAlbums: TrendingAlbum[];

      // ONLY ONE PROMOTION PER CYCLE - place it randomly at position 1, 2, or 3
      if (promotedAlbums.length > 0) {
        // Take only the first promoted album (one per cycle)
        const singlePromotedAlbum = promotedAlbums[0];

        // Randomly choose position 0, 1, or 2 (displayed as 1st, 2nd, or 3rd card)
        const randomPosition = Math.floor(Math.random() * 3);

        console.log(`[TrendingAlbums] Placing promoted album at position ${randomPosition + 1}`);

        // Build final array with promotion at random position
        finalAlbums = [];
        let nonPromotedIndex = 0;

        for (let i = 0; i < 20; i++) {
          if (i === randomPosition) {
            // Insert promoted album at this position
            finalAlbums.push(singlePromotedAlbum);
          } else if (nonPromotedIndex < nonPromotedAlbums.length) {
            // Fill with non-promoted albums
            finalAlbums.push(nonPromotedAlbums[nonPromotedIndex]);
            nonPromotedIndex++;
          }
        }
      } else {
        // No promotions, just use non-promoted albums
        finalAlbums = nonPromotedAlbums;
      }

      console.log('[TrendingAlbums] Final album order:', finalAlbums.map(a => ({ id: a.id, title: a.title, isPromoted: a.isPromoted })));

      setOriginalAlbums(finalAlbums);
      setTrendingAlbums(finalAlbums);
      // Cache albums for 15 minutes
      await persistentCache.set(CACHE_KEY, finalAlbums, 15 * 60 * 1000);
    } catch (err) {
      console.error("Error fetching trending albums:", err);
      setError("Failed to load trending albums");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlayAlbum = async (album: TrendingAlbum) => {
    setActiveBlink(album.id);
    setTimeout(() => setActiveBlink(null), 600);

    if (!album.tracks || album.tracks.length === 0) {
      alert("This album has no playable tracks.");
      return;
    }

    // Check if any tracks have audio URLs
    const playableTracks = album.tracks.filter(track => track.audioUrl);
    if (playableTracks.length === 0) {
      alert("This album is not available for playback.");
      return;
    }

    // Track click if this is promoted content
    if (album.isPromoted) {
      await recordPromotedContentClick(album.id, 'trending_album', 'album');
    }

    // Navigate to AlbumPlayerScreen
    navigate(`/album/${album.id}`);
  };

  const handleAlbumHover = (albumId: string) => {
    // Prefetch album data on hover for instant loading
    albumCache.prefetch(albumId);
  };

  const handleRefresh = () => {
    fetchTrendingAlbums();
  };

  // Fallback albums for visual reference when no data is available
  const fallbackAlbums: TrendingAlbum[] = [
    {
      id: "trending-album-fallback-1",
      title: "Greatest Hits",
      artist: "Popular Artist",
      artistId: null,
      coverImageUrl: "https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400",
      totalPlays: 5000,
      trackCount: 12,
      totalDuration: 2400,
      tracks: [],
      followerCount: 0,
      playCount: 5000
    },
    {
      id: "trending-album-fallback-2",
      title: "Summer Vibes",
      artist: "Trending Artist",
      artistId: null,
      coverImageUrl: "https://images.pexels.com/photos/167636/pexels-photo-167636.jpeg?auto=compress&cs=tinysrgb&w=400",
      totalPlays: 4200,
      trackCount: 10,
      totalDuration: 2100,
      tracks: [],
      followerCount: 0,
      playCount: 4200
    },
    {
      id: "trending-album-fallback-3",
      title: "Midnight Sessions",
      artist: "Rising Star",
      artistId: null,
      coverImageUrl: "https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=400",
      totalPlays: 3800,
      trackCount: 8,
      totalDuration: 1800,
      tracks: [],
      followerCount: 0,
      playCount: 3800
    }
  ];

  // Display fallback items if loading, error, or no data
  const displayItems = isLoading || error || trendingAlbums.length === 0 
    ? fallbackAlbums 
    : trendingAlbums;

  return (
    <section className="w-full py-6 px-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl tracking-tight">
          Trending Albums
        </h2>

        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/trending-albums')}
            className="font-['Inter',sans-serif] text-white hover:text-white/80 text-sm font-medium transition-colors duration-200"
          >
            View All
          </button>
        </div>
      </div>

      {isLoading ? (
        <ScrollArea className="w-full">
          <div className="grid grid-rows-2 grid-flow-col gap-3 pb-4">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="w-[110px] animate-pulse">
                <div className="bg-[#181818] rounded-xl overflow-hidden">
                  <div className="w-[110px] h-[110px] bg-[#282828]"></div>
                </div>
                <div className="mt-3">
                  <div className="h-3 bg-[#282828] rounded mb-1"></div>
                  <div className="h-2 bg-[#282828] rounded w-3/4"></div>
                </div>
              </div>
            ))}
          </div>
          <ScrollBar orientation="horizontal" className="opacity-0" />
        </ScrollArea>
      ) : error ? (
        <div className="p-4 bg-red-500/20 border border-red-500/30 rounded-lg text-center">
          <p className="font-['Inter',sans-serif] text-red-400 text-sm">
            {error}
          </p>
          <button
            onClick={handleRefresh}
            className="mt-2 px-4 py-2 bg-red-500/30 hover:bg-red-500/40 rounded-lg text-red-400 text-sm transition-colors duration-200 flex items-center gap-2 mx-auto"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        </div>
      ) : trendingAlbums.length === 0 ? (
        <div className="p-4 bg-white/5 rounded-lg text-center">
          <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-3">
            <AlbumIcon className="w-6 h-6 text-white/60" />
          </div>
          <h3 className="font-['Inter',sans-serif] font-semibold text-white text-base mb-2">
            No Trending Albums Yet
          </h3>
          <p className="font-['Inter',sans-serif] text-white/70 text-sm">
            Albums will appear here as users start listening to content
          </p>
        </div>
      ) : (
        <ScrollArea className="w-full">
          <div className="grid grid-rows-2 grid-flow-col gap-4 pb-4">
            {displayItems.map((album, index) => (
              <Card
                key={`${album.id}-${index}`}
                className="w-[110px] bg-transparent border-none shadow-none group cursor-pointer active:scale-95 transition-transform duration-150"
                onClick={() => handlePlayAlbum(album)}
                onMouseEnter={() => handleAlbumHover(album.id)}
                onTouchStart={() => handleAlbumHover(album.id)}
              >
                <CardContent className="p-0">
                  <div className={`relative w-[110px] h-[110px] bg-cover bg-center rounded-xl overflow-hidden shadow-lg group-active:shadow-2xl transition-all duration-200 ${activeBlink === album.id ? 'blink-effect' : ''}`}>
                    <LazyImage
                      src={album.coverImageUrl || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
                      alt={album.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/30 group-active:bg-black/20 transition-colors duration-200"></div>

                    {/* Promoted Badge */}
                    {trendingAlbums.length > 0 && album.isPromoted && (
                      <div className="absolute top-1.5 right-1.5 p-1 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full shadow-lg">
                        <Flame className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </div>

                  <div className="w-[110px] mt-3">
                    <p className="font-['Inter',sans-serif] font-bold text-left text-white/90 text-xs leading-tight group-active:text-white transition-colors duration-200 line-clamp-1 mb-1">
                      {album.title}
                    </p>
                    <p className="font-['Inter',sans-serif] text-left text-white/60 text-xs leading-tight line-clamp-1">
                      {album.artistId ? (
                        <Link
                          to={`/user/${album.artistId}`}
                          className="active:text-orange-400 transition-colors duration-200"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {album.artist}
                        </Link>
                      ) : (
                        album.artist
                      )}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <ScrollBar orientation="horizontal" className="opacity-0" />
        </ScrollArea>
      )}
    </section>
  );
};