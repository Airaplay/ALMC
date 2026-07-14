import { useEffect, useRef } from "react";
import { recordPromotedContentImpression } from "@/lib/promotionService";

/**
 * Automatically records promotion impressions for any promoted items
 * that are currently rendered. De-duplicated per session in the service layer.
 *
 * @param items - Array of items with `id` and `isPromoted` fields
 * @param sectionKey - The section identifier (e.g. "now_trending", "new_release")
 */
export function usePromotionImpressions(
  items: Array<{ id: string; isPromoted?: boolean }> | null | undefined,
  sectionKey: string
) {
  const recorded = useRef(new Set<string>());

  useEffect(() => {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return;

    const promoted = list.filter((i) => i.isPromoted);
    for (const item of promoted) {
      const key = `${item.id}:${sectionKey}`;
      if (recorded.current.has(key)) continue;
      recorded.current.add(key);
      recordPromotedContentImpression(item.id, sectionKey).catch(() => {});
    }
  }, [items, sectionKey]);
}
