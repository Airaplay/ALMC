import { supabase } from "@/lib/supabase";
import { smartCache } from "@/lib/smartCache";

/* ─── Types ─── */
interface PromotionRow {
  target_id: string;
  section_key: string;
  promotion_type: string;
  id: string;
}

const ALL_PROMOTIONS_KEY = "all_active_promotions";

/**
 * Fetch ALL active promotions once and cache for 5 minutes.
 * Every section reads from this single cached result instead of
 * firing its own query.
 */
async function getAllActivePromotions(): Promise<PromotionRow[]> {
  return smartCache.fetch<PromotionRow[]>(
    ALL_PROMOTIONS_KEY,
    async () => {
      const { data, error } = await supabase
        .from("active_promotions_with_cooldown")
        .select("id, target_id, section_key, promotion_type")
        .eq("status", "active");

      if (error) {
        console.error("[PromotionService] Error fetching all promotions:", error);
        return [];
      }
      return (data ?? []) as PromotionRow[];
    },
    { ttlMs: 5 * 60_000, staleTtlMs: 60_000 }
  );
}

/**
 * Fetch promoted content IDs for a given home-screen section.
 * Now reads from the batched cache instead of firing a separate query.
 */
export async function getPromotedContentForSection(
  sectionKey: string,
  promotionType?: string,
  limit?: number
): Promise<string[]> {
  try {
    const all = await getAllActivePromotions();
    let filtered = all.filter((r) => r.section_key === sectionKey);

    if (promotionType) {
      filtered = filtered.filter((r) => r.promotion_type === promotionType);
    }

    const ids = filtered.map((r) => r.target_id).filter(Boolean);
    return limit ? ids.slice(0, limit) : ids;
  } catch (err) {
    console.error("[PromotionService] Unexpected error:", err);
    return [];
  }
}

/* ─── Shared dedup set to avoid duplicate impression inserts per session ─── */
const _recordedImpressions = new Set<string>();

/**
 * Resolve the promotion row ID for a given target in a section.
 * Now reads from the batched cache.
 */
async function resolvePromotionId(
  promotionTargetId: string,
  sectionKey: string
): Promise<string | null> {
  try {
    const all = await getAllActivePromotions();
    const match = all.find(
      (r) => r.target_id === promotionTargetId && r.section_key === sectionKey
    );
    return match?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Record a view / impression on promoted content (card rendered on screen).
 * De-duplicated per session so the same card showing twice won't double-count.
 */
export async function recordPromotedContentImpression(
  promotionTargetId: string,
  sectionKey: string
): Promise<void> {
  const dedup = `${promotionTargetId}:${sectionKey}`;
  if (_recordedImpressions.has(dedup)) return;
  _recordedImpressions.add(dedup);

  try {
    const promotionId = await resolvePromotionId(promotionTargetId, sectionKey);
    if (promotionId) {
      await supabase.from("promotion_impressions").insert({
        promotion_id: promotionId,
        section_key: sectionKey,
        clicked: false,
      });
    }
  } catch (err) {
    console.error("[PromotionService] Error recording impression:", err);
  }
}

/**
 * Record a click on promoted content (for analytics).
 */
export async function recordPromotedContentClick(
  promotionTargetId: string,
  sectionKey: string,
  _promotionType: string
): Promise<void> {
  try {
    const promotionId = await resolvePromotionId(promotionTargetId, sectionKey);
    if (promotionId) {
      await supabase.from("promotion_impressions").insert({
        promotion_id: promotionId,
        section_key: sectionKey,
        clicked: true,
      });
    }
  } catch (err) {
    console.error("[PromotionService] Error recording click:", err);
  }
}
