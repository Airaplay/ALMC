import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Card, CardContent } from "../../../../components/ui/card";
import { ScrollArea, ScrollBar } from "../../../../components/ui/scroll-area";
import { Flame } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { mergeTrendingContentWithPromotions } from "../../../../lib/trendingPromotionSlots";
import { recordPromotedContentClick } from "../../../../lib/promotionHelper";
import { useHomeScreenData } from "../../../../contexts/HomeScreenDataContext";
import { getManualTrendingSongs } from "../../../../lib/supabase";
import { persistentCache } from "../../../../lib/persistentCache";
import { useEngagementSync } from "../../../../hooks/useEngagementSync";

// Performance constants
const QUERY_TIMEOUT_MS = 3000; // 3 seconds max per query
const PROCESSING_TIMEOUT_MS = 4000; // 4 seconds max for entire processing

// Query timeout wrapper
const withTimeout = <T extends unknown>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Query timeout')), timeoutMs)
    )
  ]);
};

interface Song {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  coverImageUrl?: string | null;
  audioUrl?: string | null;
  videoUrl?: string | null;
  duration?: number;
  playCount?: number;
  featuredArtists?: string[] | null;
}

interface TrendingSong {
  id: string;
  title: string;
  artist: string;
  artist_id: string;
  artist_user_id: string | null;
  cover_image_url: string | null;
  audio_url: string | null;
  duration_seconds: number;
  play_count: number;
  isPromoted?: boolean;
  featured_artists?: string[] | null;
}

interface TrendingSectionProps {
  onOpenMusicPlayer: (song: Song, playlist?: Song[], context?: string) => void;
}

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

const CACHE_KEY = 'trending_section_processed';

