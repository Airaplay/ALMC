import { ReactNode, createElement } from 'react';
import {
  Facebook,
  Globe,
  Instagram,
  Link2,
  Music2,
  Twitter,
  Youtube,
} from 'lucide-react';
import { applyDataSaverImageCaps } from '../../lib/dataSaver';

export const PROFILE_HERO_HEIGHT = '220px';
export const PROFILE_HERO_HEADER_GRID_BACK = '2.75rem';
export const PROFILE_HERO_HEADER_BTN_CLASS =
  'w-10 h-10 rounded-full bg-black/45 border border-white/15 text-white flex items-center justify-center touch-manipulation active:scale-95 transition-all hover:bg-black/55';
export const PROFILE_HERO_HEADER_BTN_DANGER_CLASS =
  'border-red-500/25 text-red-300 hover:bg-red-500/12';
export const PROFILE_HERO_HEADER_ICON_CLASS = 'w-[18px] h-[18px]';
export const PROFILE_HERO_HEADER_ICON_STROKE = 2;
export const PROFILE_AVATAR_IMAGE_CLASS = 'w-full h-full object-cover';
export const PROFILE_HERO_IMAGE_CLASS =
  'absolute inset-0 w-full h-full object-cover object-center';

export const PROFILE_SAFE_AREA_STYLE = `
  .profile-safe-x {
    padding-left: max(1.25rem, env(safe-area-inset-left, 0px));
    padding-right: max(1.25rem, env(safe-area-inset-right, 0px));
  }
`;

export function formatProfileCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '0';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(count);
}

function appendImageTransform(
  url: string,
  options: { width?: number; height?: number; quality?: number },
): string {
  if (!url) return url;

  try {
    const parsed = new URL(url);
    const caps = applyDataSaverImageCaps(options);

    if (caps.width) parsed.searchParams.set('width', String(caps.width));
    if (caps.height) parsed.searchParams.set('height', String(caps.height));
    parsed.searchParams.set('quality', String(caps.quality));

    return parsed.toString();
  } catch {
    return url;
  }
}

export function getProfileAvatarSrc(url?: string | null): string {
  if (!url) return '';
  return appendImageTransform(url, { width: 144, height: 144, quality: 75 });
}

export function getProfileHeroSrc(url?: string | null): string {
  if (!url) return '';
  return appendImageTransform(url, { width: 960, height: 440, quality: 75 });
}

export function resolveProfileAvatarUrl(
  previewUrl?: string | null,
  userAvatarUrl?: string | null,
  artistPhotoUrl?: string | null,
): string | null {
  return previewUrl || userAvatarUrl || artistPhotoUrl || null;
}

const TikTokIcon = ({ className }: { className?: string }) =>
  createElement(
    'svg',
    { className, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true },
    createElement('path', {
      d: 'M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z',
    }),
  );

export function getSocialIcon(platform: string, className = 'w-4 h-4'): ReactNode {
  const key = platform.trim().toLowerCase();

  if (key.includes('youtube')) return createElement(Youtube, { className });
  if (key.includes('instagram')) return createElement(Instagram, { className });
  if (key.includes('facebook')) return createElement(Facebook, { className });
  if (key.includes('twitter') || key === 'x') return createElement(Twitter, { className });
  if (key.includes('tiktok')) return createElement(TikTokIcon, { className });
  if (key.includes('spotify') || key.includes('apple') || key.includes('soundcloud')) {
    return createElement(Music2, { className });
  }
  if (key.includes('website') || key.includes('web')) return createElement(Globe, { className });

  return createElement(Link2, { className });
}
