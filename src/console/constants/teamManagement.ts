import type { OrgPermission } from '../../lib/orgAccess';

export const CUSTOM_ROLE_PERMISSION_OPTIONS: Array<{
  key: OrgPermission;
  label: string;
  hint: string;
}> = [
  { key: 'team.invite', label: 'Invite team', hint: 'Send member invitations' },
  { key: 'team.manage', label: 'Manage team', hint: 'Change roles and remove members' },
  { key: 'org.settings', label: 'Org settings', hint: 'Edit workspace profile' },
  { key: 'artists.view', label: 'View artists', hint: 'See linked roster' },
  { key: 'artists.create', label: 'Create artists', hint: 'Add new artist profiles' },
  { key: 'artists.invite', label: 'Invite artists', hint: 'Link artists to the org' },
  { key: 'artists.revoke', label: 'Revoke artists', hint: 'Remove artist access' },
  { key: 'content.view', label: 'View content', hint: 'Browse uploads & calendar' },
  { key: 'content.upload', label: 'Upload content', hint: 'Publish and schedule releases' },
  { key: 'analytics.view', label: 'View analytics', hint: 'Streams, revenue, reports' },
];

export const INVITE_ROLE_FALLBACKS = [
  { key: 'admin', label: 'Administrator' },
  { key: 'content_manager', label: 'Content Manager' },
  { key: 'finance_manager', label: 'Finance Manager' },
  { key: 'viewer', label: 'Viewer' },
] as const;
