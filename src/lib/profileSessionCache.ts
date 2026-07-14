export interface ProfileSessionBundle {
  userProfile: unknown;
  artistProfile: unknown;
  socialLinks: unknown[];
  followerCount: number;
  followingCount: number;
}

let profileSession: { userId: string; data: ProfileSessionBundle } | null = null;

export function readProfileSession(userId: string): ProfileSessionBundle | null {
  if (profileSession?.userId === userId) return profileSession.data;
  return null;
}

export function writeProfileSession(userId: string, data: ProfileSessionBundle): void {
  profileSession = { userId, data };
}

export function clearProfileSession(): void {
  profileSession = null;
}
