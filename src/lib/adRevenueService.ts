import { supabase } from './supabase';

/**
 * Service for handling ad revenue-related operations
 *
 * REVENUE SPLIT (per ad shown, per song):
 * - Always 50% Artist/Creator | 50% Platform (configurable in Ad Safety Caps; minimum 50% creator for AdMob compliance).
 * - The Artist/Creator "Live balance" (users.total_earnings) displayed everywhere in the app
 *   is always their NET revenue (their 50% share after the split), never gross ad revenue.
 * - Listeners earn through the separate Contribution Rewards System.
 *
 * The actual revenue processing and split logic is handled by database
 * functions that were updated in the migration system.
 */
export const adRevenueService = {
  /**
   * Process revenue for a specific ad impression
   * @param impressionId The ID of the ad impression to process
   * @returns Promise resolving to the processing result
   */
  async processAdRevenue(impressionId: string): Promise<any> {
    try {
      // Use RPC function instead of Edge Function (RPC function exists in database)
      const { data, error } = await supabase.rpc('process_ad_impression_revenue', {
        impression_uuid: impressionId
      });

      if (error) {
        console.error('Error processing ad revenue:', error);
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error in processAdRevenue:', error);
      throw error;
    }
  },

  /**
   * Process a batch of unprocessed ad impressions
   * @param options Optional parameters for batch processing
   * @returns Promise resolving to the batch processing result
   */
  async processBatchAdRevenue(options: {
    startDate?: string;
    endDate?: string;
    limit?: number;
  } = {}): Promise<any> {
    try {
      // Use RPC function instead of Edge Function (RPC function exists in database)
      const { data, error } = await supabase.rpc('process_pending_ad_revenue', {
        batch_size: options.limit || 100
      });

      if (error) {
        console.error('Error processing batch ad revenue:', error);
        throw error;
      }

      // Format response to match expected structure
      return {
        success: true,
        processed_count: data?.processed_count || 0,
        message: data?.message || `Processed ${data?.processed_count || 0} ad impressions successfully`,
        ...data
      };
    } catch (error) {
      console.error('Error in processBatchAdRevenue:', error);
      throw error;
    }
  },

  /**
   * Get revenue summary for the current user
   * @param startDate Optional start date for the summary period
   * @param endDate Optional end date for the summary period
   * @returns Promise resolving to the user's revenue summary
   */
  async getUserRevenueSummary(
    startDate?: Date,
    endDate?: Date
  ): Promise<any> {
    try {
      const { data, error } = await supabase.rpc('get_user_revenue_summary', {
        start_date: startDate?.toISOString(),
        end_date: endDate?.toISOString(),
      });

      if (error) {
        console.error('Error getting user revenue summary:', error);
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error in getUserRevenueSummary:', error);
      throw error;
    }
  },

  /**
   * Get detailed revenue events for the current user
   * @param options Optional parameters for filtering revenue events
   * @returns Promise resolving to the user's revenue events
   */
  async getUserRevenueEvents(options: {
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  } = {}): Promise<any> {
    try {
      let query = supabase
        .from('ad_revenue_events')
        .select('*')
        .order('processed_at', { ascending: false });

      if (options.startDate) {
        query = query.gte('processed_at', options.startDate.toISOString());
      }

      if (options.endDate) {
        query = query.lte('processed_at', options.endDate.toISOString());
      }

      if (options.limit) {
        query = query.limit(options.limit);
      }

      if (options.offset) {
        query = query.range(
          options.offset,
          options.offset + (options.limit || 10) - 1
        );
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error getting user revenue events:', error);
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error in getUserRevenueEvents:', error);
      throw error;
    }
  },
};