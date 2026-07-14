import { useCallback, useEffect, useState } from 'react';
import { Search, UserPlus, Upload, BarChart3, MoreVertical, BadgeCheck, Ban } from 'lucide-react';
import { useOrganization } from '../contexts/OrganizationContext';
import {
  inviteArtistToOrganization,
  listOrganizationArtists,
  OrgArtistItem,
  revokeOrganizationArtistAccess,
} from '../../lib/orgAccess';
import { almcRoutes } from '../../lib/almcRoutes';
import { LoadingLogo } from '../../components/LoadingLogo';

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
  const [showInvite, setShowInvite] = useState(initialShowInvite ?? false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

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
    if (initialShowInvite) setShowInvite(true);
  }, [initialShowInvite]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization?.id || !inviteEmail.trim()) return;
    setInviting(true);
    setError(null);
    try {
      const { token } = await inviteArtistToOrganization(organization.id, inviteEmail.trim());
      setInviteLink(almcRoutes.acceptArtistInviteUrl(token));
      setInviteEmail('');
      await loadArtists();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invitation');
    } finally {
      setInviting(false);
    }
  };

  const handleRevoke = async (artist: OrgArtistItem) => {
    if (!organization?.id) return;
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white">Artists</h2>
          <p className="mt-1 text-sm text-white/50">{total} in roster</p>
        </div>
        {hasPermission('artists.invite') && (
          <button
            type="button"
            onClick={() => setShowInvite(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#FF3366] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#FF3366]/90"
          >
            <UserPlus className="h-4 w-4" />
            Invite Artist
          </button>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
        <input
          type="search"
          placeholder="Search artists..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-[#141416] py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-white/40 focus:border-[#FF3366]/50 focus:outline-none"
        />
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {showInvite && (
        <div className="rounded-2xl border border-white/10 bg-[#141416] p-5">
          <h3 className="text-lg font-semibold text-white">Invite Artist</h3>
          <p className="mt-1 text-sm text-white/50">
            Invite an existing Airaplay artist by email. They keep full ownership of their profile.
          </p>
          <form onSubmit={handleInvite} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              type="email"
              required
              placeholder="artist@email.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="flex-1 rounded-xl border border-white/10 bg-[#0f0f11] px-4 py-2.5 text-sm text-white focus:border-[#FF3366]/50 focus:outline-none"
            />
            <button
              type="submit"
              disabled={inviting}
              className="rounded-xl bg-[#FF3366] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {inviting ? 'Sending…' : 'Send Invite'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowInvite(false);
                setInviteLink(null);
              }}
              className="rounded-xl border border-white/10 px-5 py-2.5 text-sm text-white/70"
            >
              Cancel
            </button>
          </form>
          {inviteLink && (
            <div className="mt-3 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">
              Invitation created. Share this link with the artist:
              <code className="mt-1 block break-all text-xs text-emerald-200">{inviteLink}</code>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[240px] items-center justify-center">
          <LoadingLogo />
        </div>
      ) : artists.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-[#141416]/50 p-12 text-center">
          <p className="text-white/60">No artists in your roster yet</p>
          {hasPermission('artists.invite') && (
            <button
              type="button"
              onClick={() => setShowInvite(true)}
              className="mt-4 text-sm font-medium text-[#FF3366] hover:underline"
            >
              Invite your first artist
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {artists.map((artist) => (
            <div
              key={artist.link_id}
              className="rounded-2xl border border-white/10 bg-[#141416] p-4 sm:p-5"
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
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/10 text-lg font-semibold text-white">
                      {artist.stage_name.charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-white">{artist.stage_name}</h3>
                      {artist.is_verified && <BadgeCheck className="h-4 w-4 shrink-0 text-sky-400" />}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${
                          artist.link_status === 'active'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : artist.link_status === 'pending_invite'
                              ? 'bg-amber-500/15 text-amber-400'
                              : 'bg-white/10 text-white/50'
                        }`}
                      >
                        {artist.link_status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-sm text-white/50">{artist.country ?? '—'}</p>
                    <p className="mt-1 text-xs text-white/40">
                      {formatNum(Number(artist.followers))} followers · {formatNum(Number(artist.streams))} streams
                      {artist.latest_release?.title && ` · Latest: ${artist.latest_release.title}`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {artist.link_status === 'active' && hasPermission('content.upload') && (
                    <button
                      type="button"
                      onClick={() => onUploadArtist(artist)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/80 hover:bg-white/5"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Upload
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setArtistProfileId(artist.artist_profile_id);
                      setSelectedArtist(artist);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/80 hover:bg-white/5"
                  >
                    <BarChart3 className="h-3.5 w-3.5" />
                    Focus
                  </button>
                  {hasPermission('artists.revoke') && artist.link_status !== 'revoked' && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setMenuOpen(menuOpen === artist.link_id ? null : artist.link_id)}
                        className="rounded-lg p-2 text-white/50 hover:bg-white/5 hover:text-white"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                      {menuOpen === artist.link_id && (
                        <div className="absolute right-0 top-full z-10 mt-1 w-44 rounded-xl border border-white/10 bg-[#141416] py-1 shadow-xl">
                          <button
                            type="button"
                            onClick={() => handleRevoke(artist)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 hover:bg-white/5"
                          >
                            <Ban className="h-4 w-4" />
                            Revoke access
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
    </div>
  );
}
