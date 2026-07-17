import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Disc3, Music, Plus, Search, Video } from 'lucide-react';
import { useOrganization } from '../contexts/OrganizationContext';
import {
  listOrganizationContent,
  OrgArtistItem,
  OrgContentItem,
} from '../../lib/orgAccess';
import { OrgContentUploadWizard } from './OrgContentUploadWizard';
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

interface ArtistContentPanelProps {
  artist: OrgArtistItem;
  onBack: () => void;
}

export function ArtistContentPanel({ artist, onBack }: ArtistContentPanelProps) {
  const { organization, hasPermission } = useOrganization();
  const [items, setItems] = useState<OrgContentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);

  const artistProfileId = artist.artist_profile_id;

  const loadContent = useCallback(async () => {
    if (!organization?.id || !artistProfileId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listOrganizationContent(organization.id, {
        artistProfileId,
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
      setLoading(false);
    }
  }, [organization?.id, artistProfileId, typeFilter, search]);

  useEffect(() => {
    loadContent();
  }, [loadContent]);

  if (!hasPermission('content.view')) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to artists
        </button>
        <p className="text-muted-foreground">Access denied</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to artists
          </button>
          <div className="flex min-w-0 items-center gap-3">
            {artist.profile_photo_url ? (
              <img
                src={artist.profile_photo_url}
                alt=""
                className="h-12 w-12 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
                {artist.stage_name.charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-semibold text-foreground">{artist.stage_name}</h2>
              <p className="text-sm text-muted-foreground">
                Content · {total} item{total === 1 ? '' : 's'}
              </p>
            </div>
          </div>
        </div>
        {hasPermission('content.upload') && (
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#3ba208] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#3ba208]/90"
          >
            <Plus className="h-4 w-4" />
            Upload
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className={`${consoleTheme.input} min-w-[130px] py-2 text-sm`}
        >
          {TYPE_FILTERS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <form
          className="flex min-w-[180px] flex-1 gap-2"
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
              className={`${consoleTheme.input} w-full py-2 pl-9 text-sm`}
            />
          </div>
          <button
            type="submit"
            className="rounded-xl border border-border bg-secondary px-3 py-2 text-sm hover:bg-muted"
          >
            Search
          </button>
        </form>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[280px] items-center justify-center">
          <LoadingLogo />
        </div>
      ) : items.length === 0 ? (
        <div className={`${consoleTheme.card} p-10 text-center`}>
          <p className="text-muted-foreground">No content for this artist yet.</p>
          {hasPermission('content.upload') && (
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="mt-3 text-sm font-medium text-[#3ba208] hover:underline"
            >
              Upload something new
            </button>
          )}
        </div>
      ) : (
        <div className={`${consoleTheme.card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-secondary/60 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Title</th>
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

      {wizardOpen && organization && (
        <OrgContentUploadWizard
          organizationId={organization.id}
          artists={[artist]}
          initialArtist={artist}
          onClose={() => setWizardOpen(false)}
          onSuccess={() => {
            setWizardOpen(false);
            loadContent();
          }}
        />
      )}
    </div>
  );
}
