import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trophy, TrendingUp, Sparkles, ChevronRight, Crown, Users } from 'lucide-react';
import { LazyImage } from './LazyImage';
import { supabase } from '../lib/supabase';

interface Top1PercentArtist {
  artist_id: string;
  user_id: string;
  artist_name: string;
  artist_photo: string | null;
  is_verified: boolean;
  total_plays: number;
  total_treats_sent: number;
  loyalty_score: number;
  rank_position: number;
  total_listeners: number;
}

interface TopFan {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  total_plays: number;
  total_treats_sent: number;
  loyalty_score: number;
  rank_position: number;
}

interface Top1PercentClubProps {
  userId?: string;
  userRole?: string;
  artistProfileId?: string;
}

export const Top1PercentClub = ({ userId, userRole, artistProfileId }: Top1PercentClubProps): JSX.Element => {
  const navigate = useNavigate();
  const [topArtists, setTopArtists] = useState<Top1PercentArtist[]>([]);
  const [topFans, setTopFans] = useState<TopFan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newRankings, setNewRankings] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'artists' | 'fans'>('artists');

  const isCreator = userRole === 'creator';

  useEffect(() => {
    if (userId) {
      if (isCreator && artistProfileId) {
        // For creators, load both their top fans and artists they support
        Promise.all([loadTopArtists(), loadTopFans()]);
      } else {
        // For listeners, only load artists they support
        loadTopArtists();
      }
    }
  }, [userId, isCreator, artistProfileId]);

  const loadTopArtists = async () => {
    if (!userId) return;

    try {
      setIsLoading(true);

      const { data, error } = await supabase
        .rpc('get_user_top_1_percent_artists', { p_user_id: userId });

      if (error) throw error;

      if (data && data.length > 0) {
        const previousArtistIds = new Set(topArtists.map(a => a.artist_id));
        const newArtistIds = new Set(data.map((a: Top1PercentArtist) => a.artist_id));

        const newlyAdded = data
          .filter((a: Top1PercentArtist) => !previousArtistIds.has(a.artist_id))
          .map((a: Top1PercentArtist) => a.artist_id);

        if (newlyAdded.length > 0) {
          setNewRankings(new Set(newlyAdded));
          setTimeout(() => setNewRankings(new Set()), 3000);
        }

        setTopArtists(data);
      } else {
        setTopArtists([]);
      }
    } catch (error) {
      console.error('Error loading top 1% artists:', error);
      setTopArtists([]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadTopFans = async () => {
    if (!artistProfileId) return;

    try {
      const { data, error } = await supabase
        .rpc('get_artist_top_fans', { p_artist_id: artistProfileId });

      if (error) throw error;

      setTopFans(data || []);
    } catch (error) {
      console.error('Error loading top fans:', error);
      setTopFans([]);
    }
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const handleArtistClick = (userId: string) => {
    navigate(`/user/${userId}`);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="text-center mb-6 animate-pulse">
          <div className="h-8 w-48 bg-white/10 rounded-lg mx-auto mb-2"></div>
          <div className="h-4 w-64 bg-white/10 rounded-lg mx-auto"></div>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-gradient-to-br from-white/10 to-white/5 rounded-2xl p-4 border border-white/10 animate-pulse">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-white/10 rounded-full"></div>
              <div className="flex-1">
                <div className="h-5 w-32 bg-white/10 rounded mb-2"></div>
                <div className="h-4 w-48 bg-white/10 rounded"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const currentList = viewMode === 'artists' ? topArtists : topFans;
  const hasNoData = currentList.length === 0;

  if (hasNoData && !isCreator) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center mb-6">
          <Trophy className="w-12 h-12 text-white" />
        </div>
        <h3 className="text-xl font-bold text-white mb-3">
          Join the Top 1% Club
        </h3>
        <p className="text-gray-400 text-sm leading-relaxed mb-6 max-w-sm">
          Stream your favorite artists and send them Treats to become one of their top supporters.
          You'll earn an exclusive Top 1% badge and bragging rights!
        </p>
        <div className="grid grid-cols-2 gap-4 w-full max-w-md">
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-white/70" />
              <span className="text-xs text-gray-400">Stream More</span>
            </div>
            <p className="text-sm text-white font-medium">Listen to your favorites</p>
          </div>
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-white/70" />
              <span className="text-xs text-gray-400">Send Treats</span>
            </div>
            <p className="text-sm text-white font-medium">Show your support</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* View Toggle for Creators */}
      {isCreator && topArtists.length > 0 && topFans.length > 0 && (
        <div className="flex gap-2 p-1 bg-white/5 rounded-full border border-white/10">
          <button
            onClick={() => setViewMode('fans')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-full text-sm font-medium transition-all ${
              viewMode === 'fans'
                ? 'bg-white text-black'
                : 'text-white/70 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" />
            My Top Fans
          </button>
          <button
            onClick={() => setViewMode('artists')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-full text-sm font-medium transition-all ${
              viewMode === 'artists'
                ? 'bg-white text-black'
                : 'text-white/70 hover:text-white'
            }`}
          >
            <Crown className="w-4 h-4" />
            Artists I Support
          </button>
        </div>
      )}

      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center justify-center gap-2 mb-2">
          {viewMode === 'fans' ? (
            <>
              <Users className="w-6 h-6 text-white" />
              <h2 className="text-2xl font-bold text-white">My Top Fans</h2>
            </>
          ) : (
            <>
              <Crown className="w-6 h-6 text-white" />
              <h2 className="text-2xl font-bold text-white">Top 1% Club</h2>
            </>
          )}
        </div>
        <p className="text-gray-400 text-sm">
          {viewMode === 'fans' ? (
            topFans.length > 0 ? (
              `Your top ${topFans.length} ${topFans.length === 1 ? 'supporter' : 'supporters'}`
            ) : (
              'No top fans yet'
            )
          ) : (
            topArtists.length > 0 ? (
              `You're a top supporter for ${topArtists.length} ${topArtists.length === 1 ? 'artist' : 'artists'}`
            ) : (
              'Not supporting any artists yet'
            )
          )}
        </p>
      </div>

      {/* Artists View */}
      {viewMode === 'artists' && topArtists.length > 0 && (
        <div className="space-y-3">
          {topArtists.map((artist) => (
          <div
            key={artist.artist_id}
            onClick={() => handleArtistClick(artist.user_id)}
            className="relative bg-gradient-to-br from-white/10 to-white/5 rounded-2xl p-4 border border-white/10 cursor-pointer transition-all duration-300 hover:border-white/20 hover:bg-white/[0.12]"
          >
            <div className="flex items-center gap-3">
              <div className="relative flex-shrink-0">
                <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-white/10">
                  {artist.artist_photo ? (
                    <LazyImage
                      src={artist.artist_photo}
                      alt={artist.artist_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-gray-600 to-gray-700 flex items-center justify-center">
                      <span className="text-white text-lg font-semibold">
                        {artist.artist_name.charAt(0)}
                      </span>
                    </div>
                  )}
                </div>
                {artist.is_verified && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-white/20 flex items-center justify-center border-2 border-[#1a1a1a]">
                    <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="text-white font-medium text-sm truncate mb-1">
                  {artist.artist_name}
                </h3>

                <div className="flex items-center gap-2 mb-2">
                  <span className="text-white/90 text-xs font-medium">
                    #{artist.rank_position} out of {formatNumber(artist.total_listeners)}
                  </span>
                  <span className="w-1 h-1 rounded-full bg-gray-500"></span>
                  <span className="text-gray-400 text-xs">
                    {formatNumber(artist.total_plays)} plays
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-white/70 text-xs font-medium">
                    Top 1%
                  </span>
                  {artist.total_treats_sent > 0 && (
                    <>
                      <span className="w-1 h-1 rounded-full bg-gray-500"></span>
                      <span className="text-gray-400 text-xs">
                        {formatNumber(artist.total_treats_sent)} Treats sent
                      </span>
                    </>
                  )}
                </div>
              </div>

              <ChevronRight className="w-5 h-5 text-gray-500 flex-shrink-0" />
            </div>
          </div>
        ))}
        </div>
      )}

      {/* Fans View */}
      {viewMode === 'fans' && topFans.length > 0 && (
        <div className="space-y-3">
          {topFans.map((fan, index) => (
            <div
              key={fan.user_id}
              onClick={() => handleArtistClick(fan.user_id)}
              className="relative bg-gradient-to-br from-white/10 to-white/5 rounded-2xl p-4 border border-white/10 cursor-pointer transition-all duration-300 hover:border-white/20 hover:bg-white/[0.12]"
            >
              <div className="flex items-center gap-3">
                <div className="relative flex-shrink-0">
                  <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-white/10">
                    {fan.avatar_url ? (
                      <LazyImage
                        src={fan.avatar_url}
                        alt={fan.display_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-gray-600 to-gray-700 flex items-center justify-center">
                        <span className="text-white text-lg font-semibold">
                          {fan.display_name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                  </div>
                  {/* Rank Badge */}
                  <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-white/20 flex items-center justify-center border-2 border-[#1a1a1a] text-[10px] font-bold text-white">
                    {index + 1}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="text-white font-medium text-sm truncate mb-1">
                    {fan.display_name}
                  </h3>

                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-white/90 text-xs font-medium">
                      #{fan.rank_position}
                    </span>
                    <span className="w-1 h-1 rounded-full bg-gray-500"></span>
                    <span className="text-gray-400 text-xs">
                      {formatNumber(fan.total_plays)} plays
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-white/70 text-xs font-medium">
                      Top 1%
                    </span>
                    {fan.total_treats_sent > 0 && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-gray-500"></span>
                        <span className="text-gray-400 text-xs">
                          {formatNumber(fan.total_treats_sent)} Treats
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <ChevronRight className="w-5 h-5 text-gray-500 flex-shrink-0" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State for Current View */}
      {hasNoData && isCreator && (
        <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center mb-6">
            {viewMode === 'fans' ? (
              <Users className="w-12 h-12 text-white" />
            ) : (
              <Trophy className="w-12 h-12 text-white" />
            )}
          </div>
          <h3 className="text-xl font-bold text-white mb-3">
            {viewMode === 'fans' ? 'No Top Fans Yet' : 'Not Supporting Any Artists Yet'}
          </h3>
          <p className="text-gray-400 text-sm leading-relaxed max-w-sm">
            {viewMode === 'fans'
              ? 'Keep creating great content and engaging with your audience. Your top supporters will appear here!'
              : 'Stream your favorite artists and send them Treats to become one of their top supporters.'
            }
          </p>
        </div>
      )}

    </div>
  );
};
