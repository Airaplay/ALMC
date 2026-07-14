import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Play, Heart, Share2, Flame, MapPin } from 'lucide-react';
import { LazyImage } from '../../components/LazyImage';
import { Skeleton } from '../../components/ui/skeleton';
import { supabase, getManualTrendingSongs, toggleSongFavorite } from '../../lib/supabase';
import { shareSong } from '../../lib/shareService';
import { favoritesCache } from '../../lib/favoritesCache';
import { useNavigate } from 'react-router-dom';
import { mergeTrendingContentWithPromotions } from '../../lib/trendingPromotionSlots';
import { mergeAdditionalSongsWithPromotions } from '../../lib/additionalSongsPromotionSlots';
import { recordPromotedContentClick, getPromotedContentForSection } from '../../lib/promotionHelper';
import { useLocation } from '../../hooks/useLocation';
import { AdMobBanner } from '../../components/AdMobBanner';

interface Song {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  coverImageUrl?: string | null;
  audioUrl?: string | null;
  duration?: number;
  playCount?: number;
  artistProfilePhoto?: string | null;
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
  artist_profile_photo: string | null;
  isPromoted?: boolean;
}

interface Genre {
  id: string;
  name: string;
}

interface GridItem {
  id: string;
  isAd: boolean;
  songData?: TrendingSong;
}

const COUNTRY_FLAG_EMOJI: { [key: string]: string } = {
  NG: "🇳🇬", GH: "🇬🇭", KE: "🇰🇪", ZA: "🇿🇦", US: "🇺🇸", GB: "🇬🇧", CA: "🇨🇦",
  JM: "🇯🇲", TZ: "🇹🇿", UG: "🇺🇬", RW: "🇷🇼", ET: "🇪🇹", ZW: "🇿🇼", BW: "🇧🇼",
  CM: "🇨🇲", SN: "🇸🇳", CI: "🇨🇮", ML: "🇲🇱", BJ: "🇧🇯", TG: "🇹🇬", NE: "🇳🇪",
  BF: "🇧🇫", MR: "🇲🇷", GM: "🇬🇲", GN: "🇬🇳", SL: "🇸🇱", LR: "🇱🇷", MZ: "🇲🇿",
  AO: "🇦🇴", NA: "🇳🇦", LS: "🇱🇸", SZ: "🇸🇿", MW: "🇲🇼", ZM: "🇿🇲", CD: "🇨🇩",
  CG: "🇨🇬", GA: "🇬🇦", GQ: "🇬🇶", TD: "🇹🇩", CF: "🇨🇫", SS: "🇸🇸", SD: "🇸🇩",
  ER: "🇪🇷", DJ: "🇩🇯", SO: "🇸🇴", MU: "🇲🇺", SC: "🇸🇨", MG: "🇲🇬", KM: "🇰🇲",
  ST: "🇸🇹", CV: "🇨🇻",
};

interface TrendingNearYouViewAllScreenProps {
  onOpenMusicPlayer?: (song: Song) => void;
}

