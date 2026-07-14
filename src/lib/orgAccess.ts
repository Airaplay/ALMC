import { supabase } from './supabase';

export type OrgType = 'label' | 'management' | 'distributor' | 'entertainment';

export type OrgPermission =
  | 'org.manage'
  | 'org.settings'
  | 'team.manage'
  | 'team.invite'
  | 'artists.view'
  | 'artists.create'
  | 'artists.invite'
  | 'artists.revoke'
  | 'content.view'
  | 'content.upload'
  | 'analytics.view';

export interface OrganizationSummary {
  id: string;
  type: OrgType;
  name: string;
  slug: string;
  logo_url: string | null;
  role_key: string;
  role_name: string;
  permissions: OrgPermission[];
}

export interface OrgDashboardData {
  total_artists: number;
  total_streams: number;
  total_followers: number;
  total_revenue: number;
  total_songs: number;
  total_albums: number;
  total_videos: number;
  top_performing_artist: {
    artist_profile_id: string;
    stage_name: string;
    streams: number;
  } | null;
  fastest_growing_artist: unknown;
  recent_activity: Array<{
    id: string;
    action: string;
    artist_profile_id: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
}

export interface OrgArtistItem {
  link_id: string;
  link_status: string;
  linked_at: string | null;
  is_pending_invitation?: boolean;
  invitation_id?: string | null;
  invitation_type?: 'link_existing' | 'create_new' | null;
  invitation_code?: string | null;
  artist_profile_id: string | null;
  stage_name: string;
  profile_photo_url: string | null;
  is_verified: boolean | null;
  country: string | null;
  artist_id: string | null;
  user_id: string | null;
  email: string;
  display_name: string | null;
  followers: number;
  streams: number;
  revenue: number;
  latest_release: {
    title: string;
    type: string;
    created_at: string;
  } | null;
}

export interface ArtistInviteCandidate {
  email: string;
  has_account: boolean;
  has_artist_profile: boolean;
  user_id: string | null;
  artist_profile_id: string | null;
  stage_name: string | null;
  display_name: string | null;
  link_status: string | null;
  pending_invitation_id: string | null;
  recommended_invitation_type: 'link_existing' | 'create_new';
}

export interface OrgMemberItem {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  role_key: string;
  role_name: string;
  status: string;
  joined_at: string | null;
}

const ORG_STORAGE_KEY = 'airaplay_console_org_id';
const ARTIST_STORAGE_KEY = 'airaplay_console_artist_profile_id';

export function getStoredOrgId(): string | null {
  return localStorage.getItem(ORG_STORAGE_KEY);
}

export function setStoredOrgId(orgId: string): void {
  localStorage.setItem(ORG_STORAGE_KEY, orgId);
}

export function clearStoredOrgId(): void {
  localStorage.removeItem(ORG_STORAGE_KEY);
}

export function getStoredArtistProfileId(): string | null {
  return localStorage.getItem(ARTIST_STORAGE_KEY);
}

export function setStoredArtistProfileId(artistProfileId: string | null): void {
  if (artistProfileId) {
    localStorage.setItem(ARTIST_STORAGE_KEY, artistProfileId);
  } else {
    localStorage.removeItem(ARTIST_STORAGE_KEY);
  }
}

export async function getMyOrganizations(): Promise<OrganizationSummary[]> {
  const { data, error } = await supabase.rpc('get_my_organizations');
  if (error) throw error;
  return (data?.organizations ?? []) as OrganizationSummary[];
}

export async function createOrganization(input: {
  type: OrgType;
  name: string;
  email: string;
  country: string;
  phone?: string;
  website?: string;
  business_registration_number?: string;
  description?: string;
  logo_url?: string;
}): Promise<{ organization_id: string; slug: string }> {
  const { data, error } = await supabase.rpc('create_organization', {
    p_type: input.type,
    p_name: input.name,
    p_email: input.email,
    p_country: input.country,
    p_phone: input.phone ?? null,
    p_website: input.website ?? null,
    p_business_registration_number: input.business_registration_number ?? null,
    p_description: input.description ?? null,
    p_logo_url: input.logo_url ?? null,
  });
  if (error) throw error;
  if (!data?.success) throw new Error('Failed to create organization');
  return {
    organization_id: data.organization_id as string,
    slug: data.slug as string,
  };
}

export async function getOrganizationDashboard(orgId: string): Promise<OrgDashboardData> {
  const { data, error } = await supabase.rpc('get_organization_dashboard', { p_org_id: orgId });
  if (error) throw error;
  return data as OrgDashboardData;
}

export async function listOrganizationArtists(
  orgId: string,
  options?: { search?: string; status?: string; limit?: number; offset?: number }
): Promise<{ items: OrgArtistItem[]; total: number }> {
  const { data, error } = await supabase.rpc('list_organization_artists', {
    p_org_id: orgId,
    p_search: options?.search ?? null,
    p_status: options?.status ?? 'active',
    p_limit: options?.limit ?? 50,
    p_offset: options?.offset ?? 0,
  });
  if (error) throw error;
  return {
    items: (data?.items ?? []) as OrgArtistItem[],
    total: (data?.total ?? 0) as number,
  };
}

export function formatInvitationCodeInput(value: string): string {
  const raw = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8);
  if (raw.length <= 4) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function normalizeInvitationCode(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function rpcErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

export async function inviteArtistToOrganization(
  orgId: string,
  email: string,
  invitationType: 'link_existing' | 'create_new' = 'link_existing',
  artistMetadata: Record<string, unknown> = {}
): Promise<{ invitation_id: string; invitation_code: string; invitation_type: string; email_sent?: boolean }> {
  const { data, error } = await supabase.rpc('invite_artist_to_organization', {
    p_org_id: orgId,
    p_email: email,
    p_invitation_type: invitationType,
    p_artist_metadata: artistMetadata,
  });
  if (error) throw new Error(rpcErrorMessage(error, 'Failed to send invitation'));
  if (!data || data.success === false) {
    throw new Error((data?.message as string) || 'Failed to send invitation');
  }
  const invitationCode =
    (data.invitation_code as string) ||
    formatInvitationCodeInput((data.token as string) || '');
  if (!data.invitation_id || !invitationCode) {
    throw new Error('Invitation was not created. Please try again.');
  }
  return {
    invitation_id: data.invitation_id as string,
    invitation_code: invitationCode,
    invitation_type: (data.invitation_type as string) ?? invitationType,
    email_sent: data.email_sent as boolean | undefined,
  };
}

export async function lookupArtistInviteCandidate(
  orgId: string,
  email: string
): Promise<ArtistInviteCandidate> {
  const { data, error } = await supabase.rpc('lookup_artist_invite_candidate', {
    p_org_id: orgId,
    p_email: email,
  });
  if (error) throw error;
  return data as ArtistInviteCandidate;
}

export async function cancelArtistOrganizationInvitation(
  orgId: string,
  invitationId: string
): Promise<void> {
  const { error } = await supabase.rpc('cancel_artist_organization_invitation', {
    p_org_id: orgId,
    p_invitation_id: invitationId,
  });
  if (error) throw error;
}

export async function revokeOrganizationArtistAccess(
  orgId: string,
  artistProfileId: string,
  reason?: string
): Promise<void> {
  const { error } = await supabase.rpc('revoke_organization_artist_access', {
    p_org_id: orgId,
    p_artist_profile_id: artistProfileId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}

export async function listOrganizationMembers(orgId: string): Promise<OrgMemberItem[]> {
  const { data, error } = await supabase.rpc('list_organization_members', { p_org_id: orgId });
  if (error) throw error;
  return (data?.members ?? []) as OrgMemberItem[];
}

export async function inviteOrganizationMember(
  orgId: string,
  email: string,
  roleKey: string
): Promise<{ invitation_id: string; token: string }> {
  const { data, error } = await supabase.rpc('invite_organization_member', {
    p_org_id: orgId,
    p_email: email,
    p_role_key: roleKey,
  });
  if (error) throw error;
  return {
    invitation_id: data.invitation_id as string,
    token: data.token as string,
  };
}

export function orgHasPermission(
  permissions: OrgPermission[] | string[] | undefined,
  permission: OrgPermission
): boolean {
  return (permissions ?? []).includes(permission);
}

export async function acceptArtistOrganizationInvitation(code: string): Promise<{
  organization_id: string;
  requires_artist_profile?: boolean;
}> {
  const normalized = normalizeInvitationCode(code);
  const { data, error } = await supabase.rpc('accept_artist_organization_invitation', {
    p_token: normalized || code.trim(),
  });
  if (error) throw new Error(rpcErrorMessage(error, 'Failed to accept invitation'));
  if (data?.requires_artist_profile || data?.success === false) {
    return {
      organization_id: data.organization_id as string,
      requires_artist_profile: true,
    };
  }
  return { organization_id: data.organization_id as string };
}

export async function acceptOrganizationMemberInvitation(token: string): Promise<{ organization_id: string }> {
  const { data, error } = await supabase.rpc('accept_organization_member_invitation', { p_token: token });
  if (error) throw error;
  return { organization_id: data.organization_id as string };
}
