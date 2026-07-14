import { useState, useEffect, useRef } from "react";
import { Search, TrendingUp, Music, Users, Video, X, Play, MoreHorizontal, Heart, UserPlus, ListPlus, Share2, Flag, ArrowLeft, Sparkles, RefreshCw } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { ScrollArea, ScrollBar } from "../../components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { LazyImage } from "../../components/LazyImage";
import { Skeleton } from "../../components/ui/skeleton";
import { supabase, searchAllContent } from "../../lib/supabase";
import { shareSong } from "../../lib/shareService";
import { AuthModal } from "../../components/AuthModal";
import { BottomActionSheet } from "../../components/BottomActionSheet";
import { Link, useNavigate } from "react-router-dom";
import { persistentCache } from "../../lib/persistentCache";
import { useMusicPlayer } from "../../contexts/MusicPlayerContext";

interface ExploreScreenProps {
  onFormVisibilityChange?: (isVisible: boolean) => void;
  onOpenMusicPlayer?: (song: Song, playlist?: Song[], context?: string) => void;
  onModalVisibilityChange?: (isVisible: boolean) => void;
}

interface Song {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  coverImageUrl?: string | null;
  audioUrl?: string | null;
  duration?: number;
  playCount?: number;
}

interface FeaturedArtist {
  id: string;
  artistId: string;
  userId: string;
  name: string;
  imageUrl: string | null;
  region: string;
  verified: boolean;
  weeklyGrowth: number;
  totalLikes: number;
  isFollowing?: boolean;
}

const GENRES_CACHE_KEY = 'explore_genres_processed';
const FEATURED_CACHE_KEY = 'explore_featured_artists_processed';
const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes - shorter cache for fresher genre updates

