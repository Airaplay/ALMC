import { useState, useEffect, memo, useCallback, useRef } from 'react';
import { ChevronRight, Music, Play, Flame } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../../lib/supabase';
import { getPromotedContentForSection, recordPromotedContentClick } from '../../../../lib/promotionHelper';
import { playlistCache } from '../../../../lib/playlistCache';
import { persistentCache } from '../../../../lib/persistentCache';

interface CuratedMix {
  id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  song_count: number;
  total_duration: number;
  play_count: number;
  isPromoted?: boolean;
  contentType?: 'mix' | 'album';
}

const SHUFFLE_INTERVAL = 33 * 60 * 1000; // 33 minutes in milliseconds
const STORAGE_KEY = 'mix_for_you_shuffle_timestamp';
const CACHE_KEY = 'mix_for_you_section_processed';

// Shuffle array using Fisher-Yates algorithm with seed for consistent results within cycle
const shuffleArray = <T,>(array: T[], seed: number): T[] => {
  const shuffled = [...array];
  let currentIndex = shuffled.length;

  // Seeded random number generator
  const seededRandom = (max: number) => {
    seed = (seed * 9301 + 49297) % 233280;
    return (seed / 233280) * max;
  };

  while (currentIndex !== 0) {
    const randomIndex = Math.floor(seededRandom(currentIndex));
    currentIndex--;
    [shuffled[currentIndex], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[currentIndex]];
  }

  return shuffled;
};

