import { useState, useEffect, useRef, memo, useCallback } from 'react';
import { Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../../../../lib/supabase';
import { useEngagementSync } from '../../../../hooks/useEngagementSync';
import { isReleased } from '../../../../lib/releaseDateUtils';
import { useAuth } from '../../../../contexts/AuthContext';
import { ScrollArea, ScrollBar } from '../../../../components/ui/scroll-area';
import { persistentCache } from '../../../../lib/persistentCache';

const REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes (reduces DB/egress)
const RADAR_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min in-memory cache to cut egress on tab switch/remount
const RADAR_PERSISTENT_CACHE_TTL_MS = 15 * 60 * 1000; // Same pattern as Trending rails
let radarCache: { userId: string; data: unknown[]; ts: number } | null = null;
const getRadarCacheKey = (userId: string) => `on_your_radar_section_${userId}_v1`;

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

interface RadarTrack {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  coverImageUrl?: string | null;
  audioUrl?: string | null;
  duration?: number;
  playCount?: number;
  rank: number;
  featured_artists?: string[] | null;
}

interface OnYourRadarSectionProps {
  onOpenMusicPlayer: (song: Song, playlist?: Song[], context?: string) => void;
}

export const OnYourRadarSection = memo(({ onOpenMusicPlayer }: OnYourRadarSectionProps): JSX.Element | null => {
  const { user, isInitialized } = useAuth();
  const [tracks, setTracks] = useState<RadarTrack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const hydratedCacheForUserRef = useRef<string | null>(null);
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEngagementSync(useCallback((update) => {
    if (update.contentType === 'song' && update.metric === 'play_count') {
      setTracks(prev => prev.map(t => t.id === update.contentId ? { ...t, playCount: update.value } : t));
    }
  }, []));

  const fetchRadarSongs = useCallback(async () => {
    if (!user?.id) {
      setTracks([]);
      setIsLoading(false);
      return;
    }

    const now = Date.now();
    if (radarCache && radarCache.userId === user.id && now - radarCache.ts < RADAR_CACHE_TTL_MS) {
      setTracks(radarCache.data as RadarTrack[]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      // 1. Get followed users (following_ids)
      const { data: followData, error: followError } = await supabase
        .from('user_follows')
        .select('following_id')
        .eq('follower_id', user.id);

      if (followError) {
        console.error('[OnYourRadar] Error fetching follows:', followError);
        setTracks([]);
        await persistentCache.delete(getRadarCacheKey(user.id));
        return;
      }

      const followingIds = (followData || []).map((r) => r.following_id).filter(Boolean);
      if (followingIds.length === 0) {
        setTracks([]);
        await persistentCache.delete(getRadarCacheKey(user.id));
        return;
      }

      // 2. Fetch listening history for followed users (capped for egress)
      const { data: historyData, error: historyError } = await supabase
        .from('listening_history')
        .select('song_id,user_id,listened_at')
        .in('user_id', followingIds)
        .not('song_id', 'is', null)
        .order('listened_at', { ascending: false })
        .limit(100);

      if (historyError) {
        console.error('[OnYourRadar] Error fetching listening history:', historyError);
        setTracks([]);
        await persistentCache.delete(getRadarCacheKey(user.id));
        return;
      }

      const rows = historyData || [];

      // 3. Rank by social proof first:
      // - distinct followed users who listened (primary)
      // - total listens in sampled window (secondary)
      // - latest listen recency (tertiary)
      const countBySongId = new Map<string, number>();
      const uniqueUsersBySongId = new Map<string, Set<string>>();
      const latestListenTsBySongId = new Map<string, number>();
      for (const row of rows) {
        const sid = row.song_id;
        if (!sid) continue;

        countBySongId.set(sid, (countBySongId.get(sid) || 0) + 1);

        if (row.user_id) {
          const existing = uniqueUsersBySongId.get(sid) ?? new Set<string>();
          existing.add(row.user_id);
          uniqueUsersBySongId.set(sid, existing);
        }

        const listenedAtTs = row.listened_at ? new Date(row.listened_at).getTime() : 0;
        const currentLatest = latestListenTsBySongId.get(sid) || 0;
        if (listenedAtTs > currentLatest) {
          latestListenTsBySongId.set(sid, listenedAtTs);
        }
      }

      // 4. Top 10 songs by unique listeners, then total listens, then recency
      const top10SongIds = Array.from(countBySongId.entries())
        .sort((a, b) => {
          const uniqueA = uniqueUsersBySongId.get(a[0])?.size || 0;
          const uniqueB = uniqueUsersBySongId.get(b[0])?.size || 0;
          if (uniqueB !== uniqueA) return uniqueB - uniqueA;

          const countDiff = b[1] - a[1];
          if (countDiff !== 0) return countDiff;

          const latestA = latestListenTsBySongId.get(a[0]) || 0;
          const latestB = latestListenTsBySongId.get(b[0]) || 0;
          return latestB - latestA;
        })
        .slice(0, 10)
        .map(([id]) => id);

      if (top10SongIds.length === 0) {
        setTracks([]);
        await persistentCache.delete(getRadarCacheKey(user.id));
        return;
      }

      // 5. Fetch song details (songs + artists) for those IDs
      const { data: songsData, error: songsError } = await supabase
        .from('songs')
        .select(`
          id,
          title,
          cover_image_url,
          audio_url,
          duration_seconds,
          play_count,
          artist_id,
          release_date,
          featured_artists,
          artists:artist_id (
            id,
            name,
            artist_profiles(user_id)
          )
        `)
        .in('id', top10SongIds);

      if (songsError || !songsData?.length) {
        setTracks([]);
        await persistentCache.delete(getRadarCacheKey(user.id));
        return;
      }

      const releasedSongs = songsData.filter((s: any) => isReleased(s.release_date));
      const orderMap = new Map(top10SongIds.map((id, i) => [id, i + 1]));
      const sorted = [...releasedSongs].sort((a, b) => (orderMap.get(a.id) ?? 99) - (orderMap.get(b.id) ?? 99));

      const radarTracks: RadarTrack[] = sorted.map((s: any) => ({
        id: s.id,
        title: s.title,
        artist: s.artists?.name ?? 'Unknown Artist',
        artistId: s.artists?.artist_profiles?.[0]?.user_id ?? null,
        coverImageUrl: s.cover_image_url,
        audioUrl: s.audio_url,
        duration: s.duration_seconds,
        playCount: s.play_count,
        rank: orderMap.get(s.id) ?? 0,
        featured_artists: s.featured_artists ?? null,
      }));

      radarCache = { userId: user.id, data: radarTracks, ts: Date.now() };
      setTracks(radarTracks);
      await persistentCache.set(getRadarCacheKey(user.id), radarTracks, RADAR_PERSISTENT_CACHE_TTL_MS);
    } catch (err) {
      console.error('[OnYourRadar] Error:', err);
      setTracks([]);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!isInitialized) return;
    if (!user) {
      setIsLoading(false);
      setTracks([]);
      return;
    }

    let mounted = true;
    const bootstrap = async () => {
      if (hydratedCacheForUserRef.current !== user.id) {
        const cached = await persistentCache.get<RadarTrack[]>(getRadarCacheKey(user.id));
        if (!mounted) return;
        if (cached && cached.length > 0) {
          setTracks(cached);
          radarCache = { userId: user.id, data: cached, ts: Date.now() };
          setIsLoading(false);
        }
        hydratedCacheForUserRef.current = user.id;
      }

      if (mounted) {
        fetchRadarSongs();
        refreshIntervalRef.current = setInterval(fetchRadarSongs, REFRESH_INTERVAL_MS);
      }
    };

    bootstrap();
    return () => {
      mounted = false;
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [isInitialized, user?.id, fetchRadarSongs]);

  const handlePlay = useCallback(
    (track: RadarTrack) => {
      if (!track.audioUrl) return;
      const song: Song = {
        id: track.id,
        title: track.title,
        artist: track.artist,
        artistId: track.artistId,
        coverImageUrl: track.coverImageUrl,
        audioUrl: track.audioUrl,
        duration: track.duration,
        playCount: track.playCount,
        featuredArtists: track.featured_artists ?? null,
      };
      const playlist: Song[] = tracks
        .filter((t) => t.audioUrl)
        .map((t) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          artistId: t.artistId,
          coverImageUrl: t.coverImageUrl,
          audioUrl: t.audioUrl,
          duration: t.duration,
          playCount: t.playCount,
          featuredArtists: t.featured_artists ?? null,
        }));
      onOpenMusicPlayer(song, playlist, 'On Your Radar');
    },
    [tracks, onOpenMusicPlayer]
  );

  if (!isInitialized) return null;
  const showLoadingSkeleton = !!user && isLoading && tracks.length === 0;
  if (!showLoadingSkeleton && tracks.length === 0) return null;

  return (
    <section className="w-full px-4 sm:px-5">
      <h2 className="text-xl font-black tracking-tight text-white leading-none mb-5">
        On Your Radar
      </h2>
      {showLoadingSkeleton ? (
        <div className="flex gap-4 pb-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="w-[110px] h-[110px] rounded-xl bg-white/10 animate-pulse flex-shrink-0" />
          ))}
        </div>
      ) : (
      <ScrollArea className="w-full">
        <div className="flex gap-4 pb-4">
          {tracks.map((track) => (
            <div
              key={track.id}
              onClick={() => handlePlay(track)}
              className="w-[110px] flex-shrink-0 bg-transparent cursor-pointer group"
            >
              <div className="relative w-[110px] h-[110px] rounded-xl overflow-hidden bg-[#1a1a1a]">
                {track.coverImageUrl ? (
                  <img
                    src={track.coverImageUrl}
                    alt={track.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#1a2a1a] to-[#0d0d0d] text-white/30">
                    <Play className="w-8 h-8" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center">
                    <Play className="w-5 h-5 text-black fill-black ml-0.5" />
                  </div>
                </div>
              </div>
              <div className="w-[110px] mt-2.5">
                <p className="font-['Inter',sans-serif] font-bold text-left text-white/90 text-xs leading-tight line-clamp-1 mb-1">
                  {track.title}
                </p>
                {track.artistId ? (
                  <Link
                    to={`/user/${track.artistId}`}
                    className="font-['Inter',sans-serif] text-white/60 text-left text-xs leading-tight line-clamp-1 block hover:text-white transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {track.artist}
                  </Link>
                ) : (
                  <p className="font-['Inter',sans-serif] text-white/60 text-left text-xs leading-tight line-clamp-1">
                    {track.artist}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" className="opacity-0" />
      </ScrollArea>
      )}
    </section>
  );
});

OnYourRadarSection.displayName = 'OnYourRadarSection';
