/**
 * Share URLs route through the OG gateway (/share/:type/:id) so crawlers receive
 * title, artist/creator, description, and cover art meta tags.
 */

import { shareContent } from "./shareService";
import { compactIdFromUuid } from "./shareIdCodec";

export type ShareToPlatformOptions = {
  title?: string;
  coverImageUrl?: string | null;
};

/** Canonical production origin for share links (matches shareService.ts). */
export const SHARE_SITE_ORIGIN = "https://airaplay.com";

export type ShareContentType = "song" | "album" | "playlist" | "video" | "user";

/** Public OG gateway URL — always use this instead of direct SPA paths (/song/, /video/, etc.). */
export function getShareUrl(type: ShareContentType, id: string): string {
  const raw = String(id ?? "").trim();
  if (!raw) return SHARE_SITE_ORIGIN;
  const segment = compactIdFromUuid(raw) || encodeURIComponent(raw);
  return `${SHARE_SITE_ORIGIN}/share/${type}/${segment}`;
}

/** OG / card title: "Title — Artist" for music and video; profile uses creator name. */
export function getShareDisplayTitle(
  type: ShareContentType,
  title: string,
  artistOrCreator?: string | null,
): string {
  const t = String(title ?? "").trim();
  const creator = String(artistOrCreator ?? "").trim();

  if (type === "user") {
    return creator ? `${creator} on Airaplay` : "Profile on Airaplay";
  }
  if (!t) return "Airaplay";
  if (creator && (type === "song" || type === "album" || type === "video")) {
    return `${t} — ${creator}`;
  }
  return t;
}

/** Prefilled share message for social platforms (link appended separately by each platform). */
export function getShareMessageText(
  type: ShareContentType,
  title: string,
  artistOrCreator?: string | null,
): string {
  const t = String(title ?? "").trim();
  const creator = String(artistOrCreator ?? "").trim();

  switch (type) {
    case "song":
      return creator
        ? `Listen to "${t}" by ${creator} on Airaplay!`
        : `Listen to "${t}" on Airaplay!`;
    case "album":
      return creator
        ? `Check out the album "${t}" by ${creator} on Airaplay!`
        : `Check out "${t}" on Airaplay!`;
    case "video":
      return creator
        ? `Watch "${t}" by ${creator} on Airaplay!`
        : `Watch "${t}" on Airaplay!`;
    case "playlist":
      return creator
        ? `Listen to "${t}" by ${creator} on Airaplay!`
        : `Listen to "${t}" on Airaplay!`;
    case "user":
      return creator
        ? `Check out ${creator}'s music on Airaplay!`
        : "Check out this profile on Airaplay!";
    default:
      return "Check this out on Airaplay!";
  }
}

function openPlatformShareLink(platform: string, url: string, text: string) {
  const encoded = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text);
  const links: Record<string, string> = {
    whatsapp: `https://wa.me/?text=${encodedText}%20${encoded}`,
    twitter: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encoded}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encoded}`,
    telegram: `https://t.me/share/url?url=${encoded}&text=${encodedText}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encoded}`,
  };
  if (links[platform]) {
    window.open(links[platform], "_blank", "noopener,noreferrer,width=600,height=400");
  }
}

/**
 * Share to a social platform. When cover art is available and the device supports
 * native/Web Share with file attachments, uses the same rich share path as "Share with cover"
 * so WhatsApp/Telegram show the artwork thumbnail alongside the link.
 */
export async function shareToPlatform(
  platform: string,
  url: string,
  text: string,
  options?: ShareToPlatformOptions
): Promise<void> {
  const coverImageUrl = options?.coverImageUrl ?? null;
  const title = options?.title ?? text;

  if (coverImageUrl?.trim() && typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await shareContent({
        title,
        text,
        url,
        coverImageUrl,
        dialogTitle: "Share",
      });
      return;
    } catch (error: unknown) {
      const name =
        error && typeof error === "object" && "name" in error
          ? (error as { name?: string }).name
          : "";
      if (name === "AbortError") {
        return;
      }
      /* fall through to platform deep link */
    }
  }

  openPlatformShareLink(platform, url, text);
}

/** Native / Web Share with optional cover art attachment + OG gateway URL. */
export async function shareWithRichPreview(options: {
  type: ShareContentType;
  id: string;
  title: string;
  artistOrCreator?: string | null;
  coverImageUrl?: string | null;
  dialogTitle?: string;
}): Promise<void> {
  const url = getShareUrl(options.type, options.id);
  const text = getShareMessageText(options.type, options.title, options.artistOrCreator);
  const displayTitle = getShareDisplayTitle(options.type, options.title, options.artistOrCreator);
  await shareContent({
    title: displayTitle,
    text,
    url,
    coverImageUrl: options.coverImageUrl,
    dialogTitle: options.dialogTitle ?? "Share",
  });
}
