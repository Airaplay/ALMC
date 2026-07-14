import { supabase } from "@/lib/supabase";

/**
 * Filters out songs with a future release_date by checking the songs table.
 * Works with any array of objects that have an `id` field.
 */
export async function filterScheduledSongs<T extends { id: string }>(
  items: T[]
): Promise<T[]> {
  if (items.length === 0) return items;

  const ids = items.map((i) => i.id);
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("songs")
    .select("id, release_date")
    .in("id", ids);

  if (error || !data) return items;

  const scheduledIds = new Set(
    data
      .filter((s: { release_date?: string | null }) => s.release_date && s.release_date > now)
      .map((s: { id: string }) => s.id)
  );

  if (scheduledIds.size === 0) return items;
  return items.filter((i) => !scheduledIds.has(i.id));
}

/**
 * Filters out albums with a future release_date by checking the albums table.
 */
export async function filterScheduledAlbums<T extends { id: string }>(
  items: T[]
): Promise<T[]> {
  if (items.length === 0) return items;

  const ids = items.map((i) => i.id);
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("albums")
    .select("id, release_date")
    .in("id", ids);

  if (error || !data) return items;

  const scheduledIds = new Set(
    data
      .filter((a: { release_date?: string | null }) => a.release_date && a.release_date > now)
      .map((a: { id: string }) => a.id)
  );

  if (scheduledIds.size === 0) return items;
  return items.filter((i) => !scheduledIds.has(i.id));
}
