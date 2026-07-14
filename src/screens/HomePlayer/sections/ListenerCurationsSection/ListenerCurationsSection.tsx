import { useState, useEffect, memo, useRef, useCallback } from 'react';
import { ListMusic, Flame, Music, Disc3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../../lib/supabase';
import { persistentCache } from '../../../../lib/persistentCache';
import { getPromotedContentDetailed, recordPromotedContentClick } from '../../../../lib/promotionHelper';
import { Card, CardContent } from '../../../../components/ui/card';
import { ScrollArea, ScrollBar } from '../../../../components/ui/scroll-area';
import { useMusicPlayer } from '../../../../contexts/MusicPlayerContext';
import { useEngagementSync } from '../../../../hooks/useEngagementSync';

interface FeaturedContent {
  id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  song_count?: number;
  play_count: number;
  curator_id?: string;
  curator_name: string | null;
  curator_avatar?: string | null;
  featured_at?: string;
  created_at: string;
  isPromoted?: boolean;
  content_type: 'playlist' | 'song' | 'album';
  artist?: string;
  artist_id?: string;
  duration?: number;
  audio_url?: string | null;
}

const CACHE_KEY = 'listener_curations_section';
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

// Fisher-Yates shuffle algorithm
const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

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

export const ListenerCurationsSection = memo((): JSX.Element | null => {
  const [content, setContent] = useState<FeaturedContent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeBlink, setActiveBlink] = useState<string | null>(null);
  const navigate = useNavigate();
  const isInitialMount = useRef(true);
  const { playSong } = useMusicPlayer();

  // Real-time engagement sync
  useEngagementSync(useCallback((update) => {
    if (update.metric === 'play_count') {
      setContent(prevContent =>
        prevContent.map(item =>
          item.id === update.contentId &&
          ((update.contentType === 'song' && item.content_type === 'song') ||
           (update.contentType === 'album' && item.content_type === 'album'))
            ? { ...item, play_count: update.value }
            : item
        )
      );
    }
  }, []));

  // Load cached content on mount
  useEffect(() => {
    const loadCached = async () => {
      if (isInitialMount.current) {
        const cached = await persistentCache.get<FeaturedContent[]>(CACHE_KEY);
        if (cached && cached.length > 0) {
          // Shuffle cached content for fresh look
          setContent(shuffleArray(cached));
          setIsLoading(false);
        }
        isInitialMount.current = false;
      }
    };
    loadCached();
  }, []);

  useEffect(() => {
    let isMounted = true;

    const fetchFeaturedContent = async () => {
      try {
        // Fetch user-created playlists and promoted content only
        const [
          playlistsResult,
          promotedPlaylistsResult,
          promotedSongsResult,
          promotedAlbumsResult
        ] = await Promise.allSettled([
          supabase.rpc('get_featured_playlists', { limit_count: 20 }),
          getPromotedContentDetailed('listener_curations', 'playlist', 1),
          getPromotedContentDetailed('listener_curations', 'song', 1),
          getPromotedContentDetailed('listener_curations', 'album', 1)
        ]);

        if (!isMounted) return;

        let allContent: FeaturedContent[] = [];
        const promotedIds = new Set<string>();
        const contentIds = new Set<string>();

        // Process user-created playlists
        if (playlistsResult.status === 'fulfilled' && playlistsResult.value.data) {
          const playlists = playlistsResult.value.data.map((p: any) => ({
            ...p,
            content_type: 'playlist' as const
          }));
          allContent.push(...playlists);
          playlists.forEach((p: any) => contentIds.add(p.id));
        }

        // Collect promoted IDs and fetch missing promoted content
        // Note: Promoted playlists will already be in the playlists result, so we just mark them
        // But promoted songs/albums need to be fetched since they're not in the regular query
        const promotedToFetch: Array<{id: string, type: 'song' | 'album' | 'playlist'}> = [];

        if (promotedPlaylistsResult.status === 'fulfilled' && promotedPlaylistsResult.value.length > 0) {
          promotedPlaylistsResult.value.forEach((item: any) => {
            promotedIds.add(item.targetId);
            if (!contentIds.has(item.targetId)) {
              promotedToFetch.push({ id: item.targetId, type: 'playlist' });
            }
          });
        }
        if (promotedSongsResult.status === 'fulfilled' && promotedSongsResult.value.length > 0) {
          promotedSongsResult.value.forEach((item: any) => {
            promotedIds.add(item.targetId);
            // Songs are ONLY shown if promoted, so always add them
            promotedToFetch.push({ id: item.targetId, type: 'song' });
          });
        }
        if (promotedAlbumsResult.status === 'fulfilled' && promotedAlbumsResult.value.length > 0) {
          promotedAlbumsResult.value.forEach((item: any) => {
            promotedIds.add(item.targetId);
            // Albums are ONLY shown if promoted, so always add them
            promotedToFetch.push({ id: item.targetId, type: 'album' });
          });
        }

        // Fetch missing promoted content (playlists) or promoted songs/albums
        if (promotedToFetch.length > 0) {

          for (const item of promotedToFetch) {
            try {
              if (item.type === 'playlist') {
                const { data: playlistData } = await supabase
                  .from('playlists')
                  .select(`
                    id,
                    title,
                    description,
                    cover_image_url,
                    play_count,
                    curator_id,
                    created_at,
                    users!playlists_curator_id_fkey(id, username, avatar_url)
                  `)
                  .eq('id', item.id)
                  .maybeSingle();

                if (playlistData) {
                  allContent.unshift({
                    id: playlistData.id,
                    title: playlistData.title,
                    description: playlistData.description,
                    cover_image_url: playlistData.cover_image_url,
                    play_count: playlistData.play_count,
                    curator_id: playlistData.curator_id,
                    curator_name: playlistData.users?.username || 'Anonymous',
                    curator_avatar: playlistData.users?.avatar_url,
                    created_at: playlistData.created_at,
                    content_type: 'playlist' as const
                  });
                  contentIds.add(playlistData.id);
                }
              } else if (item.type === 'song') {
                const { data: songData } = await supabase
                  .from('songs')
                  .select('id, title, cover_image_url, audio_url, duration_seconds, play_count, created_at, artist:artists!songs_artist_id_fkey(id, name)')
                  .eq('id', item.id)
                  .maybeSingle();

                if (songData) {
                  allContent.unshift({
                    id: songData.id,
                    title: songData.title,
                    cover_image_url: songData.cover_image_url,
                    audio_url: songData.audio_url,
                    duration: songData.duration_seconds,
                    play_count: songData.play_count,
                    created_at: songData.created_at,
                    curator_name: songData.artist?.name || 'Unknown Artist',
                    artist: songData.artist?.name || 'Unknown Artist',
                    artist_id: songData.artist?.id,
                    content_type: 'song' as const,
                    description: null
                  });
                }
              } else if (item.type === 'album') {
                const { data: albumData } = await supabase
                  .from('albums')
                  .select('id, title, cover_image_url, play_count, created_at, artist:artists!albums_artist_id_fkey(id, name)')
                  .eq('id', item.id)
                  .maybeSingle();

                if (albumData) {
                  allContent.unshift({
                    id: albumData.id,
                    title: albumData.title,
                    cover_image_url: albumData.cover_image_url,
                    play_count: albumData.play_count,
                    created_at: albumData.created_at,
                    curator_name: albumData.artist?.name || 'Unknown Artist',
                    artist: albumData.artist?.name || 'Unknown Artist',
                    artist_id: albumData.artist?.id,
                    content_type: 'album' as const,
                    description: null
                  });
                }
              }
            } catch (fetchError) {
              console.error('[ListenerCurations] Error fetching promoted content:', fetchError);
            }
          }
        }

        if (allContent.length > 0) {
          // Mark promoted content
          const contentWithPromo = allContent.map(item => ({
            ...item,
            isPromoted: promotedIds.has(item.id)
          }));

          // Separate promoted and regular content
          const promoted = contentWithPromo.filter(c => c.isPromoted);
          const regular = contentWithPromo.filter(c => !c.isPromoted);

          // Shuffle regular content for variety
          const shuffledRegular = shuffleArray(regular);

          // Merge: promoted first, then regular
          const finalContent = [...promoted, ...shuffledRegular].slice(0, 30); // Limit to 30 items

          setContent(finalContent);
          // Cache the merged results
          await persistentCache.set(CACHE_KEY, finalContent, CACHE_DURATION);
        }
      } catch (err) {
        console.error('Error in fetchFeaturedContent:', err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchFeaturedContent();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleContentClick = async (item: FeaturedContent) => {
    setActiveBlink(item.id);
    setTimeout(() => setActiveBlink(null), 600);

    // Record click if promoted
    if (item.isPromoted) {
      await recordPromotedContentClick(item.id, 'listener_curations', item.content_type);
    }

    // Navigate based on content type
    switch (item.content_type) {
      case 'playlist':
        navigate(`/playlist/${item.id}`);
        break;
      case 'song':
        // Play song directly in MiniMusicPlayer instead of navigating
        if (item.audio_url) {
          const songData = {
            id: item.id,
            title: item.title,
            artist: item.artist || item.curator_name || 'Unknown Artist',
            artistId: item.artist_id || null,
            coverImageUrl: item.cover_image_url,
            audioUrl: item.audio_url,
            duration: item.duration || 0,
            playCount: item.play_count || 0,
          };
          // expandFullPlayer = false to play from MiniMusicPlayer first
          playSong(songData, false, [songData], 0, 'listener-curations', null);
        } else {
          // Fallback: navigate to song screen if audio_url not available
          navigate(`/song/${item.id}`);
        }
        break;
      case 'album':
        navigate(`/album/${item.id}`);
        break;
    }
  };

  // Get appropriate icon for content type
  const getContentIcon = (type: string) => {
    switch (type) {
      case 'playlist':
        return <ListMusic className="w-8 h-8 text-white/60" />;
      case 'song':
        return <Music className="w-8 h-8 text-white/60" />;
      case 'album':
        return <Disc3 className="w-8 h-8 text-white/60" />;
      default:
        return <ListMusic className="w-8 h-8 text-white/60" />;
    }
  };

  // Don't render if no content
  if (!isLoading && content.length === 0) {
    return null;
  }

  return (
    <section className="w-full py-6 px-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl tracking-tight">
          Listener Curations
        </h2>
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
            {content.map((item, index) => (
              <Card
                key={`${item.id}-${index}`}
                className="w-[110px] flex-shrink-0 bg-transparent border-none shadow-none group cursor-pointer active:scale-95 transition-transform duration-150"
                onClick={() => handleContentClick(item)}
              >
                <CardContent className="p-0">
                  <div
                    className={`relative w-[110px] h-[110px] bg-cover bg-center rounded-xl overflow-hidden shadow-lg group-active:shadow-2xl transition-all duration-200 ${activeBlink === item.id ? 'blink-effect' : ''}`}
                  >
                    {item.cover_image_url ? (
                      <img
                        src={item.cover_image_url}
                        alt={item.title}
                        className="w-full h-full object-cover"
                        loading={index < 8 ? "eager" : "lazy"}
                        decoding="async"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#309605] to-[#00ad74]">
                        {getContentIcon(item.content_type)}
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/30 group-active:bg-black/20 transition-colors duration-200"></div>

                    {/* Promoted Badge */}
                    {item.isPromoted && (
                      <div className="absolute top-1.5 right-1.5 p-1 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full shadow-lg">
                        <Flame className="w-3 h-3 text-white" />
                      </div>
                    )}

                  </div>
                  <div className="w-[110px] text-center mt-2.5">
                    <p className="font-['Inter',sans-serif] font-bold text-left text-white/90 text-xs leading-tight group-active:text-white transition-colors duration-200 line-clamp-1 mb-1">
                      {item.title}
                    </p>
                    <p className="font-['Inter',sans-serif] text-white/60 text-left text-xs leading-tight line-clamp-1">
                      {item.curator_name || 'Anonymous'}
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
});

ListenerCurationsSection.displayName = 'ListenerCurationsSection';
