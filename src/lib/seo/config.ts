/** Canonical production origin — keep in sync with shareService.ts / shareUtils.ts */
export const SEO_SITE_ORIGIN =
  (import.meta.env.VITE_PUBLIC_WEB_URL?.trim() || "https://airaplay.com").replace(/\/$/, "");

export const SEO_SITE_NAME = "Airaplay";

export const SEO_DEFAULT_TITLE = "Airaplay — Every Play Has Value";

export const SEO_DEFAULT_DESCRIPTION =
  "Discover and stream amazing music from talented artistes worldwide. Listen to songs, albums, playlists, and videos on Airaplay.";

export const SEO_DEFAULT_OG_IMAGE = `${SEO_SITE_ORIGIN}/api/og-image?default=1`;

export const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim() || "";

export const GSC_VERIFICATION = import.meta.env.VITE_GSC_VERIFICATION?.trim() || "";

export function absoluteUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${SEO_SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}
