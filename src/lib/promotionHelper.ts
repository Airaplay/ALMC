import { supabase } from './supabase';
import { getFairPromotedContent, recordPromotionImpression, getSessionId } from './promotionFairness';

interface PromotionCheck {
  isPromoted: boolean;
  sectionName?: string;
}

/**
 * Check if content is currently promoted in a specific section
 */
export const checkIfPromoted = async (
  targetId: string,
  promotionType: 'song' | 'video' | 'album' | 'short_clip' | 'profile',
  sectionKey?: string
): Promise<PromotionCheck> => {
  try {
    const now = new Date().toISOString();

    let query = supabase
      .from('promotions')
      .select('id, promotion_sections:promotion_section_id(section_name)')
      .eq('target_id', targetId)
      .eq('promotion_type', promotionType)
      .eq('status', 'active')
      .lte('start_date', now)
      .gte('end_date', now);

    if (sectionKey) {
      query = query.eq('promotion_sections.section_key', sectionKey);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.error('Error checking promotion status:', error);
      return { isPromoted: false };
    }

    if (data) {
      return {
        isPromoted: true,
        sectionName: (data as any).promotion_sections?.section_name
      };
    }

    return { isPromoted: false };
  } catch (error) {
    console.error('Error checking promotion status:', error);
    return { isPromoted: false };
  }
};

/**
 * Check multiple content items for promotion status
 */
export const checkMultiplePromoted = async (
  items: Array<{ id: string; type: 'song' | 'video' | 'album' | 'short_clip' | 'profile' }>,
  _sectionKey?: string
): Promise<Map<string, boolean>> => {
  const promotionMap = new Map<string, boolean>();

  try {
    const now = new Date().toISOString();
    const targetIds = items.map(item => item.id);

    let query = supabase
      .from('promotions')
      .select('target_id, promotion_type')
      .in('target_id', targetIds)
      .eq('status', 'active')
      .lte('start_date', now)
      .gte('end_date', now);

    const { data, error } = await query;

    if (error) {
      console.error('Error checking multiple promotions:', error);
      return promotionMap;
    }

    if (data && data.length > 0) {
      data.forEach((promo: any) => {
        promotionMap.set(promo.target_id, true);
      });
    }

    return promotionMap;
  } catch (error) {
    console.error('Error checking multiple promotions:', error);
    return promotionMap;
  }
};

/**
 * Get all promoted content for a specific section with fair rotation
 * This replaces the old getPromotedContentForSection with fairness algorithm
 * @param userIdOptional - If provided, skips getUser() (reduces egress when caller has user from context).
 */
export const getPromotedContentForSection = async (
  sectionKey: string,
  contentType: 'song' | 'video' | 'album' | 'short_clip' | 'profile',
  limit: number = 10,
  userIdOptional?: string | null
): Promise<string[]> => {
  try {
    console.log(`[PromotionHelper] 🎯 Fetching promoted content for section: ${sectionKey}, type: ${contentType}, limit: ${limit}`);
    
    const promotedContent = await getFairPromotedContent(sectionKey, contentType, limit);

    if (promotedContent.length === 0) {
      console.warn(`[PromotionHelper] ⚠️ No promoted content found for ${sectionKey} (${contentType}) - Check if promotions are ACTIVE`);
      return [];
    }

    console.log(`[PromotionHelper] ✅ Retrieved ${promotedContent.length} fairly rotated items for ${sectionKey}:`, 
      promotedContent.map(p => ({ targetId: p.targetId, title: p.targetTitle }))
    );

    const sessionId = getSessionId();
    const userId = userIdOptional ?? (await supabase.auth.getUser()).data.user?.id;

    const impressionPromises = promotedContent.map(item =>
      recordPromotionImpression({
        promotionId: item.promotionId,
        sectionKey,
        userId,
        clicked: false,
        sessionId
      })
    );

    await Promise.allSettled(impressionPromises);

    const targetIds = promotedContent.map(item => item.targetId);
    console.log(`[PromotionHelper] 📤 Returning ${targetIds.length} promoted content IDs for ${sectionKey}`);
    
    return targetIds;
  } catch (error) {
    console.error(`[PromotionHelper] ❌ Error fetching promoted content for ${sectionKey}:`, error);
    return [];
  }
};

