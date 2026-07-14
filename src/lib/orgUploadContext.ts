export interface OrgUploadContext {
  targetUserId: string;
  targetDisplayName?: string;
  organizationId: string;
  artistProfileId?: string;
}

export interface DelegatedUploadContext {
  targetUserId: string;
  targetDisplayName?: string;
  organizationId?: string;
  artistProfileId?: string;
}

export function resolveContentOwnerUserId(
  delegatedContext: DelegatedUploadContext | undefined,
  authUserId: string | undefined
): string | null {
  return delegatedContext?.targetUserId ?? authUserId ?? null;
}

export function toDelegatedUploadContext(
  orgContext: OrgUploadContext
): DelegatedUploadContext {
  return {
    targetUserId: orgContext.targetUserId,
    targetDisplayName: orgContext.targetDisplayName,
    organizationId: orgContext.organizationId,
    artistProfileId: orgContext.artistProfileId,
  };
}
