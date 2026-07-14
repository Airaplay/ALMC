import { supabase } from './supabase';
import { rotationQueueManager } from './rotationQueueManager';
import { cache } from './cache';

export interface PromotedContent {
  promotionId: string;
  targetId: string;
  targetTitle: string;
  userId: string;
  rotationPriority: number;
  performanceScore: number;
  visibilityScore?: number;
  queuePosition?: number;
  forcedInclusion?: boolean;
}

export interface ImpressionData {
  promotionId: string;
  sectionKey: string;
  userId?: string;
  clicked?: boolean;
  sessionId?: string;
}

const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours (rotation cycle length)

/**
 * Get fairly rotated promoted content for a section using smart rotation queue
 * Implements visibility score calculation with 2-hour rotation cycles and fairness enforcement
 * Caches results for up to 4 hours to minimize database load
 */
export const getFairPromotedContent = async (
  sectionKey: string,
  contentType: 'song' | 'video' | 'album' | 'short_clip' | 'profile',
  limit: number = 10
): Promise<PromotedContent[]> => {
  try {
    console.log(`[PromotionFairness] 🔄 getFairPromotedContent called for ${sectionKey} (${contentType}), limit: ${limit}`);

    const cacheKey = `promoted_content:${sectionKey}:${contentType}:${limit}`;

    // Check cache first
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`[PromotionFairness] 💾 Using cached promoted content for ${sectionKey} (${cached.length} items)`);
      return cached;
    }

    // Check if current cycle needs rotation
    const needsRotation = await rotationQueueManager.checkCycleExpiration(sectionKey);
    if (needsRotation) {
      console.log(`[PromotionFairness] 🔄 Cycle expired for ${sectionKey}, rotating...`);
      await rotationQueueManager.rotateSection(sectionKey);
      // Clear cache for this section when rotating
      cache.delete(cacheKey);
    }

    // Use the new smart rotation function
    console.log(`[PromotionFairness] 📞 Calling get_smart_rotated_promotions RPC with params:`, {
      p_section_key: sectionKey,
      p_content_type: contentType,
      p_limit: limit
    });

    const { data, error } = await supabase.rpc('get_smart_rotated_promotions', {
      p_section_key: sectionKey,
      p_content_type: contentType,
      p_limit: limit
    });

    if (error) {
      console.error('[PromotionFairness] ❌ Error fetching smart rotated content:', error);
      return [];
    }

    if (!data || data.length === 0) {
      console.warn(`[PromotionFairness] ⚠️ No promoted content found for ${sectionKey} (${contentType}) - Promotions may be PENDING or INACTIVE`);
      return [];
    }

    console.log(`[PromotionFairness] ✅ Retrieved ${data.length} promoted items for ${sectionKey} with smart rotation:`, data);

    // Map the response
    const promotedContent = data.map((item: any) => ({
      promotionId: item.promotion_id,
      targetId: item.target_id,
      targetTitle: item.target_title,
      userId: item.user_id,
      rotationPriority: item.visibility_score || 0, // Use visibility score as priority
      performanceScore: item.visibility_score || 0,
      visibilityScore: item.visibility_score,
      queuePosition: item.queue_position,
      forcedInclusion: item.forced_inclusion
    }));

    console.log(`[PromotionFairness] 📊 Mapped promoted content for ${sectionKey}:`, 
      promotedContent.map(p => ({ 
        id: p.promotionId.substring(0, 8), 
        targetId: p.targetId.substring(0, 8), 
        title: p.targetTitle 
      }))
    );

    // Cache the results
    cache.set(cacheKey, promotedContent, CACHE_TTL);

    // Log starved promotions for monitoring (async, non-blocking)
    rotationQueueManager.getStarvedPromotions(sectionKey).then(starved => {
      if (starved.length > 0) {
        console.warn(`[PromotionFairness] ⚖️ ${starved.length} promotions in ${sectionKey} need fairness enforcement`);
      }
    });

    return promotedContent;
  } catch (error) {
    console.error('[PromotionFairness] ❌ Error in getFairPromotedContent:', error);
    return [];
  }
};

/**
 * Record a promotion impression (view)
 */
