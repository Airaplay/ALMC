import { supabase } from './supabase';
import { curatorMonetizationService } from './curatorMonetizationService';

/**
 * Log ad impression and trigger curator monetization if applicable
 * This should be called whenever an ad is displayed during playlist playback
 */
export async function logAdImpressionWithPlaylistContext(params: {
  userId?: string;
  adUnitId?: string;
  placementKey?: string;
  network?: string;
  adType?: string;
  completed?: boolean;
  playlistId?: string | null;
  contentId?: string;
  contentType?: string;
  estimatedRevenue?: number;
  metadata?: Record<string, any>;
}): Promise<string | null> {
  try {
    // Log the basic ad impression
    await logAdImpression({
      userId: params.userId,
      adUnitId: params.adUnitId,
      placementKey: params.placementKey,
      network: params.network,
      adType: params.adType,
      completed: params.completed,
      metadata: {
        ...params.metadata,
        contentId: params.contentId,
        contentType: params.contentType,
        playlistId: params.playlistId
      }
    });

    // If this ad impression is for a playlist, trigger curator monetization
    if (params.playlistId && params.completed) {
      const estimatedRevenue = params.estimatedRevenue || 0.0001; // Default minimal revenue
      const sessionDuration = (params.metadata?.sessionDuration as number) || 300; // Default 5 minutes

      // Trigger silent curator monetization with session duration
      await curatorMonetizationService.trackPlaylistWithAd(
        params.playlistId,
        (params.adType as 'banner' | 'interstitial' | 'native') || 'banner',
        estimatedRevenue,
        sessionDuration
      );
    }

    return params.playlistId || null;
  } catch (error) {
    console.error('Error logging ad impression with playlist context:', error);
    return null;
  }
}

/**
 * Log ad reward completion or skip
 */
export async function logAdReward(params: {
  userId: string;
  adImpressionId?: string;
  adUnitId?: string;
  placementKey?: string;
  rewardType: string;
  rewardAmount?: number;
  rewardCurrency?: string;
  completed?: boolean;
  skipped?: boolean;
  skipReason?: string;
  completionDuration?: number;
  metadata?: Record<string, any>;
}): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('log_ad_reward', {
      p_user_id: params.userId,
      p_ad_impression_id: params.adImpressionId || null,
      p_ad_unit_id: params.adUnitId || null,
      p_placement_key: params.placementKey || null,
      p_reward_type: params.rewardType,
      p_reward_amount: params.rewardAmount || null,
      p_reward_currency: params.rewardCurrency || 'treats',
      p_completed: params.completed || false,
      p_skipped: params.skipped || false,
      p_skip_reason: params.skipReason || null,
      p_completion_duration: params.completionDuration || null,
      p_metadata: params.metadata || {}
    });

    if (error) {
      console.error('Error logging ad reward:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in logAdReward:', error);
    return null;
  }
}

/**
 * Log ad revenue estimate
 */
export async function logAdRevenue(params: {
  adImpressionId?: string;
  adUnitId?: string;
  networkId?: string;
  placementKey?: string;
  estimatedCPM?: number;
  estimatedRevenue?: number;
  currency?: string;
  ecpmFloorUsed?: number;
  winningNetwork?: string;
  metadata?: Record<string, any>;
}): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('ad_revenue_logs')
      .insert([{
        ad_impression_id: params.adImpressionId || null,
        ad_unit_id: params.adUnitId || null,
        network_id: params.networkId || null,
        placement_key: params.placementKey || null,
        estimated_cpm: params.estimatedCPM || null,
        estimated_revenue: params.estimatedRevenue || null,
        currency: params.currency || 'USD',
        ecpm_floor_used: params.ecpmFloorUsed || null,
        winning_network: params.winningNetwork || null,
        metadata: params.metadata || {}
      }]);

    if (error) {
      console.error('Error logging ad revenue:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in logAdRevenue:', error);
    return false;
  }
}

/**
 * Log ad impression (enhanced)
 */
export async function logAdImpression(params: {
  adImpressionId?: string;
  userId?: string;
  adUnitId?: string;
  placementKey?: string;
  network?: string;
  adType?: string;
  impressionCount?: number;
  viewDuration?: number;
  completed?: boolean;
  failed?: boolean;
  failureReason?: string;
  metadata?: Record<string, any>;
}): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('ad_impression_logs')
      .insert([{
        ad_impression_id: params.adImpressionId || null,
        user_id: params.userId || null,
        ad_unit_id: params.adUnitId || null,
        placement_key: params.placementKey || null,
        network: params.network || null,
        ad_type: params.adType || null,
        impression_count: params.impressionCount || 1,
        view_duration: params.viewDuration || 0,
        completed: params.completed || false,
        failed: params.failed || false,
        failure_reason: params.failureReason || null,
        metadata: params.metadata || {}
      }]);

    if (error) {
      console.error('Error logging ad impression:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in logAdImpression:', error);
    return false;
  }
}

/**
 * Get user retention by reward type
 */
export async function getUserRetentionByRewardType(
  startDate?: Date,
  endDate?: Date
): Promise<any[]> {
  try {
    const { data, error } = await supabase.rpc('get_user_retention_by_reward_type', {
      p_start_date: startDate?.toISOString() || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      p_end_date: endDate?.toISOString() || new Date().toISOString()
    });

    if (error) {
      console.error('Error fetching user retention:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in getUserRetentionByRewardType:', error);
    return [];
  }
}

/**
 * Get ad revenue summary
 */
export async function getAdRevenueSummary(
  startDate?: Date,
  endDate?: Date
): Promise<any> {
  try {
    const { data, error } = await supabase.rpc('get_ad_revenue_summary', {
      p_start_date: startDate?.toISOString() || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      p_end_date: endDate?.toISOString() || new Date().toISOString()
    });

    if (error) {
      console.error('Error fetching ad revenue summary:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in getAdRevenueSummary:', error);
    return null;
  }
}


