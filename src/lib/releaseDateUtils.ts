/**
 * Helpers for release-date/time gating: content with a future release_date
 * (and optional time) should not be public until that moment; owners can always see scheduled content.
 */

/**
 * Today's date in YYYY-MM-DD (UTC date, no time) for DB comparison.
 */
export function getTodayISO(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

/**
 * True if the content is considered "released" (no date/time or release date+time <= now).
 * Supports date-only (YYYY-MM-DD) and datetime (YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss).
 */
export function isReleased(releaseDate: string | null | undefined): boolean {
  if (!releaseDate || !releaseDate.trim()) return true;
  const s = releaseDate.trim();
  if (s.length <= 10) {
    return s <= getTodayISO();
  }
  try {
    return new Date(s).getTime() <= Date.now();
  } catch {
    return s <= getTodayISO();
  }
}

/**
 * For Supabase .or() filter: only include rows where release_date is null or <= today.
 * Use: .or(releaseDatePublicFilter())
 */
export function releaseDatePublicFilter(): string {
  const today = getTodayISO();
  return `release_date.is.null,release_date.lte.${today}`;
}

/**
 * For content_uploads (metadata jsonb): only include rows where metadata.release_date is null or <= today.
 * Use: .or(releaseDateMetadataFilter())
 */
export function releaseDateMetadataFilter(): string {
  const today = getTodayISO();
  return `metadata->release_date.is.null,metadata->release_date.lte.${today}`;
}

/**
 * Format a release date (and optional time) for display.
 * e.g. "Mar 15, 2025" or "Mar 15, 2025 at 2:00 PM" if time is present.
 */
export function formatReleaseDateDisplay(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const hasTime = iso.includes('T') && iso.length > 11;
    const d = new Date(iso.length <= 10 ? iso + 'T12:00:00Z' : iso);
    const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    if (hasTime) {
      const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
      return `${dateStr} at ${timeStr}`;
    }
    return dateStr;
  } catch {
    return iso;
  }
}
