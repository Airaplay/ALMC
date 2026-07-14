import { useState } from 'react';
import { X, Music, Disc3, Video } from 'lucide-react';
import SingleUploadForm from '../../components/SingleUploadForm';
import AlbumUploadForm from '../../components/AlbumUploadForm';
import VideoUploadForm from '../../components/VideoUploadForm';
import type { AdminUploadContext } from '../../lib/adminUploadContext';
import type { OrgArtistItem } from '../../lib/orgAccess';

type UploadType = 'single' | 'album' | 'video';

interface OrgContentUploadModalProps {
  organizationId: string;
  artist: OrgArtistItem;
  onClose: () => void;
  onSuccess: () => void;
}

const UPLOAD_OPTIONS: Array<{ id: UploadType; label: string; detail: string; icon: typeof Music }> = [
  { id: 'single', label: 'Single', detail: 'Upload one track', icon: Music },
  { id: 'album', label: 'Album / EP', detail: 'Upload a full project', icon: Disc3 },
  { id: 'video', label: 'Music Video', detail: 'Upload a video release', icon: Video },
];

export function OrgContentUploadModal({
  organizationId,
  artist,
  onClose,
  onSuccess,
}: OrgContentUploadModalProps) {
  const [selectedType, setSelectedType] = useState<UploadType | null>(null);

  const adminUploadContext: AdminUploadContext = {
    targetUserId: artist.user_id,
    targetDisplayName: artist.stage_name,
  };

  const handleSuccess = () => {
    onSuccess();
    onClose();
  };

  if (selectedType) {
    return (
      <div className="fixed inset-0 z-[200] bg-black/60">
        {selectedType === 'single' && (
          <SingleUploadForm
            adminUploadContext={adminUploadContext}
            onClose={() => setSelectedType(null)}
            onSuccess={handleSuccess}
          />
        )}
        {selectedType === 'album' && (
          <AlbumUploadForm
            adminUploadContext={adminUploadContext}
            onClose={() => setSelectedType(null)}
            onSuccess={handleSuccess}
          />
        )}
        {selectedType === 'video' && (
          <VideoUploadForm
            adminUploadContext={adminUploadContext}
            onClose={() => setSelectedType(null)}
            onSuccess={handleSuccess}
          />
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#141416] shadow-2xl">
        <div className="flex items-start justify-between border-b border-white/10 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-white/40">Upload content</p>
            <h3 className="mt-0.5 text-lg font-bold text-white">For {artist.stage_name}</h3>
            <p className="mt-1 text-sm text-white/50">Org: {organizationId.slice(0, 8)}…</p>
          </div>
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid gap-3 p-5">
          {UPLOAD_OPTIONS.map(({ id, label, detail, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSelectedType(id)}
              className="flex items-center gap-4 rounded-xl border border-white/10 bg-[#0f0f11] p-4 text-left hover:border-[#309605]/40"
            >
              <div className="rounded-lg bg-[#309605]/15 p-3">
                <Icon className="h-5 w-5 text-[#3ba208]" />
              </div>
              <div>
                <p className="font-semibold text-white">{label}</p>
                <p className="text-sm text-white/50">{detail}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
