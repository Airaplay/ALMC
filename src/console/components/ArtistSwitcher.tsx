import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, User } from 'lucide-react';
import { useOrganization } from '../contexts/OrganizationContext';
import { listOrganizationArtists, OrgArtistItem } from '../../lib/orgAccess';

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
        className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2 text-sm text-foreground hover:bg-white/10"
      >
        <User className="h-4 w-4 text-muted-foreground" />
        <span className="max-w-[140px] truncate font-medium">{label}</span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
          <button
            type="button"
            onClick={() => selectArtist(null)}
            className={`flex w-full items-center px-4 py-3 text-left text-sm hover:bg-muted ${
              !artistProfileId ? 'text-[#3ba208]' : 'text-secondary-foreground'
            }`}
          >
            All Artists (Org view)
          </button>
          <div className="border-t border-border" />
          {activeArtists.map((artist) => (
            <button
              key={artist.artist_profile_id ?? artist.link_id}
              type="button"
              onClick={() => selectArtist(artist)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted ${
                artistProfileId === artist.artist_profile_id ? 'text-[#3ba208]' : 'text-secondary-foreground'
              }`}
            >
              {artist.profile_photo_url ? (
                <img src={artist.profile_photo_url} alt="" className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs">
                  {artist.stage_name.charAt(0)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{artist.stage_name}</p>
                {artist.is_verified && <p className="text-[10px] text-emerald-400">Verified</p>}
              </div>
            </button>
          ))}
          {hasPermission('artists.invite') && onAddArtist && (
            <>
              <div className="border-t border-border" />
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onAddArtist();
                }}
                className="flex w-full items-center gap-2 px-4 py-3 text-sm text-[#3ba208] hover:bg-muted"
              >
                <Plus className="h-4 w-4" />
                Add Artist
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
