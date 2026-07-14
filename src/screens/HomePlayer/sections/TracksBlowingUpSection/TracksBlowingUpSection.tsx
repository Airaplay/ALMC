import { useState, useEffect, useRef, memo, useCallback } from 'react';
import { Flame } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase, getTracksBlowingUp } from '../../../../lib/supabase';
import { getPromotedContentDetailed, recordPromotedContentClick } from '../../../../lib/promotionHelper';
import { Link } from 'react-router-dom';
import { useEngagementSync } from '../../../../hooks/useEngagementSync';
import { useUserCountry } from '../../../../hooks/useUserCountry';

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

interface TracksBlowingUpSectionProps {
  onOpenMusicPlayer: (song: Song, playlist?: Song[], context?: string) => void;
}

interface BlowingUpTrack {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  coverImageUrl?: string | null;
  audioUrl?: string | null;
  duration?: number;
  playCount?: number;
  growthPercentage: number;
  currentHourPlays: number;
  previousHourPlays: number;
  featured_artists?: string[] | null;
  isPromoted?: boolean;
}

const REFRESH_INTERVAL = 20 * 60 * 1000; // 20 minutes

export const TracksBlowingUpSection = memo(({ onOpenMusicPlayer }: TracksBlowingUpSectionProps): JSX.Element | null => {
  const navigate = useNavigate();
  const { countryCode } = useUserCountry();
  const [tracks, setTracks] = useState<BlowingUpTrack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeBlink, setActiveBlink] = useState<string | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastRealtimeUpdateRef = useRef<number>(0);

  // Real-time engagement sync
  useEngagementSync(useCallback((update) => {
    if (update.contentType === 'song' && update.metric === 'play_count') {
      setTracks(prevTracks =>
        prevTracks.map(track =>
          track.id === update.contentId
            ? { ...track, playCount: update.value }
            : track
        )
      );
    }
  }, []));

  const loadTracks = async (isBackgroundRefresh = false) => {
    try {
      // Only show loading on initial load, not on background refreshes
      if (!isBackgroundRefresh) {
        setIsLoading(true);
      }

      const [tracksData, promotedData] = await Promise.allSettled([
        getTracksBlowingUp(20, countryCode || undefined),
        getPromotedContentDetailed('tracks_blowing_up', 'song', 1)
      ]);

      let tracks: any[] = [];
      let promotedSongs: any[] = [];

      // Process tracks data
      if (tracksData.status === 'fulfilled' && tracksData.value) {
        tracks = tracksData.value;
      } else {
        console.log('[TracksBlowingUp] No tracks found');
      }

      // Process promoted data and fetch full song details
      if (promotedData.status === 'fulfilled' && promotedData.value.length > 0) {
        const promotedIds = promotedData.value.map((item: any) => item.targetId);
        console.log('[TracksBlowingUp] Promoted song IDs:', promotedIds);

        // Fetch full details for promoted songs
        const { data: promotedSongsData, error: promotedError } = await supabase
          .from('songs')
          .select(`
            id,
            title,
            cover_image_url,
            audio_url,
            duration_seconds,
            play_count,
            featured_artists,
            artist:artists!songs_artist_id_fkey(
              id,
              name,
              artist_profiles(
                user_id,
                stage_name
              )
            )
          `)
          .in('id', promotedIds);

        if (!promotedError && promotedSongsData) {
          promotedSongs = promotedSongsData.map((song: any) => ({
            id: song.id,
            title: song.title,
            artist_name: song.artist?.name || 'Unknown Artist',
            artist_stage_name: song.artist?.artist_profiles?.[0]?.stage_name,
            artist_user_id: song.artist?.artist_profiles?.[0]?.user_id,
            cover_image_url: song.cover_image_url,
            audio_url: song.audio_url,
            duration_seconds: song.duration_seconds,
            play_count: song.play_count,
            featured_artists: song.featured_artists,
            plays_last_30min: 0,
            plays_prev_30min: 0,
            growth_percentage: 0,
            is_promoted: true
          }));
          console.log('[TracksBlowingUp] Fetched promoted songs:', promotedSongs);
        }
      }

      // Combine promoted songs with regular tracks
      // Promoted songs that aren't already in the tracks list get added
      const trackIds = new Set(tracks.map((t: any) => t.id));
      const additionalPromoted = promotedSongs.filter((ps: any) => !trackIds.has(ps.id));
      tracks = [...additionalPromoted, ...tracks];

      if (!tracks || tracks.length === 0) {
        setTracks([]);
        if (!isBackgroundRefresh) {
          setIsLoading(false);
        }
        return;
      }

      // Format tracks for display
      const formattedTracks: BlowingUpTrack[] = tracks.map((track: any) => ({
        id: track.id,
        title: track.title || 'Unknown Title',
        artist: track.artist_stage_name || track.artist_name || 'Unknown Artist',
        artistId: track.artist_user_id,
        coverImageUrl: track.cover_image_url,
        audioUrl: track.audio_url,
        duration: track.duration_seconds || 0,
        playCount: track.play_count || 0,
        growthPercentage: track.growth_percentage || 0,
        currentHourPlays: track.plays_last_30min || 0,
        previousHourPlays: track.plays_prev_30min || 0,
        featured_artists: track.featured_artists || null,
        isPromoted: track.is_promoted === true
      }));

      // Filter to ensure only ONE song per artist for diversity
      const seenArtists = new Set<string>();
      const diverseTracks: BlowingUpTrack[] = [];

      for (const track of formattedTracks) {
        const artistKey = track.artistId || track.artist;
        if (!seenArtists.has(artistKey)) {
          diverseTracks.push(track);
          seenArtists.add(artistKey);
        }
      }

      // Separate promoted and regular tracks
      const promotedTracks = diverseTracks.filter(t => t.isPromoted);
      const regularTracks = diverseTracks.filter(t => !t.isPromoted);

      // Take top 8 from regular tracks and shuffle
      let shuffledRegular = regularTracks.slice(0, 8);
      shuffledRegular = shuffledRegular.sort(() => Math.random() - 0.5);

      // Merge: promoted first (at position 0), then shuffled regular
      const finalTracks = [...promotedTracks, ...shuffledRegular].slice(0, 8);

      console.log('[TracksBlowingUp] Loaded', finalTracks.length, 'tracks');

      if (finalTracks.length === 0) {
        console.log('[TracksBlowingUp] No valid tracks found after filtering');
      }

      setTracks(finalTracks);
    } catch (error) {
      console.error('[TracksBlowingUp] Error loading blowing up tracks:', error);
      setTracks([]);
    } finally {
      // Only set loading to false on initial load
      if (!isBackgroundRefresh) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    loadTracks(false);

    const channel = supabase
      .channel('tracks-blowing-up-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'listening_history',
          filter: 'is_validated=eq.true'
        },
        () => {
          const now = Date.now();
          if (now - lastRealtimeUpdateRef.current > 30000) {
            lastRealtimeUpdateRef.current = now;
            loadTracks(true);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[TracksBlowingUp] Realtime subscription error, falling back to polling');
        }
      });

    refreshIntervalRef.current = setInterval(() => {
      loadTracks(true);
    }, REFRESH_INTERVAL);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
      channel.unsubscribe();
    };
  }, [countryCode]);

  const handlePlayTrack = async (track: BlowingUpTrack) => {
    setActiveBlink(track.id);
    setTimeout(() => setActiveBlink(null), 600);

    if (!track.audioUrl) {
      console.error('Track has no audio URL:', track);
      alert("This track is not available for playback.");
      return;
    }

    // Record click if promoted
    if (track.isPromoted) {
      await recordPromotedContentClick(track.id, 'tracks_blowing_up', 'song');
    }

    const formattedSong: Song = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      artistId: track.artistId,
      coverImageUrl: track.coverImageUrl,
      audioUrl: track.audioUrl,
      duration: track.duration,
      playCount: track.playCount,
      featuredArtists: track.featured_artists || null
    };

    const formattedPlaylist: Song[] = tracks
      .filter(t => t.audioUrl)
      .map(t => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        artistId: t.artistId,
        coverImageUrl: t.coverImageUrl,
        audioUrl: t.audioUrl,
        duration: t.duration,
        playCount: t.playCount,
        featuredArtists: t.featured_artists || null
      }));

    onOpenMusicPlayer(formattedSong, formattedPlaylist, 'Tracks Blowing Up');
  };

  const getGrowthTag = (growthPercentage: number): string => {
    if (growthPercentage >= 999) {
      return '+250% Viral Spike';
    } else if (growthPercentage >= 200) {
      return `+${Math.round(growthPercentage)}% Viral Spike`;
    } else if (growthPercentage >= 100) {
      return `+${Math.round(growthPercentage)}% This Hour`;
    } else if (growthPercentage >= 50) {
      return `+${Math.round(growthPercentage)}% This Hour`;
    } else if (growthPercentage > 0) {
      return `+${Math.round(growthPercentage)}% This Hour`;
    } else {
      return 'Trending';
    }
  };

  // Don't show section if loading and no tracks, or if no tracks at all
  if (isLoading && tracks.length === 0) {
    return null;
  }

  if (tracks.length === 0) {
    return null;
  }

  return (
    <section className="w-full py-6 px-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-bold text-white text-xl tracking-tight">
          Blowing Up Right Now
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {tracks.map((track) => (
          <div
            key={track.id}
            onClick={() => handlePlayTrack(track)}
            className="cursor-pointer group"
          >
            <div className="relative min-h-[60px] rounded-xl overflow-hidden bg-[#1a1a1a] transition-colors duration-200 hover:bg-[#222222]">
              <div className="flex items-center h-full">
                <div className="relative flex-shrink-0 w-[60px] h-[60px]">
                  <img
                    src={track.coverImageUrl || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400'}
                    alt={track.title}
                    className="w-full h-full object-cover rounded-l-xl"
                    loading="lazy"
                  />
                  {/* Promoted Badge */}
                  {track.isPromoted && (
                    <div className="absolute top-1.5 right-1.5 p-1 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full shadow-lg">
                      <Flame className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 px-2.5 py-1.5 flex flex-col justify-center">
                  <h3 className="text-white font-semibold text-xs tracking-tight leading-tight mb-0.5 line-clamp-1">
                    {track.title}
                  </h3>
                  {track.artistId ? (
                    <Link
                      to={`/user/${track.artistId}`}
                      className="text-white/50 text-xs hover:text-[#309605] transition-colors line-clamp-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {track.artist}
                    </Link>
                  ) : (
                    <p className="text-white/50 text-xs line-clamp-1">
                      {track.artist}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
});

TracksBlowingUpSection.displayName = 'TracksBlowingUpSection';