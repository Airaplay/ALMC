/**
 * Rewrite internal protocol links in HTML to app routes for artists and songs.
 * Supports href="artist:USER_ID" -> /user/USER_ID and href="song:SONG_ID" -> /song/SONG_ID.
 */
export function rewriteInternalLinks(html: string): string {
  return html
    .replace(/href=["']artist:([^"']+)["']/gi, 'href="/user/$1"')
    .replace(/href=["']song:([^"']+)["']/gi, 'href="/song/$1"');
}

/**
 * Slugify for TOC anchor ids
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export interface TocItem {
  id: string;
  text: string;
  level: number; // 2 = h2, 3 = h3
}

/**
 * Extract table-of-contents from HTML content (h2, h3).
 * Ensures unique ids by appending -1, -2 if duplicate.
 */
export function extractTocFromHtml(html: string): TocItem[] {
  const toc: TocItem[] = [];
  const seen = new Map<string, number>();
  const regex = /<h([23])[^>]*(?:id="([^"]*)")?[^>]*>([^<]*)<\/h\1>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const level = parseInt(m[1], 10);
    const existingId = m[2]?.trim();
    const text = m[3].replace(/<[^>]+>/g, '').trim();
    let id = existingId && /^[a-z0-9-]+$/i.test(existingId) ? existingId : slugify(text);
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    if (count > 1) id = `${id}-${count}`;
    toc.push({ id, text, level });
  }
  return toc;
}

/**
 * Inject heading ids into HTML for in-page TOC links.
 * Uses same logic as extractTocFromHtml so ids match.
 */
export function injectHeadingIds(html: string): string {
  const seen = new Map<string, number>();
  return html.replace(/<h([23])([^>]*)>([^<]*)<\/h\1>/gi, (_, level, attrs, inner) => {
    const hasId = /id\s*=/i.test(attrs);
    if (hasId) return `<h${level}${attrs}>${inner}</h${level}>`;
    const text = inner.replace(/<[^>]+>/g, '').trim();
    let id = slugify(text);
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    if (count > 1) id = `${id}-${count}`;
    return `<h${level}${attrs} id="${id}">${inner}</h${level}>`;
  });
}
