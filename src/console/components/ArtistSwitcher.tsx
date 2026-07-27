import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, User } from 'lucide-react';
import { useOrganization } from '../contexts/OrganizationContext';
import { listOrganizationArtists, OrgArtistItem } from '../../lib/orgAccess';
import { consoleTheme } from '../consoleTheme';

interface ArtistSwitcherProps {
  onAddArtist?: () => void;
  onFocusArtist?: () => void;
}

export function ArtistSwitcher({ onAddArtist, onFocusArtist }: ArtistSwitcherProps) {
  const {
    organization,
    artistProfileId,
    setArtistProfileId,
    setSelectedArtist,
    hasPermission,
  } = useOrganization();
  const [open, setOpen] = useState(false);
  const [artists, setArtists] = useState<OrgArtistItem[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!organization?.id) return;
    listOrganizationArtists(organization.id, { status: 'active', limit: 100 })
      .then(({ items }) => setArtists(items))
      .catch(() => setArtists([]));
  }, [organization?.id]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const activeArtists = artists.filter((a) => a.link_status === 'active' && a.artist_profile_id);

  const selected = activeArtists.find((a) => a.artist_profile_id === artistProfileId) ?? null;
  const label = selected?.stage_name ?? 'All Artists';

  const selectArtist = (artist: OrgArtistItem | null) => {
    if (artist?.artist_profile_id) {
      setArtistProfileId(artist.artist_profile_id);
      setSelectedArtist(artist);
      onFocusArtist?.();
    } else {
      setArtistProfileId(null);
      setSelectedArtist(null);
    }
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-border/80 bg-card px-3.5 py-2 text-sm text-foreground shadow-[var(--almc-shadow-sm)] hover:bg-muted"
      >
        <User className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
        <span className="max-w-[140px] truncate font-medium">{label}</span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-border/80 bg-card py-1 shadow-[var(--almc-shadow)]">
          <button
            type="button"
            onClick={() => selectArtist(null)}
            className={`flex w-full items-center px-4 py-2.5 text-left text-sm hover:bg-muted ${
              !artistProfileId ? 'font-medium text-foreground' : 'text-secondary-foreground'
            }`}
          >
            All Artists (Org view)
          </button>
          <div className="border-t border-border/70" />
          {activeArtists.map((artist) => (
            <button
              key={artist.artist_profile_id ?? artist.link_id}
              type="button"
              onClick={() => selectArtist(artist)}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted ${
                artistProfileId === artist.artist_profile_id
                  ? 'font-medium text-foreground'
                  : 'text-secondary-foreground'
              }`}
            >
              {artist.profile_photo_url ? (
                <img
                  src={artist.profile_photo_url}
                  alt=""
                  className="h-8 w-8 rounded-full object-cover ring-2 ring-white"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {artist.stage_name.charAt(0)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{artist.stage_name}</p>
                {artist.is_verified && (
                  <p className="text-[10px] text-[var(--almc-lime-deep)]">Verified</p>
                )}
              </div>
            </button>
          ))}
          {hasPermission('artists.invite') && onAddArtist && (
            <>
              <div className="border-t border-border/70" />
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onAddArtist();
                }}
                className={`flex w-full items-center gap-2 px-4 py-2.5 text-sm ${consoleTheme.iconAccent} hover:bg-muted`}
              >
                <Plus className="h-4 w-4" strokeWidth={1.75} />
                Add Artist
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
