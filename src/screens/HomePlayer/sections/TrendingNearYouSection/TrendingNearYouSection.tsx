import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "../../../../components/ui/card";
import { ScrollArea, ScrollBar } from "../../../../components/ui/scroll-area";
import { MapPin, Flame } from "lucide-react";
import { supabase, getManualTrendingSongs } from "../../../../lib/supabase";
import { Link, useNavigate } from "react-router-dom";
import { useLocation } from "../../../../hooks/useLocation";
import { getPromotedContentForSection, recordPromotedContentClick } from "../../../../lib/promotionHelper";
import { persistentCache } from "../../../../lib/persistentCache";
import { useEngagementSync } from "../../../../hooks/useEngagementSync";

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
  country?: string;
  isPromoted?: boolean;
  featuredArtists?: string[] | null;
}

interface TrendingNearYouSectionProps {
  onOpenMusicPlayer: (song: Song) => void;
}

const COUNTRY_FLAG_EMOJI: { [key: string]: string } = {
  NG: "🇳🇬",
  GH: "🇬🇭",
  KE: "🇰🇪",
  ZA: "🇿🇦",
  US: "🇺🇸",
  GB: "🇬🇧",
  CA: "🇨🇦",
  JM: "🇯🇲",
  TZ: "🇹🇿",
  UG: "🇺🇬",
  RW: "🇷🇼",
  ET: "🇪🇹",
  ZW: "🇿🇼",
  BW: "🇧🇼",
  CM: "🇨🇲",
  SN: "🇸🇳",
  CI: "🇨🇮",
  ML: "🇲🇱",
  BJ: "🇧🇯",
  TG: "🇹🇬",
  NE: "🇳🇪",
  BF: "🇧🇫",
  MR: "🇲🇷",
  GM: "🇬🇲",
  GN: "🇬🇳",
  SL: "🇸🇱",
  LR: "🇱🇷",
  MZ: "🇲🇿",
  AO: "🇦🇴",
  NA: "🇳🇦",
  LS: "🇱🇸",
  SZ: "🇸🇿",
  MW: "🇲🇼",
  ZM: "🇿🇲",
  CD: "🇨🇩",
  CG: "🇨🇬",
  GA: "🇬🇦",
  GQ: "🇬🇶",
  TD: "🇹🇩",
  CF: "🇨🇫",
  SS: "🇸🇸",
  SD: "🇸🇩",
  ER: "🇪🇷",
  DJ: "🇩🇯",
  SO: "🇸🇴",
  MU: "🇲🇺",
  SC: "🇸🇨",
  MG: "🇲🇬",
  KM: "k🇲",
  ST: "🇸🇹",
  CV: "🇨🇻",
};

const CACHE_KEY = 'trending_near_you_section_processed';

