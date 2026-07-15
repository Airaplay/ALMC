import { OrgActivityItem } from '../../lib/orgAccess';

export function formatOrgActivityMessage(item: OrgActivityItem): string {
  const meta = item.metadata ?? {};
  const email = typeof meta.email === 'string' ? meta.email : null;
  const stageName = typeof meta.stage_name === 'string' ? meta.stage_name : null;

  switch (item.action) {
    case 'organization_created':
      return 'Organization workspace created';
    case 'artist_invited':
      return email ? `Invitation sent to ${email}` : 'Artist invitation sent';
    case 'artist_invitation_confirmed':
    case 'artist_invitation_accepted':
      return email ? `Artist linked — ${email}` : 'Artist joined the roster';
    case 'artist_linked':
      return stageName ? `${stageName} joined the roster` : 'Artist joined the roster';
    case 'artist_access_revoked':
      return stageName ? `Access revoked for ${stageName}` : 'Artist access revoked';
    case 'artist_invitation_cancelled':
      return email ? `Invitation cancelled for ${email}` : 'Artist invitation cancelled';
    case 'team_member_invited':
      return email ? `Team invite sent to ${email}` : 'Team member invited';
    case 'team_member_joined':
      return email ? `${email} joined the team` : 'Team member joined';
    case 'content_uploaded':
      return typeof meta.title === 'string'
        ? `Upload completed — ${meta.title}`
        : 'Content upload completed';
    default:
      return item.action.replace(/_/g, ' ');
  }
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
