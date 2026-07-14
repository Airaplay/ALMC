import { supabase } from './supabase';
import { cache } from './cache';

export interface RotationCycle {
  id: string;
  sectionKey: string;
  cycleNumber: number;
  cycleStartTime: string;
  cycleEndTime: string;
  promotionsDisplayed: number;
  status: 'active' | 'completed' | 'expired';
}

export interface QueueState {
  promotionId: string;
  sectionKey: string;
  queuePosition: number;
  visibilityScore: number;
  lastDisplayedAt?: string;
  cyclesSinceDisplay: number;
  forcedNextCycle: boolean;
  inCurrentRotation: boolean;
}

export interface ExposureLog {
  promotionId: string;
  sectionKey: string;
  eventType: 'enter_rotation' | 'exit_rotation' | 'forced_inclusion';
  visibilityScore?: number;
  queuePosition?: number;
  treatDeducted: number;
  eventTime: string;
}

/**
 * Rotation Queue Manager
 * Manages the smart rotation queue system for promoted content
 */
export class RotationQueueManager {
  private static FAIRNESS_CYCLE_LIMIT = 3; // 6 hours = 3 cycles
  private static ROTATION_CHECK_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours in ms
  private static SCORE_RECALC_INTERVAL = 30 * 60 * 1000; // 30 minutes - background score updates

  private intervalId?: ReturnType<typeof setInterval>;
  private scoreRecalcIntervalId?: ReturnType<typeof setInterval>;

  /**
   * Start automatic cycle rotation
   */
  startAutoRotation(): void {
    if (this.intervalId) {
      console.warn('[RotationQueue] Auto-rotation already started');
      return;
    }

    console.log('[RotationQueue] Starting auto-rotation (every 2 hours)');

    this.intervalId = setInterval(async () => {
      await this.rotateAllSections();
    }, RotationQueueManager.ROTATION_CHECK_INTERVAL);

    // Start background score recalculation
    this.startBackgroundScoreRecalculation();

    // Run initial rotation check
    this.rotateAllSections();
  }

  /**
   * Stop automatic cycle rotation
   */
  stopAutoRotation(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      console.log('[RotationQueue] Auto-rotation stopped');
    }