/**
 * Get promoted content with detailed information
 * Useful for displaying promoted content with metadata
 * @param userIdOptional - If provided, skips getUser() (reduces egress when caller has user from context).
 */
export const getPromotedContentDetailed = async (
  sectionKey: string,
  contentType: 'song' | 'video' | 'album' | 'short_clip' | 'profile',
  limit: number = 10,
  userIdOptional?: string | null
) => {
  try {
    console.log(`[PromotionHelper] 🎯 Fetching DETAILED promoted content for section: ${sectionKey}, type: ${contentType}, limit: ${limit}`);
    
    const promotedContent = await getFairPromotedContent(sectionKey, contentType, limit);

    if (promotedContent.length === 0) {
      console.warn(`[PromotionHelper] ⚠️ No detailed promoted content found for ${sectionKey} (${contentType})`);
      return [];
    }

    console.log(`[PromotionHelper] ✅ Retrieved ${promotedContent.length} detailed promoted items for ${sectionKey}:`,
      promotedContent.map(p => ({ targetId: p.targetId, title: p.targetTitle }))
    );

    const sessionId = getSessionId();
    const userId = userIdOptional ?? (await supabase.auth.getUser()).data.user?.id;

    const impressionPromises = promotedContent.map(item =>
      recordPromotionImpression({
        promotionId: item.promotionId,
        sectionKey,
        userId,
        clicked: false,
        sessionId
      })
    );

    await Promise.allSettled(impressionPromises);

    console.log(`[PromotionHelper] 📤 Returning ${promotedContent.length} detailed promoted items for ${sectionKey}`);
    
    return promotedContent;
  } catch (error) {
    console.error(`[PromotionHelper] ❌ Error fetching detailed promoted content for ${sectionKey}:`, error);
    return [];
  }
};

/**
 * Record a click on promoted content
 * @param userIdOptional - If provided, skips getUser() (reduces egress when caller has user from context).
 */
export const recordPromotedContentClick = async (
  targetId: string,
  sectionKey: string,
  contentType: 'song' | 'video' | 'album' | 'short_clip' | 'profile',
  userIdOptional?: string | null
): Promise<void> => {
  try {
    console.log(`[PromotionHelper] Recording click - targetId: ${targetId}, sectionKey: ${sectionKey}, contentType: ${contentType}`);

    const now = new Date().toISOString();

    const { data: sectionData, error: sectionError } = await supabase
      .from('promotion_sections')
      .select('id')
      .eq('section_key', sectionKey)
      .eq('is_active', true)
      .maybeSingle();

    if (sectionError) {
      console.error('[PromotionHelper] Error fetching section:', sectionError);
      return;
    }

    if (!sectionData) {
      console.warn('[PromotionHelper] No active section found for key:', sectionKey);
      return;
    }

    console.log(`[PromotionHelper] Found section ID: ${sectionData.id}`);

    const { data: promotionData, error: promotionError } = await supabase
      .from('promotions')
      .select('id')
      .eq('target_id', targetId)
      .eq('promotion_type', contentType)
      .eq('promotion_section_id', sectionData.id)
      .eq('status', 'active')
      .lte('start_date', now)
      .gte('end_date', now)
      .maybeSingle();

    if (promotionError) {
      console.error('[PromotionHelper] Error fetching promotion:', promotionError);
      return;
    }

    if (!promotionData) {
      console.warn('[PromotionHelper] No active promotion found for:', { targetId, sectionKey, contentType });
      return;
    }

    console.log(`[PromotionHelper] Found promotion ID: ${promotionData.id}`);

    const sessionId = getSessionId();
    const userId = userIdOptional ?? (await supabase.auth.getUser()).data.user?.id;

    await recordPromotionImpression({
      promotionId: promotionData.id,
      sectionKey,
      userId,
      clicked: true,
      sessionId
    });

    console.log(`[PromotionHelper] ✅ Successfully recorded click for promotion ${promotionData.id}`);
  } catch (error) {
    console.error('[PromotionHelper] Error recording promotion click:', error);
  }
};
