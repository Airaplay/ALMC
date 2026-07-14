/** Email-safe HTML snippets for the marketing composer (table buttons + store badges). */

import type { JSONContent } from '@tiptap/core';

const supabasePublic =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '') || '';

/** Hosted in `app-assets` (public bucket). Filenames match Supabase uploads. */
const APP_ASSETS = 'app-assets';
const PLAY_STORE_BADGE_FILE = 'Play Store.jpg';
const APP_STORE_BADGE_FILE = 'App store.jpg';

function appAssetPublicUrl(fileName: string): string {
  return `${supabasePublic}/storage/v1/object/public/${APP_ASSETS}/${encodeURIComponent(fileName)}`;
}

/** Hosted in `app-assets` when uploaded; falls back to official badge artwork. */
export const EMAIL_PLAY_STORE_BADGE_SRC = supabasePublic
  ? appAssetPublicUrl(PLAY_STORE_BADGE_FILE)
  : 'https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png';

export const EMAIL_APP_STORE_BADGE_SRC = supabasePublic
  ? appAssetPublicUrl(APP_STORE_BADGE_FILE)
  : 'https://tools.applemediaservices.com/api/badges/download-on-the-app-store/black/en-us?size=250x83';

export const DEFAULT_PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.airaplay.app';

export const DEFAULT_APP_STORE_URL = 'https://apps.apple.com/app/airaplay';

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Ensure store links open correctly in email clients and the composer. */
export function normalizeStoreHref(href: string, fallback: string): string {
  const trimmed = href.trim() || fallback;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return `https://${trimmed}`;
}

function linkMark(href: string, fallback: string): JSONContent {
  return {
    type: 'link',
    attrs: {
      href: normalizeStoreHref(href, fallback),
      target: '_blank',
      rel: 'noopener noreferrer',
    },
  };
}

/** Table layout survives Gmail/Outlook; anchor wraps image for a large click target. */
function buildLinkedBadgeTableHtml(
  href: string,
  imgSrc: string,
  alt: string,
  width: number,
  fallback: string,
): string {
  const safeHref = escapeAttr(normalizeStoreHref(href, fallback));
  const safeSrc = escapeAttr(imgSrc);
  const safeAlt = escapeAttr(alt);
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:16px auto;border-collapse:collapse;">
  <tr>
    <td align="center" style="padding:0;">
      <a href="${safeHref}" target="_blank" rel="noopener noreferrer" style="display:inline-block;text-decoration:none;line-height:0;">
        <img src="${safeSrc}" alt="${safeAlt}" width="${width}" border="0" style="display:block;border:0;max-width:100%;height:auto;" />
      </a>
    </td>
  </tr>
</table>`;
}

function buildLinkedBadgesRowTableHtml(playHref: string, appStoreHref: string): string {
  const play = escapeAttr(normalizeStoreHref(playHref, DEFAULT_PLAY_STORE_URL));
  const apple = escapeAttr(normalizeStoreHref(appStoreHref, DEFAULT_APP_STORE_URL));
  const playSrc = escapeAttr(EMAIL_PLAY_STORE_BADGE_SRC);
  const appSrc = escapeAttr(EMAIL_APP_STORE_BADGE_SRC);
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:20px auto;border-collapse:collapse;">
  <tr>
    <td align="center" style="padding:0 8px;">
      <a href="${play}" target="_blank" rel="noopener noreferrer" style="display:inline-block;text-decoration:none;line-height:0;">
        <img src="${playSrc}" alt="Get it on Google Play" width="135" border="0" style="display:block;border:0;max-width:100%;height:auto;" />
      </a>
    </td>
    <td align="center" style="padding:0 8px;">
      <a href="${apple}" target="_blank" rel="noopener noreferrer" style="display:inline-block;text-decoration:none;line-height:0;">
        <img src="${appSrc}" alt="Download on the App Store" width="120" border="0" style="display:block;border:0;max-width:100%;height:auto;" />
      </a>
    </td>
  </tr>
</table>`;
}

export function buildPlayStoreBadgeTipTapContent(href: string): JSONContent {
  return {
    type: 'paragraph',
    attrs: { textAlign: 'center' },
    content: [
      {
        type: 'storeBadgeImage',
        attrs: {
          src: EMAIL_PLAY_STORE_BADGE_SRC,
          alt: 'Get it on Google Play',
          width: 135,
          height: 40,
          store: 'play',
        },
        marks: [linkMark(href, DEFAULT_PLAY_STORE_URL)],
      },
    ],
  };
}

export function buildAppStoreBadgeTipTapContent(href: string): JSONContent {
  return {
    type: 'paragraph',
    attrs: { textAlign: 'center' },
    content: [
      {
        type: 'storeBadgeImage',
        attrs: {
          src: EMAIL_APP_STORE_BADGE_SRC,
          alt: 'Download on the App Store',
          width: 120,
          height: 40,
          store: 'app',
        },
        marks: [linkMark(href, DEFAULT_APP_STORE_URL)],
      },
    ],
  };
}

export function buildStoreBadgesRowTipTapContent(playHref: string, appStoreHref: string): JSONContent {
  return {
    type: 'paragraph',
    attrs: { textAlign: 'center' },
    content: [
      {
        type: 'storeBadgeImage',
        attrs: {
          src: EMAIL_PLAY_STORE_BADGE_SRC,
          alt: 'Get it on Google Play',
          width: 135,
          height: 40,
          store: 'play',
        },
        marks: [linkMark(playHref, DEFAULT_PLAY_STORE_URL)],
      },
      { type: 'text', text: ' ' },
      {
        type: 'storeBadgeImage',
        attrs: {
          src: EMAIL_APP_STORE_BADGE_SRC,
          alt: 'Download on the App Store',
          width: 120,
          height: 40,
          store: 'app',
        },
        marks: [linkMark(appStoreHref, DEFAULT_APP_STORE_URL)],
      },
    ],
  };
}

export function buildEmailCtaButtonHtml(label: string, href: string): string {
  const safeLabel = label.trim() || 'Learn more';
  const safeHref = escapeAttr(normalizeStoreHref(href, 'https://airaplay.com'));
  return `<p style="text-align:center;margin:20px 0;">
  <a href="${safeHref}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background-color:#000000;background:#000000;color:#ffffff;padding:14px 28px;border-radius:6px;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;font-weight:700;line-height:1.2;">${safeLabel}</a>
</p>`;
}

export function buildPlayStoreBadgeHtml(href: string): string {
  return buildLinkedBadgeTableHtml(
    href,
    EMAIL_PLAY_STORE_BADGE_SRC,
    'Get it on Google Play',
    135,
    DEFAULT_PLAY_STORE_URL,
  );
}

export function buildAppStoreBadgeHtml(href: string): string {
  return buildLinkedBadgeTableHtml(
    href,
    EMAIL_APP_STORE_BADGE_SRC,
    'Download on the App Store',
    120,
    DEFAULT_APP_STORE_URL,
  );
}

export function buildStoreBadgesRowHtml(playHref: string, appStoreHref: string): string {
  return buildLinkedBadgesRowTableHtml(playHref, appStoreHref);
}
