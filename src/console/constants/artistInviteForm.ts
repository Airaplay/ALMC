export const ARTIST_INVITE_COUNTRIES = [
  'Nigeria',
  'Ghana',
  'South Africa',
  'Kenya',
  'Tanzania',
  'Uganda',
  'Cameroon',
  'Senegal',
  'Ivory Coast',
  'Egypt',
  'Morocco',
  'Ethiopia',
  'Rwanda',
  'Zimbabwe',
  'Mozambique',
  'Angola',
  'DR Congo',
  'Mali',
  'United States',
  'United Kingdom',
  'Canada',
  'France',
  'Germany',
  'Brazil',
  'Jamaica',
  'India',
  'Japan',
  'Australia',
  'Other',
] as const;

export type ArtistPermissionPreset = 'full_management' | 'upload_only' | 'view_only';

export const ARTIST_PERMISSION_PRESETS: Array<{
  value: ArtistPermissionPreset;
  label: string;
  description: string;
}> = [
  {
    value: 'full_management',
    label: 'Full Management',
    description: 'View catalog and upload content on behalf of the artist',
  },
  {
    value: 'upload_only',
    label: 'Upload Only',
    description: 'View and upload content only',
  },
  {
    value: 'view_only',
    label: 'View Only',
    description: 'Read-only access to artist catalog and stats',
  },
];

export type AddArtistTab = 'create_new' | 'invite_existing' | 'csv_import' | 'bulk';

export const ADD_ARTIST_TABS: Array<{
  id: AddArtistTab;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
}> = [
  { id: 'create_new', label: 'Create New' },
  { id: 'invite_existing', label: 'Invite Existing' },
  { id: 'csv_import', label: 'CSV Import', disabled: true, disabledReason: 'Coming in Phase 2' },
  { id: 'bulk', label: 'Bulk', disabled: true, disabledReason: 'Coming in Phase 2' },
];