    if (this.scoreRecalcIntervalId) {
      clearInterval(this.scoreRecalcIntervalId);
      this.scoreRecalcIntervalId = undefined;
      console.log('[RotationQueue] Background score recalculation stopped');
    }
  }

  /**
   * Start background visibility score recalculation
   * Runs every 30 minutes to keep scores fresh before rotation
   */
  private startBackgroundScoreRecalculation(): void {
    if (this.scoreRecalcIntervalId) {
      console.warn('[RotationQueue] Background score recalculation already started');
      return;
    }

    console.log('[RotationQueue] Starting background score recalculation (every 30 minutes)');

    this.scoreRecalcIntervalId = setInterval(async () => {
      await this.recalculateVisibilityScores();
    }, RotationQueueManager.SCORE_RECALC_INTERVAL);
  }

  /**
   * Recalculate visibility scores for all active promotions
   * This happens in the background to keep scores fresh
   */
  private async recalculateVisibilityScores(): Promise<void> {
    try {
      console.log('[RotationQueue] Recalculating visibility scores...');

      // Update performance scores for all active promotions
      const { error } = await supabase.rpc('update_promotion_performance');

      if (error) {
        console.error('[RotationQueue] Error recalculating scores:', error);
        return;
      }

      console.log('[RotationQueue] Visibility scores recalculated successfully');
    } catch (error) {
      console.error('[RotationQueue] Failed to recalculate scores:', error);
    }
  }

  /**
   * Rotate all sections to next cycle
   */
  async rotateAllSections(): Promise<void> {
    try {
      console.log('[RotationQueue] Rotating all sections...');

      // Recalculate scores before rotation
      await this.recalculateVisibilityScores();

      const { error } = await supabase.rpc('rotate_promotion_cycle', {
        p_section_key: null // null = rotate all sections
      });

      if (error) {
        console.error('[RotationQueue] Error rotating sections:', error);
        throw error;
      }

      // Clear all promotion content cache after rotation
      cache.deletePattern('^promoted_content:');
      console.log('[RotationQueue] Cleared promotion cache after rotation');

      console.log('[RotationQueue] All sections rotated successfully');
    } catch (error) {
      console.error('[RotationQueue] Failed to rotate sections:', error);
    }
  }

  /**
   * Rotate a specific section to next cycle
   */
  async rotateSection(sectionKey: string): Promise<void> {
    try {
      console.log(`[RotationQueue] Rotating section: ${sectionKey}`);

      // Recalculate scores before rotation
      await this.recalculateVisibilityScores();

      const { error } = await supabase.rpc('rotate_promotion_cycle', {
        p_section_key: sectionKey
      });

      if (error) {
        console.error(`[RotationQueue] Error rotating section ${sectionKey}:`, error);
        throw error;
      }

      // Clear cache for this specific section
      cache.deletePattern(`^promoted_content:${sectionKey}:`);
      console.log(`[RotationQueue] Cleared cache for section ${sectionKey}`);

      console.log(`[RotationQueue] Section ${sectionKey} rotated successfully`);
    } catch (error) {
      console.error(`[RotationQueue] Failed to rotate section ${sectionKey}:`, error);
    }
  }

  /**
   * Get current rotation cycle for a section
   */
  async getCurrentCycle(sectionKey: string): Promise<RotationCycle | null> {
    try {
      const { data, error } = await supabase
        .from('promotion_rotation_cycles')
        .select('*')
        .eq('section_key', sectionKey)
        .eq('status', 'active')
        .order('cycle_start_time', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error(`[RotationQueue] Error fetching current cycle:`, error);
        return null;
      }

      if (!data) return null;

      return {
        id: data.id,
        sectionKey: data.section_key,
        cycleNumber: data.cycle_number,
        cycleStartTime: data.cycle_start_time,
        cycleEndTime: data.cycle_end_time,
        promotionsDisplayed: data.promotions_displayed,
        status: data.status
      };
    } catch (error) {
      console.error('[RotationQueue] Error in getCurrentCycle:', error);
      return null;
    }
  }

  /**
   * Get queue state for all promotions in a section
   */
  async getQueueState(sectionKey: string): Promise<QueueState[]> {
    try {
      const { data, error } = await supabase
        .from('promotion_queue_state')
        .select('*')
        .eq('section_key', sectionKey)
        .order('queue_position', { ascending: true });

      if (error) {
        console.error(`[RotationQueue] Error fetching queue state:`, error);
        return [];
      }

      return (data || []).map(item => ({
        promotionId: item.promotion_id,
        sectionKey: item.section_key,
        queuePosition: item.queue_position,
        visibilityScore: item.visibility_score,
        lastDisplayedAt: item.last_displayed_at,
        cyclesSinceDisplay: item.cycles_since_display,
        forcedNextCycle: item.forced_next_cycle,
        inCurrentRotation: item.in_current_rotation
      }));
    } catch (error) {
      console.error('[RotationQueue] Error in getQueueState:', error);
      return [];
    }
  }

  /**
   * Get exposure logs for a promotion
   */
  async getExposureLogs(
    promotionId: string,
    sectionKey?: string,
    limit: number = 100
  ): Promise<ExposureLog[]> {
    try {
      let query = supabase
        .from('promotion_exposure_logs')
        .select('*')
        .eq('promotion_id', promotionId)
        .order('event_time', { ascending: false })
        .limit(limit);

      if (sectionKey) {
        query = query.eq('section_key', sectionKey);
      }

      const { data, error } = await query;

      if (error) {
        console.error(`[RotationQueue] Error fetching exposure logs:`, error);
        return [];
      }

      return (data || []).map(item => ({
        promotionId: item.promotion_id,
        sectionKey: item.section_key,
        eventType: item.event_type,
        visibilityScore: item.visibility_score,
        queuePosition: item.queue_position,
        treatDeducted: item.treat_deducted,
        eventTime: item.event_time
      }));
    } catch (error) {
      console.error('[RotationQueue] Error in getExposureLogs:', error);
      return [];
    }
  }

  /**
   * Get rotation statistics for a section
   */
  async getRotationStats(sectionKey: string): Promise<{
    currentCycle: RotationCycle | null;
    totalPromotionsInQueue: number;
    promotionsInRotation: number;
    promotionsWaitingForSlot: number;
    forcedPromotions: number;
    averageVisibilityScore: number;
  }> {
    try {
      const [currentCycle, queueState] = await Promise.all([
        this.getCurrentCycle(sectionKey),
        this.getQueueState(sectionKey)
      ]);

      const inRotation = queueState.filter(q => q.inCurrentRotation).length;
      const forced = queueState.filter(q => q.forcedNextCycle).length;
      const avgScore = queueState.length > 0
        ? queueState.reduce((sum, q) => sum + q.visibilityScore, 0) / queueState.length
        : 0;

      return {
        currentCycle,
        totalPromotionsInQueue: queueState.length,
        promotionsInRotation: inRotation,
        promotionsWaitingForSlot: queueState.length - inRotation,
        forcedPromotions: forced,
        averageVisibilityScore: avgScore
      };
    } catch (error) {
      console.error('[RotationQueue] Error in getRotationStats:', error);
      return {
        currentCycle: null,
        totalPromotionsInQueue: 0,
        promotionsInRotation: 0,
        promotionsWaitingForSlot: 0,
        forcedPromotions: 0,
        averageVisibilityScore: 0
      };
    }
  }

  /**
   * Check if a cycle needs rotation
   */
  async checkCycleExpiration(sectionKey: string): Promise<boolean> {
    try {
      const currentCycle = await this.getCurrentCycle(sectionKey);

      if (!currentCycle) return true;

      const endTime = new Date(currentCycle.cycleEndTime);
      const now = new Date();

      return now >= endTime;
    } catch (error) {
      console.error('[RotationQueue] Error checking cycle expiration:', error);
      return false;
    }
  }

  /**
   * Get promotions that need fairness enforcement
   */
  async getStarvedPromotions(sectionKey: string): Promise<QueueState[]> {
    try {
      const queueState = await this.getQueueState(sectionKey);

      return queueState.filter(
        q => q.cyclesSinceDisplay >= RotationQueueManager.FAIRNESS_CYCLE_LIMIT
      );
    } catch (error) {
      console.error('[RotationQueue] Error in getStarvedPromotions:', error);
      return [];
    }
  }

  /**
   * Calculate time until next rotation
   */
  async getTimeUntilNextRotation(sectionKey: string): Promise<number> {
    try {
      const currentCycle = await this.getCurrentCycle(sectionKey);

      if (!currentCycle) return 0;

      const endTime = new Date(currentCycle.cycleEndTime);
      const now = new Date();
      const msUntilRotation = endTime.getTime() - now.getTime();

      return Math.max(0, msUntilRotation);
    } catch (error) {
      console.error('[RotationQueue] Error calculating time until rotation:', error);
      return 0;
    }
  }

  /**
   * Get promotion performance in rotation
   */
  async getPromotionPerformance(promotionId: string, sectionKey: string): Promise<{
    totalCycles: number;
    cyclesDisplayed: number;
    averagePosition: number;
    totalTreatDeducted: number;
    lastDisplayed?: string;
  }> {
    try {
      const logs = await this.getExposureLogs(promotionId, sectionKey);

      const enterEvents = logs.filter(l => l.eventType === 'enter_rotation');
      const totalTreat = logs.reduce((sum, l) => sum + l.treatDeducted, 0);
      const avgPosition = enterEvents.length > 0
        ? enterEvents.reduce((sum, l) => sum + (l.queuePosition || 0), 0) / enterEvents.length
        : 0;

      const queueState = await supabase
        .from('promotion_queue_state')
        .select('last_displayed_at, last_cycle_displayed')
        .eq('promotion_id', promotionId)
        .eq('section_key', sectionKey)
        .maybeSingle();

      return {
        totalCycles: (queueState.data?.last_cycle_displayed || 0) + 1,
        cyclesDisplayed: enterEvents.length,
        averagePosition: avgPosition,
        totalTreatDeducted: totalTreat,
        lastDisplayed: queueState.data?.last_displayed_at
      };
    } catch (error) {
      console.error('[RotationQueue] Error in getPromotionPerformance:', error);
      return {
        totalCycles: 0,
        cyclesDisplayed: 0,
        averagePosition: 0,
        totalTreatDeducted: 0
      };
    }
  }
}

// Export singleton instance
export const rotationQueueManager = new RotationQueueManager();

// Auto-start rotation in browser environment
if (typeof window !== 'undefined') {
  rotationQueueManager.startAutoRotation();

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    rotationQueueManager.stopAutoRotation();
  });
}
