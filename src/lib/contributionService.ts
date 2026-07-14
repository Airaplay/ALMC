/**
 * Contribution Rewards Service
 *
 * Manages the compliant listener rewards system where:
 * - Listeners earn based on VALUE-ADDING contributions
 * - NO direct connection to ad viewing
 * - Rewards come from platform's community budget
 * - Activities: playlist creation, discovery, curation, engagement
 */

import { supabase } from './supabase';
import { getBestEffortPublicIp, getBestEffortUserAgent, getOrCreateDeviceId } from './deviceId';

export interface ContributionActivity {
  id: string;
  activity_type: string;
  activity_name: string;
  description: string;
  base_reward_points: number;
  is_active: boolean;
  created_at: string;
}

export interface ListenerContribution {
  id: string;
  user_id: string;
  activity_type: string;
  reference_id: string | null;
  reference_type: string | null;
  contribution_points: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ContributionScore {
  user_id: string;
  total_points: number;
  current_period_points: number;
  playlist_creation_points: number;
  discovery_points: number;
  curation_points: number;
  engagement_points: number;
  last_reward_date: string | null;
  updated_at: string;
}

export interface TopContributor {
  user_id: string;
  username: string;
  avatar_url: string | null;
  current_period_points: number;
  total_points: number;
  rank: number;
}

export interface RewardsBudget {
  id: string;
  period_date: string;
  total_budget_usd: number;
  distributed_amount_usd: number;
  remaining_budget_usd: number;
  total_points_pool: number;
  usd_per_point: number;
  created_at: string;
  updated_at: string;
}

async function buildSybilMetadata(base?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const deviceId = getOrCreateDeviceId();
  const userAgent = getBestEffortUserAgent();
  const ip = await getBestEffortPublicIp();

  return {
    ...(base || {}),
    ...(deviceId ? { device_id: deviceId } : {}),
    ...(userAgent ? { user_agent: userAgent } : {}),
    ...(ip ? { ip } : {})
  };
}

/**
 * Record a contribution activity (5-arg `record_listener_contribution` RPC).
 * At the global daily points cap the DB returns success with `points_earned: 0` and
 * `daily_cap_reached: true` — not a PostgREST error, so the app stays quiet.
 *
 * @param userIdOptional - If provided, skips getUser() (reduces egress when caller has user from context).
 */
export async function recordContribution(
  activityType: string,
  referenceId?: string,
  referenceType?: string,
  metadata?: Record<string, unknown>,
  userIdOptional?: string | null
): Promise<void> {
  try {
    const userId = userIdOptional ?? (await supabase.auth.getUser()).data.user?.id;
    if (!userId) return;

    const sybilMetadata = await buildSybilMetadata(metadata);

    const { error } = await supabase.rpc('record_listener_contribution', {
      p_user_id: userId,
      p_activity_type: activityType,
      p_reference_id: referenceId || null,
      p_reference_type: referenceType || null,
      p_metadata: sybilMetadata
    });

    if (error) {
      console.error('Error recording contribution:', error);
    }
  } catch (error) {
    console.error('Error in recordContribution:', error);
  }
}

/**
 * Get all available contribution activities
 */
export async function getContributionActivities(): Promise<ContributionActivity[]> {
  try {
    const { data, error } = await supabase
      .from('contribution_activities')
      .select('*')
      .eq('is_active', true)
      .order('base_reward_points', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching contribution activities:', error);
    return [];
  }
}

/**
 * Get user's contribution score
 */
export async function getUserContributionScore(userId: string): Promise<ContributionScore | null> {
  try {
    const { data, error } = await supabase
      .from('listener_contribution_scores')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  } catch (error) {
    console.error('Error fetching contribution score:', error);
    return null;
  }
}

/**
 * Get user's recent contributions
 */
export async function getUserContributions(
  userId: string,
  limit: number = 20
): Promise<ListenerContribution[]> {
  try {
    const { data, error } = await supabase
      .from('listener_contributions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching user contributions:', error);
    return [];
  }
}

/**
 * Get top contributors leaderboard
 */
export async function getTopContributors(limit: number = 10): Promise<TopContributor[]> {
  try {
    const { data, error } = await supabase.rpc('get_top_contributors', {
      p_limit: limit
    });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching top contributors:', error);
    return [];
  }
}

/**
 * Get current rewards budget info
 */
export async function getCurrentRewardsBudget(): Promise<RewardsBudget | null> {
  try {
    const { data, error } = await supabase
      .from('platform_rewards_budget')
      .select('*')
      .order('period_date', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  } catch (error) {
    console.error('Error fetching rewards budget:', error);
    return null;
  }
}

/**
 * Get user's reward history
 */
export async function getUserRewardHistory(userId: string, limit: number = 10) {
  try {
    const { data, error } = await supabase
      .from('contribution_rewards_history')
      .select('*')
      .eq('user_id', userId)
      .order('period_date', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching reward history:', error);
    return [];
  }
}

// =================================================================
// CONTRIBUTION TRACKING HELPERS
// =================================================================

/**
 * Track playlist creation
 */
export async function trackPlaylistCreated(playlistId: string) {
  await recordContribution('playlist_created', playlistId, 'playlist');
}

/**
 * Track when someone plays a user's playlist
 */
export async function trackPlaylistPlayed(
  playlistOwnerId: string,
  playlistId: string,
  playerId: string
) {
  // Only count if it's NOT the owner playing their own playlist
  if (playlistOwnerId === playerId) return;

  // Record contribution for the playlist owner
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Temporarily switch context to playlist owner
  const sybilMetadata = await buildSybilMetadata({ played_by: playerId });
  await supabase.rpc('record_listener_contribution', {
    p_user_id: playlistOwnerId,
    p_activity_type: 'playlist_play',
    p_reference_id: playlistId,
    p_reference_type: 'playlist',
    p_metadata: sybilMetadata
  });
}

/**
 * Check and award playlist quality bonus
 * Called periodically to check if playlists have reached the threshold
 */
export async function checkPlaylistQualityBonus(playlistId: string, ownerId: string) {
  try {
    // Get playlist play count from unique users
    const { count, error } = await supabase
      .from('playback_history')
      .select('user_id', { count: 'exact', head: true })
      .eq('playlist_id', playlistId)
      .neq('user_id', ownerId); // Exclude owner's plays

    if (error) throw error;

    // If playlist has 50+ plays from other users, award bonus
    if (count && count >= 50) {
      // Check if bonus already awarded
      const { data: existing } = await supabase
        .from('listener_contributions')
        .select('id')
        .eq('user_id', ownerId)
        .eq('activity_type', 'playlist_quality_bonus')
        .eq('reference_id', playlistId)
        .single();

      if (!existing) {
        await recordContribution('playlist_quality_bonus', playlistId, 'playlist', {
          play_count: count
        });
      }
    }
  } catch (error) {
    console.error('Error checking playlist quality bonus:', error);
  }
}

/**
 * Track early discovery
 * Award points when a song a user added early becomes popular
 */
export async function checkEarlyDiscovery(songId: string) {
  try {
    // Get current song play count
    const { count: currentPlays, error: countError } = await supabase
      .from('playback_history')
      .select('*', { count: 'exact', head: true })
      .eq('song_id', songId);

    if (countError) throw countError;

    // Only proceed if song has 1000+ plays (popular threshold)
    if (!currentPlays || currentPlays < 1000) return;

    // Find users who added this song to playlists early
    // Check playlist_songs table for early additions
    const { data: earlyAdds, error: playlistError } = await supabase
      .from('playlist_songs')
      .select(`
        playlist_id,
        playlists!inner(user_id, created_at)
      `)
      .eq('song_id', songId);

    if (playlistError) throw playlistError;

    // Award points to users who added it to their playlists
    // (assuming they added it early if their playlist predates the popularity)
    if (earlyAdds) {
      for (const add of earlyAdds) {
        const playlistOwnerId = (add.playlists as any).user_id;

        // Check if already rewarded
        const { data: existing } = await supabase
          .from('listener_contributions')
          .select('id')
          .eq('user_id', playlistOwnerId)
          .eq('activity_type', 'early_discovery')
          .eq('reference_id', songId)
          .single();

        if (!existing) {
          const sybilMetadata = await buildSybilMetadata({ current_plays: currentPlays });
          await supabase.rpc('record_listener_contribution', {
            p_user_id: playlistOwnerId,
            p_activity_type: 'early_discovery',
            p_reference_id: songId,
            p_reference_type: 'song',
            p_metadata: sybilMetadata
          });
        }
      }
    }
  } catch (error) {
    console.error('Error checking early discovery:', error);
  }
}

/**
 * Track artist discovery
 * Award points when a user follows/plays an artist early who later becomes popular
 */
export async function checkArtistDiscovery(artistId: string) {
  try {
    // Get artist's total play count
    const { data: artistSongs, error: songsError } = await supabase
      .from('songs')
      .select('id')
      .eq('artist_id', artistId);

    if (songsError) throw songsError;
    if (!artistSongs || artistSongs.length === 0) return;

    const songIds = artistSongs.map(s => s.id);

    // Get total plays across all artist's songs
    const { count: totalPlays, error: countError } = await supabase
      .from('playback_history')
      .select('*', { count: 'exact', head: true })
      .in('song_id', songIds);

    if (countError) throw countError;

    // Only proceed if artist has 5000+ total plays (popular threshold)
    if (!totalPlays || totalPlays < 5000) return;

    // Find users who followed this artist early
    const { data: earlyFollowers, error: followError } = await supabase
      .from('artist_followers')
      .select('user_id, created_at')
      .eq('artist_id', artistId)
      .order('created_at', { ascending: true });

    if (followError) throw followError;

    // Award to early followers (first 100 followers)
    if (earlyFollowers && earlyFollowers.length > 0) {
      const early = earlyFollowers.slice(0, Math.min(100, earlyFollowers.length));

      for (const follower of early) {
        // Check if already rewarded
        const { data: existing } = await supabase
          .from('listener_contributions')
          .select('id')
          .eq('user_id', follower.user_id)
          .eq('activity_type', 'artist_discovery')
          .eq('reference_id', artistId)
          .single();

        if (!existing) {
          const sybilMetadata = await buildSybilMetadata({
            total_plays: totalPlays,
            followed_at: follower.created_at
          });
          await supabase.rpc('record_listener_contribution', {
            p_user_id: follower.user_id,
            p_activity_type: 'artist_discovery',
            p_reference_id: artistId,
            p_reference_type: 'artist',
            p_metadata: sybilMetadata
          });
        }
      }
    }
  } catch (error) {
    console.error('Error checking artist discovery:', error);
  }
}

/**
 * Track early supporter
 * Award major points for being in the first 10 followers of an artist who becomes very popular
 */
export async function checkEarlySupporter(artistId: string, userId: string) {
  try {
    // Count how many followers the artist had when this user followed
    const { data: followerData } = await supabase
      .from('artist_followers')
      .select('user_id, created_at')
      .eq('artist_id', artistId)
      .eq('user_id', userId)
      .single();

    if (!followerData) return;

    // Count followers before this user
    const { count: followersBeforeCount } = await supabase
      .from('artist_followers')
      .select('*', { count: 'exact', head: true })
      .eq('artist_id', artistId)
      .lt('created_at', followerData.created_at);

    // If user was in first 10 followers
    if (followersBeforeCount !== null && followersBeforeCount < 10) {
      // Check if artist now has 10000+ total plays
      const { data: artistSongs } = await supabase
        .from('songs')
        .select('id')
        .eq('artist_id', artistId);

      if (artistSongs && artistSongs.length > 0) {
        const songIds = artistSongs.map(s => s.id);
        const { count: totalPlays } = await supabase
          .from('playback_history')
          .select('*', { count: 'exact', head: true })
          .in('song_id', songIds);

        // Award if artist is now very popular (10000+ plays)
        if (totalPlays && totalPlays >= 10000) {
          // Check if already rewarded
          const { data: existing } = await supabase
            .from('listener_contributions')
            .select('id')
            .eq('user_id', userId)
            .eq('activity_type', 'early_supporter')
            .eq('reference_id', artistId)
            .single();

          if (!existing) {
            const sybilMetadata = await buildSybilMetadata({
              follower_number: followersBeforeCount + 1,
              total_plays: totalPlays
            });
            await supabase.rpc('record_listener_contribution', {
              p_user_id: userId,
              p_activity_type: 'early_supporter',
              p_reference_id: artistId,
              p_reference_type: 'artist',
              p_metadata: sybilMetadata
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('Error checking early supporter:', error);
  }
}

/**
 * Track listener curation engagement
 */
export async function trackCurationEngagement(curationId: string, creatorId: string) {
  const sybilMetadata = await buildSybilMetadata();
  await supabase.rpc('record_listener_contribution', {
    p_user_id: creatorId,
    p_activity_type: 'curation_engagement',
    p_reference_id: curationId,
    p_reference_type: 'curation',
    p_metadata: sybilMetadata
  });
}

/**
 * Track daily active contribution
 * Called once per day per user when they perform any contribution
 */
export async function trackDailyEngagement(userId: string) {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Check if already tracked today
    const { data: existing } = await supabase
      .from('listener_contributions')
      .select('id')
      .eq('user_id', userId)
      .eq('activity_type', 'daily_engagement')
      .gte('created_at', `${today}T00:00:00`)
      .single();

    if (!existing) {
      const sybilMetadata = await buildSybilMetadata({ date: today });
      await supabase.rpc('record_listener_contribution', {
        p_user_id: userId,
        p_activity_type: 'daily_engagement',
        p_reference_id: null,
        p_reference_type: null,
        p_metadata: sybilMetadata
      });
    }
  } catch (error) {
    // Ignore errors - this is bonus tracking
  }
}

/**
 * Track referral contribution
 * Called when a referred user becomes an active contributor
 */
export async function trackReferralContribution(referrerId: string, referredUserId: string) {
  const sybilMetadata = await buildSybilMetadata();
  await supabase.rpc('record_listener_contribution', {
    p_user_id: referrerId,
    p_activity_type: 'referral_contribution',
    p_reference_id: referredUserId,
    p_reference_type: 'user',
    p_metadata: sybilMetadata
  });
}

/**
 * Subscribe to contribution score updates
 */
export function subscribeToContributionScore(
  userId: string,
  callback: (score: ContributionScore) => void
) {
  const subscription = supabase
    .channel(`contribution_score:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'listener_contribution_scores',
        filter: `user_id=eq.${userId}`
      },
      (payload) => {
        callback(payload.new as ContributionScore);
      }
    )
    .subscribe();

  return () => {
    subscription.unsubscribe();
  };
}

// =================================================================
// LISTENING ENGAGEMENT TRACKING
// =================================================================

/**
 * Track listening engagement (song completion, variety, etc.)
 * This tracks ENGAGEMENT BEHAVIOR, not just passive consumption
 *
 * COMPLIANT: Rewards milestones like "listen to 5 songs today" not "1 point per song"
 */
export async function trackListeningEngagement(
  userId: string,
  songId: string,
  completed: boolean,
  genre?: string,
  artistTotalPlays?: number
) {
  try {
    const deviceId = getOrCreateDeviceId();
    const userAgent = getBestEffortUserAgent();
    const ip = await getBestEffortPublicIp();
    const { error } = await supabase.rpc('track_listening_engagement', {
      p_user_id: userId,
      p_song_id: songId,
      p_completed: completed,
      p_genre: genre || null,
      p_artist_total_plays: artistTotalPlays || null,
      p_device_id: deviceId,
      p_ip: ip,
      p_user_agent: userAgent
    });

    if (error) {
      console.error('Error tracking listening engagement:', error);
    }
  } catch (error) {
    console.error('Error in trackListeningEngagement:', error);
  }
}

/**
 * Get user's listening engagement stats
 */
export async function getUserEngagementStats(userId: string) {
  try {
    const { data, error } = await supabase
      .from('listener_engagement_stats')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  } catch (error) {
    console.error('Error fetching engagement stats:', error);
    return null;
  }
}

/**
 * Helper: Track when a song starts playing
 */
export async function trackSongStarted(userId: string, songId: string, genre?: string, artistTotalPlays?: number) {
  await trackListeningEngagement(userId, songId, false, genre, artistTotalPlays);
}

/**
 * Helper: Track when a song completes (80%+ listened)
 */
export async function trackSongCompleted(userId: string, songId: string, genre?: string, artistTotalPlays?: number) {
  await trackListeningEngagement(userId, songId, true, genre, artistTotalPlays);
}

// =================================================================
// MONTHLY CONVERSION SYSTEM
// =================================================================

export interface ConversionSettings {
  id: string;
  conversion_rate: number;
  conversion_rate_description: string;
  is_active: boolean;
  max_payout_per_user_usd: number | null;
  minimum_points_for_payout: number;
  updated_at: string;
}

export interface ConversionHistory {
  id: string;
  conversion_date: string;
  reward_pool_usd: number;
  total_points_converted: number;
  total_users_paid: number;
  conversion_rate_used: number;
  actual_rate_applied: number;
  scaling_applied: boolean;
  total_distributed_usd: number;
  status: string;
  execution_notes: string | null;
  created_at: string;
}

export interface ConversionPreview {
  total_eligible_points: number;
  estimated_payout_usd: number;
  eligible_users_count: number;
  conversion_rate: number;
  minimum_points_required: number;
}

/**
 * Get current conversion settings
 */
export async function getConversionSettings(): Promise<ConversionSettings | null> {
  try {
    const { data, error } = await supabase
      .from('contribution_conversion_settings')
      .select('*')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  } catch (error) {
    console.error('Error fetching conversion settings:', error);
    return null;
  }
}

/**
 * Get conversion preview for current period
 */
export async function getConversionPreview(): Promise<ConversionPreview | null> {
  try {
    const { data, error } = await supabase.rpc('get_conversion_preview');

    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  } catch (error) {
    console.error('Error fetching conversion preview:', error);
    return null;
  }
}

/**
 * Get conversion history
 */
export async function getConversionHistory(limit: number = 10): Promise<ConversionHistory[]> {
  try {
    const { data, error } = await supabase
      .from('contribution_conversion_history')
      .select('*')
      .order('conversion_date', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching conversion history:', error);
    return [];
  }
}

/**
 * Update conversion rate (Admin only)
 */
export async function updateConversionRate(
  newRate: number,
  description?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'You must be logged in' };
    }

    const { error } = await supabase.rpc('admin_update_conversion_rate', {
      p_new_rate: newRate,
      p_description: description || null
    });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error updating conversion rate:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update conversion rate'
    };
  }
}

/**
 * Process monthly conversion (Admin only)
 */
export async function processMonthlyConversion(
  periodDate: string,
  rewardPoolUsd: number
): Promise<{
  success: boolean;
  data?: {
    distributed_count: number;
    total_distributed_usd: number;
    total_points_converted: number;
    conversion_rate_used: number;
    actual_rate_applied: number;
    scaling_applied: boolean;
  };
  error?: string;
}> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'You must be logged in' };
    }

    const { data, error } = await supabase.rpc('admin_distribute_contribution_rewards', {
      p_period_date: periodDate,
      p_reward_pool_usd: rewardPoolUsd
    });

    if (error) throw error;

    return {
      success: true,
      data: data && data.length > 0 ? data[0] : undefined
    };
  } catch (error) {
    console.error('Error processing monthly conversion:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process conversion'
    };
  }
}

/**
 * Get user's contribution rewards history
 */
export async function getUserContributionRewards(userId: string, limit: number = 10) {
  try {
    const { data, error } = await supabase
      .from('contribution_rewards_history')
      .select('*')
      .eq('user_id', userId)
      .order('period_date', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching user contribution rewards:', error);
    return [];
  }
}

// =================================================================
// LISTENER SCORE → LIVE BALANCE (SELF-SERVICE POOL CONVERSION)
// =================================================================

export interface ListenerConversionQuote {
  success: boolean;
  error?: string;
  points_requested?: number;
  points_convertible?: number;
  cash_multiplier?: number;
  weighted_points?: number;
  pool_remaining_usd?: number;
  pool_funded_usd?: number;
  platform_weighted_outstanding?: number;
  effective_rate_per_weighted_point?: number;
  estimated_payout_usd?: number;
  minimum_points_required?: number;
  quote_is_indicative?: boolean;
}

export interface ListenerConversionResult {
  success: boolean;
  error?: string;
  status?: string;
  conversion_id?: string;
  points_converted?: number;
  payout_usd?: number;
  pool_remaining_usd?: number;
  new_current_period_points?: number;
}

export interface ListenerPoolStatus {
  has_active_pool: boolean;
  period_start?: string;
  period_end?: string;
  funded_usd?: number;
  distributed_usd?: number;
  remaining_usd?: number;
  platform_weighted_outstanding?: number;
  effective_rate_if_all_weighted_converted?: number;
}

// ---------------------------------------------------------------------------
// Listener rewards pool — self-service convert (Listener Score → Live Balance)
// Pool funding: (1) platform AdMob share via locked ad_daily_revenue_input — automatic
//               (2) external_revenue_contribution_pool_topups — manual topups only
// ---------------------------------------------------------------------------

export async function getListenerScoreConversionQuote(
  points?: number
): Promise<ListenerConversionQuote> {
  try {
    const { data, error } = await supabase.rpc('get_listener_score_conversion_quote', {
      p_points: points ?? null
    });
    if (error) throw error;
    return (data as ListenerConversionQuote) ?? { success: false, error: 'No quote returned' };
  } catch (error) {
    console.error('Error fetching conversion quote:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load quote'
    };
  }
}

export async function convertListenerScoreToLiveBalance(
  points?: number
): Promise<ListenerConversionResult> {
  try {
    const idempotencyKey =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `conv-${Date.now()}`;

    const { data, error } = await supabase.rpc('user_convert_listener_score', {
      p_points: points ?? null,
      p_idempotency_key: idempotencyKey
    });
    if (error) throw error;
    return (data as ListenerConversionResult) ?? { success: false, error: 'No result returned' };
  } catch (error) {
    console.error('Error converting listener score:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Conversion failed'
    };
  }
}

export async function getListenerRewardsPoolStatus(): Promise<ListenerPoolStatus | null> {
  try {
    const { data, error } = await supabase.rpc('get_listener_rewards_pool_status');
    if (error) throw error;
    return data as ListenerPoolStatus;
  } catch (error) {
    console.error('Error fetching listener pool status:', error);
    return null;
  }
}