export const TrendingSection = ({ onOpenMusicPlayer }: TrendingSectionProps): JSX.Element => {
  const navigate = useNavigate();
  const { data, isLoading: dataLoading } = useHomeScreenData();
  const [trendingSongs, setTrendingSongs] = useState<TrendingSong[]>([]);
  const [isProcessingPromotions, setIsProcessingPromotions] = useState(false);
  const [activeBlink, setActiveBlink] = useState<string | null>(null);
  const [lastProcessedTimestamp, setLastProcessedTimestamp] = useState<number>(0);
  const isInitialMount = useRef(true);

  // Real-time engagement sync
  useEngagementSync(useCallback((update) => {
    if (update.contentType === 'song' && update.metric === 'play_count') {
      setTrendingSongs(prevSongs =>
        prevSongs.map(song =>
          song.id === update.contentId
            ? { ...song, play_count: update.value }
            : song
        )
      );
    }
  }, []));

  const formattedSongs = useMemo(() => {
    if (!data?.trendingSongs) return [];

    return data.trendingSongs.map((song: any) => ({
      id: song.id,
      title: song.title,
      artist: song.artist || song.artists?.artist_profiles?.[0]?.stage_name || song.artists?.artist_profiles?.[0]?.users?.display_name || song.artists?.name || 'Unknown',
      artist_id: song.artist_id || song.artists?.id || '',
      artist_user_id: song.artist_user_id || song.artists?.artist_profiles?.[0]?.user_id || null,
      cover_image_url: song.cover_image_url,
      audio_url: song.audio_url,
      duration_seconds: song.duration_seconds || 0,
      play_count: song.play_count || 0,
      featured_artists: song.featured_artists || null,
    }));
  }, [data?.trendingSongs]);

  // Load cached songs on mount
  useEffect(() => {
    const loadCachedSongs = async () => {
      if (isInitialMount.current) {
        const cached = await persistentCache.get<TrendingSong[]>(CACHE_KEY);
        if (cached && cached.length > 0) {
          setTrendingSongs(cached);
        }
        isInitialMount.current = false;
      }
    };

    loadCachedSongs();
  }, []);

  useEffect(() => {
    const songsToProcess = formattedSongs.slice(0, 25);
    const currentTimestamp = data?.timestamp || 0;

    // Show songs immediately if we have them and trendingSongs is empty
    if (songsToProcess.length > 0 && trendingSongs.length === 0) {
      setTrendingSongs(songsToProcess);
    }

    // Only process promotions if we have new data (timestamp changed) and not already processing
    if (currentTimestamp > 0 && currentTimestamp > lastProcessedTimestamp && !isProcessingPromotions) {
      setIsProcessingPromotions(true);
      setLastProcessedTimestamp(currentTimestamp);
      // Process in background without blocking UI
      processTrendingSongs(songsToProcess).catch(err => {
        console.error("Error processing trending songs:", err);
        setIsProcessingPromotions(false);
      });
    }
  }, [formattedSongs, data?.timestamp]);

  const processTrendingSongs = async (songs: TrendingSong[]) => {
    try {
      // Wrap entire processing in timeout
      await withTimeout(
        (async () => {
          // Fetch manual trending songs and prepare promotion merge in parallel
          const [manualSongsResult, promotionMergeResult] = await Promise.allSettled([
            withTimeout(getManualTrendingSongs('global_trending'), QUERY_TIMEOUT_MS),
            // Pre-fetch promotion data (non-blocking)
            Promise.resolve(null) // Will be handled separately
          ]);

          // Format manual songs if fetch succeeded
          let formattedManualSongs: TrendingSong[] = [];
          if (manualSongsResult.status === 'fulfilled') {
            formattedManualSongs = manualSongsResult.value.map((mts: any) => {
              const song = mts.songs;
              let artistName = 'Unknown';
              if (song.artists?.name) {
                artistName = song.artists.name;
              } else if (song.artists?.artist_profiles?.[0]?.stage_name) {
                artistName = song.artists.artist_profiles[0].stage_name;
              } else if (song.artists?.artist_profiles?.[0]?.users?.display_name) {
                artistName = song.artists.artist_profiles[0].users.display_name;
              }

              return {
                id: song.id,
                title: song.title,
                artist: artistName,
                artist_id: song.artists?.id || '',
                artist_user_id: song.artists?.artist_profiles?.[0]?.user_id || null,
                cover_image_url: song.cover_image_url,
                audio_url: song.audio_url,
                duration_seconds: song.duration_seconds || 0,
                play_count: song.play_count || 0,
              };
            });
          } else {
            console.warn("Manual trending songs fetch failed or timed out:", manualSongsResult.reason);
          }

          // Combine: manual songs first (ordered by display_order), then auto-trending
          // Remove duplicates (manual songs take priority)
          const manualSongIds = new Set(formattedManualSongs.map(s => s.id));
          const autoSongsFiltered = songs.filter(s => !manualSongIds.has(s.id));
          const combinedSongs = [...formattedManualSongs, ...autoSongsFiltered].slice(0, 50);

          // Merge with promotions (with timeout)
          const mergedContent = await withTimeout(
            mergeTrendingContentWithPromotions(
              combinedSongs.slice(0, 25),
              'now_trending',
              'song'
            ),
            QUERY_TIMEOUT_MS
          );

          const songsWithPromotion = mergedContent.map(({ item, isPromoted }) => ({
            ...item,
            isPromoted
          }));

          setTrendingSongs(songsWithPromotion);
          // Cache processed songs for instant loading on next mount
          await persistentCache.set(CACHE_KEY, songsWithPromotion, 30 * 60 * 1000); // 30 minutes
        })(),
        PROCESSING_TIMEOUT_MS
      );
    } catch (err) {
      console.error("Error processing trending songs:", err);
      // Fallback to just auto-trending songs if processing fails
      try {
        const mergedContent = await withTimeout(
          mergeTrendingContentWithPromotions(
            songs.slice(0, 25),
            'now_trending',
            'song'
          ),
          QUERY_TIMEOUT_MS
        );

        const songsWithPromotion = mergedContent.map(({ item, isPromoted }) => ({
          ...item,
          isPromoted
        }));

        setTrendingSongs(songsWithPromotion);
        // Cache processed songs for instant loading on next mount
        await persistentCache.set(CACHE_KEY, songsWithPromotion, 30 * 60 * 1000); // 30 minutes
      } catch (fallbackErr) {
        console.error("Error processing trending songs (fallback):", fallbackErr);
        // If everything fails, at least show the auto-trending songs without promotions
        const fallbackSongs = songs.slice(0, 25).map(song => ({
          ...song,
          isPromoted: false
        }));
        setTrendingSongs(fallbackSongs);
      }
    } finally {
      setIsProcessingPromotions(false);
    }
  };

  const handlePlaySong = async (song: TrendingSong) => {
    setActiveBlink(song.id);
    setTimeout(() => setActiveBlink(null), 600);

    if (!song.audio_url) {
      alert("This song is not available for playback.");
      return;
    }

    if (song.isPromoted) {
      await recordPromotedContentClick(song.id, 'now_trending', 'song');
    }

    console.log('🎵 Playing song from TrendingSection:', {
      id: song.id,
      title: song.title,
      audio_url: song.audio_url,
      hasAudioUrl: !!song.audio_url
    });

    const formattedSong = {
      id: song.id,
      title: song.title,
      artist: song.artist,
      artistId: song.artist_id,
      coverImageUrl: song.cover_image_url,
      audioUrl: song.audio_url,
      duration: song.duration_seconds,
      playCount: song.play_count,
      featuredArtists: song.featured_artists || null
    };

    const formattedPlaylist = trendingSongs
      .filter(s => s.audio_url)
      .map(s => ({
        id: s.id,
        title: s.title,
        artist: s.artist,
        artistId: s.artist_id,
        coverImageUrl: s.cover_image_url,
        audioUrl: s.audio_url,
        duration: s.duration_seconds,
        playCount: s.play_count,
        featuredArtists: s.featured_artists || null
      }));

    onOpenMusicPlayer(formattedSong, formattedPlaylist, 'Global Trending');
  };

  // Only show loading skeleton on very first load when we have absolutely no data
  const isLoading = dataLoading && trendingSongs.length === 0 && formattedSongs.length === 0 && !isInitialMount.current;

  // Hide section only if we truly have no content to display
  if (!isLoading && trendingSongs.length === 0) {
    return <></>;
  }

  return (
    <section className="w-full py-6 px-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl tracking-tight">
         Global Trending
        </h2>

        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/trending')}
            className="font-['Inter',sans-serif] text-white hover:text-white/80 text-sm font-medium transition-colors duration-200"
          >
            View All
          </button>
          </div>
      </div>

      {isLoading ? (
        <ScrollArea className="w-full">
          <div className="flex gap-4 pb-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="w-[110px] flex-shrink-0 animate-pulse">
                <div className="bg-[#181818] rounded-xl overflow-hidden">
                  <div className="w-[110px] h-[110px] bg-[#282828]"></div>
                </div>
                <div className="mt-2.5">
                  <div className="h-3 bg-[#282828] rounded mb-1"></div>
                  <div className="h-2 bg-[#282828] rounded w-3/4"></div>
                </div>
              </div>
            ))}
          </div>
          <ScrollBar orientation="horizontal" className="opacity-0" />
        </ScrollArea>
      ) : (
        <ScrollArea className="w-full">
          <div className="flex gap-4 pb-4">
            {trendingSongs.map((song, index) => (
              <Card
                key={`${song.id}-${index}`}
                className="w-[110px] flex-shrink-0 bg-transparent border-none shadow-none group cursor-pointer active:scale-95 transition-transform duration-150"
                onClick={() => handlePlaySong(song)}
              >
                <CardContent className="p-0">
                  <div
                    className={`relative w-[110px] h-[110px] bg-cover bg-center rounded-xl overflow-hidden shadow-lg group-active:shadow-2xl transition-all duration-200 ${activeBlink === song.id ? 'blink-effect' : ''}`}
                  >
                    <img
                      src={song.cover_image_url || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
                      alt={song.title}
                      className="w-full h-full object-cover"
                      loading={index < 8 ? "eager" : "lazy"}
                      decoding="async"
                    />
                    <div className="absolute inset-0 bg-black/30 group-active:bg-black/20 transition-colors duration-200"></div>

                    {/* Promoted Badge */}
                    {song.isPromoted && (
                      <div className="absolute top-1.5 right-1.5 p-1 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full shadow-lg">
                        <Flame className="w-3 h-3 text-white" />
                      </div>
                    )}
                                      </div>
                  <div className="w-[110px] text-center mt-2.5">
                    <p className="font-['Inter',sans-serif] font-bold text-left text-white/90 text-xs leading-tight group-active:text-white transition-colors duration-200 line-clamp-1 mb-1">
                      {song.title}
                    </p>
                    <p className="font-['Inter',sans-serif] text-white/60 text-left text-xs leading-tight line-clamp-1">
                      {song.artist_user_id ? (
                        <Link 
                          to={`/user/${song.artist_user_id}`}
                          className="active:text-orange-400 transition-colors duration-200"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {song.artist}
                        </Link>
                      ) : (
                        song.artist
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