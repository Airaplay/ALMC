import { normalizeShareResourceId } from "./shareIdCodec";

/** Single-letter kind in /o/:kind/:id → content type segment. */
export const SHARE_KIND_TO_TYPE: Record<string, string> = {
  s: "song",
  a: "album",
  p: "playlist",
  v: "video",
  u: "user",
};

export function resolveShareContentId(rawId: string | null | undefined): string {
  const raw = String(rawId ?? "").trim();
  if (!raw) return "";
  return normalizeShareResourceId(raw) || raw;
}

/** Map share type (song, album, …) + id → SPA path, or null if invalid. */
export function shareTypeToContentPath(type: string, rawId: string): string | null {
  const id = resolveShareContentId(rawId);
  if (!id) return null;

  switch (String(type ?? "").trim().toLowerCase()) {
    case "song":
      return `/song/${id}`;
    case "album":
      return `/album/${id}`;
    case "playlist":
      return `/playlist/${id}`;
    case "video":
      return `/video/${id}`;
    case "user":
      return `/user/${id}`;
    default:
      return null;
  }
}

/** /o/:kind/:id → SPA content path. */
export function openSharePathToContentPath(kind: string, rawId: string): string | null {
  const type = SHARE_KIND_TO_TYPE[String(kind ?? "").trim().toLowerCase()];
  if (!type) return null;
  return shareTypeToContentPath(type, rawId);
}

/** /share/:type/:id → SPA content path. */
export function legacySharePathToContentPath(type: string, rawId: string): string | null {
  return shareTypeToContentPath(type, rawId);
}

const SHARE_URL_PATTERNS: Array<{ pattern: RegExp; route: string }> = [
  { pattern: /\/share\/song\/([^/?#]+)/, route: "/song/" },
  { pattern: /\/share\/album\/([^/?#]+)/, route: "/album/" },
  { pattern: /\/share\/playlist\/([^/?#]+)/, route: "/playlist/" },
  { pattern: /\/share\/video\/([^/?#]+)/, route: "/video/" },
  { pattern: /\/share\/user\/([^/?#]+)/, route: "/user/" },
  { pattern: /\/o\/s\/([^/?#]+)/, route: "/song/" },
  { pattern: /\/o\/a\/([^/?#]+)/, route: "/album/" },
  { pattern: /\/o\/p\/([^/?#]+)/, route: "/playlist/" },
  { pattern: /\/o\/v\/([^/?#]+)/, route: "/video/" },
  { pattern: /\/o\/u\/([^/?#]+)/, route: "/user/" },
  { pattern: /\/song\/([^/?#]+)/, route: "/song/" },
  { pattern: /\/album\/([^/?#]+)/, route: "/album/" },
  { pattern: /\/playlist\/([^/?#]+)/, route: "/playlist/" },
  { pattern: /\/video\/([^/?#]+)/, route: "/video/" },
  { pattern: /\/user\/([^/?#]+)/, route: "/user/" },
];

/** True when the SPA pathname is a shared-content destination (not home). */
export function isShareContentPath(pathname: string): boolean {
  return parseShareContentPathFromPathname(pathname) !== null;
}

/** Map pathname → SPA content path, or null. */
export function parseShareContentPathFromPathname(pathname: string): string | null {
  for (const { pattern, route } of SHARE_URL_PATTERNS) {
    const match = pathname.match(pattern);
    if (match?.[1]) {
      let rawSeg = match[1];
      try {
        rawSeg = decodeURIComponent(rawSeg);
      } catch {
        /* keep encoded segment */
      }
      const id = resolveShareContentId(rawSeg);
      if (id) return `${route}${id}`;
    }
  }
  return null;
}

/** Map deep-link / App Link URL → SPA content path, or null. */
export function parseShareContentPathFromUrl(url: string): string | null {
  try {
    return parseShareContentPathFromPathname(new URL(url).pathname);
  } catch {
    return null;
  }
}
