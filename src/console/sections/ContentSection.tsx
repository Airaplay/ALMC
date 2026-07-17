import { useCallback, useEffect, useMemo, useState } from 'react';
import { Disc3, Music, Plus, Search, Video } from 'lucide-react';
import { useOrganization } from '../contexts/OrganizationContext';
import {
  listOrganizationArtists,
  listOrganizationContent,
  OrgArtistItem,
  OrgContentItem,
} from '../../lib/orgAccess';
import { OrgContentUploadWizard } from '../components/OrgContentUploadWizard';
import { LoadingLogo } from '../../components/LoadingLogo';
import { consoleTheme } from '../consoleTheme';

const TYPE_FILTERS = [
  { value: 'all', label: 'All types' },
  { value: 'single', label: 'Singles' },
  { value: 'album', label: 'Albums' },
  { value: 'video', label: 'Videos' },
  { value: 'short_clip', label: 'Shorts' },
] as const;

const STATUS_STYLES: Record<string, string> = {
  published: 'bg-emerald-500/15 text-emerald-300',
  scheduled: 'bg-amber-500/15 text-amber-300',
  draft: 'bg-white/10 text-muted-foreground',
  cancelled: 'bg-red-500/15 text-red-300',
};

function TypeIcon({ type }: { type: string }) {
  if (type === 'album') return <Disc3 className="h-4 w-4" />;
  if (type === 'video' || type === 'short_clip') return <Video className="h-4 w-4" />;
  return <Music className="h-4 w-4" />;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ContentSection() {
  const { organization, hasPermission, selectedArtist, setArtistProfileId } = useOrganization();
  const [artists, setArtists] = useState<OrgArtistItem[]>([]);
  const [items, setItems] = useState<OrgContentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingArtists, setLoadingArtists] = useState(true);
  const [loadingContent, setLoadingContent] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [artistFilter, setArtistFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const [wizardOpen, setWizardOpen] = useState(false);
  const [uploadArtist, setUploadArtist] = useState<OrgArtistItem | null>(null);

  useEffect(() => {
    if (selectedArtist?.artist_profile_id) {
      setArtistFilter(selectedArtist.artist_profile_id);
    }
  }, [selectedArtist?.artist_profile_id]);

  useEffect(() => {
    if (!organization?.id) return;
    setLoadingArtists(true);
    listOrganizationArtists(organization.id, { status: 'active', limit: 200 })
      .then(({ items: list }) => setArtists(list.filter((a) => a.link_status === 'active')))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load artists'))
      .finally(() => setLoadingArtists(false));
  }, [organization?.id]);

  const loadContent = useCallback(async () => {
    if (!organization?.id) return;
    setLoadingContent(true);
    setError(null);
    try {
      const result = await listOrganizationContent(organization.id, {
        artistProfileId: artistFilter === 'all' ? null : artistFilter,
        contentType: typeFilter === 'all' ? null : typeFilter,
        search: search.trim() || null,
        limit: 100,
        offset: 0,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load content');
      setItems([]);
      setTotal(0);
    } finally {
      setLoadingContent(false);
    }
  }, [organization?.id, artistFilter, typeFilter, search]);

  useEffect(() => {
    loadContent();
  }, [loadContent]);

  const activeArtists = artists;
  const filterLabel = useMemo(() => {
    if (artistFilter === 'all') return 'All artists';
    return activeArtists.find((a) => a.artist_profile_id === artistFilter)?.stage_name ?? 'Artist';
  }, [artistFilter, activeArtists]);

  const openWizard = (artist?: OrgArtistItem) => {
    setUploadArtist(artist ?? null);
    setWizardOpen(true);
  };

  const closeWizard = () => {
    setWizardOpen(false);
    setUploadArtist(null);
    loadContent();
  };

  if (!hasPermission('content.view')) {
    return <p className="text-muted-foreground">You don&apos;t have permission to view content.</p>;
  }

  if (loadingArtists) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <LoadingLogo />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Content</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse and upload singles, albums, and videos per artist
          </p>
        </div>
        {hasPermission('content.upload') && activeArtists.length > 0 && (
          <button
            type="button"
            onClick={() => openWizard()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#3ba208] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#3ba208]/90"
          >
            <Plus className="h-4 w-4" />
            Upload
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {activeArtists.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <p className="text-muted-foreground">Link an artist before managing content</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={artistFilter}
              onChange={(e) => {
                const value = e.target.value;
                setArtistFilter(value);
                setArtistProfileId(value === 'all' ? null : value);
              }}
              className={`${consoleTheme.input} min-w-[180px]`}
            >
              <option value="all">All artists</option>
              {activeArtists.map((a) => (
                <option key={a.artist_profile_id ?? a.link_id} value={a.artist_profile_id ?? ''}>
                  {a.stage_name}
                </option>
              ))}
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className={`${consoleTheme.input} min-w-[140px]`}
            >
              {TYPE_FILTERS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <form
              className="flex min-w-[200px] flex-1 gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(searchInput);
              }}
            >
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search titles…"
                  className={`${consoleTheme.input} w-full pl-9`}
                />
              </div>
              <button
                type="submit"
                className="rounded-xl border border-border bg-secondary px-3 py-2 text-sm text-foreground hover:bg-muted"
              >
                Search
              </button>
            </form>
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <p>
              {total} item{total === 1 ? '' : 's'}
              {artistFilter !== 'all' ? ` · ${filterLabel}` : ''}
            </p>
          </div>

          {loadingContent ? (
            <div className="flex min-h-[200px] items-center justify-center">
              <LoadingLogo />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center">
              <p className="text-muted-foreground">No content found for this filter.</p>
              {hasPermission('content.upload') && (
                <button
                  type="button"
                  onClick={() => {
                    const artist =
                      artistFilter === 'all'
                        ? null
                        : activeArtists.find((a) => a.artist_profile_id === artistFilter) ?? null;
                    openWizard(artist ?? undefined);
                  }}
                  className="mt-4 text-sm font-medium text-[#3ba208] hover:underline"
                >
                  Upload something new
                </button>
              )}
            </div>
          ) : (
            <div className={`${consoleTheme.card} overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-secondary/60 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Title</th>
                      <th className="px-4 py-3 font-medium">Artist</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Plays</th>
                      <th className="px-4 py-3 font-medium">Released</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((item) => (
                      <tr key={item.id} className="hover:bg-secondary/40">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {item.cover_url ? (
                              <img
                                src={item.cover_url}
                                alt=""
                                className="h-10 w-10 rounded-lg object-cover"
                              />
                            ) : (
                              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                                <TypeIcon type={item.content_type} />
                              </div>
                            )}
                            <span className="font-medium text-foreground">{item.title}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-secondary-foreground">{item.stage_name}</td>
                        <td className="px-4 py-3 capitalize text-muted-foreground">
                          {item.content_type.replace('_', ' ')}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                              STATUS_STYLES[item.release_status] ?? STATUS_STYLES.draft
                            }`}
                          >
                            {item.release_status}
                          </span>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">
                          {(item.play_count ?? 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatDate(item.release_at ?? item.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {wizardOpen && organization && (
        <OrgContentUploadWizard
          organizationId={organization.id}
          artists={activeArtists}
          initialArtist={uploadArtist}
          onClose={closeWizard}
          onSuccess={closeWizard}
        />
      )}
    </div>
  );
}