export const TrendingNearYouSection = ({ onOpenMusicPlayer }: TrendingNearYouSectionProps): JSX.Element => {
  const navigate = useNavigate();
  const { location, isLoading: isLocationLoading } = useLocation(true);
  const [trendingSongs, setTrendingSongs] = useState<Song[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeBlink, setActiveBlink] = useState<string | null>(null);
  const isInitialMount = useRef(true);

  // Real-time engagement sync
  useEngagementSync(useCallback((update) => {
    if (update.contentType === 'song' && update.metric === 'play_count') {
      setTrendingSongs(prevSongs =>
        prevSongs.map(song =>
          song.id === update.contentId
            ? { ...song, playCount: update.value }
            : song
        )
      );
    }
  }, []));

  // Load cached songs on mount
  useEffect(() => {
    const loadCachedSongs = async () => {
      if (isInitialMount.current) {
        const cached = await persistentCache.get<Song[]>(CACHE_KEY);
        if (cached && cached.length > 0) {
          setTrendingSongs(cached);
          setIsLoading(false);
        }
        isInitialMount.current = false;
      }
    };

    loadCachedSongs();
  }, []);

  useEffect(() => {
    if (location && !isLocationLoading) {
      fetchTrendingSongs();

      const refreshInterval = setInterval(() => {
        fetchTrendingSongs();
      }, 20 * 60 * 1000);

      return () => {
        clearInterval(refreshInterval);
      };
    }
  }, [location, isLocationLoading]);

  const fetchTrendingSongs = async () => {
    if (!location) return;

    // Only show loading if we don't have cached songs yet
    if (trendingSongs.length === 0) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const userCountryCode = location.location.countryCode;

      console.log('[TrendingNearYouSection] Fetching promoted content for trending_near_you section');
      const promotedSongIds = await getPromotedContentForSection('trending_near_you', 'song', 3);
      console.log('[TrendingNearYouSection] Promoted song IDs received:', promotedSongIds);

      // Fetch manual trending songs for this country
      const manualSongs = await getManualTrendingSongs('trending_near_you', userCountryCode);
      
      // Format manual songs
      const formattedManualSongs: Song[] = manualSongs.map((mts: any) => {
        const song = mts.songs;
        const artistUserId = song.artists?.artist_profiles?.[0]?.user_id || null;

        let artistName = 'Unknown Artist';
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
          artistId: artistUserId,
          duration: song.duration_seconds || 0,
          audioUrl: song.audio_url,
          coverImageUrl: song.cover_image_url,
          playCount: song.play_count || 0,
          country: song.country,
          isPromoted: promotedSongIds.includes(song.id),
          featured_artists: song.featured_artists || null
        };
      });

      // Fetch auto-trending songs using RPC with smart fallback
      const { data, error } = await supabase
        .rpc('get_trending_near_you_songs', {
          country_param: userCountryCode,
          days_param: null,
          limit_param: 50
        });

      if (error) throw error;

      const formattedSongs = (data || []).map((song: any) => {
        return {
          id: song.id,
          title: song.title,
          artist: song.artist || 'Unknown Artist',
          artistId: song.artist_user_id || null,
          duration: song.duration_seconds || 0,
          audioUrl: song.audio_url,
          coverImageUrl: song.cover_image_url,
          playCount: song.play_count || 0,
          country: song.country,
          isPromoted: promotedSongIds.includes(song.id),
          featured_artists: song.featured_artists || null
        };
      });

      // Fetch promoted songs that aren't in the current country's trending list
      const promotedSongsNotInList = promotedSongIds.filter(id => !formattedSongs.some(s => s.id === id));
      let promotedSongsData: any[] = [];

      if (promotedSongsNotInList.length > 0) {
        const { data: promotedData, error: promoError } = await supabase
          .from('songs')
          .select(`
            id,
            title,
            duration_seconds,
            audio_url,
            cover_image_url,
            play_count,
            country,
            artists:artist_id (
              id,
              name,
              artist_profiles(
                id,
                user_id,
                stage_name,
                profile_photo_url,
                is_verified,
                users:user_id(display_name)
              )
            )
          `)
          .in('id', promotedSongsNotInList);

        if (!promoError && promotedData) {
          promotedSongsData = promotedData.map((song: any) => {
            const artistUserId = song.artists?.artist_profiles?.[0]?.user_id || null;
            let artistName = 'Unknown Artist';
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
              artistId: artistUserId,
              duration: song.duration_seconds || 0,
              audioUrl: song.audio_url,
              coverImageUrl: song.cover_image_url,
              playCount: song.play_count || 0,
              country: song.country,
              isPromoted: true,
              featured_artists: song.featured_artists || null
            };
          });
        }
      }

      // Remove promoted songs from original positions
      const nonPromotedSongs = formattedSongs.filter(s => !s.isPromoted);
      const existingPromotedSongs = formattedSongs.filter(s => s.isPromoted);

      // Combine: manual songs first (ordered by display_order), then promoted, then regular trending
      // Remove duplicates (manual songs take priority, then promoted, then auto-trending)
      const manualSongIds = new Set(formattedManualSongs.map(s => s.id));
      const promotedSongIdsSet = new Set([...promotedSongsData.map(s => s.id), ...existingPromotedSongs.map(s => s.id)]);
      const autoSongsFiltered = nonPromotedSongs.filter(s => !manualSongIds.has(s.id) && !promotedSongIdsSet.has(s.id));
      
      // Final order: manual songs (by display_order) > promoted songs > auto-trending songs
      const finalSongs = [...formattedManualSongs, ...promotedSongsData, ...existingPromotedSongs, ...autoSongsFiltered];

      console.log('[TrendingNearYouSection] Final songs with', promotedSongsData.length + existingPromotedSongs.length, 'promoted items');

      setTrendingSongs(finalSongs);
      // Cache processed songs for instant loading on next mount
      await persistentCache.set(CACHE_KEY, finalSongs, 20 * 60 * 1000); // 20 minutes
    } catch (err) {
      console.error("Error fetching trending songs:", err);
      setError("Failed to load trending songs");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlaySong = async (song: Song) => {
    setActiveBlink(song.id);
    setTimeout(() => setActiveBlink(null), 600);

    if (!song.audioUrl) {
      alert("This song is not available for playback.");
      return;
    }

    if (song.isPromoted) {
      await recordPromotedContentClick(song.id, 'trending_near_you', 'song');
    }

    const formattedSong = {
      id: song.id,
      title: song.title,
      artist: song.artist,
      artistId: song.artistId,
      coverImageUrl: song.coverImageUrl,
      audioUrl: song.audioUrl,
      duration: song.duration,
      playCount: song.playCount,
      featuredArtists: song.featured_artists || null
    };

    const formattedPlaylist = trendingSongs
      .filter(s => s.audioUrl)
      .map(s => ({
        id: s.id,
        title: s.title,
        artist: s.artist,
        artistId: s.artistId,
        coverImageUrl: s.coverImageUrl,
        audioUrl: s.audioUrl,
        duration: s.duration,
        playCount: s.playCount,
        featuredArtists: s.featured_artists || null
      }));

    onOpenMusicPlayer(formattedSong, formattedPlaylist, 'Trending Near You');
  };

  const handleRefresh = () => {
    fetchTrendingSongs();
  };

  const getCountryFlag = (countryCode: string) => {
    return COUNTRY_FLAG_EMOJI[countryCode] || "🌍";
  };

  // Only show location loading on very first mount with no cache
  if (isLocationLoading && trendingSongs.length === 0) {
    return (
      <section className="w-full py-6 px-6">
        <div className="flex items-center justify-between mb-6">
          <div className="animate-pulse">
            <div className="h-6 bg-[#282828] rounded w-48 mb-2"></div>
            <div className="h-4 bg-[#282828] rounded w-32"></div>
          </div>
        </div>
      </section>
    );
  }

  if (!location || !location.detected) {
    return <></>;
  }

  const countryName = location.location.country;
  const countryCode = location.location.countryCode;
  const countryFlag = getCountryFlag(countryCode);

  // Only show loading skeleton on very first load when we have absolutely no data
  const shouldShowLoading = isLoading && trendingSongs.length === 0 && !isInitialMount.current;

  // Hide section only if we truly have no content to display
  if (!shouldShowLoading && trendingSongs.length === 0) {
    return <></>;
  }

  return (
    <section className="w-full py-6 px-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl tracking-tight">
            Trending Near You
          </h2>
          <p className="font-['Inter',sans-serif] text-white/60 text-sm mt-1 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5" />
            Showing what's hot in {countryName} {countryFlag}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/trending-near-you')}
            className="font-['Inter',sans-serif] text-white hover:text-white/80 text-sm font-medium transition-colors duration-200"
          >
            View All
          </button>
        </div>
      </div>

      {shouldShowLoading ? (
        <ScrollArea className="w-full">
          <div className="grid grid-rows-2 grid-flow-col gap-4 pb-4">
            {Array.from({ length: 22 }).map((_, i) => (
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
      ) : (
        <ScrollArea className="w-full">
          <div className="grid grid-rows-2 grid-flow-col gap-4 pb-4">
            {trendingSongs.map((item, index) => (
              <Card
                key={`${item.id}-${index}`}
                className="w-[110px] bg-transparent border-none shadow-none group cursor-pointer"
                onClick={() => handlePlaySong(item)}
              >
                <CardContent className="p-0">
                  <div className={`relative w-[110px] h-[110px] bg-cover bg-center rounded-xl overflow-hidden shadow-lg ${activeBlink === item.id ? 'blink-effect' : ''}`}>
                    <img
                      src={item.coverImageUrl || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
                      alt={item.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/30"></div>

                    {item.isPromoted && (
                      <div className="absolute top-2 right-2 p-1 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full shadow-lg">
                        <Flame className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="w-[110px] mt-3">
                    <p className="font-['Inter',sans-serif] font-bold text-left text-white/90 text-xs leading-tight line-clamp-1 mb-1">
                      {item.title}
                    </p>
                    <p className="font-['Inter',sans-serif] text-left text-white/60 text-xs leading-tight line-clamp-1">
                      {item.artistId ? (
                        <Link
                          to={`/user/${item.artistId}`}
                          className="hover:text-[#309605] hover:underline transition-colors duration-200"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {item.artist}
                        </Link>
                      ) : (
                        item.artist
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
