import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "../../../../components/ui/card";
import { ScrollArea, ScrollBar } from "../../../../components/ui/scroll-area";
import { Flame } from "lucide-react";
import { LazyImage } from "../../../../components/LazyImage";
import { supabase } from "../../../../lib/supabase";
import { Link } from "react-router-dom";
import { getPromotedContentForSection, recordPromotedContentClick } from "../../../../lib/promotionHelper";
import { persistentCache } from "../../../../lib/persistentCache";
import { useEngagementSync } from "../../../../hooks/useEngagementSync";

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

interface RecommendedSong {
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

interface InspiredByYouSectionProps {
  onOpenMusicPlayer: (song: Song, playlist?: Song[], context?: string) => void;
}

const CACHE_KEY = 'inspired_by_you_section_processed';

export const InspiredByYouSection = ({ onOpenMusicPlayer }: InspiredByYouSectionProps): JSX.Element => {
  const [recommendations, setRecommendations] = useState<RecommendedSong[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [shouldShow, setShouldShow] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isInitialMount = useRef(true);

  // Real-time engagement sync
  useEngagementSync(useCallback((update) => {
    if (update.contentType === 'song' && update.metric === 'play_count') {
      setRecommendations(prevRecs =>
        prevRecs.map(rec =>
          rec.id === update.contentId
            ? { ...rec, play_count: update.value }
            : rec
        )
      );
    }
  }, []));

  // Load cached recommendations on mount
  useEffect(() => {
    const loadCached = async () => {
      if (isInitialMount.current) {
        const cached = await persistentCache.get<RecommendedSong[]>(CACHE_KEY);
        if (cached && cached.length > 0) {
          setRecommendations(cached);
          setShouldShow(true);
          setIsLoading(false);
        }
        isInitialMount.current = false;
      }
    };

    loadCached();
  }, []);

  useEffect(() => {
    fetchRecommendations();

    const refreshInterval = setInterval(() => {
      shuffleAndRefresh();
    }, 15 * 60 * 1000); // 15 minutes

    return () => clearInterval(refreshInterval);
  }, []);

  const shuffleArray = <T,>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  const shuffleAndRefresh = async () => {
    setIsRefreshing(true);

    if (recommendations.length > 0) {
      const shuffled = shuffleArray(recommendations);
      setRecommendations(shuffled);
    }

    setTimeout(async () => {
      await fetchRecommendations(true);
      setIsRefreshing(false);
    }, 500);
  };

  const fetchRecommendations = async (silentRefresh = false) => {
    if (!silentRefresh) {
      setIsLoading(true);
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        setShouldShow(false);
        setIsLoading(false);
        return;
      }

      const userId = session.user.id;

      // Get user's artist profile to exclude their own content
      const { data: userArtistProfile } = await supabase
        .from('artist_profiles')
        .select('artist_id')
        .eq('user_id', userId)
        .maybeSingle();

      const userArtistId = userArtistProfile?.artist_id;

      const { data: recentHistory, error: historyError } = await supabase
        .from('listening_history')
        .select('song_id')
        .eq('user_id', userId)
        .not('song_id', 'is', null)
        .order('listened_at', { ascending: false })
        .limit(20);

      if (historyError) throw historyError;

      const listenedSongIds = recentHistory?.map(h => h.song_id) || [];

      if (listenedSongIds.length === 0) {
        await fetchPromotedContentOnly();
        return;
      }

      const { data: genreData, error: genreError } = await supabase
        .from('song_genres')
        .select('genre_id')
        .in('song_id', listenedSongIds);

      if (genreError) throw genreError;

      const genreIds = [...new Set(genreData?.map(g => g.genre_id).filter(Boolean))] || [];

      let recommendedSongs: any[] = [];

      if (genreIds.length > 0) {
        const { data: genreSongs, error: genreSongsError } = await supabase
          .from('song_genres')
          .select(`
            song_id,
            songs!inner (
              id,
              title,
              duration_seconds,
              audio_url,
              cover_image_url,
              play_count,
              artist_id,
              featured_artists,
              artists:artist_id (
                id,
                name,
                artist_profiles(user_id)
              )
            )
          `)
          .in('genre_id', genreIds)
          .limit(150);

        if (!genreSongsError && genreSongs) {
          // Exclude songs you've already listened to
          const excludedIds = new Set(listenedSongIds);
          const songsFromGenre = genreSongs
            .map(sg => sg.songs)
            .filter((song: any) =>
              song &&
              song.audio_url &&
              !excludedIds.has(song.id) &&
              (userArtistId ? song.artist_id !== userArtistId : true)
            );

          const seenArtists = new Set<string>();
          const diverseSongs: any[] = [];

          const shuffledGenreSongs = shuffleArray(songsFromGenre)
            .sort((a: any, b: any) => (b.play_count || 0) - (a.play_count || 0) + (Math.random() * 10 - 5));

          shuffledGenreSongs.forEach((song: any) => {
            const artistKey = song.artist_id || song.artists?.id;
            if (!seenArtists.has(artistKey)) {
              diverseSongs.push(song);
              seenArtists.add(artistKey);
            }
          });

          recommendedSongs = diverseSongs.slice(0, 20);
        }
      }

      if (recommendedSongs.length < 10) {
        let fallbackQuery = supabase
          .from('songs')
          .select(`
            id,
            title,
            duration_seconds,
            audio_url,
            cover_image_url,
            play_count,
            artist_id,
            featured_artists,
            artists:artist_id (
              id,
              name,
              artist_profiles(user_id)
            )
          `)
          .not('audio_url', 'is', null)
          .order('play_count', { ascending: false })
          .limit(50);

        // Exclude current user's own content
        if (userArtistId) {
          fallbackQuery = fallbackQuery.not('artist_id', 'eq', userArtistId);
        }

        const { data: fallbackData, error: fallbackError} = await fallbackQuery;

        if (!fallbackError && fallbackData) {
          // Exclude listened songs
          const excludedIds = new Set(listenedSongIds);
          const filteredFallback = fallbackData.filter((song: any) =>
            song.id && !excludedIds.has(song.id)
          );

          const seenArtists = new Set<string>();
          recommendedSongs.forEach(song => {
            const artistKey = song.artist_id || song.artists?.id;
            seenArtists.add(artistKey);
          });

          const diverseFallback = filteredFallback.filter(song => {
            const artistKey = song.artist_id || song.artists?.id;
            if (!seenArtists.has(artistKey)) {
              seenArtists.add(artistKey);
              return true;
            }
            return false;
          });

          recommendedSongs = [...recommendedSongs, ...diverseFallback];
        }
      }

      const uniqueSongs = recommendedSongs
        .filter((song, index, self) =>
          index === self.findIndex(s => s.id === song.id)
        )
        .slice(0, 20);

      const mappedRecommendations: RecommendedSong[] = uniqueSongs.map(song => {
        const artistData = Array.isArray(song.artists) ? song.artists[0] : song.artists;
        const artistProfiles = artistData?.artist_profiles;
        const artistProfileData = Array.isArray(artistProfiles) ? artistProfiles[0] : artistProfiles;

        return {
          id: song.id,
          title: song.title,
          artist: artistData?.name || 'Unknown Artist',
          artist_id: song.artist_id,
          artist_user_id: artistProfileData?.user_id || null,
          cover_image_url: song.cover_image_url,
          audio_url: song.audio_url,
          duration_seconds: song.duration_seconds || 0,
          play_count: song.play_count || 0,
          featured_artists: song.featured_artists || null
        };
      });

      const promotedSongIds = await getPromotedContentForSection('inspired_by_you', 'song', 1);

      if (promotedSongIds.length > 0) {
        let promotedQuery = supabase
          .from('songs')
          .select(`
            id,
            title,
            duration_seconds,
            audio_url,
            cover_image_url,
            play_count,
            artist_id,
            artists:artist_id (
              id,
              name,
              artist_profiles(user_id)
            )
          `)
          .in('id', promotedSongIds)
          .not('audio_url', 'is', null);

        // Exclude current user's own content from promotions
        if (userArtistId) {
          promotedQuery = promotedQuery.not('artist_id', 'eq', userArtistId);
        }

        const { data: promotedData, error: promotedError } = await promotedQuery.limit(1);

        if (!promotedError && promotedData && promotedData.length > 0) {
          const promotedSong = promotedData[0];
          const artistData = Array.isArray(promotedSong.artists) ? promotedSong.artists[0] : promotedSong.artists;
          const artistProfiles = artistData?.artist_profiles;
          const artistProfileData = Array.isArray(artistProfiles) ? artistProfiles[0] : artistProfiles;

          const promoted: RecommendedSong = {
            id: promotedSong.id,
            title: promotedSong.title,
            artist: artistData?.name || 'Unknown Artist',
            artist_id: promotedSong.artist_id,
            artist_user_id: artistProfileData?.user_id || null,
            cover_image_url: promotedSong.cover_image_url,
            audio_url: promotedSong.audio_url,
            duration_seconds: promotedSong.duration_seconds || 0,
            play_count: promotedSong.play_count || 0,
            isPromoted: true,
            featured_artists: promotedSong.featured_artists || null
          };

          const insertPosition = Math.floor(Math.random() * Math.min(3, mappedRecommendations.length + 1));
          mappedRecommendations.splice(insertPosition, 0, promoted);
        }
      }

      if (mappedRecommendations.length > 0) {
        setRecommendations(mappedRecommendations);
        setShouldShow(true);
        // Cache processed recommendations
        await persistentCache.set(CACHE_KEY, mappedRecommendations, 15 * 60 * 1000); // 15 minutes
      } else {
        await fetchPromotedContentOnly();
      }
    } catch (err) {
      console.error("Error fetching recommendations:", err);
      setShouldShow(false);
    } finally {
      if (!silentRefresh) {
        setIsLoading(false);
      }
    }
  };

  const fetchPromotedContentOnly = async () => {
    try {
      const promotedSongIds = await getPromotedContentForSection('inspired_by_you', 'song', 1);

      if (promotedSongIds.length === 0) {
        setShouldShow(false);
        return;
      }

      const { data: promotedData, error: promotedError } = await supabase
        .from('songs')
        .select(`
          id,
          title,
          duration_seconds,
          audio_url,
          cover_image_url,
          play_count,
          artist_id,
          artists:artist_id (
            id,
            name,
            artist_profiles(user_id)
          )
        `)
        .in('id', promotedSongIds)
        .not('audio_url', 'is', null)
        .limit(1);

      if (promotedError) throw promotedError;

      if (!promotedData || promotedData.length === 0) {
        setShouldShow(false);
        return;
      }

      const promotedSongs: RecommendedSong[] = promotedData.map(song => {
        const artistData = Array.isArray(song.artists) ? song.artists[0] : song.artists;
        const artistProfiles = artistData?.artist_profiles;
        const artistProfileData = Array.isArray(artistProfiles) ? artistProfiles[0] : artistProfiles;

        return {
          id: song.id,
          title: song.title,
          artist: artistData?.name || 'Unknown Artist',
          artist_id: song.artist_id,
          artist_user_id: artistProfileData?.user_id || null,
          cover_image_url: song.cover_image_url,
          audio_url: song.audio_url,
          duration_seconds: song.duration_seconds || 0,
          play_count: song.play_count || 0,
          isPromoted: true,
          featured_artists: song.featured_artists || null
        };
      });

      setRecommendations(promotedSongs);
      setShouldShow(true);
      // Cache promoted content
      await persistentCache.set(CACHE_KEY, promotedSongs, 15 * 60 * 1000); // 15 minutes
    } catch (err) {
      console.error("Error fetching promoted content:", err);
      setShouldShow(false);
    }
  };

  const handlePlaySong = async (song: RecommendedSong) => {
    if (song.isPromoted) {
      await recordPromotedContentClick(song.id, 'inspired_by_you', 'song');
    }

    const songData: Song = {
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

    const playlistData = recommendations
      .filter(r => r.audio_url)
      .map(r => ({
        id: r.id,
        title: r.title,
        artist: r.artist,
        artistId: r.artist_id,
        coverImageUrl: r.cover_image_url,
        audioUrl: r.audio_url,
        duration: r.duration_seconds,
        playCount: r.play_count,
        featuredArtists: r.featured_artists || null
      }));

    onOpenMusicPlayer(songData, playlistData, 'Inspired By You');
  };

  if (!shouldShow) {
    return <></>;
  }

  // Show nothing while loading or if no recommendations - no skeleton
  if (isLoading || recommendations.length === 0) {
    return null;
  }

  return (
    <section className="w-full py-6 px-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl tracking-tight">
            Inspired by You
          </h2>
          <p className={`font-['Inter',sans-serif] text-xs mt-1 transition-colors duration-300 ${isRefreshing ? 'text-[#309605]' : 'text-white/50'}`}>
            {isRefreshing ? 'Refreshing picks...' : 'Based on your recent listening'}
          </p>
        </div>
      </div>

      <ScrollArea className="w-full">
        <div className="flex gap-4 pb-4">
          {recommendations.map((song) => (
            <Card
              key={song.id}
              className="w-[110px] flex-shrink-0 bg-transparent border-none shadow-none group cursor-pointer active:scale-95 transition-transform duration-150"
              onClick={() => handlePlaySong(song)}
            >
              <CardContent className="p-0">
                <div className="relative w-[110px] h-[110px] bg-cover bg-center rounded-xl overflow-hidden shadow-lg group-active:shadow-2xl transition-all duration-200">
                  <LazyImage
                    src={song.cover_image_url || "https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg"}
                    alt={song.title}
                    className="w-full h-full"
                    width={110}
                    height={110}
                    useSkeleton={true}
                  />
                  <div className="absolute inset-0 bg-black/30 group-active:bg-black/20 transition-colors duration-200"></div>
                  {song.isPromoted && (
                    <div className="absolute top-2 right-2 p-1 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full shadow-lg">
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
    </section>
  );
};
