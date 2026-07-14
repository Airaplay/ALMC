import { useState, useEffect } from "react";
import { ScrollArea, ScrollBar } from "../../../../components/ui/scroll-area";
import { Star, Users, UserPlus, Flame } from "lucide-react";
import { LazyImage } from "../../../../components/LazyImage";
import { supabase } from "../../../../lib/supabase";
import { useNavigate } from "react-router-dom";
import { getPromotedContentForSection, recordPromotedContentClick } from "../../../../lib/promotionHelper";

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
  isPromoted?: boolean;
}

interface TopArtisteSectionProps {
  className?: string;
}

export const TopArtisteSection = ({ className = '' }: TopArtisteSectionProps): JSX.Element | null => {
  const navigate = useNavigate();
  const [featuredArtists, setFeaturedArtists] = useState<FeaturedArtist[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchFeaturedArtists();
  }, []);

  const handleFollowToggle = async (artist: FeaturedArtist, e: React.MouseEvent) => {
    e.stopPropagation();

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
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

        setFeaturedArtists(prev =>
          prev.filter(a => a.id !== artist.id)
        );
      }
    } catch (err) {
      console.error('Error toggling follow:', err);
    }
  };

  const fetchFeaturedArtists = async () => {
    setIsLoading(true);

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
        }
      }

      console.log('[TopArtisteSection] Fetching promoted content for top_artist section');
      const promotedUserIds = await getPromotedContentForSection('top_artist', 'profile');
      console.log('[TopArtisteSection] Promoted user IDs received:', promotedUserIds);

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
          isFollowing: followingStatus[fa.user_id] || false,
          isPromoted: promotedUserIds.includes(fa.user_id)
        }))
        .filter((artist) => {
          if (session) {
            if (artist.userId === session.user.id) {
              return false;
            }
            if (artist.isFollowing) {
              return false;
            }
          }
          return true;
        });

      // Fetch promoted artists not in the featured list
      const promotedNotInList = promotedUserIds.filter(userId => !processedArtists.some(a => a.userId === userId));
      let promotedArtistsData: FeaturedArtist[] = [];

      if (promotedNotInList.length > 0) {
        const { data: promotedData, error: promoError } = await supabase
          .from('artists')
          .select(`
            id,
            name,
            image_url,
            verified,
            artist_profiles (
              user_id
            )
          `)
          .in('artist_profiles.user_id', promotedNotInList);

        if (!promoError && promotedData) {
          const promotedFollowStatus: Record<string, boolean> = {};
          if (session) {
            const promotedUserIds = promotedData.map((a: any) => a.artist_profiles?.[0]?.user_id).filter(Boolean);
            const { data: promoFollowData } = await supabase
              .from('user_follows')
              .select('following_id')
              .eq('follower_id', session.user.id)
              .in('following_id', promotedUserIds);

            (promoFollowData || []).forEach(f => {
              promotedFollowStatus[f.following_id] = true;
            });
          }

          promotedArtistsData = promotedData
            .filter((a: any) => {
              const userId = a.artist_profiles?.[0]?.user_id;
              if (!userId) return false;
              if (session && userId === session.user.id) return false;
              if (session && promotedFollowStatus[userId]) return false;
              return true;
            })
            .map((a: any) => ({
              id: `promoted-${a.id}`,
              artistId: a.id,
              userId: a.artist_profiles?.[0]?.user_id,
              name: a.name || 'Unknown Artist',
              imageUrl: a.image_url || null,
              region: region,
              verified: a.verified || false,
              weeklyGrowth: 0,
              totalLikes: 0,
              isFollowing: false,
              isPromoted: true
            }));
        }
      }

      // Remove promoted artists from original positions
      const nonPromotedArtists = processedArtists.filter(a => !a.isPromoted);
      const existingPromotedArtists = processedArtists.filter(a => a.isPromoted);

      // Combine: promoted artists first, then regular featured
      const finalArtists = [...promotedArtistsData, ...existingPromotedArtists, ...nonPromotedArtists];

      console.log('[TopArtisteSection] Final artists with', promotedArtistsData.length + existingPromotedArtists.length, 'promoted items');

      setFeaturedArtists(finalArtists);
    } catch (err) {
      console.error("Error fetching featured artists:", err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading && featuredArtists.length === 0) {
    return null;
  }

  if (featuredArtists.length === 0) {
    return null;
  }

  return (
    <section className={`w-full py-6 px-6 bg-gradient-to-b from-transparent to-transparent ${className}`}>
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl tracking-tight">
          Featured Artists
        </h2>
      </div>

      <ScrollArea className="w-full">
        <div className="flex gap-4 pb-4">
          {featuredArtists.map((artist) => (
            <div
              key={artist.id}
              className="w-28 flex-shrink-0 group cursor-pointer"
              onClick={async () => {
                if (artist.isPromoted) {
                  await recordPromotedContentClick(artist.userId, 'top_artist', 'profile');
                }
                navigate(`/user/${artist.userId}`);
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
               
                {artist.isPromoted && (
                  <div className="absolute -bottom-1 -right-1 p-1 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full shadow-lg">
                    <Flame className="w-3 h-3 text-white" />
                  </div>
                )}
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
    </section>
  );
};