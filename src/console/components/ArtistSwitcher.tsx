import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, User } from 'lucide-react';
import { useOrganization } from '../contexts/OrganizationContext';
import { listOrganizationArtists, OrgArtistItem } from '../../lib/orgAccess';

interface ArtistSwitcherProps {
  onAddArtist?: () => void;
}

export function ArtistSwitcher({ onAddArtist }: ArtistSwitcherProps) {
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

  const selected = artists.find((a) => a.artist_profile_id === artistProfileId) ?? null;
  const label = selected?.stage_name ?? 'All Artists';

  const selectArtist = (artist: OrgArtistItem | null) => {
    if (artist) {
      setArtistProfileId(artist.artist_profile_id);
      setSelectedArtist(artist);
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
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
      >
        <User className="h-4 w-4 text-white/60" />
        <span className="max-w-[140px] truncate font-medium">{label}</span>
        <ChevronDown className={`h-4 w-4 text-white/50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-white/10 bg-[#141416] shadow-2xl">
          <button
            type="button"
            onClick={() => selectArtist(null)}
            className={`flex w-full items-center px-4 py-3 text-left text-sm hover:bg-white/5 ${
              !artistProfileId ? 'text-[#FF3366]' : 'text-white/80'
            }`}
          >
            All Artists (Org view)
          </button>
          <div className="border-t border-white/10" />
          {artists.map((artist) => (
            <button
              key={artist.artist_profile_id}
              type="button"
              onClick={() => selectArtist(artist)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-white/5 ${
                artistProfileId === artist.artist_profile_id ? 'text-[#FF3366]' : 'text-white/80'
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
              <div className="border-t border-white/10" />
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onAddArtist();
                }}
                className="flex w-full items-center gap-2 px-4 py-3 text-sm text-[#FF3366] hover:bg-white/5"
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
