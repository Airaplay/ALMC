import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../../lib/supabase';
import { useAuth } from '../../../../contexts/AuthContext';
import { ScrollArea, ScrollBar } from '../../../../components/ui/scroll-area';
import { getGlobalDailyMixes } from '../../../../lib/globalDailyMixGenerator';

interface DailyMix {
  id: string;
  mix_number: number;
  title: string;
  description: string;
  genre_focus: string | null;
  mood_focus: string | null;
  cover_image_url: string | null;
  track_count: number;
  generated_at: string;
  artist_images?: string[];
  display_title?: string;
  is_global?: boolean;
}

export const DailyMixSection: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mixes, setMixes] = useState<DailyMix[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadDailyMixes = useCallback(async (autoGenerate = true) => {
    try {
      setIsLoading(true);
      
      // If user is authenticated, try to load personal mixes
      if (user) {
        const { data: mixesData, error } = await supabase
          .from('daily_mix_playlists')
          .select('id, mix_number, title, description, genre_focus, mood_focus, cover_image_url, track_count, generated_at')
          .eq('user_id', user.id)
          .gt('expires_at', new Date().toISOString())
          .order('mix_number');

        if (error) throw error;

        // If user has personal mixes, enrich and use them
        if (mixesData && mixesData.length > 0) {
          const enrichedMixes = await enrichMixes(mixesData, false);
          setMixes(enrichedMixes);
          return;
        }

        // No personal mixes - try to auto-generate for authenticated users
        if (autoGenerate && !isGenerating) {
          setIsGenerating(true);
          try {
            const { generateDailyMixesForUser } = await import('../../../../lib/dailyMixGenerator');
            await generateDailyMixesForUser(user.id, true);
            await loadDailyMixes(false);
          } catch (genError) {
            console.error('Error generating personal mixes, falling back to global:', genError);
            // Fall through to load global mixes
          } finally {
            setIsGenerating(false);
          }
        }
      }

      // Load global mixes for non-auth users or when personal mixes unavailable
      // Force-refresh here to avoid stale cached empty arrays masking newly generated mixes.
      const globalMixes = await getGlobalDailyMixes(true);
      if (globalMixes && globalMixes.length > 0) {
        const enrichedMixes = await enrichMixes(globalMixes, true);
        setMixes(enrichedMixes);
      } else {
        setMixes([]);
      }
    } catch (error) {
      console.error('Error loading daily mixes:', error);
      setMixes([]);
    } finally {
      setIsLoading(false);
    }
  }, [user, isGenerating]);

  /**
   * Enrich mixes with artist images and display titles
   */
  const enrichMixes = async (mixesData: any[], isGlobal: boolean): Promise<DailyMix[]> => {
    return Promise.all(
      mixesData.map(async (mix) => {
        try {
          // Determine which table to query
          const tracksTable = isGlobal ? 'global_daily_mix_tracks' : 'daily_mix_tracks';
          
          // Get songs in this mix with artist info, genres, and moods
          const { data: mixTracks, error: tracksError } = await supabase
            .from(tracksTable)
            .select(`
              song_id,
              songs!inner(
                id,
                title,
                artist_id,
                cover_image_url,
                artists:artist_id(
                  id,
                  display_name,
                  avatar_url,
                  artist_profiles(
                    stage_name,
                    profile_image_url
                  )
                )
              )
            `)
            .eq('mix_id', mix.id)
            .limit(10);

          const artistImages: string[] = [];
          const artistNames: string[] = [];
          const songImages: string[] = [];

          if (mixTracks && mixTracks.length > 0) {
            mixTracks.forEach((track: any) => {
              const song = track.songs;
              if (song) {
                // Collect artist images and names
                if (song.artists) {
                  const artist = song.artists;
                  const profile = artist.artist_profiles?.[0];
                  const imageUrl = profile?.profile_image_url || artist.avatar_url;
                  const artistName = profile?.stage_name || artist.display_name;

                  if (imageUrl && !artistImages.includes(imageUrl)) {
                    artistImages.push(imageUrl);
                  }
                  if (artistName && !artistNames.includes(artistName)) {
                    artistNames.push(artistName);
                  }
                }

                // Also collect song cover images as fallback
                if (song.cover_image_url && !songImages.includes(song.cover_image_url)) {
                  songImages.push(song.cover_image_url);
                }
              }
            });
          }

          // Use artist images if available, otherwise fall back to song cover images, or mix cover
          let displayImages = artistImages.length > 0 ? artistImages : songImages;
          if (displayImages.length === 0 && mix.cover_image_url) {
            displayImages = [mix.cover_image_url];
          }

          let displayTitle = '';

          if (mix.genre_focus && mix.genre_focus !== 'Discovery') {
            displayTitle = `Your ${mix.genre_focus} Mix`;
          } else if (mix.mood_focus) {
            displayTitle = `${mix.mood_focus} Vibes`;
          } else if (artistNames.length > 0) {
            if (artistNames.length === 1) {
              displayTitle = `${artistNames[0]} Radio`;
            } else if (artistNames.length === 2) {
              displayTitle = `${artistNames[0]} & ${artistNames[1]}`;
            } else {
              displayTitle = `${artistNames[0]} & Friends`;
            }
          } else {
            const hour = new Date().getHours();
            if (hour >= 5 && hour < 12) {
              displayTitle = 'Morning Mix';
            } else if (hour >= 12 && hour < 17) {
              displayTitle = 'Afternoon Mix';
            } else if (hour >= 17 && hour < 21) {
              displayTitle = 'Evening Mix';
            } else {
              displayTitle = 'Night Mix';
            }
          }

          return {
            ...mix,
            artist_images: displayImages.slice(0, 4),
            display_title: displayTitle,
            is_global: isGlobal
          };
        } catch (err) {
          console.error('Error enriching mix:', err);
          // Ensure we always return something visible
          return {
            ...mix,
            artist_images: mix.cover_image_url ? [mix.cover_image_url] : [],
            display_title: mix.title || mix.genre_focus || mix.mood_focus || 'Your Mix',
            is_global: isGlobal
          };
        }
      })
    );
  };

  useEffect(() => {
    loadDailyMixes();

    const refreshMs = mixes.length > 0 ? 10 * 60 * 1000 : 30 * 1000;
    refreshIntervalRef.current = setInterval(() => {
      loadDailyMixes(false); // Don't auto-generate on interval refreshes
    }, refreshMs);

    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [loadDailyMixes, mixes.length]);

  const handleMixClick = (mix: DailyMix) => {
    if (mix.is_global) {
      navigate(`/daily-mix/global/${mix.id}`);
    } else {
      navigate(`/daily-mix/${mix.id}`);
    }
  };

  const getGradientColors = (mixNumber: number): string => {
    const gradients = [
      'from-[#00ad74] to-[#008a5d]', // Brand green
      'from-blue-500 to-cyan-500',     // Ocean blue
      'from-emerald-500 to-teal-500',  // Fresh green
      'from-orange-500 to-amber-500',  // Warm sunset
      'from-cyan-500 to-blue-600'      // Deep ocean
    ];

    return gradients[(mixNumber - 1) % gradients.length];
  };

  return (
    <section className="w-full py-6 px-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl tracking-tight">
            Ai Daily Mix
          </h2>
          <p className="font-['Inter',sans-serif] text-white/60 text-xs mt-0.5">
            Personalized playlists just for you
          </p>
        </div>
      </div>

      {isLoading || mixes.length === 0 ? null : (
      <ScrollArea className="w-full">
        <div className="flex gap-4 pb-4">
          {mixes.map((mix) => (
            <button
              key={mix.id}
              onClick={() => handleMixClick(mix)}
              className={`group relative overflow-hidden rounded-xl bg-gradient-to-br ${getGradientColors(mix.mix_number)} w-[200px] h-[140px] flex-shrink-0 text-left transition-all duration-200 active:scale-95 shadow-lg hover:shadow-2xl`}
            >
              {/* Artist Images Collage */}
              {mix.artist_images && mix.artist_images.length > 0 && (
                <div className="absolute inset-0 z-0">
                  {mix.artist_images.length === 1 ? (
                    <img
                      src={mix.artist_images[0]}
                      alt="Artist"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : mix.artist_images.length === 2 ? (
                    <div className="grid grid-cols-2 h-full gap-[0.5px]">
                      {mix.artist_images.map((img, idx) => (
                        <img
                          key={idx}
                          src={img}
                          alt="Artist"
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 grid-rows-2 h-full gap-[0.5px]">
                      {mix.artist_images.slice(0, 4).map((img, idx) => (
                        <img
                          key={idx}
                          src={img}
                          alt="Artist"
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="relative z-10 p-4 h-full flex flex-col justify-between">
                <div className="flex items-start justify-between">
                  <div className="flex-1 pr-2">
                    <h3 className="font-['Inter',sans-serif] text-base font-bold text-white line-clamp-2 leading-tight">
                      {mix.display_title || mix.genre_focus || mix.mood_focus || 'Your Mix'}
                    </h3>
                  </div>
                  <div className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-white/30 group-active:bg-white/40 transition-colors flex-shrink-0">
                    <Play className="w-4 h-4 text-white fill-white" />
                  </div>
                </div>

                <div>
                  <p className="font-['Inter',sans-serif] text-white/80 text-xs line-clamp-2 leading-relaxed">
                    {mix.description}
                  </p>
                </div>
              </div>

              {/* Gradient overlay between images and content */}
              <div className="absolute inset-0 z-[1] bg-gradient-to-b from-black/30 via-black/50 to-black/70" />

              {/* Blur decorations - subtle highlights */}
              <div className="absolute top-0 right-0 w-20 h-20 bg-white/5 rounded-full blur-2xl z-[2]" />
              <div className="absolute bottom-0 left-0 w-20 h-20 bg-white/5 rounded-full blur-2xl z-[2]" />

              {/* Active state overlay */}
              <div className="absolute inset-0 z-[15] bg-black/20 opacity-0 group-active:opacity-100 transition-opacity pointer-events-none" />
            </button>
          ))}
        </div>
        <ScrollBar orientation="horizontal" className="opacity-0" />
      </ScrollArea>
      )}
    </section>
  );
};