export const TrendingNearYouViewAllScreen = ({ onOpenMusicPlayer }: TrendingNearYouViewAllScreenProps): JSX.Element => {
  const navigate = useNavigate();
  const { location, isLoading: isLocationLoading } = useLocation(true);
  const [topTenSongs, setTopTenSongs] = useState<TrendingSong[]>([]);
  const [additionalSongs, setAdditionalSongs] = useState<TrendingSong[]>([]);
  const [gridItems, setGridItems] = useState<GridItem[]>([]);
  const [isLoadingTopTen, setIsLoadingTopTen] = useState(true);
  const [isLoadingAdditional, setIsLoadingAdditional] = useState(true);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string>('all');
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFavorited, setIsFavorited] = useState<Record<string, boolean>>(() => {
    return favoritesCache.getAllFavoritesMap().songs;
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
    if (location && !isLocationLoading) {
      fetchGenres();
      fetchAllSongs();
      checkFavorites();
    }
  }, [location, isLocationLoading]);

  useEffect(() => {
    if (location && !isLocationLoading) {
      fetchAllSongs();
    }
  }, [selectedGenre, location]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkFavorites();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Inject AdMob ads into grid when additional songs change
  useEffect(() => {
    if (additionalSongs.length === 0) {
      setGridItems([]);
      return;
    }

    // Inject AdMob ad placeholders every 6 items
    const itemsWithAds: GridItem[] = [];

    for (let i = 0; i < additionalSongs.length; i++) {
      // Add the song
      itemsWithAds.push({
        id: `song-${additionalSongs[i].id}`,
        isAd: false,
        songData: additionalSongs[i]
      });

      // Every 6 items, inject an AdMob ad placeholder
      if ((i + 1) % 6 === 0) {
        itemsWithAds.push({
          id: `ad-${i}`,
          isAd: true
        });
      }
    }

    setGridItems(itemsWithAds);
  }, [additionalSongs]);

  const getCountryFlag = (countryCode: string) => {
    return COUNTRY_FLAG_EMOJI[countryCode] || "🌍";
  };

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
        .from('user_favorites')
        .select('song_id')
        .eq('user_id', session.user.id);

      if (error) throw error;

      const songIds = data?.map(fav => fav.song_id) || [];
      favoritesCache.updateFromServer({ songs: songIds });

      const favMap: Record<string, boolean> = {};
      data?.forEach(fav => {
        favMap[fav.song_id] = true;
      });
      setIsFavorited(favMap);
    } catch (err) {
      console.error('Error checking favorites:', err);
    }
  };

  const fetchTopTenSongs = async () => {
    if (!location || !location.location?.countryCode) return;

    setIsLoadingTopTen(true);
    const userCountryCode = location.location.countryCode;

    try {
      // Fetch promoted content
      const promotedSongIds = await getPromotedContentForSection('trending_near_you', 'song', 3);

      // Fetch manual trending songs for this country
      const manualSongs = await getManualTrendingSongs('trending_near_you', userCountryCode);
      
      // Format manual songs to match TrendingSong interface
      const formattedManualSongs: TrendingSong[] = manualSongs.map((mts: any) => {
        const song = mts.songs;
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
          artist_id: song.artists?.id || '',
          artist_user_id: song.artists?.artist_profiles?.[0]?.user_id || null,
          cover_image_url: song.cover_image_url,
          audio_url: song.audio_url,
          duration_seconds: song.duration_seconds || 0,
          play_count: song.play_count || 0,
          artist_profile_photo: null,
          isPromoted: promotedSongIds.includes(song.id)
        };
      });

      // Fetch auto-trending songs for this country using dynamic threshold
      const { data, error: fetchError } = await supabase
        .rpc('get_trending_near_you_songs', {
          country_param: userCountryCode,
          days_param: 14,
          limit_param: 50
        });

      if (fetchError) throw fetchError;

      let filteredData = data || [];

      if (selectedGenre !== 'all') {
        const { data: songGenres } = await supabase
          .from('song_genres')
          .select('song_id')
          .eq('genre_id', selectedGenre);

        if (songGenres && songGenres.length > 0) {
          const genreSongIds = new Set(songGenres.map(sg => sg.song_id));
          filteredData = filteredData.filter((song: any) => genreSongIds.has(song.id));
        } else {
          // If genre filter returns no results, still show manual songs
          const manualInGenre = formattedManualSongs;
          
          if (manualInGenre.length === 0) {
            setTopTenSongs([]);
            setIsLoadingTopTen(false);
            return;
          }
          
          // Show only manual songs if genre filter returns no auto-trending
          const mergedContent = await mergeTrendingContentWithPromotions(
            manualInGenre.slice(0, 10),
            'trending_near_you',
            'song'
          );

          const songsWithPromotion = mergedContent.map(({ item, isPromoted }) => ({
            ...item,
            isPromoted: item.isPromoted || isPromoted
          }));

          setTopTenSongs(songsWithPromotion);
          setCurrentCardIndex(0);
          setIsLoadingTopTen(false);
          return;
        }
      }

      const formattedAutoSongs: TrendingSong[] = filteredData.map((song: any) => {
        // RPC function returns flat structure with artist, artist_id, artist_user_id
        return {
          id: song.id,
          title: song.title,
          artist: song.artist || 'Unknown Artist',
          artist_id: song.artist_id || '',
          artist_user_id: song.artist_user_id || null,
          cover_image_url: song.cover_image_url,
          audio_url: song.audio_url,
          duration_seconds: song.duration_seconds || 0,
          play_count: song.play_count || 0,
          artist_profile_photo: null,
          isPromoted: promotedSongIds.includes(song.id)
        };
      });

      // Fetch promoted songs that aren't in the current country's trending list
      const promotedSongsNotInList = promotedSongIds.filter(id => 
        !formattedAutoSongs.some(s => s.id === id) && 
        !formattedManualSongs.some(s => s.id === id)
      );
      let promotedSongsData: TrendingSong[] = [];

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
              artist_id: song.artists?.id || '',
              artist_user_id: artistUserId,
              cover_image_url: song.cover_image_url,
              audio_url: song.audio_url,
              duration_seconds: song.duration_seconds || 0,
              play_count: song.play_count || 0,
              artist_profile_photo: song.artists?.artist_profiles?.[0]?.profile_photo_url || null,
              isPromoted: true
            };
          });
        }
      }

      // Remove promoted songs from original positions
      const nonPromotedSongs = formattedAutoSongs.filter(s => !s.isPromoted);
      const existingPromotedSongs = formattedAutoSongs.filter(s => s.isPromoted);

      // Combine: manual songs first (ordered by display_order), then promoted, then regular trending
      // Remove duplicates (manual songs take priority, then promoted, then auto-trending)
      const manualSongIds = new Set(formattedManualSongs.map(s => s.id));
      const promotedSongIdsSet = new Set([...promotedSongsData.map(s => s.id), ...existingPromotedSongs.map(s => s.id)]);
      const autoSongsFiltered = nonPromotedSongs.filter(s => !manualSongIds.has(s.id) && !promotedSongIdsSet.has(s.id));
      
      // Final order: manual songs (by display_order) > promoted songs > auto-trending songs
      const combinedSongs = [...formattedManualSongs, ...promotedSongsData, ...existingPromotedSongs, ...autoSongsFiltered];

      // Take top 10
      const topTen = combinedSongs.slice(0, 10);

      const mergedContent = await mergeTrendingContentWithPromotions(
        topTen,
        'trending_near_you',
        'song'
      );

      const songsWithPromotion = mergedContent.map(({ item, isPromoted }) => ({
        ...item,
        isPromoted: item.isPromoted || isPromoted
      }));

      setTopTenSongs(songsWithPromotion);
      setCurrentCardIndex(0);
    } catch (err) {
      console.error("Error fetching top 10 songs:", err);
      // Fallback: Use RPC with smart fallback (already handles thresholds)
      try {
        if (!location?.location?.countryCode) return;

        const { data, error: fetchError } = await supabase
          .rpc('get_trending_near_you_songs', {
            country_param: location.location.countryCode,
            days_param: 14,
            limit_param: 10
          });

        if (fetchError) throw fetchError;

        let filteredData = data || [];

        if (selectedGenre !== 'all') {
          const { data: songGenres } = await supabase
            .from('song_genres')
            .select('song_id')
            .eq('genre_id', selectedGenre);

          if (songGenres && songGenres.length > 0) {
            const genreSongIds = new Set(songGenres.map(sg => sg.song_id));
            filteredData = filteredData.filter((song: any) => genreSongIds.has(song.id));
          } else {
            setTopTenSongs([]);
            setIsLoadingTopTen(false);
            return;
          }
        }

        const formattedSongs: TrendingSong[] = filteredData.map((song: any) => {
          return {
            id: song.id,
            title: song.title,
            artist: song.artist || 'Unknown Artist',
            artist_id: song.artist_id || '',
            artist_user_id: song.artist_user_id || null,
            cover_image_url: song.cover_image_url,
            audio_url: song.audio_url,
            duration_seconds: song.duration_seconds || 0,
            play_count: song.play_count || 0,
            artist_profile_photo: null
          };
        });

        const mergedContent = await mergeTrendingContentWithPromotions(
          formattedSongs,
          'trending_near_you',
          'song'
        );

        const songsWithPromotion = mergedContent.map(({ item, isPromoted }) => ({
          ...item,
          isPromoted
        }));

        setTopTenSongs(songsWithPromotion);
        setCurrentCardIndex(0);
      } catch (fallbackErr) {
        console.error("Error fetching top 10 songs (fallback):", fallbackErr);
      }
    } finally {
      setIsLoadingTopTen(false);
    }
  };

  const fetchAdditionalSongs = async () => {
    if (!location || !location.location?.countryCode) return;

    setIsLoadingAdditional(true);
    const userCountryCode = location.location.countryCode;

    try {
      // Fetch promoted content
      const promotedSongIds = await getPromotedContentForSection('trending_near_you', 'song', 3);

      // Fetch manual trending songs
      const manualSongs = await getManualTrendingSongs('trending_near_you', userCountryCode);
      
      // Format manual songs to match TrendingSong interface
      const formattedManualSongs: TrendingSong[] = manualSongs.map((mts: any) => {
        const song = mts.songs;
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
          artist_id: song.artists?.id || '',
          artist_user_id: song.artists?.artist_profiles?.[0]?.user_id || null,
          cover_image_url: song.cover_image_url,
          audio_url: song.audio_url,
          duration_seconds: song.duration_seconds || 0,
          play_count: song.play_count || 0,
          artist_profile_photo: null,
          isPromoted: promotedSongIds.includes(song.id)
        };
      });

      // Fetch auto-trending songs using RPC with smart fallback (same as Section and Top 10)
      const { data, error: fetchError } = await supabase
        .rpc('get_trending_near_you_songs', {
          country_param: userCountryCode,
          days_param: 14,
          limit_param: 50
        });

      if (fetchError) throw fetchError;

      let filteredData = data || [];

      if (selectedGenre !== 'all') {
        const { data: songGenres } = await supabase
          .from('song_genres')
          .select('song_id')
          .eq('genre_id', selectedGenre);

        if (songGenres && songGenres.length > 0) {
          const genreSongIds = new Set(songGenres.map(sg => sg.song_id));
          filteredData = filteredData.filter((song: any) => genreSongIds.has(song.id));
        } else {
          // If genre filter returns no results, still show manual songs
          const manualInGenre = formattedManualSongs;
          
          // Exclude top 10 songs from additional songs
          const topTenIds = new Set(topTenSongs.map(s => s.id));
          const additionalManual = manualInGenre.filter(s => !topTenIds.has(s.id));
          
          const mergedContent = await mergeAdditionalSongsWithPromotions(
            additionalManual,
            'trending_near_you',
            'song'
          );

          const songsWithPromotion = mergedContent.map(({ item, isPromoted }) => ({
            ...item,
            isPromoted: item.isPromoted || isPromoted
          }));

          setAdditionalSongs(songsWithPromotion);
          setIsLoadingAdditional(false);
          return;
        }
      }

      const formattedAutoSongs: TrendingSong[] = filteredData.map((song: any) => {
        // RPC function returns flat structure with artist, artist_id, artist_user_id
        return {
          id: song.id,
          title: song.title,
          artist: song.artist || 'Unknown Artist',
          artist_id: song.artist_id || '',
          artist_user_id: song.artist_user_id || null,
          cover_image_url: song.cover_image_url,
          audio_url: song.audio_url,
          duration_seconds: song.duration_seconds || 0,
          play_count: song.play_count || 0,
          artist_profile_photo: null,
          isPromoted: promotedSongIds.includes(song.id)
        };
      });

      // Fetch promoted songs that aren't in the current country's trending list
      const promotedSongsNotInList = promotedSongIds.filter(id => 
        !formattedAutoSongs.some(s => s.id === id) && 
        !formattedManualSongs.some(s => s.id === id)
      );
      let promotedSongsData: TrendingSong[] = [];

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
              artist_id: song.artists?.id || '',
              artist_user_id: artistUserId,
              cover_image_url: song.cover_image_url,
              audio_url: song.audio_url,
              duration_seconds: song.duration_seconds || 0,
              play_count: song.play_count || 0,
              artist_profile_photo: song.artists?.artist_profiles?.[0]?.profile_photo_url || null,
              isPromoted: true
            };
          });
        }
      }

      // Remove promoted songs from original positions
      const nonPromotedSongs = formattedAutoSongs.filter(s => !s.isPromoted);
      const existingPromotedSongs = formattedAutoSongs.filter(s => s.isPromoted);

      // Combine: manual songs first, then promoted, then auto-trending
      // Remove duplicates (manual songs take priority, then promoted, then auto-trending)
      const manualSongIds = new Set(formattedManualSongs.map(s => s.id));
      const promotedSongIdsSet = new Set([...promotedSongsData.map(s => s.id), ...existingPromotedSongs.map(s => s.id)]);
      const autoSongsFiltered = nonPromotedSongs.filter(s => !manualSongIds.has(s.id) && !promotedSongIdsSet.has(s.id));
      
      // Final order: manual songs (by display_order) > promoted songs > auto-trending songs
      const combinedSongs = [...formattedManualSongs, ...promotedSongsData, ...existingPromotedSongs, ...autoSongsFiltered];

      // Exclude top 10 songs from additional songs
      const topTenIds = new Set(topTenSongs.map(s => s.id));
      const additionalSongsList = combinedSongs.filter(s => !topTenIds.has(s.id));

      const mergedContent = await mergeAdditionalSongsWithPromotions(
        additionalSongsList,
        'trending_near_you',
        'song'
      );

      const songsWithPromotion = mergedContent.map(({ item, isPromoted }) => ({
        ...item,
        isPromoted: item.isPromoted || isPromoted
      }));

      setAdditionalSongs(songsWithPromotion);
    } catch (err) {
      console.error("Error fetching additional songs:", err);
      // Fallback: Use RPC with smart fallback (already handles thresholds)
      try {
        if (!location?.location?.countryCode) return;

        const { data, error: fetchError } = await supabase
          .rpc('get_trending_near_you_songs', {
            country_param: location.location.countryCode,
            days_param: 14,
            limit_param: 50
          });

        if (fetchError) throw fetchError;

        let filteredData = data || [];

        if (selectedGenre !== 'all') {
          const { data: songGenres } = await supabase
            .from('song_genres')
            .select('song_id')
            .eq('genre_id', selectedGenre);

          if (songGenres && songGenres.length > 0) {
            const genreSongIds = new Set(songGenres.map(sg => sg.song_id));
            filteredData = filteredData.filter((song: any) => genreSongIds.has(song.id));
          } else {
            setAdditionalSongs([]);
            setIsLoadingAdditional(false);
            return;
          }
        }

        const formattedSongs: TrendingSong[] = filteredData.map((song: any) => {
          return {
            id: song.id,
            title: song.title,
            artist: song.artist || 'Unknown Artist',
            artist_id: song.artist_id || '',
            artist_user_id: song.artist_user_id || null,
            cover_image_url: song.cover_image_url,
            audio_url: song.audio_url,
            duration_seconds: song.duration_seconds || 0,
            play_count: song.play_count || 0,
            artist_profile_photo: null
          };
        });

        // Exclude top 10
        const topTenIds = new Set(topTenSongs.map(s => s.id));
        const additionalSongsList = formattedSongs.filter(s => !topTenIds.has(s.id));

        const mergedContent = await mergeAdditionalSongsWithPromotions(
          additionalSongsList,
          'trending_near_you',
          'song'
        );

        const songsWithPromotion = mergedContent.map(({ item, isPromoted }) => ({
          ...item,
          isPromoted
        }));

        setAdditionalSongs(songsWithPromotion);
      } catch (fallbackErr) {
        console.error("Error fetching additional songs (fallback):", fallbackErr);
      }
    } finally {
      setIsLoadingAdditional(false);
    }
  };

  const fetchAllSongs = async () => {
    if (!location?.location?.countryCode) {
      console.log('[TrendingNearYouViewAll] No country code, returning early');
      return;
    }

    const userCountryCode = location.location.countryCode;
    console.log('[TrendingNearYouViewAll] Fetching songs for country:', userCountryCode);
    console.log('[TrendingNearYouViewAll] Selected genre:', selectedGenre);

    try {
      setIsLoadingTopTen(true);
      setIsLoadingAdditional(true);

      // Fetch promoted content
      const promotedSongIds = await getPromotedContentForSection('trending_near_you', 'song', 3);
      console.log('[TrendingNearYouViewAll] Promoted song IDs:', promotedSongIds);

      // Fetch manual trending songs for this country
      const manualSongs = await getManualTrendingSongs('trending_near_you', userCountryCode);
      console.log('[TrendingNearYouViewAll] Manual songs fetched:', manualSongs.length);

      // Format manual songs to match TrendingSong interface
      const formattedManualSongs: TrendingSong[] = manualSongs.map((mts: any) => {
        const song = mts.songs;
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
          artist_id: song.artists?.id || '',
          artist_user_id: song.artists?.artist_profiles?.[0]?.user_id || null,
          cover_image_url: song.cover_image_url,
          audio_url: song.audio_url,
          duration_seconds: song.duration_seconds || 0,
          play_count: song.play_count || 0,
          artist_profile_photo: null,
          isPromoted: promotedSongIds.includes(song.id)
        };
      });

      // Fetch auto-trending songs for this country using dynamic threshold
      const { data, error: fetchError } = await supabase
        .rpc('get_trending_near_you_songs', {
          country_param: userCountryCode,
          days_param: 14,
          limit_param: 50
        });

      if (fetchError) throw fetchError;

      console.log('[TrendingNearYouViewAll] Auto-trending songs fetched from RPC:', data?.length || 0);
      let filteredData = data || [];

      if (selectedGenre !== 'all') {
        console.log('[TrendingNearYouViewAll] Applying genre filter:', selectedGenre);
        const { data: songGenres } = await supabase
          .from('song_genres')
          .select('song_id')
          .eq('genre_id', selectedGenre);

        console.log('[TrendingNearYouViewAll] Songs in this genre:', songGenres?.length || 0);

        if (songGenres && songGenres.length > 0) {
          const genreSongIds = new Set(songGenres.map(sg => sg.song_id));
          filteredData = filteredData.filter((song: any) => genreSongIds.has(song.id));
          console.log('[TrendingNearYouViewAll] Filtered data after genre:', filteredData.length);
        } else {
          // If genre filter returns no results, still show manual songs
          console.log('[TrendingNearYouViewAll] No songs in this genre, showing manual songs only');
          const manualInGenre = formattedManualSongs;

          if (manualInGenre.length === 0) {
            console.log('[TrendingNearYouViewAll] No manual songs either, returning empty');
            setTopTenSongs([]);
            setAdditionalSongs([]);
            setIsLoadingTopTen(false);
            setIsLoadingAdditional(false);
            return;
          }

          // Show only manual songs if genre filter returns no auto-trending
          const topTen = manualInGenre.slice(0, 10);
          const additional = manualInGenre.slice(10);

          const mergedTopTen = await mergeTrendingContentWithPromotions(
            topTen,
            'trending_near_you',
            'song'
          );

          const topTenWithPromotion = mergedTopTen.map(({ item, isPromoted }) => ({
            ...item,
            isPromoted: item.isPromoted || isPromoted
          }));

          const mergedAdditional = await mergeAdditionalSongsWithPromotions(
            additional,
            'trending_near_you',
            'song'
          );

          const additionalWithPromotion = mergedAdditional.map(({ item, isPromoted }) => ({
            ...item,
            isPromoted: item.isPromoted || isPromoted
          }));

          setTopTenSongs(topTenWithPromotion);
          setAdditionalSongs(additionalWithPromotion);
          setCurrentCardIndex(0);
          setIsLoadingTopTen(false);
          setIsLoadingAdditional(false);
          return;
        }
      }

      const formattedAutoSongs: TrendingSong[] = filteredData.map((song: any) => {
        // RPC function returns flat structure with artist, artist_id, artist_user_id
        return {
          id: song.id,
          title: song.title,
          artist: song.artist || 'Unknown Artist',
          artist_id: song.artist_id || '',
          artist_user_id: song.artist_user_id || null,
          cover_image_url: song.cover_image_url,
          audio_url: song.audio_url,
          duration_seconds: song.duration_seconds || 0,
          play_count: song.play_count || 0,
          artist_profile_photo: null,
          isPromoted: promotedSongIds.includes(song.id)
        };
      });

      // Fetch promoted songs that aren't in the current country's trending list
      const promotedSongsNotInList = promotedSongIds.filter(id =>
        !formattedAutoSongs.some(s => s.id === id) &&
        !formattedManualSongs.some(s => s.id === id)
      );
      let promotedSongsData: TrendingSong[] = [];

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
              artist_id: song.artists?.id || '',
              artist_user_id: artistUserId,
              cover_image_url: song.cover_image_url,
              audio_url: song.audio_url,
              duration_seconds: song.duration_seconds || 0,
              play_count: song.play_count || 0,
              artist_profile_photo: song.artists?.artist_profiles?.[0]?.profile_photo_url || null,
              isPromoted: true
            };
          });
        }
      }

      // Remove promoted songs from original positions
      const nonPromotedSongs = formattedAutoSongs.filter(s => !s.isPromoted);
      const existingPromotedSongs = formattedAutoSongs.filter(s => s.isPromoted);

      // Combine: manual songs first (ordered by display_order), then promoted, then regular trending
      // Remove duplicates (manual songs take priority, then promoted, then auto-trending)
      const manualSongIds = new Set(formattedManualSongs.map(s => s.id));
      const promotedSongIdsSet = new Set([...promotedSongsData.map(s => s.id), ...existingPromotedSongs.map(s => s.id)]);
      const autoSongsFiltered = nonPromotedSongs.filter(s => !manualSongIds.has(s.id) && !promotedSongIdsSet.has(s.id));

      // Final order: manual songs (by display_order) > promoted songs > auto-trending songs
      const allCombinedSongs = [...formattedManualSongs, ...promotedSongsData, ...existingPromotedSongs, ...autoSongsFiltered];
      console.log('[TrendingNearYouViewAll] Combined songs breakdown:');
      console.log('  - Manual:', formattedManualSongs.length);
      console.log('  - Promoted (new):', promotedSongsData.length);
      console.log('  - Promoted (existing):', existingPromotedSongs.length);
      console.log('  - Auto:', autoSongsFiltered.length);
      console.log('  - Total combined:', allCombinedSongs.length);

      // Split into top 10 and additional (11+)
      const topTen = allCombinedSongs.slice(0, 10);
      const additional = allCombinedSongs.slice(10);
      console.log('[TrendingNearYouViewAll] Split into:', topTen.length, 'top ten,', additional.length, 'additional');

      // Process top 10 with promotions
      const mergedTopTen = await mergeTrendingContentWithPromotions(
        topTen,
        'trending_near_you',
        'song'
      );

      const topTenWithPromotion = mergedTopTen.map(({ item, isPromoted }) => ({
        ...item,
        isPromoted: item.isPromoted || isPromoted
      }));

      // Process additional songs with promotions
      const mergedAdditional = await mergeAdditionalSongsWithPromotions(
        additional,
        'trending_near_you',
        'song'
      );

      const additionalWithPromotion = mergedAdditional.map(({ item, isPromoted }) => ({
        ...item,
        isPromoted: item.isPromoted || isPromoted
      }));

      console.log('[TrendingNearYouViewAll] Final results:', topTenWithPromotion.length, 'top ten,', additionalWithPromotion.length, 'additional');
      setTopTenSongs(topTenWithPromotion);
      setAdditionalSongs(additionalWithPromotion);
      setCurrentCardIndex(0);
      setIsLoadingTopTen(false);
      setIsLoadingAdditional(false);
    } catch (err) {
      console.error("Error fetching all songs:", err);
      setTopTenSongs([]);
      setAdditionalSongs([]);
      setIsLoadingTopTen(false);
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
    if (currentCardIndex < topTenSongs.length - 1) {
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

  const handlePlaySong = async (song: TrendingSong) => {
    if (!song.audio_url) {
      alert('This song is not available for playback.');
      return;
    }

    if (song.isPromoted) {
      await recordPromotedContentClick(song.id, 'trending_near_you', 'song');
    }

    const formattedSong: Song = {
      id: song.id,
      title: song.title,
      artist: song.artist,
      artistId: song.artist_id,
      coverImageUrl: song.cover_image_url,
      audioUrl: song.audio_url,
      duration: song.duration_seconds,
      playCount: song.play_count,
      artistProfilePhoto: song.artist_profile_photo
    };

    if (onOpenMusicPlayer) {
      onOpenMusicPlayer(formattedSong);
    }
  };

  const handleToggleFavorite = async (songId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const previousState = isFavorited[songId];
      setIsFavorited(prev => ({ ...prev, [songId]: !previousState }));

      const newState = await toggleSongFavorite(songId);
      setIsFavorited(prev => ({ ...prev, [songId]: newState }));
    } catch (err) {
      console.error('Error toggling favorite:', err);
      const previousState = isFavorited[songId];
      setIsFavorited(prev => ({ ...prev, [songId]: previousState }));
    }
  };

  const handleShare = async (song: TrendingSong, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await shareSong(song.id, song.title, song.artist);
    } catch (error) {
      console.error('Error sharing song:', error);
    }
  };

  const formatPlayCount = (count: number): string => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  const currentSong = topTenSongs[currentCardIndex];
  const prevSong = currentCardIndex > 0 ? topTenSongs[currentCardIndex - 1] : null;
  const nextSong = currentCardIndex < topTenSongs.length - 1 ? topTenSongs[currentCardIndex + 1] : null;

  const getSelectedGenreName = () => {
    if (selectedGenre === 'all') return 'Overall';
    const genre = genres.find(g => g.id === selectedGenre);
    return genre ? genre.name : 'Overall';
  };

  if (isLocationLoading) {
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
            <h1 className="font-bold text-lg">Trending Near You</h1>
            <div className="w-10"></div>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-400 text-sm">Detecting your location...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!location || !location.detected || !location.location?.countryCode) {
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
            <h1 className="font-bold text-lg">Trending Near You</h1>
            <div className="w-10"></div>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center">
            <MapPin className="w-12 h-12 text-white/30 mx-auto mb-3" />
            <h3 className="font-semibold text-lg text-gray-300 mb-2">Location Not Available</h3>
            <p className="text-gray-500 text-sm">Unable to detect your location. Please enable location services.</p>
          </div>
        </div>
      </div>
    );
  }

  const countryName = location.location.country;
  const countryCode = location.location.countryCode;
  const countryFlag = getCountryFlag(countryCode);

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav overflow-y-auto">
      {/* Header */}
      <header className="w-full py-4 px-5 sticky top-0 z-20 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="p-2 hover:bg-white/10 rounded-full transition-all"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="flex flex-col items-center">
            <h1 className="font-bold text-lg">Trending Near You</h1>
            <p className="text-xs text-white/60 flex items-center gap-1.5 mt-0.5">
              <MapPin className="w-3 h-3" />
              {countryName} {countryFlag}
            </p>
          </div>
          <div className="w-10"></div>
        </div>
      </header>

      {/* Genre Filter */}
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
          {/* Skeleton for Main Carousel */}
          <div className="relative h-[380px] mb-6">
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[85%] max-w-sm h-[360px]">
              <Skeleton variant="rectangular" className="w-full h-full rounded-3xl bg-white/10" />
            </div>
          </div>
          {/* Skeleton for Indicators */}
          <div className="flex justify-center gap-2 mb-8">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} variant="rectangular" className="h-1.5 w-1.5 rounded-full bg-white/20" />
            ))}
          </div>
          {/* Skeleton for Additional Songs Grid */}
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
      ) : topTenSongs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center">
            <MapPin className="w-12 h-12 text-white/30 mx-auto mb-3" />
            <h3 className="font-semibold text-lg text-gray-300 mb-2">No Songs Found</h3>
            <p className="text-gray-500 text-sm">No trending songs found in {countryName} yet</p>
          </div>
        </div>
      ) : (
        <>
          {/* Main Carousel Card */}
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
              {/* Previous Card (Left, Blurred) */}
              {prevSong && (
                <div
                  key={`prev-${prevSong.id}`}
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-32 h-[300px] z-0 blur-sm"
                  style={{
                    opacity: dragOffset > 0 ? Math.min(0.8, 0.5 + (dragOffset / 200) * 0.3) : 0.5,
                    transform: `translateY(-50%) scale(${1 + Math.max(0, dragOffset / 400)})`,
                    transition: isDragging ? 'none' : 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  }}
                >
                  <LazyImage
                    src={prevSong.cover_image_url || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
                    alt={prevSong.title}
                    className="w-full h-full object-cover rounded-2xl"
                  />
                </div>
              )}

              {/* Current Card (Center) */}
              {currentSong && (
                <div
                  key={`current-${currentSong.id}`}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[85%] max-w-sm h-[360px] z-10 cursor-pointer"
                  style={{
                    transform: `translate(-50%, -50%) translateX(${dragOffset}px) rotate(${dragOffset * 0.05}deg)`,
                    transition: isDragging ? 'none' : 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  }}
                >
                  <div className="relative w-full h-full rounded-3xl overflow-hidden shadow-2xl">
                    <LazyImage
                      src={currentSong.cover_image_url || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
                      alt={currentSong.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent"></div>

                    {/* Promoted Badge - Top Left */}
                    {currentSong.isPromoted && (
                      <div className="absolute top-4 left-4 px-3 py-1.5 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full shadow-lg flex items-center gap-1.5">
                        <Flame className="w-3.5 h-3.5 text-white" />
                        <span className="text-xs font-semibold text-white">Promoted</span>
                      </div>
                    )}

                    {/* Song Info - Bottom */}
                    <div className="absolute bottom-0 left-0 right-0 p-6">
                      <div className="flex items-center justify-between mb-2">
                        <h2 className="text-white text-lg font-bold drop-shadow-lg flex-1 pr-3 line-clamp-1">{currentSong.title}</h2>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handlePlaySong(currentSong);
                          }}
                          onTouchStart={(e) => e.stopPropagation()}
                          onTouchMove={(e) => e.stopPropagation()}
                          onTouchEnd={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handlePlaySong(currentSong);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="w-14 h-14 rounded-full bg-white flex items-center justify-center active:scale-95 transition-transform shadow-xl flex-shrink-0 z-20"
                        >
                          <Play className="w-6 h-6 text-black ml-1" fill="black" />
                        </button>
                      </div>
                      <div className="flex items-center gap-4 -mt-5">
                        <div className="flex items-center gap-1.5 text-white/80">
                          <Play className="w-4 h-4" />
                          <span className="text-sm">{formatPlayCount(currentSong.play_count)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Next Card (Right, Blurred) */}
              {nextSong && (
                <div
                  key={`next-${nextSong.id}`}
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-32 h-[300px] z-0 blur-sm"
                  style={{
                    opacity: dragOffset < 0 ? Math.min(0.8, 0.5 + (Math.abs(dragOffset) / 200) * 0.3) : 0.5,
                    transform: `translateY(-50%) scale(${1 + Math.max(0, Math.abs(dragOffset) / 400)})`,
                    transition: isDragging ? 'none' : 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  }}
                >
                  <LazyImage
                    src={nextSong.cover_image_url || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
                    alt={nextSong.title}
                    className="w-full h-full object-cover rounded-2xl"
                  />
                </div>
              )}
            </div>

            {/* Carousel Indicators */}
            <div className="flex justify-center gap-2 mt-6">
              {topTenSongs.map((_, index) => (
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

          {/* Additional Songs Grid (11+) with AdMob Ads */}
          <div className="px-5 py-6">
            <h2 className="text-xl font-bold mb-4">More Trending {getSelectedGenreName()} Songs in {countryName}</h2>
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
            ) : gridItems.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-gray-500 text-sm">No more songs available</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {gridItems.map((item) => {
                  if (item.isAd) {
                    // Render AdMob banner ad
                    return (
                      <div key={item.id} className="col-span-3 my-2">
                        <AdMobBanner show={true} />
                      </div>
                    );
                  } else if (!item.isAd && item.songData) {
                    // Render song card
                    const song = item.songData as TrendingSong;
                    return (
                      <div
                        key={item.id}
                        onClick={() => handlePlaySong(song)}
                        className="cursor-pointer group"
                      >
                        {/* Album Cover */}
                        <div className="relative w-full aspect-square rounded-lg overflow-hidden mb-2 bg-white/5">
                          <LazyImage
                            src={song.cover_image_url || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
                            alt={song.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-300 flex items-center justify-center">
                            <Play className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300" fill="white" />
                          </div>
                          {song.isPromoted && (
                            <div className="absolute top-1.5 right-1.5 p-1 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full shadow-lg">
                              <Flame className="w-3 h-3 text-white" />
                            </div>
                          )}
                        </div>

                        {/* Song Info */}
                        <div className="text-left">
                          <h3 className="text-xs font-semibold text-white truncate mb-0.5">{song.title}</h3>
                          <p className="text-[10px] text-gray-400 truncate">{song.artist}</p>
                        </div>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

