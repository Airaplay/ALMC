import { supabase } from './supabase';

/**
 * Silent Curator Monetization Service
 *
 * Handles automatic, silent monetization for Listener Curations playlists.
 * Earnings are processed when ads are displayed during playlist playback.
 */

interface MonetizationResult {
  success: boolean;
  message?: string;
  curator_id?: string;
  curator_share?: number;
}

export const curatorMonetizationService = {
  /**
   * Track playlist play with ad impression for curator monetization
   * Called when a listener plays a curated playlist and an ad is displayed
   *
   * @param playlistId - The playlist being played
   * @param adType - Type of ad displayed (banner, interstitial, native)
   * @param adRevenue - Estimated revenue from the ad impression
   * @param sessionDuration - Total listening duration in seconds (minimum 300 seconds required)
   * @returns Promise resolving to monetization result
   */
  async trackPlaylistWithAd(
    playlistId: string,
    adType: 'banner' | 'interstitial' | 'native' = 'banner',
    adRevenue: number = 0.0001,
    sessionDuration: number = 300
  ): Promise<MonetizationResult> {
    try {
      // Call the database function that handles all the logic
      const { data, error } = await supabase.rpc('track_playlist_play_with_ad', {
        p_playlist_id: playlistId,
        p_ad_type: adType,
        p_ad_revenue: adRevenue,
        p_session_duration: sessionDuration
      });

      if (error) {
        console.error('[Curator Monetization] Error tracking playlist play:', error);
        return { success: false, message: error.message };
      }

      // Log successful monetization (only in development)
      if (process.env.NODE_ENV === 'development' && data?.curator_processing?.success) {
        console.log('[Curator Monetization] Earnings processed:', {
          curator_id: data.curator_processing.curator_id,
          curator_share: data.curator_processing.curator_share,
          revenue_split: data.curator_processing.revenue_split_percentage,
          session_duration: data.curator_processing.session_duration,
          validation_score: data.curator_processing.validation_score
        });
      }

      // Log blocked earnings (only in development)
      if (process.env.NODE_ENV === 'development' && !data?.curator_processing?.success) {
        console.log('[Curator Monetization] Earnings blocked:', {
          reason: data?.curator_processing?.message,
          blocked_reason: data?.curator_processing?.blocked_reason,
          fraud_check: data?.curator_processing?.fraud_check
        });
      }

      return data?.curator_processing || { success: false };
    } catch (error) {
      console.error('[Curator Monetization] Error:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  },

  /**
   * Get curator revenue split settings from admin configuration
   * @returns Promise resolving to the curator settings
   */
  async getCuratorSettings(): Promise<{ enabled: boolean; percentage: number } | null> {
    try {
      const { data, error } = await supabase
        .from('curator_settings')
        .select('setting_value')
        .eq('setting_key', 'curator_revenue_split')
        .maybeSingle();

      if (error || !data) {
        return { enabled: true, percentage: 5 }; // Default values
      }

      return {
        enabled: data.setting_value.enabled ?? true,
        percentage: data.setting_value.percentage ?? 5
      };
    } catch (error) {
      console.error('[Curator Monetization] Error fetching settings:', error);
      return { enabled: true, percentage: 5 };
    }
  },

  /**
   * Check if a playlist is eligible for curator monetization
   * @param playlistId - The playlist to check
   * @returns Promise resolving to eligibility status
   */
  async isPlaylistEligible(playlistId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('playlists')
        .select('curation_status, is_public, song_count')
        .eq('id', playlistId)
        .maybeSingle();

      if (error || !data) {
        return false;
      }

      // Playlist must be approved, public, and have at least 10 songs
      return (
        data.curation_status === 'approved' &&
        data.is_public === true &&
        data.song_count >= 10
      );
    } catch (error) {
      console.error('[Curator Monetization] Error checking eligibility:', error);
      return false;
    }
  },

  /**
   * Get curator's total earnings from all playlists (for private viewing)
   * @param curatorId - The curator's user ID
   * @returns Promise resolving to total earnings
   */
  async getCuratorTotalEarnings(curatorId: string): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('curator_earnings')
        .select('amount')
        .eq('curator_id', curatorId);

      if (error || !data) {
        return 0;
      }

      return data.reduce((total, record) => total + parseFloat(record.amount), 0);
    } catch (error) {
      console.error('[Curator Monetization] Error fetching earnings:', error);
      return 0;
    }
  },

  /**
   * Get detailed earnings breakdown by playlist (for curator's private view)
   * @param curatorId - The curator's user ID
   * @returns Promise resolving to earnings breakdown
   */
  async getCuratorEarningsBreakdown(curatorId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('curator_earnings')
        .select(`
          amount,
          earned_at,
          description,
          playlist:playlist_id (
            id,
            title,
            cover_image_url
          )
        `)
        .eq('curator_id', curatorId)
        .order('earned_at', { ascending: false })
        .limit(100);

      if (error) {
        console.error('[Curator Monetization] Error fetching breakdown:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[Curator Monetization] Error:', error);
      return [];
    }
  }
};