export const recordPromotionImpression = async (
  impressionData: ImpressionData
): Promise<boolean> => {
  try {
    const { error } = await supabase.rpc('record_promotion_impression', {
      p_promotion_id: impressionData.promotionId,
      p_section_key: impressionData.sectionKey,
      p_user_id: impressionData.userId || null,
      p_clicked: impressionData.clicked || false,
      p_session_id: impressionData.sessionId || null
    });

    if (error) {
      console.error('Error recording promotion impression:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error in recordPromotionImpression:', error);
    return false;
  }
};

/**
 * Record a promotion click
 */
export const recordPromotionClick = async (
  promotionId: string,
  sectionKey: string,
  userId?: string,
  sessionId?: string
): Promise<boolean> => {
  return recordPromotionImpression({
    promotionId,
    sectionKey,
    userId,
    clicked: true,
    sessionId
  });
};

/**
 * Get promotion performance metrics for a specific promotion
 */
export const getPromotionMetrics = async (promotionId: string) => {
  try {
    const { data, error } = await supabase
      .from('promotion_performance_metrics')
      .select('*')
      .eq('promotion_id', promotionId)
      .order('date', { ascending: false });

    if (error) {
      console.error('Error fetching promotion metrics:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in getPromotionMetrics:', error);
    return null;
  }
};

/**
 * Get aggregated metrics for a promotion
 */
export const getAggregatedMetrics = async (promotionId: string) => {
  try {
    const { data, error } = await supabase
      .from('promotion_rotation_state')
      .select('*')
      .eq('promotion_id', promotionId);

    if (error) {
      console.error('Error fetching aggregated metrics:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in getAggregatedMetrics:', error);
    return null;
  }
};

/**
 * Batch record impressions for multiple promotions
 * Useful when displaying multiple promoted items at once
 */
export const batchRecordImpressions = async (
  impressions: ImpressionData[]
): Promise<boolean> => {
  try {
    const promises = impressions.map(impression =>
      recordPromotionImpression(impression)
    );

    const results = await Promise.all(promises);
    return results.every(result => result === true);
  } catch (error) {
    console.error('Error in batchRecordImpressions:', error);
    return false;
  }
};

/**
 * Generate a session ID for tracking user sessions
 */
export const generateSessionId = (): string => {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
};

/**
 * Get or create session ID from localStorage
 */
export const getSessionId = (): string => {
  const storageKey = 'promotion_session_id';
  let sessionId = localStorage.getItem(storageKey);

  if (!sessionId) {
    sessionId = generateSessionId();
    localStorage.setItem(storageKey, sessionId);
  }

  return sessionId;
};

/**
 * Calculate expected impressions for a promotion based on duration
 */
export const calculateExpectedImpressions = (
  durationHours: number,
  averageUsersPerHour: number = 100
): number => {
  return Math.floor(durationHours * averageUsersPerHour * 0.3);
};

/**
 * Check if a promotion is performing well
 */
export const isPromotionPerformingWell = (
  impressions: number,
  clicks: number,
  expectedImpressions: number
): { isPerforming: boolean; reason: string } => {
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;

  if (impressions < expectedImpressions * 0.5) {
    return {
      isPerforming: false,
      reason: 'Low impression count'
    };
  }

  if (ctr < 1.0) {
    return {
      isPerforming: false,
      reason: 'Low click-through rate'
    };
  }

  if (ctr >= 5.0) {
    return {
      isPerforming: true,
      reason: 'Excellent click-through rate'
    };
  }

  return {
    isPerforming: true,
    reason: 'Good performance'
  };
};

/**
 * Get promotion statistics summary with rotation queue analytics
 */
export const getPromotionStats = async (promotionId: string, sectionKey?: string) => {
  try {
    const [metricsData, rotationData] = await Promise.all([
      getPromotionMetrics(promotionId),
      getAggregatedMetrics(promotionId)
    ]);

    if (!metricsData || !rotationData) {
      return null;
    }

    const totalImpressions = metricsData.reduce((sum, metric) => sum + metric.impressions, 0);
    const totalClicks = metricsData.reduce((sum, metric) => sum + metric.clicks, 0);
    const avgCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

    // Get rotation queue performance if section provided
    let rotationPerformance = null;
    if (sectionKey) {
      rotationPerformance = await rotationQueueManager.getPromotionPerformance(promotionId, sectionKey);
    }

    return {
      totalImpressions,
      totalClicks,
      averageCTR: avgCTR,
      dailyMetrics: metricsData,
      rotationState: rotationData,
      performance: isPromotionPerformingWell(totalImpressions, totalClicks, 1000),
      rotationPerformance
    };
  } catch (error) {
    console.error('Error in getPromotionStats:', error);
    return null;
  }
};

/**
 * Get rotation queue statistics for a section
 */
export const getRotationQueueStats = async (sectionKey: string) => {
  try {
    return await rotationQueueManager.getRotationStats(sectionKey);
  } catch (error) {
    console.error('Error in getRotationQueueStats:', error);
    return null;
  }
};

/**
 * Get time until next rotation cycle
 */
export const getTimeUntilRotation = async (sectionKey: string): Promise<{
  milliseconds: number;
  minutes: number;
  formatted: string;
}> => {
  try {
    const ms = await rotationQueueManager.getTimeUntilNextRotation(sectionKey);
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return {
      milliseconds: ms,
      minutes,
      formatted: `${hours}h ${remainingMinutes}m`
    };
  } catch (error) {
    console.error('Error in getTimeUntilRotation:', error);
    return {
      milliseconds: 0,
      minutes: 0,
      formatted: '0h 0m'
    };
  }
};

/**
 * Get exposure history for a promotion
 */
export const getExposureHistory = async (
  promotionId: string,
  sectionKey?: string,
  limit: number = 50
) => {
  try {
    return await rotationQueueManager.getExposureLogs(promotionId, sectionKey, limit);
  } catch (error) {
    console.error('Error in getExposureHistory:', error);
    return [];
  }
};
