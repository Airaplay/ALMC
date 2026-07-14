import { getFairPromotedContent } from './promotionFairness';
import { supabase } from './supabase';

interface MergedContent<T> {
  item: T;
  isPromoted: boolean;
  promotionId?: string;
  slotPosition?: number;
}


/**
 * Distribute promotion slots fairly across trending content
 * ONLY ONE PROMOTION PER CYCLE - placed at position 1 (first position)
 */
export const distributeTrendingPromotionSlots = async (
  sectionKey: string = 'now_trending',
  contentType: 'song' | 'video' = 'song',
  maxPromotions: number = 1
): Promise<Map<number, string>> => {
  try {
    console.log(`[TrendingSlots] Distributing slots for ${sectionKey} (${contentType}), max: ${maxPromotions}`);

    const promotedContent = await getFairPromotedContent(
      sectionKey,
      contentType,
      1 // Only get ONE promotion per cycle
    );

    console.log(`[TrendingSlots] Got ${promotedContent.length} promoted items from getFairPromotedContent`);

    if (promotedContent.length === 0) {
      console.log('[TrendingSlots] No promoted content available');
      return new Map();
    }

    const slotMap = new Map<number, string>();

    // Place the single promotion at position 1 (first position)
    slotMap.set(1, promotedContent[0].promotionId);
    console.log(`[TrendingSlots] Assigned single promotion to slot 1 (first position)`);

    console.log(`[TrendingSlots] Total slots assigned: ${slotMap.size}`);
    return slotMap;
  } catch (error) {
    console.error('[TrendingSlots] Error distributing promotion slots:', error);
    return new Map();
  }
};

/**
 * Merge regular content with promoted content based on slot distribution
 * Returns a combined array with promotions inserted at designated slots
 * ONLY ONE PROMOTION PER CYCLE - placed at position 1 (first position)
 */
export const mergeTrendingContentWithPromotions = async <T extends { id: string }>(
  regularContent: T[],
  sectionKey: string = 'now_trending',
  contentType: 'song' | 'video' = 'song'
): Promise<MergedContent<T>[]> => {
  try {
    const promotedContent = await getFairPromotedContent(sectionKey, contentType, 1);

    if (promotedContent.length === 0) {
      return regularContent.map(item => ({
        item,
        isPromoted: false
      }));
    }

    const promotion = promotedContent[0];
    const promotedTargetIds = new Set([promotion.targetId]);
    const result: MergedContent<T>[] = [];

    const existingPromotedItem = regularContent.find(item => item.id === promotion.targetId);

    if (existingPromotedItem) {
      result.push({
        item: existingPromotedItem,
        isPromoted: true,
        promotionId: promotion.promotionId,
        slotPosition: 1
      });
    } else {
      const tableName = contentType === 'song' ? 'songs' : 'content_uploads';

      if (tableName === 'songs') {
        const { data, error } = await supabase
          .from('songs')
          .select(`
            id,
            title,
            duration_seconds,
            audio_url,
            cover_image_url,
            play_count,
            artist_id,
            artists:artist_id (
              id,
              name,
              artist_profiles (
                user_id,
                stage_name
              )
            )
          `)
          .eq('id', promotion.targetId)
          .maybeSingle();

        if (data && !error) {
          const itemData = data as any;
          const artistProfile = itemData.artists?.artist_profiles?.[0];
          const artistName = artistProfile?.stage_name || itemData.artists?.name || 'Unknown Artist';
          const artistUserId = artistProfile?.user_id || null;

          const formattedItem = {
            id: itemData.id,
            title: itemData.title,
            artist: artistName,
            artist_id: itemData.artist_id || '',
            artist_user_id: artistUserId,
            cover_image_url: itemData.cover_image_url,
            audio_url: itemData.audio_url,
            duration_seconds: itemData.duration_seconds || 0,
            play_count: itemData.play_count || 0
          };

          result.push({
            item: formattedItem as any,
            isPromoted: true,
            promotionId: promotion.promotionId,
            slotPosition: 1
          });
        }
      } else {
        const { data, error } = await supabase
          .from('content_uploads')
          .select('id, title, metadata, play_count, user_id')
          .eq('id', promotion.targetId)
          .maybeSingle();

        if (data && !error) {
          const itemData = data as any;
          const formattedItem = {
            id: itemData.id,
            title: itemData.title,
            creator: 'Unknown',
            creator_user_id: itemData.user_id,
            thumbnail_url: itemData.metadata?.thumbnail_url,
            video_url: itemData.metadata?.video_url,
            duration_seconds: itemData.metadata?.duration_seconds || 0,
            play_count: itemData.play_count || 0
          };

          result.push({
            item: formattedItem as any,
            isPromoted: true,
            promotionId: promotion.promotionId,
            slotPosition: 1
          });
        }
      }
    }

    for (let i = 0; i < Math.min(regularContent.length, 25); i++) {
      const item = regularContent[i];
      if (!promotedTargetIds.has(item.id)) {
        result.push({
          item,
          isPromoted: false,
          slotPosition: result.length + 1
        });
      }
    }

    return result;
  } catch (error) {
    console.error('[TrendingSlots] Error merging content:', error);
    return regularContent.map(item => ({
      item,
      isPromoted: false
    }));
  }
};

/**
 * Get promotion slot assignments for debugging/analytics
 */
export const getPromotionSlotAssignments = async (
  sectionKey: string = 'now_trending',
  contentType: 'song' | 'video' = 'song'
): Promise<Array<{ slot: number; promotionId: string }>> => {
  const slotMap = await distributeTrendingPromotionSlots(
    sectionKey,
    contentType,
    1
  );

  return Array.from(slotMap.entries())
    .map(([slot, promotionId]) => ({ slot, promotionId }))
    .sort((a, b) => a.slot - b.slot);
};

/**
 * Check if a specific slot should contain a promotion
 */
export const isPromotionSlot = (
  slotMap: Map<number, string>,
  position: number
): { isPromotion: boolean; promotionId?: string } => {
  const promotionId = slotMap.get(position);
  return {
    isPromotion: !!promotionId,
    promotionId
  };
};