export const ExploreScreen = ({ onFormVisibilityChange, onOpenMusicPlayer, onModalVisibilityChange }: ExploreScreenProps): JSX.Element => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [genres, setGenres] = useState<any[]>([]);
  const [allGenres, setAllGenres] = useState<any[]>([]);
  const [showAllGenres, setShowAllGenres] = useState(false);
  const [featuredArtists, setFeaturedArtists] = useState<FeaturedArtist[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFeaturedLoading, setIsFeaturedLoading] = useState(true);
  const isInitialMount = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [userRegion, setUserRegion] = useState<string>('global');
  const { playSong } = useMusicPlayer();

  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any>({ all: [], songs: [], creators: [], videos: [] });
  const [searchTab, setSearchTab] = useState('all');
  const [selectedSongForMenu, setSelectedSongForMenu] = useState<Song | null>(null);
  const [isActionSheetOpen, setIsActionSheetOpen] = useState(false);

  useEffect(() => {
    onFormVisibilityChange?.(showAuthModal);
    onModalVisibilityChange?.(false);
  }, [showAuthModal, onFormVisibilityChange, onModalVisibilityChange]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setSearchQuery('');
        setSearchResults({ all: [], songs: [], creators: [], videos: [] });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load cached data on mount
  useEffect(() => {
    const loadCachedData = async () => {
      if (isInitialMount.current) {
        const [cachedGenres, cachedFeatured] = await Promise.all([
          persistentCache.get<any[]>(GENRES_CACHE_KEY),
          persistentCache.get<FeaturedArtist[]>(FEATURED_CACHE_KEY)
        ]);

        if (cachedGenres && cachedGenres.length > 0) {
          setGenres(cachedGenres.slice(0, 10));
          setAllGenres(cachedGenres);
          setIsLoading(false);
        }
        if (cachedFeatured && cachedFeatured.length > 0) {
          setFeaturedArtists(cachedFeatured);
          setIsFeaturedLoading(false);
        }
        isInitialMount.current = false;
      }
    };
    loadCachedData();
  }, []);

  useEffect(() => {
    fetchData();
    fetchFeaturedArtists();
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchQuery.trim().length >= 2) {
        performSearch(searchQuery);
      } else {
        setSearchResults({ all: [], songs: [], creators: [], videos: [] });
        setIsSearching(false);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  // Fisher-Yates shuffle algorithm for randomizing arrays
  const shuffleArray = <T,>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Fetch genres with song counts (only genres that have songs)
      const { data: genresWithCounts, error: genresError } = await supabase
        .from('genres')
        .select(`
          id,
          name,
          description,
          image_url,
          song_genres (
            song_id
          )
        `)
        .order('name');

      if (genresError) throw new Error(`Error fetching genres: ${genresError.message}`);

      // Filter genres that have at least one song and calculate counts
      const genresWithSongCounts = genresWithCounts
        .map((genre: any) => ({
          id: genre.id,
          name: genre.name,
          description: genre.description,
          image_url: genre.image_url,
          songCount: genre.song_genres?.length || 0
        }))
        .filter((genre: any) => genre.songCount > 0);

      // Shuffle genres for fresh experience every time
      const shuffledGenres = shuffleArray(genresWithSongCounts);

      // Process all genres with images and counts
      const processedAllGenres = shuffledGenres.map((genre, index) => ({
        id: genre.id,
        name: genre.name,
        description: genre.description,
        image: genre.image_url || getGenrePlaceholderImage(index),
        count: `${genre.songCount} ${genre.songCount === 1 ? 'Song' : 'Songs'}`,
        songCount: genre.songCount
      }));

      setAllGenres(processedAllGenres);
      // Initially show only first 6 genres
      setGenres(processedAllGenres.slice(0, 6));
      // Cache genres
      await persistentCache.set(GENRES_CACHE_KEY, processedAllGenres, CACHE_DURATION);
    } catch (err) {
      console.error("Error fetching data:", err);
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchFeaturedArtists = async () => {
    setIsFeaturedLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();

      let region = 'global';
      if (session) {
        const { data: userData } = await supabase
          .from('users')
          .select('country')
          .eq('id', session.user.id)
          .maybeSingle();

        if (userData?.country) {
          region = userData.country;
          setUserRegion(region);
        }
      }

      const { data: featuredData, error: featuredError } = await supabase
        .from('featured_artists')
        .select(`
          id,
          artist_id,
          user_id,
          region,
          weekly_growth_percentage,
          total_likes_last_week,
          priority_order,
          artists:artist_id (
            id,
            name,
            image_url,
            verified
          )
        `)
        .eq('status', 'active')
        .lte('featured_start_date', new Date().toISOString())
        .gte('featured_end_date', new Date().toISOString())
        .order('priority_order', { ascending: true })
        .limit(10);

      if (featuredError) throw featuredError;

      const regionalArtists = featuredData?.filter(fa => fa.region === region) || [];
      const globalArtists = featuredData?.filter(fa => fa.region === 'global') || [];
      const otherArtists = featuredData?.filter(fa => fa.region !== region && fa.region !== 'global') || [];

      const sortedArtists = [...regionalArtists, ...globalArtists, ...otherArtists];

      const uniqueArtistIds = new Set<string>();
      const deduplicatedArtists = sortedArtists.filter(fa => {
        if (uniqueArtistIds.has(fa.artist_id)) {
          return false;
        }
        uniqueArtistIds.add(fa.artist_id);
        return true;
      });

      let followingStatus: Record<string, boolean> = {};
      if (session) {
        const { data: followData } = await supabase
          .from('user_follows')
          .select('following_id')
          .eq('follower_id', session.user.id)
          .in('following_id', deduplicatedArtists.map(fa => fa.user_id));

        followingStatus = (followData || []).reduce((acc, f) => {
          acc[f.following_id] = true;
          return acc;
        }, {} as Record<string, boolean>);
      }

      const processedArtists: FeaturedArtist[] = deduplicatedArtists
        .map((fa: any) => ({
          id: fa.id,
          artistId: fa.artist_id,
          userId: fa.user_id,
          name: fa.artists?.name || 'Unknown Artist',
          imageUrl: fa.artists?.image_url || null,
          region: fa.region,
          verified: fa.artists?.verified || false,
          weeklyGrowth: fa.weekly_growth_percentage || 0,
          totalLikes: fa.total_likes_last_week || 0,
          isFollowing: followingStatus[fa.user_id] || false
        }))
        .filter(artist => !artist.isFollowing);

      setFeaturedArtists(processedArtists);
      // Cache featured artists
      await persistentCache.set(FEATURED_CACHE_KEY, processedArtists, CACHE_DURATION);
    } catch (err) {
      console.error("Error fetching featured artists:", err);
    } finally {
      setIsFeaturedLoading(false);
    }
  };

  const handleFollowToggle = async (artist: FeaturedArtist, e: React.MouseEvent) => {
    e.stopPropagation();

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setShowAuthModal(true);
      return;
    }

    try {
      if (artist.isFollowing) {
        await supabase
          .from('user_follows')
          .delete()
          .eq('follower_id', session.user.id)
          .eq('following_id', artist.userId);

        setFeaturedArtists(prev =>
          prev.map(a =>
            a.id === artist.id ? { ...a, isFollowing: false } : a
          )
        );
      } else {
        await supabase
          .from('user_follows')
          .insert({
            follower_id: session.user.id,
            following_id: artist.userId
          });

        // Remove the artist from the list after following
        setFeaturedArtists(prev =>
          prev.filter(a => a.id !== artist.id)
        );
      }
    } catch (err) {
      console.error('Error toggling follow:', err);
    }
  };

  const performSearch = async (query: string) => {
    if (!query.trim()) return;

    setIsSearching(true);
    try {
      const results = await searchAllContent(query);
      setSearchResults(results);
    } catch (err) {
      console.error("Error searching content:", err);
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setIsSearching(false);
    }
  };

  const handlePlaySong = (song: Song) => {
    if (!song.audioUrl) {
      alert('This song is not available for playback.');
      return;
    }

    if (onOpenMusicPlayer) {
      onOpenMusicPlayer(song, [], 'Explore');
    }
  };

  const getGenrePlaceholderImage = (index: number): string => {
    const placeholders = [
      "https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400", // Concert/Stage
      "https://images.pexels.com/photos/167636/pexels-photo-167636.jpeg?auto=compress&cs=tinysrgb&w=400", // Piano keys
      "https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=400", // DJ/Electronic
      "https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=400", // Microphone
      "https://images.pexels.com/photos/164821/pexels-photo-164821.jpeg?auto=compress&cs=tinysrgb&w=400", // Drums
      "https://images.pexels.com/photos/33597/guitar-classical-guitar-acoustic-guitar-electric-guitar.jpg?auto=compress&cs=tinysrgb&w=400", // Guitar
      "https://images.pexels.com/photos/1916824/pexels-photo-1916824.jpeg?auto=compress&cs=tinysrgb&w=400", // Vinyl/Records
      "https://images.pexels.com/photos/1267697/pexels-photo-1267697.jpeg?auto=compress&cs=tinysrgb&w=400", // Live Performance
      "https://images.pexels.com/photos/3971985/pexels-photo-3971985.jpeg?auto=compress&cs=tinysrgb&w=400", // Saxophone/Jazz
      "https://images.pexels.com/photos/210887/pexels-photo-210887.jpeg?auto=compress&cs=tinysrgb&w=400", // Studio/Mixing
      "https://images.pexels.com/photos/1047442/pexels-photo-1047442.jpeg?auto=compress&cs=tinysrgb&w=400", // Crowd/Festival
      "https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg?auto=compress&cs=tinysrgb&w=400" // Headphones/Listening
    ];
    return placeholders[index % placeholders.length];
  };

  const handleGenreClick = (genre: { id: string; name: string }) => {
    navigate(`/genre/${genre.id}`);
  };

  const handleToggleViewMore = () => {
    if (showAllGenres) {
      // Collapse back to first 6 genres
      setGenres(allGenres.slice(0, 6));
      setShowAllGenres(false);
    } else {
      // Expand to show all genres
      setGenres(allGenres);
      setShowAllGenres(true);
    }
  };

  const handleRefreshGenres = async () => {
    setIsLoading(true);
    // Clear cache and fetch fresh data
    await persistentCache.delete(GENRES_CACHE_KEY);
    await fetchData();
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSearchResults({ all: [], songs: [], artists: [], videos: [], users: [] });
  };

  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    fetchFeaturedArtists();
  };

  const handleShowAuthModal = () => {
    setShowAuthModal(true);
  };

  const handleOpenSongMenu = (song: Song, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedSongForMenu(song);
    setIsActionSheetOpen(true);
  };

  const handleAddToPlaylist = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setShowAuthModal(true);
      return;
    }
  };

  const handleShare = async () => {
    if (selectedSongForMenu) {
      try {
        await shareSong(selectedSongForMenu.id, selectedSongForMenu.title, selectedSongForMenu.artist);
      } catch (error) {
        console.error('Error sharing song:', error);
      }
    }
  };

  const handleReport = () => {
    alert('Report functionality will be implemented soon');
  };

  const songMenuActions = [
    {
      label: 'Add to Playlist',
      icon: <ListPlus className="w-5 h-5" />,
      onClick: handleAddToPlaylist,
    },
    {
      label: 'Share',
      icon: <Share2 className="w-5 h-5" />,
      onClick: handleShare,
    },
    {
      label: 'Report',
      icon: <Flag className="w-5 h-5" />,
      onClick: handleReport,
      variant: 'destructive' as const,
    },
  ];

  const isSearchMode = searchQuery.trim().length >= 2;

  return (
    <div className="flex flex-col content-with-nav min-h-screen min-h-[100dvh] overflow-y-auto bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000]">
      <header className="w-full py-6 px-6 sticky top-0 z-20 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-white/10 rounded-full transition-all duration-200 active:scale-95"
            aria-label="Go back"
          >
            <ArrowLeft className="w-6 h-6 text-white" />
          </button>
          <h1 className="font-['Inter',sans-serif] font-bold text-white text-2xl tracking-tight">
            Explore Music
          </h1>
        </div>

        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-white/60" />
          <input
            type="text"
            placeholder="Search songs, artists, albums..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-12 pl-12 pr-10 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/30 transition-all duration-200 font-['Inter',sans-serif]"
          />
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-4 top-1/2 transform -translate-y-1/2 p-1 hover:bg-white/10 rounded-full transition-colors duration-200 active:scale-95"
            >
              <X className="w-4 h-4 text-white/60" />
            </button>
          )}
        </div>

        {!isSearchMode && (
          <ScrollArea className="w-full">
            <div className="flex space-x-3 pb-2">
              <button
                onClick={() => navigate('/mood-discovery')}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#309605] to-[#3ba208] text-white shadow-lg rounded-full transition-all duration-200 whitespace-nowrap active:scale-95 hover:opacity-90 font-['Inter',sans-serif]"
              >
                <Sparkles className="w-4 h-4" />
                <span className="font-semibold text-sm">Mood</span>
              </button>
              <button className="flex items-center gap-2 px-5 py-2.5 bg-white text-black shadow-lg rounded-full transition-all duration-200 whitespace-nowrap active:scale-95 font-['Inter',sans-serif]">
                <TrendingUp className="w-4 h-4" />
                <span className="font-semibold text-sm">All</span>
              </button>
              <button className="flex items-center gap-2 px-5 py-2.5 bg-white/10 text-white/80 hover:bg-white/20 hover:text-white rounded-full transition-all duration-200 whitespace-nowrap active:scale-95 font-['Inter',sans-serif]">
                <Music className="w-4 h-4" />
                <span className="font-semibold text-sm">Genre</span>
              </button>
              <button className="flex items-center gap-2 px-5 py-2.5 bg-white/10 text-white/80 hover:bg-white/20 hover:text-white rounded-full transition-all duration-200 whitespace-nowrap active:scale-95 font-['Inter',sans-serif]">
                <Users className="w-4 h-4" />
                <span className="font-semibold text-sm">Artists</span>
              </button>
            </div>
            <ScrollBar orientation="horizontal" className="opacity-0" />
          </ScrollArea>
        )}

        {isSearchMode && (
          <Tabs
            defaultValue="all"
            value={searchTab}
            onValueChange={setSearchTab}
            className="w-full"
          >
            <TabsList className="w-full bg-white/5 p-1 rounded-xl grid grid-cols-4 gap-1">
              <TabsTrigger value="all" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-black font-['Inter',sans-serif] font-semibold text-xs transition-all duration-200">
                All
              </TabsTrigger>
              <TabsTrigger value="songs" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-black font-['Inter',sans-serif] font-semibold text-xs transition-all duration-200">
                Songs
              </TabsTrigger>
              <TabsTrigger value="creators" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-black font-['Inter',sans-serif] font-semibold text-xs transition-all duration-200">
                Creators
              </TabsTrigger>
              <TabsTrigger value="videos" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-black font-['Inter',sans-serif] font-semibold text-xs transition-all duration-200">
                Videos
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </header>

      {error && !isSearchMode ? (
        <div className="flex-1 px-6 flex items-center justify-center">
          <Card className="bg-red-500/20 border border-red-500/30 w-full">
            <CardContent className="p-6 text-center">
              <p className="text-red-400 text-sm mb-4 font-['Inter',sans-serif]">{error}</p>
              <button
                onClick={fetchData}
                className="px-4 py-2 bg-red-500/30 hover:bg-red-500/40 rounded-lg text-red-400 text-sm transition-colors duration-200 font-['Inter',sans-serif] font-semibold active:scale-95"
              >
                Try Again
              </button>
            </CardContent>
          </Card>
        </div>
      ) : isSearchMode ? (
        <div className="flex-1 px-6">
          <Tabs value={searchTab} className="w-full">
              <TabsContent value="all" className="mt-4">
                {searchResults.all.length === 0 ? (
                  <Card className="bg-white/5 backdrop-blur-sm border border-white/10">
                    <CardContent className="p-8 text-center">
                      <p className="text-white/70 text-sm font-['Inter',sans-serif]">No results found for "{searchQuery}"</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-6">
                    {searchResults.creators.length > 0 && (
                      <div>
                        <div className="grid grid-cols-2 gap-3">
                          {searchResults.creators.slice(0, 4).map((creator: any) => (
                            <Card
                              key={`creator-${creator.id}`}
                              className="bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 cursor-pointer active:scale-95 shadow-lg hover:shadow-xl"
                              onClick={() => {
                                if (!creator.userId) {
                                  console.error('Creator profile not available:', creator.name);
                                  alert('This creator profile is not available at the moment.');
                                  return;
                                }
                                window.location.href = `/user/${creator.userId}`;
                              }}
                            >
                              <CardContent className="p-4 text-center">
                                <div className="w-20 h-20 mx-auto mb-3 rounded-full overflow-hidden bg-white/10 shadow-lg">
                                  {creator.imageUrl ? (
                                    <img
                                      src={creator.imageUrl}
                                      alt={creator.name}
                                      className="w-full h-full object-cover"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <Users className="w-10 h-10 text-white/60" />
                                    </div>
                                  )}
                                </div>
                                <h4 className="font-['Inter',sans-serif] font-semibold text-white text-sm truncate">
                                  {creator.name}
                                </h4>
                                {creator.username && (
                                  <p className="text-white/60 text-xs font-['Inter',sans-serif] truncate mt-1">
                                    @{creator.username}
                                  </p>
                                )}
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                        {searchResults.creators.length > 4 && (
                          <button
                            onClick={() => setSearchTab('creators')}
                            className="w-full py-2.5 text-center text-orange-400 hover:text-orange-300 text-sm font-['Inter',sans-serif] font-semibold transition-colors duration-200 mt-3"
                          >
                            View all {searchResults.creators.length} creators
                          </button>
                        )}
                      </div>
                    )}

                    {searchResults.songs.length > 0 && (
                      <div>
                        <h3 className="font-['Inter',sans-serif] font-bold text-white text-lg mb-4 tracking-tight">Songs</h3>
                        <div className="space-y-3">
                          {searchResults.songs.slice(0, 3).map((song: any) => (
                            <Card
                              key={`song-${song.id}`}
                              className="relative z-10 bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 active:scale-[0.99] shadow-lg hover:shadow-xl hover:z-20"
                            >
                              <CardContent className="p-4">
                                <div className="flex items-center gap-4">
                                  <button
                                    onClick={() => handlePlaySong({
                                      id: song.id,
                                      title: song.title,
                                      artist: song.artist,
                                      artistId: song.artistId,
                                      coverImageUrl: song.coverImageUrl,
                                      audioUrl: song.audioUrl,
                                      duration: song.duration,
                                      playCount: song.playCount
                                    })}
                                    disabled={!song.audioUrl}
                                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 bg-white/10 text-white/60 hover:bg-white/20 hover:text-white active:scale-95 shadow-md ${!song.audioUrl ? 'opacity-50 cursor-not-allowed' : ''}`}
                                  >
                                    <Play className="w-5 h-5 ml-1 fill-white/60" />
                                  </button>
                                  <div className="flex-1 min-w-0">
                                    <h4 className="font-['Inter',sans-serif] font-semibold text-white text-base truncate">
                                      {song.title}
                                    </h4>
                                    <p className="font-['Inter',sans-serif] text-white/70 text-sm truncate">
                                      {song.artistId ? (
                                        <Link
                                          to={`/user/${song.artistId}`}
                                          className="hover:text-white hover:underline transition-colors duration-200"
                                        >
                                          {song.artist}
                                        </Link>
                                      ) : (
                                        song.artist
                                      )}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <span className="font-['Inter',sans-serif] text-white/60 text-xs font-medium">
                                      {formatDuration(song.duration)}
                                    </span>
                                    <button
                                      onClick={(e) => handleOpenSongMenu({
                                        id: song.id,
                                        title: song.title,
                                        artist: song.artist,
                                        artistId: song.artistId,
                                        coverImageUrl: song.coverImageUrl,
                                        audioUrl: song.audioUrl,
                                        duration: song.duration,
                                        playCount: song.playCount
                                      }, e)}
                                      className="p-2 hover:bg-white/10 rounded-full transition-colors duration-200 active:scale-95"
                                    >
                                      <MoreHorizontal className="w-4 h-4 text-white/60" />
                                    </button>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                          {searchResults.songs.length > 3 && (
                            <button
                              onClick={() => setSearchTab('songs')}
                              className="w-full py-2.5 text-center text-orange-400 hover:text-orange-300 text-sm font-['Inter',sans-serif] font-semibold transition-colors duration-200"
                            >
                              View all {searchResults.songs.length} songs
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {searchResults.videos.length > 0 && (
                      <div>
                        <h3 className="font-['Inter',sans-serif] font-bold text-white text-lg mb-4 tracking-tight">Videos</h3>
                        <div className="space-y-3">
                          {searchResults.videos.slice(0, 3).map((video: any) => (
                            <Card
                              key={`video-${video.id}`}
                              className="relative z-10 bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 active:scale-[0.99] shadow-lg hover:shadow-xl hover:z-20"
                            >
                              <CardContent className="p-4">
                                <div className="flex items-center gap-4">
                                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-white/10 flex-shrink-0 shadow-lg">
                                    {video.thumbnailUrl ? (
                                      <img
                                        src={video.thumbnailUrl}
                                        alt={video.title}
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center">
                                        <Video className="w-10 h-10 text-white/60" />
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <h4 className="font-['Inter',sans-serif] font-semibold text-white text-base truncate">
                                      {video.title}
                                    </h4>
                                    <p className="font-['Inter',sans-serif] text-white/70 text-sm truncate">
                                      {video.artistId ? (
                                        <Link
                                          to={`/user/${video.artistId}`}
                                          className="hover:text-white hover:underline transition-colors duration-200"
                                        >
                                          {video.artist}
                                        </Link>
                                      ) : (
                                        video.artist
                                      )}
                                    </p>
                                    <div className="flex items-center gap-2 mt-1.5">
                                      <span className="px-2.5 py-1 bg-gradient-to-r from-orange-500/20 to-red-500/20 border border-orange-500/30 rounded-full text-orange-400 text-xs font-['Inter',sans-serif] font-medium">
                                        Video
                                      </span>
                                      <span className="font-['Inter',sans-serif] text-white/60 text-xs font-medium">
                                        {formatDuration(video.duration)}
                                      </span>
                                    </div>
                                  </div>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      alert('Video options will be implemented soon');
                                    }}
                                    className="p-2 hover:bg-white/10 rounded-full transition-colors duration-200 active:scale-95"
                                  >
                                    <MoreHorizontal className="w-5 h-5 text-white/60" />
                                  </button>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                          {searchResults.videos.length > 3 && (
                            <button
                              onClick={() => setSearchTab('videos')}
                              className="w-full py-2.5 text-center text-orange-400 hover:text-orange-300 text-sm font-['Inter',sans-serif] font-semibold transition-colors duration-200"
                            >
                              View all {searchResults.videos.length} videos
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="songs" className="mt-4">
                {searchResults.songs.length === 0 ? (
                  <Card className="bg-white/5 backdrop-blur-sm border border-white/10">
                    <CardContent className="p-8 text-center">
                      <p className="text-white/70 text-sm font-['Inter',sans-serif]">No songs found for "{searchQuery}"</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {searchResults.songs.map((song: any) => (
                      <Card
                        key={`song-full-${song.id}`}
                        className="relative z-10 bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 active:scale-[0.99] shadow-lg hover:shadow-xl hover:z-20"
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center gap-4">
                            <button
                              onClick={() => handlePlaySong({
                                id: song.id,
                                title: song.title,
                                artist: song.artist,
                                artistId: song.artistId,
                                coverImageUrl: song.coverImageUrl,
                                audioUrl: song.audioUrl,
                                duration: song.duration,
                                playCount: song.playCount
                              })}
                              disabled={!song.audioUrl}
                              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 bg-white/10 text-white/60 hover:bg-white/20 hover:text-white active:scale-95 shadow-md ${!song.audioUrl ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                              <Play className="w-5 h-5 ml-1 fill-white/60" />
                            </button>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-['Inter',sans-serif] font-semibold text-white text-base truncate">
                                {song.title}
                              </h4>
                              <p className="font-['Inter',sans-serif] text-white/70 text-sm truncate">
                                {song.artistId ? (
                                  <Link
                                    to={`/user/${song.artistId}`}
                                    className="hover:text-white hover:underline transition-colors duration-200"
                                  >
                                    {song.artist}
                                  </Link>
                                ) : (
                                  song.artist
                                )}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-['Inter',sans-serif] text-white/60 text-xs font-medium">
                                {formatDuration(song.duration)}
                              </span>
                              <button className="p-2 hover:bg-white/10 rounded-full transition-colors duration-200 active:scale-95">
                                <Heart className="w-4 h-4 text-white/60" />
                              </button>
                              <button
                                onClick={(e) => handleOpenSongMenu({
                                  id: song.id,
                                  title: song.title,
                                  artist: song.artist,
                                  artistId: song.artistId,
                                  coverImageUrl: song.coverImageUrl,
                                  audioUrl: song.audioUrl,
                                  duration: song.duration,
                                  playCount: song.playCount
                                }, e)}
                                className="p-2 hover:bg-white/10 rounded-full transition-colors duration-200 active:scale-95"
                              >
                                <MoreHorizontal className="w-4 h-4 text-white/60" />
                              </button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="creators" className="mt-4">
                {searchResults.creators.length === 0 ? (
                  <Card className="bg-white/5 backdrop-blur-sm border border-white/10">
                    <CardContent className="p-8 text-center">
                      <p className="text-white/70 text-sm font-['Inter',sans-serif]">No creators found for "{searchQuery}"</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {searchResults.creators.map((creator: any) => (
                      <Card
                        key={`creator-full-${creator.id}`}
                        className="bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 cursor-pointer active:scale-95 shadow-lg hover:shadow-xl"
                        onClick={() => {
                          if (!creator.userId) {
                            console.error('Creator profile not available:', creator.name);
                            alert('This creator profile is not available at the moment.');
                            return;
                          }
                          window.location.href = `/user/${creator.userId}`;
                        }}
                      >
                        <CardContent className="p-4 text-center">
                          <div className="w-24 h-24 mx-auto mb-3 rounded-full overflow-hidden bg-white/10 shadow-lg">
                            {creator.imageUrl ? (
                              <img
                                src={creator.imageUrl}
                                alt={creator.name}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Users className="w-12 h-12 text-white/60" />
                              </div>
                            )}
                          </div>
                          <h4 className="font-['Inter',sans-serif] font-semibold text-white text-base truncate">
                            {creator.name}
                          </h4>
                          {creator.username && (
                            <p className="text-white/60 text-xs font-['Inter',sans-serif] truncate mt-1">
                              @{creator.username}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="videos" className="mt-4">
                {searchResults.videos.length === 0 ? (
                  <Card className="bg-white/5 backdrop-blur-sm border border-white/10">
                    <CardContent className="p-8 text-center">
                      <p className="text-white/70 text-sm font-['Inter',sans-serif]">No videos found for "{searchQuery}"</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {searchResults.videos.map((video: any) => (
                      <Card
                        key={`video-full-${video.id}`}
                        className="relative z-10 bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 active:scale-[0.99] shadow-lg hover:shadow-xl hover:z-20"
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center gap-4">
                            <div className="w-20 h-20 rounded-xl overflow-hidden bg-white/10 flex-shrink-0 shadow-lg">
                              {video.thumbnailUrl ? (
                                <img
                                  src={video.thumbnailUrl}
                                  alt={video.title}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Video className="w-10 h-10 text-white/60" />
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-['Inter',sans-serif] font-semibold text-white text-base truncate">
                                {video.title}
                              </h4>
                              <p className="font-['Inter',sans-serif] text-white/70 text-sm truncate">
                                {video.artistId ? (
                                  <Link
                                    to={`/user/${video.artistId}`}
                                    className="hover:text-white hover:underline transition-colors duration-200"
                                  >
                                    {video.artist}
                                  </Link>
                                ) : (
                                  video.artist
                                )}
                              </p>
                              <div className="flex items-center gap-2 mt-1.5">
                                <span className="px-2.5 py-1 bg-gradient-to-r from-orange-500/20 to-red-500/20 border border-orange-500/30 rounded-full text-orange-400 text-xs font-['Inter',sans-serif] font-medium">
                                  Video
                                </span>
                                <span className="font-['Inter',sans-serif] text-white/60 text-xs font-medium">
                                  {formatDuration(video.duration)}
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                alert('Video options will be implemented soon');
                              }}
                              className="p-2 hover:bg-white/10 rounded-full transition-colors duration-200 active:scale-95"
                            >
                              <MoreHorizontal className="w-5 h-5 text-white/60" />
                            </button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

            </Tabs>
        </div>
      ) : (
        <div className="flex-1 px-6 space-y-8">
          <section>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl tracking-tight">
                  Browse by Genre
                </h2>
                <button
                  onClick={handleRefreshGenres}
                  disabled={isLoading}
                  className="p-1.5 hover:bg-white/10 rounded-full transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Refresh genres"
                >
                  <RefreshCw className={`w-4 h-4 text-white/60 hover:text-white ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
              {!isLoading && allGenres.length > 6 && (
                <button
                  onClick={handleToggleViewMore}
                  className="font-['Inter',sans-serif] text-sm font-semibold text-[#309605] hover:text-[#3ba208] transition-colors duration-200 active:scale-95"
                >
                  {showAllGenres ? 'Show Less' : 'View More'}
                </button>
              )}
            </div>
            {isLoading ? (
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-28 bg-white/5 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : genres.length > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {genres.map((genre) => (
                    <Card
                      key={genre.id}
                      onClick={() => handleGenreClick({ id: genre.id, name: genre.name })}
                      className="relative overflow-hidden rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 cursor-pointer group active:scale-95 shadow-lg hover:shadow-xl"
                    >
                      <CardContent className="p-0">
                        <div
                          className="h-28 bg-cover bg-center relative"
                          style={{ backgroundImage: `url(${genre.image})` }}
                        >
                          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent group-hover:from-black/80 transition-all duration-300"></div>
                          <div className="absolute bottom-3 left-3 right-3">
                            <h3 className="font-['Inter',sans-serif] font-bold text-white text-base tracking-tight">
                              {genre.name}
                            </h3>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            ) : (
              <Card className="bg-white/5 backdrop-blur-sm border border-white/10">
                <CardContent className="p-6 text-center">
                  <p className="text-white/70 text-sm font-['Inter',sans-serif]">No genres with songs available</p>
                </CardContent>
              </Card>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl tracking-tight">
                Featured Artists
              </h2>
              {userRegion !== 'global' && (
                <span className="font-['Inter',sans-serif] text-xs text-white/60 px-3 py-1.5 bg-white/10 rounded-full font-medium">
                  {userRegion}
                </span>
              )}
            </div>

            {isFeaturedLoading ? (
              <div className="flex space-x-4 overflow-hidden">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex-shrink-0 w-32">
                    <div className="w-32 h-32 bg-white/5 rounded-full animate-pulse mb-3" />
                    <div className="h-4 w-full bg-white/5 rounded animate-pulse mb-2" />
                    <div className="h-3 w-2/3 bg-white/5 rounded animate-pulse mx-auto" />
                  </div>
                ))}
              </div>
            ) : featuredArtists.length === 0 ? (
              <Card className="bg-white/5 backdrop-blur-sm border border-white/10">
                <CardContent className="p-6 text-center">
                  <p className="text-white/70 text-sm font-['Inter',sans-serif]">No featured artists available at the moment</p>
                </CardContent>
              </Card>
            ) : (
              <ScrollArea className="w-full">
                <div className="flex space-x-4 pb-4">
                  {featuredArtists.map((artist) => (
                    <div
                      key={artist.id}
                      className="w-28 flex-shrink-0 group cursor-pointer"
                      onClick={() => {
                        if (!artist.userId) {
                          console.error('Featured artist profile not available:', artist.name);
                          alert('This artist profile is not available at the moment.');
                          return;
                        }
                        window.location.href = `/user/${artist.userId}`;
                      }}
                    >
                      <div className="relative w-20 h-20 mx-auto mb-2">
                        <div className="w-full h-full rounded-full overflow-hidden bg-white/10 shadow-lg group-hover:shadow-xl transition-all duration-300">
                          {artist.imageUrl ? (
                            <LazyImage
                              src={artist.imageUrl}
                              alt={artist.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Users className="w-10 h-10 text-white/60" />
                            </div>
                          )}
                        </div>
                      </div>
                      <h3 className="font-['Inter',sans-serif] font-semibold text-white text-sm mb-2 group-hover:text-white/80 transition-colors duration-200 truncate text-center">
                        {artist.name}
                      </h3>
                      <button
                        onClick={(e) => handleFollowToggle(artist, e)}
                        className={`w-full py-2 rounded-full text-xs font-['Inter',sans-serif] font-semibold transition-all duration-200 flex items-center justify-center gap-1 active:scale-95 shadow-md ${
                          artist.isFollowing
                            ? 'bg-white/20 text-white hover:bg-white/30'
                            : 'bg-white text-black hover:bg-white/90'
                        }`}
                      >
                        <UserPlus className="w-3 h-3" />
                        {artist.isFollowing ? 'Following' : 'Follow'}
                      </button>
                    </div>
                  ))}
                </div>
                <ScrollBar orientation="horizontal" className="opacity-0" />
              </ScrollArea>
            )}
          </section>
        </div>
      )}

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={handleAuthSuccess}
        />
      )}

      <BottomActionSheet
        isOpen={isActionSheetOpen}
        onClose={() => {
          setIsActionSheetOpen(false);
          setSelectedSongForMenu(null);
        }}
        title={selectedSongForMenu ? `${selectedSongForMenu.title}` : 'Options'}
        actions={songMenuActions}
      />
    </div>
  );
};
