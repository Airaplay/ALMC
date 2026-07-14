import type { MouseEvent } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { artistCache } from './artistCache';

export function canNavigateToArtistProfile(artistId?: string | null): boolean {
  return Boolean(artistId);
}

export async function resolveArtistProfileUserId(
  artistId?: string | null,
  tipRecipientUserId?: string | null,
): Promise<string | null> {
  if (tipRecipientUserId) return tipRecipientUserId;
  if (!artistId) return null;

  const immediate = artistCache.getImmediate(artistId);
  if (immediate?.userId) return immediate.userId;

  const cached = await artistCache.get(artistId);
  return cached?.userId ?? null;
}

export async function openArtistPublicProfile(
  navigate: NavigateFunction,
  artistId?: string | null,
  tipRecipientUserId?: string | null,
): Promise<void> {
  const profileUserId = await resolveArtistProfileUserId(artistId, tipRecipientUserId);
  if (!profileUserId) return;
  navigate(`/user/${profileUserId}`);
}

export function handleArtistProfileClick(
  e: MouseEvent,
  navigate: NavigateFunction,
  artistId?: string | null,
  tipRecipientUserId?: string | null,
): void {
  e.stopPropagation();
  void openArtistPublicProfile(navigate, artistId, tipRecipientUserId);
}
