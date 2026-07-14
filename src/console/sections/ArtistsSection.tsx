import { useCallback, useEffect, useState } from 'react';
import { Search, UserPlus, Upload, BarChart3, MoreVertical, BadgeCheck, Ban, XCircle } from 'lucide-react';
import { useOrganization } from '../contexts/OrganizationContext';
import {
  cancelArtistOrganizationInvitation,
  listOrganizationArtists,
  OrgArtistItem,
  revokeOrganizationArtistAccess,
} from '../../lib/orgAccess';
import { LoadingLogo } from '../../components/LoadingLogo';
import { AddArtistModal } from '../components/AddArtistModal';

interface ArtistsSectionProps {
  onUploadArtist: (artist: OrgArtistItem) => void;
  initialShowInvite?: boolean;
}

export function ArtistsSection({ onUploadArtist, initialShowInvite }: ArtistsSectionProps) {
  const { organization, hasPermission, setArtistProfileId, setSelectedArtist } = useOrganization();
  const [artists, setArtists] = useState<OrgArtistItem[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(initialShowInvite ?? false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const loadArtists = useCallback(async () => {
    if (!organization?.id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listOrganizationArtists(organization.id, {
        search: search || undefined,
        status: 'all',
      });
      setArtists(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load artists');
    } finally {
      setLoading(false);
    }
  }, [organization?.id, search]);

  useEffect(() => {
    loadArtists();
  }, [loadArtists]);

  useEffect(() => {
    if (initialShowInvite) setShowAddModal(true);
  }, [initialShowInvite]);

  const handleRevoke = async (artist: OrgArtistItem) => {
    if (!organization?.id) return;

    if (artist.is_pending_invitation && artist.invitation_id) {
      const confirmed = window.confirm(`Cancel the invitation for ${artist.email}?`);
      if (!confirmed) return;
      try {
        await cancelArtistOrganizationInvitation(organization.id, artist.invitation_id);
        await loadArtists();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to cancel invitation');
      }
      setMenuOpen(null);
      return;
    }

    if (!artist.artist_profile_id) return;

    const confirmed = window.confirm(
      `Remove access for ${artist.stage_name}? Their profile, followers, and music stay with the artist.`
    );
    if (!confirmed) return;
    try {
      await revokeOrganizationArtistAccess(organization.id, artist.artist_profile_id);
      await loadArtists();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke access');
    }
    setMenuOpen(null);
  };

  const formatNum = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
  };

  const statusLabel = (artist: OrgArtistItem) => {
    if (artist.is_pending_invitation) {
      return artist.invitation_type === 'create_new' ? 'invite pending' : 'link pending';
    }
    return artist.link_status.replace('_', ' ');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Artists</h2>
          <p className="mt-1 text-sm text-muted-foreground">{total} in roster</p>
        </div>
        {hasPermission('artists.invite') && (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#309605] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#3ba208]"
          >
            <UserPlus className="h-4 w-4" />
            Add Artist
          </button>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/80" />
        <input
          type="search"
          placeholder="Search artists..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground/80 focus:border-[#309605]/50 focus:outline-none"
        />
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {loading ? (
        <div className="flex min-h-[240px] items-center justify-center">
          <LoadingLogo />
        </div>
      ) : artists.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
          <p className="text-muted-foreground">No artists in your roster yet</p>
          {hasPermission('artists.invite') && (
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="mt-4 text-sm font-medium text-[#3ba208] hover:underline"
            >
              Add your first artist
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {artists.map((artist) => (
            <div
              key={artist.link_id}
              className="rounded-2xl border border-border bg-card p-4 sm:p-5"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  {artist.profile_photo_url ? (
                    <img
                      src={artist.profile_photo_url}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
                      {(artist.stage_name || artist.email).charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-foreground">
                        {artist.stage_name || artist.email}
                      </h3>
                      {artist.is_verified && <BadgeCheck className="h-4 w-4 shrink-0 text-sky-400" />}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${
                          artist.link_status === 'active'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : artist.link_status === 'pending_invite' || artist.is_pending_invitation
                              ? 'bg-amber-500/15 text-amber-400'
                              : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {statusLabel(artist)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{artist.email}</p>
                    {artist.country && (
                      <p className="text-sm text-muted-foreground">{artist.country}</p>
                    )}
                    {!artist.is_pending_invitation && (
                      <p className="mt-1 text-xs text-muted-foreground/80">
                        {formatNum(Number(artist.followers))} followers · {formatNum(Number(artist.streams))} streams
                        {artist.latest_release?.title && ` · Latest: ${artist.latest_release.title}`}
                      </p>
                    )}
                    {artist.is_pending_invitation && (
                      <p className="mt-1 text-xs text-amber-400/90">
                        Waiting for artist to accept invitation
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {artist.link_status === 'active' && artist.artist_profile_id && hasPermission('content.upload') && (
                    <button
                      type="button"
                      onClick={() => onUploadArtist(artist)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-secondary-foreground hover:bg-muted"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Upload
                    </button>
                  )}
                  {artist.link_status === 'active' && artist.artist_profile_id && (
                    <button
                      type="button"
                      onClick={() => {
                        setArtistProfileId(artist.artist_profile_id);
                        setSelectedArtist(artist);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-secondary-foreground hover:bg-muted"
                    >
                      <BarChart3 className="h-3.5 w-3.5" />
                      Focus
                    </button>
                  )}
                  {hasPermission('artists.revoke') && artist.link_status !== 'revoked' && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setMenuOpen(menuOpen === artist.link_id ? null : artist.link_id)}
                        className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                      {menuOpen === artist.link_id && (
                        <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-xl border border-border bg-card py-1 shadow-xl">
                          <button
                            type="button"
                            onClick={() => handleRevoke(artist)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 hover:bg-muted"
                          >
                            {artist.is_pending_invitation ? (
                              <>
                                <XCircle className="h-4 w-4" />
                                Cancel invitation
                              </>
                            ) : (
                              <>
                                <Ban className="h-4 w-4" />
                                Revoke access
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {organization && (
        <AddArtistModal
          organizationId={organization.id}
          open={showAddModal}
          onClose={() => setShowAddModal(false)}
          onSuccess={loadArtists}
        />
      )}
    </div>
  );
}
