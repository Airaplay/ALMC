import { useCallback, useEffect, useState } from 'react';
import {
  Search,
  UserPlus,
  Upload,
  BarChart3,
  MoreVertical,
  BadgeCheck,
  Ban,
  XCircle,
  LayoutGrid,
  Table2,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileSpreadsheet,
  FolderOpen,
} from 'lucide-react';
import { useOrganization } from '../contexts/OrganizationContext';
import {
  cancelArtistOrganizationInvitation,
  listOrganizationArtists,
  OrgArtistItem,
  OrgArtistSort,
  revokeOrganizationArtistAccess,
} from '../../lib/orgAccess';
import { LoadingLogo } from '../../components/LoadingLogo';
import { AddArtistModal } from '../components/AddArtistModal';
import { ArtistContentPanel } from '../components/ArtistContentPanel';

const PAGE_SIZE = 12;

interface ArtistsSectionProps {
  onUploadArtist: (artist: OrgArtistItem) => void;
  onFocusArtist?: (artist: OrgArtistItem) => void;
  initialShowInvite?: boolean;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatRevenueUsd(n: number): string {
  if (!Number.isFinite(n)) return '$0';
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function releaseTypeLabel(type: string): string {
  const map: Record<string, string> = {
    single: 'Single',
    album: 'Album',
    video: 'Video',
    short_clip: 'Clip',
    ep: 'EP',
    podcast: 'Podcast',
  };
  return map[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function consumerArtistUrl(userId: string | null): string | null {
  if (!userId) return null;
  const base = (import.meta.env.VITE_AIRAPLAY_CONSUMER_URL as string | undefined)?.replace(/\/$/, '');
  if (!base) return null;
  return `${base}/user/${userId}`;
}

function statusLabel(artist: OrgArtistItem): string {
  if (artist.is_pending_invitation) {
    return artist.invitation_type === 'create_new' ? 'Awaiting verification' : 'Link pending';
  }
  if (artist.link_status === 'active') return 'Active';
  return artist.link_status.replace(/_/g, ' ');
}

export function ArtistsSection({ onUploadArtist, onFocusArtist, initialShowInvite }: ArtistsSectionProps) {
  const { organization, hasPermission, artistProfileId, setArtistProfileId, setSelectedArtist } =
    useOrganization();
  const [artists, setArtists] = useState<OrgArtistItem[]>([]);
  const [total, setTotal] = useState(0);
  const [genreOptions, setGenreOptions] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [genreFilter, setGenreFilter] = useState('');
  const [verifiedFilter, setVerifiedFilter] = useState<'all' | 'verified' | 'unverified'>('all');
  const [sortBy, setSortBy] = useState<OrgArtistSort>('monthly_streams');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(initialShowInvite ?? false);
  const [verifyEmail, setVerifyEmail] = useState<string | undefined>();
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [contentArtist, setContentArtist] = useState<OrgArtistItem | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadArtists = useCallback(async () => {
    if (!organization?.id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listOrganizationArtists(organization.id, {
        search: search || undefined,
        status: statusFilter,
        genre: genreFilter || undefined,
        verified: verifiedFilter,
        sort: sortBy,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setArtists(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load artists');
    } finally {
      setLoading(false);
    }
  }, [organization?.id, search, statusFilter, genreFilter, verifiedFilter, sortBy, page]);

  useEffect(() => {
    loadArtists();
  }, [loadArtists]);

  useEffect(() => {
    if (!organization?.id) return;
    listOrganizationArtists(organization.id, { status: 'all', limit: 500 })
      .then(({ items }) => {
        const genres = [
          ...new Set(items.map((a) => a.genre).filter((g): g is string => Boolean(g && g.trim()))),
        ].sort((a, b) => a.localeCompare(b));
        setGenreOptions(genres);
      })
      .catch(() => setGenreOptions([]));
  }, [organization?.id]);

  useEffect(() => {
    if (initialShowInvite) setShowAddModal(true);
  }, [initialShowInvite]);

  useEffect(() => {
    setPage(0);
  }, [search, statusFilter, genreFilter, verifiedFilter, sortBy]);

  const focusArtist = (artist: OrgArtistItem, navigate = false) => {
    if (!artist.artist_profile_id) return;
    setArtistProfileId(artist.artist_profile_id);
    setSelectedArtist(artist);
    if (navigate) onFocusArtist?.(artist);
  };

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

  const artistActions = (artist: OrgArtistItem, compact = false) => (
    <div className={`flex items-center gap-2 ${compact ? 'justify-end' : 'flex-wrap'}`}>
      {artist.is_pending_invitation && hasPermission('artists.invite') && (
        <button
          type="button"
          onClick={() => {
            setVerifyEmail(artist.email);
            setShowAddModal(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#309605]/40 bg-[#309605]/10 px-3 py-2 text-xs text-[#3ba208] hover:bg-[#309605]/20"
        >
          Enter code
        </button>
      )}
      {artist.link_status === 'active' && artist.artist_profile_id && (
        <>
          {consumerArtistUrl(artist.user_id) && (
            <a
              href={consumerArtistUrl(artist.user_id)!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-secondary-foreground hover:bg-muted"
            >
              <Eye className="h-3.5 w-3.5" />
              View
            </a>
          )}
          {hasPermission('content.upload') && (
            <button
              type="button"
              onClick={() => onUploadArtist(artist)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-secondary-foreground hover:bg-muted"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload
            </button>
          )}
          {hasPermission('content.view') && (
            <button
              type="button"
              onClick={() => setContentArtist(artist)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-secondary-foreground hover:bg-muted"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Content
            </button>
          )}
          {hasPermission('analytics.view') && (
            <button
              type="button"
              onClick={() => focusArtist(artist, true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-secondary-foreground hover:bg-muted"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Analytics
            </button>
          )}
        </>
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
  );

  const ArtistCard = ({ artist }: { artist: OrgArtistItem }) => {
    const metaLine = [artist.genre, artist.country].filter(Boolean).join(' · ');
    const isFocused = artist.artist_profile_id && artistProfileId === artist.artist_profile_id;

    return (
      <div
        className={`flex h-full flex-col rounded-2xl border bg-card p-5 ${
          isFocused ? 'border-[#309605]/50 ring-1 ring-[#309605]/30' : 'border-border'
        }`}
      >
        <div className="flex items-start gap-4">
          {artist.profile_photo_url ? (
            <img
              src={artist.profile_photo_url}
              alt=""
              className="h-16 w-16 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-muted text-xl font-semibold text-foreground">
              {(artist.stage_name || artist.email).charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold text-foreground">
                {artist.stage_name || artist.email}
              </h3>
              {artist.is_verified && <BadgeCheck className="h-4 w-4 shrink-0 text-sky-400" />}
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${
                  artist.link_status === 'active'
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : artist.is_pending_invitation
                      ? 'bg-amber-500/15 text-amber-400'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {statusLabel(artist)}
              </span>
            </div>
            {metaLine && <p className="mt-1 text-sm text-muted-foreground">{metaLine}</p>}
            {!artist.is_pending_invitation && (
              <p className="mt-2 text-sm text-secondary-foreground">
                {formatNum(Number(artist.followers))} followers ·{' '}
                {formatNum(Number(artist.monthly_streams ?? 0))} monthly ·{' '}
                {formatRevenueUsd(Number(artist.revenue))} revenue
              </p>
            )}
            {artist.latest_release?.title && !artist.is_pending_invitation && (
              <p className="mt-1 text-xs text-muted-foreground/80">
                Latest: {artist.latest_release.title} ({releaseTypeLabel(artist.latest_release.type)})
                {' · '}
                {new Date(artist.latest_release.created_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            )}
            {artist.is_pending_invitation && (
              <p className="mt-2 text-xs text-amber-400/90">
                Awaiting verification — enter the code from the artist
              </p>
            )}
          </div>
        </div>
        <div className="mt-4 border-t border-border/60 pt-4">{artistActions(artist)}</div>
      </div>
    );
  };

  if (contentArtist) {
    return (
      <ArtistContentPanel artist={contentArtist} onBack={() => setContentArtist(null)} />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Artists ({total})</h2>
          <p className="mt-1 text-sm text-muted-foreground">Manage your label roster</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasPermission('artists.invite') && (
            <button
              type="button"
              onClick={() => {
                setVerifyEmail(undefined);
                setShowAddModal(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-[#309605] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#3ba208]"
            >
              <UserPlus className="h-4 w-4" />
              Add Artist
            </button>
          )}
          <button
            type="button"
            disabled
            title="CSV import coming in a later release"
            className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm text-muted-foreground/80 opacity-60"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Import CSV
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/80" />
          <input
            type="search"
            placeholder="Search artists..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground/80 focus:border-[#309605]/50 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground"
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="pending_invite">Pending</option>
            <option value="revoked">Revoked</option>
          </select>
          <select
            value={genreFilter}
            onChange={(e) => setGenreFilter(e.target.value)}
            className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground"
          >
            <option value="">All genres</option>
            {genreOptions.map((genre) => (
              <option key={genre} value={genre}>
                {genre}
              </option>
            ))}
          </select>
          <select
            value={verifiedFilter}
            onChange={(e) => setVerifiedFilter(e.target.value as 'all' | 'verified' | 'unverified')}
            className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground"
          >
            <option value="all">All artists</option>
            <option value="verified">Verified</option>
            <option value="unverified">Not verified</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as OrgArtistSort)}
            className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground"
          >
            <option value="monthly_streams">Sort: Monthly streams</option>
            <option value="streams">Sort: Total streams</option>
            <option value="followers">Sort: Followers</option>
            <option value="revenue">Sort: Revenue</option>
            <option value="stage_name">Sort: Name</option>
            <option value="linked_at">Sort: Recently linked</option>
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-xl border border-border bg-card p-1">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${
              viewMode === 'grid' ? 'bg-[#309605]/15 text-[#3ba208]' : 'text-muted-foreground'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Grid
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${
              viewMode === 'table' ? 'bg-[#309605]/15 text-[#3ba208]' : 'text-muted-foreground'
            }`}
          >
            <Table2 className="h-3.5 w-3.5" />
            Table
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[240px] items-center justify-center">
          <LoadingLogo />
        </div>
      ) : artists.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
          <p className="text-muted-foreground">No artists match your filters</p>
          {hasPermission('artists.invite') && (
            <button
              type="button"
              onClick={() => {
                setVerifyEmail(undefined);
                setShowAddModal(true);
              }}
              className="mt-4 text-sm font-medium text-[#3ba208] hover:underline"
            >
              Add your first artist
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {artists.map((artist) => (
            <ArtistCard key={artist.link_id} artist={artist} />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Artist</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Genre</th>
                <th className="px-4 py-3 font-medium">Followers</th>
                <th className="px-4 py-3 font-medium">Monthly</th>
                <th className="px-4 py-3 font-medium">Revenue</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {artists.map((artist) => (
                <tr key={artist.link_id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {artist.profile_photo_url ? (
                        <img src={artist.profile_photo_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                          {(artist.stage_name || artist.email).charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-1.5 font-medium text-foreground">
                          {artist.stage_name || artist.email}
                          {artist.is_verified && <BadgeCheck className="h-3.5 w-3.5 text-sky-400" />}
                        </div>
                        <p className="text-xs text-muted-foreground">{artist.country || artist.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{statusLabel(artist)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{artist.genre || '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{formatNum(Number(artist.followers))}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {formatNum(Number(artist.monthly_streams ?? 0))}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{formatRevenueUsd(Number(artist.revenue))}</td>
                  <td className="px-4 py-3">{artistActions(artist, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-sm text-secondary-foreground hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-sm text-secondary-foreground hover:bg-muted disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {organization && (
        <AddArtistModal
          organizationId={organization.id}
          open={showAddModal}
          onClose={() => {
            setShowAddModal(false);
            setVerifyEmail(undefined);
          }}
          onSuccess={loadArtists}
          initialEmail={verifyEmail}
          initialStep={verifyEmail ? 'verify' : 'details'}
        />
      )}
    </div>
  );
}
