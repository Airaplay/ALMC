import { getFairPromotedContent } from './promotionFairness';
import { supabase } from './supabase';

interface MergedContent<T> {
  item: T;
  isPromoted: boolean;
  promotionId?: string;
  slotPosition?: number;
}

/**
 * Generate 10 random promotion slots with spacing constraints
 * - 10 promotion slots total
 * - At least 2-3 regular songs between any two promotions
 * - Randomized on every load for fairness
 */
const generateRandomPromotionSlots = (
  totalPositions: number,
  numPromotions: number = 10,
  minSpacing: number = 2
): number[] => {
  const slots: number[] = [];
  const maxSlot = totalPositions;

  // Generate available positions (starting from position 1)
  const availablePositions: number[] = [];
  for (let i = 1; i <= maxSlot; i++) {
    availablePositions.push(i);
  }

  // Shuffle available positions for randomness
  for (let i = availablePositions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [availablePositions[i], availablePositions[j]] = [availablePositions[j], availablePositions[i]];
  }

  // Select slots ensuring minimum spacing
  for (const position of availablePositions) {
    if (slots.length >= numPromotions) break;

    // Check if this position respects minimum spacing
    const tooClose = slots.some(existingSlot =>
      Math.abs(existingSlot - position) <= minSpacing
    );

    if (!tooClose) {
      slots.push(position);
    }
  }

  // Sort slots for easy processing
  return slots.sort((a, b) => a - b);
};

/**
 * Distribute 10 promotion slots randomly across additional songs
 * Ensures proper spacing and randomization on every load
 */
export const distributeAdditionalSongsPromotionSlots = async (
  sectionKey: string = 'now_trending',
  contentType: 'song' | 'video' = 'song',
  totalPositions: number = 40
): Promise<Map<number, string>> => {
  try {
    console.log(`[AdditionalSongsSlots] Distributing 10 random slots for ${sectionKey} (${contentType})`);

    // Get 10 promoted items
    const promotedContent = await getFairPromotedContent(
      sectionKey,
      contentType,
      10
    );

    console.log(`[AdditionalSongsSlots] Got ${promotedContent.length} promoted items from getFairPromotedContent`);

    if (promotedContent.length === 0) {
      console.log('[AdditionalSongsSlots] No promoted content available');
      return new Map();
    }

    // Generate random slots with spacing constraints
    // minSpacing = 2 means at least 2 regular songs between promotions
    const randomSlots = generateRandomPromotionSlots(
      totalPositions,
      promotedContent.length,
      2
    );

    console.log(`[AdditionalSongsSlots] Generated random slots:`, randomSlots);

    const slotMap = new Map<number, string>();

    // Assign promotions to random slots
    randomSlots.forEach((slot, index) => {
      if (index < promotedContent.length) {
        slotMap.set(slot, promotedContent[index].promotionId);
        console.log(`[AdditionalSongsSlots] Assigned promotion "${promotedContent[index].targetTitle}" to slot ${slot}`);
      }
    });

    console.log(`[AdditionalSongsSlots] Total slots assigned: ${slotMap.size}`);
    return slotMap;
  } catch (error) {
    console.error('[AdditionalSongsSlots] Error distributing promotion slots:', error);
    return new Map();
  }
};

/**
 * Merge regular additional songs with promoted content
 * 10 promotions placed randomly with proper spacing
 */
