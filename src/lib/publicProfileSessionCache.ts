export interface PublicProfileSessionEntry {
  profile: unknown;
  userSongs?: unknown[];
  userAlbums?: unknown[];
  userVideos?: unknown[];
  userPlaylists?: unknown[];
}

const MAX_ENTRIES = 12;
const sessions = new Map<string, PublicProfileSessionEntry>();

export function readPublicProfileSession(userId: string): PublicProfileSessionEntry | null {
  return sessions.get(userId) ?? null;
}

export function writePublicProfileSession(
  userId: string,
  patch: PublicProfileSessionEntry,
): void {
  if (sessions.size >= MAX_ENTRIES && !sessions.has(userId)) {
    const oldest = sessions.keys().next().value;
    if (oldest) sessions.delete(oldest);
  }
  const prev = sessions.get(userId);
  sessions.set(userId, { ...prev, ...patch });
}

export function clearPublicProfileSession(userId?: string): void {
  if (userId) {
    sessions.delete(userId);
    return;
  }
  sessions.clear();
}
