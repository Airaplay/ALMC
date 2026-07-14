import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "../../../../components/ui/card";
import { ScrollArea, ScrollBar } from "../../../../components/ui/scroll-area";
import { Flame } from "lucide-react";
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { getPromotedContentForSection, recordPromotedContentClick } from "../../../../lib/promotionHelper";
import { supabase } from "../../../../lib/supabase";
import { persistentCache } from "../../../../lib/persistentCache";
import { useEngagementSync } from "../../../../hooks/useEngagementSync";
import { useUserCountry } from "../../../../hooks/useUserCountry";

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
  featuredArtists?: string[] | null;
}

interface NewSingleRelease {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  duration: number;
  audioUrl: string | null;
  coverImageUrl: string | null;
  playCount?: number;
  releaseDate?: string;
  isPromoted?: boolean;
  featured_artists?: string[] | null;
}

interface NewReleasesSectionProps {
  onOpenMusicPlayer: (song: Song, playlist?: Song[], context?: string) => void;
}

const CACHE_KEY = 'new_releases_section_processed';

export const NewReleasesSection = ({ onOpenMusicPlayer }: NewReleasesSectionProps): JSX.Element => {
  const navigate = useNavigate();
  const { countryCode } = useUserCountry();
  const [newReleases, setNewReleases] = useState<NewSingleRelease[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [originalReleases, setOriginalReleases] = useState<NewSingleRelease[]>([]);
  const [activeBlink, setActiveBlink] = useState<string | null>(null);
  const isInitialMount = useRef(true);

  // Real-time engagement sync
  useEngagementSync(useCallback((update) => {
    if (update.contentType === 'song' && update.metric === 'play_count') {
      setNewReleases(prevReleases =>
        prevReleases.map(release =>
          release.id === update.contentId
            ? { ...release, playCount: update.value }
            : release
        )
      );
      setOriginalReleases(prevReleases =>
        prevReleases.map(release =>
          release.id === update.contentId
            ? { ...release, playCount: update.value }
            : release
        )
      );
    }
  }, []));

  // Load cached releases on mount
  useEffect(() => {
    const loadCached = async () => {
      if (isInitialMount.current) {
        const cached = await persistentCache.get<NewSingleRelease[]>(CACHE_KEY);
        if (cached && cached.length > 0) {
          setNewReleases(cached);
          setOriginalReleases(cached);
        }
        isInitialMount.current = false;
      }
    };
    loadCached();
  }, []);

  useEffect(() => {
    fetchNewReleases();
  }, [countryCode]);

  const fetchNewReleases = async () => {
    try {
      const params: any = {};
      if (countryCode) params.user_country = countryCode;

      const { data: rpcData, error } = await supabase.rpc('get_new_releases_by_country', params);

      if (error) throw error;
      if (rpcData && rpcData.length > 0) {
        processNewReleases(rpcData);
      }
    } catch (err) {
      console.error('[NewReleasesSection] RPC fetch error:', err);
    }
  };

  useEffect(() => {
    if (originalReleases.length === 0) return;

    const shuffleInterval = setInterval(() => {
      const shuffled = [...originalReleases].sort(() => Math.random() - 0.5);
      setNewReleases(shuffled);
    }, 7 * 60 * 1000); // 7 minutes

    return () => clearInterval(shuffleInterval);
  }, [originalReleases]);

  const processNewReleases = async (songs: any[]) => {
    setIsLoading(true);

    try {
      const promotedIds = await getPromotedContentForSection('new_release', 'song', 3);

      const formattedReleases = songs.map((song: any) => ({
        id: song.id,
        title: song.title,
        artist: song.artist_name || 'Unknown Artist',
        artistId: song.artist_user_id || null,
        duration: song.duration_seconds || 0,
        audioUrl: song.audio_url,
        coverImageUrl: song.cover_image_url,
        playCount: song.play_count || 0,
        releaseDate: song.created_at,
        featured_artists: song.featured_artists || null
      }));

      // Fetch promoted songs from database if they're not in the list
      const promotedSongsNotInList = promotedIds.filter(id => !formattedReleases.some(s => s.id === id));

      let promotedSongsData: any[] = [];
      if (promotedSongsNotInList.length > 0) {
        const { data, error } = await supabase
          .from('songs')
          .select(`
            id,
            title,
            duration_seconds,
            audio_url,
            cover_image_url,
            play_count,
            created_at,
            artists:artist_id (
              id,
              name,
              artist_profiles(
                user_id,
                stage_name,
                users:user_id(display_name)
              )
            )
          `)
          .in('id', promotedSongsNotInList);

        if (!error && data) {
          promotedSongsData = data.map((song: any) => {
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
              releaseDate: song.created_at,
              isPromoted: true,
              featured_artists: song.featured_artists || null
            };
          });
        }
      }

      // Mark existing songs as promoted
      const releasesWithPromotion = formattedReleases.map(song => ({
        ...song,
        isPromoted: promotedIds.includes(song.id)
      }));

      // Remove promoted songs from their original positions
      const nonPromotedReleases = releasesWithPromotion.filter(song => !song.isPromoted);
      const existingPromotedReleases = releasesWithPromotion.filter(song => song.isPromoted);

      // Combine: promoted songs first (both fetched and existing), then non-promoted
      const finalReleases = [...promotedSongsData, ...existingPromotedReleases, ...nonPromotedReleases];


      setOriginalReleases(finalReleases);
      setNewReleases(finalReleases);
      // Cache processed releases
      await persistentCache.set(CACHE_KEY, finalReleases, 7 * 60 * 1000); // 7 minutes

    } catch (err) {
      console.error("Error processing new releases:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlaySong = async (song: NewSingleRelease) => {
    setActiveBlink(song.id);
    setTimeout(() => setActiveBlink(null), 600);

    console.log('🎵 [NewReleasesSection] Song clicked:', {
      id: song.id,
      title: song.title,
      isPromoted: song.isPromoted,
      audioUrl: song.audioUrl,
      hasAudioUrl: !!song.audioUrl
    });

    if (!song.audioUrl) {
      console.error('❌ Song has no audio URL:', song);
      alert("This song is not available for playback.");
      return;
    }

    if (song.isPromoted) {
      console.log('🔥 [NewReleasesSection] Recording click for promoted song:', song.id);
      await recordPromotedContentClick(song.id, 'new_release', 'song');
      console.log('✅ [NewReleasesSection] Click recorded successfully');
    } else {
      console.log('ℹ️ [NewReleasesSection] Song is NOT promoted, skipping click tracking');
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

    const formattedPlaylist = newReleases
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

    onOpenMusicPlayer(formattedSong, formattedPlaylist, 'New Releases');
  };


  // Only show loading skeleton on very first load when we have absolutely no data
  const shouldShowLoading = isLoading && newReleases.length === 0 && !isInitialMount.current;

  // Hide section only if we truly have no content to display
  if (!shouldShowLoading && newReleases.length === 0) {
    return <></>;
  }

  return (
    <section className="w-full py-6 px-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl tracking-tight">
          New Release
        </h2>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/new-releases')}
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
            {newReleases.map((item, index) => (
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