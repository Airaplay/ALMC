import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  OrganizationSummary,
  OrgArtistItem,
  getMyOrganizations,
  getStoredArtistProfileId,
  getStoredOrgId,
  orgHasPermission,
  setStoredArtistProfileId,
  setStoredOrgId,
  OrgPermission,
} from '../../lib/orgAccess';

interface OrganizationContextValue {
  organizations: OrganizationSummary[];
  organization: OrganizationSummary | null;
  artistProfileId: string | null;
  selectedArtist: OrgArtistItem | null;
  isLoading: boolean;
  error: string | null;
  permissions: OrgPermission[];
  hasPermission: (permission: OrgPermission) => boolean;
  setOrganizationId: (orgId: string) => void;
  setArtistProfileId: (artistProfileId: string | null) => void;
  setSelectedArtist: (artist: OrgArtistItem | null) => void;
  refreshOrganizations: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextValue | null>(null);

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [organizationId, setOrganizationIdState] = useState<string | null>(() => getStoredOrgId());
  const [artistProfileId, setArtistProfileIdState] = useState<string | null>(() => getStoredArtistProfileId());
  const [selectedArtist, setSelectedArtist] = useState<OrgArtistItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshOrganizations = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const orgs = await getMyOrganizations();
      setOrganizations(orgs);

      if (orgs.length === 0) {
        setOrganizationIdState(null);
        clearStoredOrg();
        return;
      }

      const storedId = getStoredOrgId();
      const activeOrg = orgs.find((o) => o.id === storedId) ?? orgs[0];
      setOrganizationIdState(activeOrg.id);
      setStoredOrgId(activeOrg.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load organizations');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshOrganizations();
  }, [refreshOrganizations]);

  const setOrganizationId = useCallback((orgId: string) => {
    setOrganizationIdState(orgId);
    setStoredOrgId(orgId);
    setArtistProfileIdState(null);
    setStoredArtistProfileId(null);
    setSelectedArtist(null);
  }, []);

  const setArtistProfileId = useCallback((id: string | null) => {
    setArtistProfileIdState(id);
    setStoredArtistProfileId(id);
    if (!id) setSelectedArtist(null);
  }, []);

  const organization = useMemo(
    () => organizations.find((o) => o.id === organizationId) ?? null,
    [organizations, organizationId]
  );

  const permissions = (organization?.permissions ?? []) as OrgPermission[];

  const hasPermission = useCallback(
    (permission: OrgPermission) => orgHasPermission(permissions, permission),
    [permissions]
  );

  const value = useMemo(
    () => ({
      organizations,
      organization,
      artistProfileId,
      selectedArtist,
      isLoading,
      error,
      permissions,
      hasPermission,
      setOrganizationId,
      setArtistProfileId,
      setSelectedArtist,
      refreshOrganizations,
    }),
    [
      organizations,
      organization,
      artistProfileId,
      selectedArtist,
      isLoading,
      error,
      permissions,
      hasPermission,
      setOrganizationId,
      setArtistProfileId,
      refreshOrganizations,
    ]
  );

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

function clearStoredOrg() {
  localStorage.removeItem('airaplay_console_org_id');
}

export function useOrganization() {
  const ctx = useContext(OrganizationContext);
  if (!ctx) throw new Error('useOrganization must be used within OrganizationProvider');
  return ctx;
}
