import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Megaphone, Music, User } from 'lucide-react';
import { useOrganization } from '../contexts/OrganizationContext';
import {
  listOrgArtistPromotableContent,
  OrgArtistItem,
  OrgPromotableItem,
} from '../../lib/orgAccess';
import { LoadingLogo } from '../../components/LoadingLogo';
import { AlmcPromotionSetupModal } from './AlmcPromotionSetupModal';
import { consoleTheme } from '../consoleTheme';

interface ArtistPromotePanelProps {
  artist: OrgArtistItem;
  onBack: () => void;
}

function typeLabel(type: OrgPromotableItem['promotion_type']): string {
  const map: Record<string, string> = {
    song: 'Single',
    album: 'Album',
    video: 'Video',
    short_clip: 'Clip',
    profile: 'Profile',
    playlist: 'Playlist',
  };
  return map[type] ?? type;
}

export function ArtistPromotePanel({ artist, onBack }: ArtistPromotePanelProps) {
  const { organization, hasPermission } = useOrganization();
  const [items, setItems] = useState<OrgPromotableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<OrgPromotableItem | null>(null);

  const artistProfileId = artist.artist_profile_id;

  const loadItems = useCallback(async () => {
    if (!organization?.id || !artistProfileId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listOrgArtistPromotableContent(organization.id, artistProfileId);
      setItems(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load promotable content');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [organization?.id, artistProfileId]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  if (selected) {
    return (
      <AlmcPromotionSetupModal
        promotionType={selected.promotion_type}
        targetId={selected.id}
        targetTitle={selected.title}
        targetCoverUrl={selected.cover_url}
        onClose={() => setSelected(null)}
        onSuccess={() => {
          setSelected(null);
          loadItems();
        }}
      />
    );
  }

  if (!hasPermission('content.promote')) {
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
        <p className="text-muted-foreground">You don&apos;t have permission to promote content.</p>
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
              <h2 className="break-words text-2xl font-semibold text-foreground">
                Promote {artist.stage_name}
              </h2>
              <p className="text-sm text-muted-foreground">
                Boost releases using treats from your wallet
              </p>
            </div>
          </div>
        </div>
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
          <p className="text-muted-foreground">No promotable content for this artist yet.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div
              key={`${item.promotion_type}-${item.id}`}
              className={`${consoleTheme.card} flex flex-col gap-3 p-4`}
            >
              <div className="flex items-start gap-3">
                {item.cover_url ? (
                  <img
                    src={item.cover_url}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                    {item.promotion_type === 'profile' ? (
                      <User className="h-5 w-5" />
                    ) : (
                      <Music className="h-5 w-5" />
                    )}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium text-foreground">{item.title}</p>
                  <p className="text-sm capitalize text-muted-foreground">
                    {typeLabel(item.promotion_type)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(item)}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--almc-lime)] px-3 py-2 text-xs font-semibold text-white hover:brightness-95"
              >
                <Megaphone className="h-3.5 w-3.5" />
                Promote
              </button>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