const blinkStyle = `
  @keyframes lightBlink {
    0%, 49% {
      box-shadow: 0 4px 12px -2px rgba(0, 0, 0, 0.1);
    }
    50%, 100% {
      box-shadow: 0 4px 12px -2px rgba(255, 255, 255, 0.15);
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

export const MixForYouSection = memo((): JSX.Element | null => {
  const [mixes, setMixes] = useState<CuratedMix[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeBlink, setActiveBlink] = useState<string | null>(null);
  const navigate = useNavigate();
  const isInitialMount = useRef(true);

  // Load cached mixes on mount
  useEffect(() => {
    const loadCached = async () => {
      if (isInitialMount.current) {
        const cached = await persistentCache.get<CuratedMix[]>(CACHE_KEY);
        if (cached && cached.length > 0) {
          setMixes(cached);
          setIsLoading(false);
        }
        isInitialMount.current = false;
      }
    };
    loadCached();
  }, []);

  // Check if shuffle cycle needs refresh
  const needsShuffle = useCallback(() => {
    const lastShuffleStr = localStorage.getItem(STORAGE_KEY);
    if (!lastShuffleStr) return true;

    const lastShuffle = parseInt(lastShuffleStr, 10);
    const now = Date.now();
    return (now - lastShuffle) >= SHUFFLE_INTERVAL;
  }, []);

  // Get current cycle seed for consistent shuffle
  const getCycleSeed = useCallback(() => {
    const lastShuffleStr = localStorage.getItem(STORAGE_KEY);
    if (!lastShuffleStr || needsShuffle()) {
      const newTimestamp = Date.now();
      localStorage.setItem(STORAGE_KEY, newTimestamp.toString());
      return newTimestamp;
    }
    return parseInt(lastShuffleStr, 10);
  }, [needsShuffle]);

  useEffect(() => {
    loadMixes();

    // Set up interval to check for shuffle
    const interval = setInterval(() => {
      if (needsShuffle()) {
        console.log('[MixForYouSection] Shuffle cycle expired, reloading...');
        loadMixes();
      }
    }, 60000); // Check every minute

    return () => clearInterval(interval);
  }, []);

  const loadMixes = async () => {
    try {
      setIsLoading(true);

      const { data: { user } } = await supabase.auth.getUser();
      let userCountry = null;

      if (user) {
        const { data: userData } = await supabase
          .from('users')
          .select('country')
          .eq('id', user.id)
          .single();

        userCountry = userData?.country;
      }

      console.log('[MixForYouSection] Fetching promoted content for mix_for_you section');
      const promotedMixIds = await getPromotedContentForSection('mix_for_you', 'album', 1);
      console.log('[MixForYouSection] Promoted mix IDs received:', promotedMixIds);

      // Fetch up to 10 mixes from database
      const { data, error } = await supabase.rpc('get_curated_mixes_for_user', {
        user_country: userCountry,
        user_id: user?.id,
        limit_count: 20 // Fetch more to ensure we have enough after filtering
      });

      if (error) throw error;

      const mixesWithPromotion = (data || []).map((mix: CuratedMix) => ({
        ...mix,
        isPromoted: promotedMixIds.includes(mix.id),
        contentType: 'mix' as const
      }));

      // Fetch promoted mixes not in the current list
      const promotedNotInList = promotedMixIds.filter(id => !mixesWithPromotion.some((m: CuratedMix) => m.id === id));
      let promotedMixesData: CuratedMix[] = [];

      if (promotedNotInList.length > 0) {
        // First try to fetch from curated_mixes
        const { data: curatedData, error: curatedError } = await supabase
          .from('curated_mixes')
          .select('id, title, description, cover_image_url')
          .in('id', promotedNotInList)
          .eq('is_visible', true);

        if (!curatedError && curatedData && curatedData.length > 0) {
          // Get song counts and durations for curated mixes
          const mixesWithDetails = await Promise.all(
            curatedData.map(async (mix: any) => {
              const { data: songs } = await supabase
                .from('songs')
                .select('duration_seconds')
                .contains('id', [mix.id]);

              const songCount = songs?.length || 0;
              const totalDuration = songs?.reduce((sum, s) => sum + (s.duration_seconds || 0), 0) || 0;

              return {
                id: mix.id,
                title: mix.title,
                description: mix.description,
                cover_image_url: mix.cover_image_url,
                song_count: songCount,
                total_duration: totalDuration,
                play_count: 0,
                isPromoted: true,
                contentType: 'mix' as const
              };
            })
          );

          promotedMixesData = mixesWithDetails;
        }

        // Check for remaining IDs that weren't found in curated_mixes - they might be regular albums
        const foundIds = new Set(curatedData?.map((m: any) => m.id) || []);
        const remainingIds = promotedNotInList.filter(id => !foundIds.has(id));

        if (remainingIds.length > 0) {
          // Fetch from albums table
          const { data: albumData, error: albumError } = await supabase
            .from('albums')
            .select(`
              id,
              title,
              cover_image_url,
              artists:artist_id (
                name
              )
            `)
            .in('id', remainingIds);

          if (!albumError && albumData && albumData.length > 0) {
            // Get song counts for albums
            const albumsWithDetails = await Promise.all(
              albumData.map(async (album: any) => {
                const { data: songs } = await supabase
                  .from('songs')
                  .select('duration_seconds')
                  .eq('album_id', album.id);

                const songCount = songs?.length || 0;
                const totalDuration = songs?.reduce((sum, s) => sum + (s.duration_seconds || 0), 0) || 0;

                return {
                  id: album.id,
                  title: album.title,
                  description: album.artists?.name || null,
                  cover_image_url: album.cover_image_url,
                  song_count: songCount,
                  total_duration: totalDuration,
                  play_count: 0,
                  isPromoted: true,
                  contentType: 'album' as const
                };
              })
            );

            promotedMixesData = [...promotedMixesData, ...albumsWithDetails];
          }
        }
      }

      // Combine all mixes (promoted from external fetch + regular mixes)
      const allAvailableMixes = [...promotedMixesData, ...mixesWithPromotion];

      // Remove duplicates
      const uniqueMixes = allAvailableMixes.reduce((acc: CuratedMix[], mix: CuratedMix) => {
        if (!acc.find((m: CuratedMix) => m.id === mix.id)) {
          acc.push(mix);
        }
        return acc;
      }, [] as CuratedMix[]);

      // Separate promoted and non-promoted
      const promotedMixes = uniqueMixes.filter((m: CuratedMix) => m.isPromoted);
      const nonPromotedMixes = uniqueMixes.filter((m: CuratedMix) => !m.isPromoted);

      // Shuffle non-promoted mixes using cycle seed
      const cycleSeed = getCycleSeed();
      const shuffledNonPromoted = shuffleArray<CuratedMix>(nonPromotedMixes, cycleSeed);

      // Take only what we need to reach 10 total (accounting for promoted)
      const remainingSlots = Math.max(0, 10 - promotedMixes.length);
      const finalNonPromoted: CuratedMix[] = shuffledNonPromoted.slice(0, remainingSlots);

      // Place promoted content in slot 1 (index 0)
      const finalMixes: CuratedMix[] = [];

      // Build final array with promoted in slot 1
      let promotedIndex = 0;
      let nonPromotedIndex = 0;

      for (let i = 0; i < 10; i++) {
        if (i === 0 && promotedIndex < promotedMixes.length) {
          // Place promoted content in the first slot
          const promotedMix = promotedMixes[promotedIndex];
          if (promotedMix) finalMixes.push(promotedMix);
          promotedIndex++;
        } else if (nonPromotedIndex < finalNonPromoted.length) {
          const nonPromotedMix = finalNonPromoted[nonPromotedIndex];
          if (nonPromotedMix) finalMixes.push(nonPromotedMix);
          nonPromotedIndex++;
        } else if (promotedIndex < promotedMixes.length) {
          // If we run out of non-promoted, add remaining promoted
          const promotedMix = promotedMixes[promotedIndex];
          if (promotedMix) finalMixes.push(promotedMix);
          promotedIndex++;
        }
      }

      console.log('[MixForYouSection] Final mixes:', finalMixes.length, 'total,', promotedMixes.length, 'promoted (in slot 1)');
      console.log('[MixForYouSection] Shuffle cycle seed:', cycleSeed);

      setMixes(finalMixes);
      // Cache processed mixes
      await persistentCache.set(CACHE_KEY, finalMixes, 33 * 60 * 1000); // 33 minutes
    } catch (error) {
      console.error('Error loading mixes:', error);
      setMixes([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMixClick = async (mix: CuratedMix) => {
    setActiveBlink(mix.id);
    setTimeout(() => setActiveBlink(null), 600);

    try {
      if (mix.isPromoted) {
        await recordPromotedContentClick(mix.id, 'mix_for_you', 'album');
      }

      // Route to correct player based on content type
      if (mix.contentType === 'album') {
        navigate(`/album/${mix.id}`);
      } else {
        await supabase.rpc('increment_mix_play_count', { mix_id: mix.id });
        navigate(`/playlist/${mix.id}`);
      }
    } catch (error) {
      console.error('Error playing mix:', error);
    }
  };

  const handleMixHover = (mixId: string) => {
    // Prefetch playlist data on hover for instant loading
    playlistCache.prefetch(mixId);
  };

  // Show nothing while loading or if no mixes - no skeleton needed
  if (isLoading || mixes.length === 0) {
    return null;
  }

  return (
    <section className="w-full py-6 px-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white">Mix for You</h2>
        {mixes.length > 5 && (
          <button
            onClick={() => navigate('/mixes')}
            className="flex items-center text-white font-medium text-sm hover:text-white/80 transition-colors"
          >
            View All
            <ChevronRight className="w-4 h-4 ml-1" />
          </button>
        )}
      </div>

      <style>{`
        .hide-scrollbar {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      <div className="flex gap-4 overflow-x-auto hide-scrollbar">
        {mixes.map((mix) => (
          <div
            key={mix.id}
            onClick={() => handleMixClick(mix)}
            onMouseEnter={() => handleMixHover(mix.id)}
            onTouchStart={() => handleMixHover(mix.id)}
            className="flex-shrink-0 w-32 cursor-pointer group active:scale-95 transition-transform duration-150"
          >
            <div className="relative mb-2">
              {mix.cover_image_url ? (
                <img
                  src={mix.cover_image_url}
                  alt={mix.title}
                  className={`w-full h-32 object-cover rounded-lg shadow-md group-active:shadow-lg transition-shadow duration-200 ${activeBlink === mix.id ? 'blink-effect' : ''}`}
                />
              ) : (
                <div className={`w-full h-32 bg-gradient-to-br from-[#309605] to-[#3ba208] rounded-lg shadow-md flex items-center justify-center ${activeBlink === mix.id ? 'blink-effect' : ''}`}>
                  <Music className="w-10 h-10 text-white/80" />
                </div>
              )}


              {mix.isPromoted && (
                <div className="absolute top-2 right-2 p-1 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full shadow-lg">
                  <Flame className="w-3 h-3 text-white" />
                </div>
              )}
            </div>

            <h3 className="font-semibold text-white text-xs truncate">
              {mix.title}
            </h3>
            {mix.description && (
              <p className="text-xs text-white/70 line-clamp-1">
                {mix.description}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
});

MixForYouSection.displayName = 'MixForYouSection';
