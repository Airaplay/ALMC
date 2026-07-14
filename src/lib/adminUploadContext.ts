export interface AdminUploadContext {
  targetUserId: string;
  targetDisplayName?: string;
}

export function resolveContentOwnerUserId(
  adminContext: AdminUploadContext | undefined,
  authUserId: string | undefined
): string | null {
  return adminContext?.targetUserId ?? authUserId ?? null;
}