export const mergeAdditionalSongsWithPromotions = async <T extends { id: string }>(
  regularContent: T[],
  sectionKey: string = 'now_trending',
  contentType: 'song' | 'video' = 'song'
): Promise<MergedContent<T>[]> => {
  try {
    console.log(`[AdditionalSongsSlots] Starting merge with ${regularContent.length} regular items`);

    const slotMap = await distributeAdditionalSongsPromotionSlots(
      sectionKey,
      contentType,
      regularContent.length + 10 // Account for total positions including promotions
    );

    console.log(`[AdditionalSongsSlots] Slot map size: ${slotMap.size}`);

    if (slotMap.size === 0) {
      console.log('[AdditionalSongsSlots] No promotion slots, returning regular content only');
      return regularContent.map(item => ({
        item,
        isPromoted: false
      }));
    }

    const promotedContent = await getFairPromotedContent(
      sectionKey,
      contentType,
      10
    );

    console.log(`[AdditionalSongsSlots] Retrieved ${promotedContent.length} promoted items`);

    // Fetch full promoted song/video data from database
    const promotedItemsData = new Map<string, T>();
    if (promotedContent.length > 0) {
      const targetIds = promotedContent.map(p => p.targetId);

      // Determine which table to query
      const tableName = contentType === 'song' ? 'songs' : contentType === 'video' ? 'content_uploads' : 'videos';

      let promotedData: any[] = [];
      let promotedError: any = null;

      if (tableName === 'content_uploads') {
        // For content_uploads (short clips)
        const { data, error } = await supabase
          .from('content_uploads')
          .select(`
            id,
            title,
            description,
            content_type,
            metadata,
            play_count,
            created_at,
            user_id,
            users (
              id,
              display_name,
              avatar_url
            )
          `)
          .in('id', targetIds);

        promotedData = data || [];
        promotedError = error;

        if (!promotedError && promotedData) {
          promotedData.forEach((item: any) => {
            const formattedItem = {
              id: item.id,
              title: item.title,
              creator: item.users?.display_name || 'Unknown Creator',
              creator_id: item.user_id || '',
              creator_user_id: item.user_id || null,
              thumbnail_url: item.metadata?.thumbnail_url,
              video_url: item.metadata?.file_url || item.metadata?.video_url,
              duration_seconds: item.metadata?.duration_seconds || 0,
              play_count: item.play_count || 0,
              creator_profile_photo: item.users?.avatar_url || null
            } as any;
            promotedItemsData.set(item.id, formattedItem);
          });
          console.log(`[AdditionalSongsSlots] Fetched ${promotedItemsData.size} promoted items from content_uploads`);
        }
      } else {
        // For songs or videos tables
        const { data, error } = await supabase
          .from(tableName)
          .select(`
            id,
            title,
            duration_seconds,
            ${contentType === 'song' ? 'audio_url' : 'video_url'},
            cover_image_url,
            play_count,
            created_at,
            artists:artist_id (
              id,
              name,
              artist_profiles (
                id,
                user_id,
                stage_name,
                profile_photo_url,
                is_verified
              )
            )
          `)
          .in('id', targetIds);

        promotedData = data || [];
        promotedError = error;

        if (!promotedError && promotedData) {
          promotedData.forEach((item: any) => {
            const formattedItem = {
              id: item.id,
              title: item.title,
              artist: item.artists?.artist_profiles?.[0]?.stage_name || item.artists?.name || 'Unknown Artist',
              artist_id: item.artists?.id,
              artist_user_id: item.artists?.artist_profiles?.[0]?.user_id,
              cover_image_url: item.cover_image_url,
              [contentType === 'song' ? 'audio_url' : 'video_url']: item[contentType === 'song' ? 'audio_url' : 'video_url'],
              duration_seconds: item.duration_seconds || 0,
              play_count: item.play_count || 0,
              artist_profile_photo: item.artists?.artist_profiles?.[0]?.profile_photo_url || null
            } as any;
            promotedItemsData.set(item.id, formattedItem);
          });
          console.log(`[AdditionalSongsSlots] Fetched ${promotedItemsData.size} promoted items from database`);
        }
      }
    }

    // Create promotion map
    const promotionIdToContentMap = new Map<string, typeof promotedContent[0]>();
    promotedContent.forEach(promo => {
      promotionIdToContentMap.set(promo.promotionId, promo);
    });

    // Filter out promoted items from regular content
    const promotedTargetIds = new Set(promotedContent.map(p => p.targetId));
    const filteredRegularContent = regularContent.filter(
      item => !promotedTargetIds.has(item.id)
    );

    const result: MergedContent<T>[] = [];
    let regularIndex = 0;

    // Calculate max positions
    const maxPosition = Math.max(
      filteredRegularContent.length,
      ...Array.from(slotMap.keys())
    );

    // Build result array with promotions at designated slots
    for (let position = 1; position <= maxPosition; position++) {
      const promotionId = slotMap.get(position);

      if (promotionId) {
        const promotion = promotionIdToContentMap.get(promotionId);
        if (promotion) {
          // Try to find in fetched promoted item data
          let promotedItem = promotedItemsData.get(promotion.targetId);

          // Fallback to regular content if somehow it's there
          if (!promotedItem) {
            promotedItem = regularContent.find(item => item.id === promotion.targetId);
          }

          if (promotedItem) {
            console.log(`[AdditionalSongsSlots] Inserting promoted item at position ${position}:`, promotion.targetTitle);
            result.push({
              item: promotedItem,
              isPromoted: true,
              promotionId,
              slotPosition: position
            });
            continue;
          } else {
            console.warn(`[AdditionalSongsSlots] Promoted item not found:`, promotion.targetId);
          }
        }
      }

      // Add regular content
      if (regularIndex < filteredRegularContent.length) {
        result.push({
          item: filteredRegularContent[regularIndex],
          isPromoted: false,
          slotPosition: position
        });
        regularIndex++;
      }
    }

    console.log(`[AdditionalSongsSlots] Merged ${result.length} items (${slotMap.size} promoted, ${regularIndex} regular)`);
    return result;
  } catch (error) {
    console.error('[AdditionalSongsSlots] Error merging content:', error);
    return regularContent.map(item => ({
      item,
      isPromoted: false
    }));
  }
};
