import { useState } from 'react';
import { X, Music, Disc3, Video } from 'lucide-react';
import SingleUploadForm from '../SingleUploadForm';
import AlbumUploadForm from '../AlbumUploadForm';
import VideoUploadForm from '../VideoUploadForm';
import type { AdminUploadContext } from '../../lib/adminUploadContext';

type UploadType = 'single' | 'album' | 'video';

interface AdminUserContentUploadModalProps {
  user: {
    id: string;
    display_name?: string | null;
    email?: string;
  };
  onClose: () => void;
  onSuccess: () => void;
}

const UPLOAD_OPTIONS: Array<{ id: UploadType; label: string; detail: string; icon: typeof Music }> = [
  { id: 'single', label: 'Single', detail: 'Upload one track', icon: Music },
  { id: 'album', label: 'Album / EP', detail: 'Upload a full project', icon: Disc3 },
  { id: 'video', label: 'Music Video', detail: 'Upload a video release', icon: Video },
];

export const AdminUserContentUploadModal = ({
  user,
  onClose,
  onSuccess,
}: AdminUserContentUploadModalProps): JSX.Element => {
  const [selectedType, setSelectedType] = useState<UploadType | null>(null);

  const adminUploadContext: AdminUploadContext = {
    targetUserId: user.id,
    targetDisplayName: user.display_name || user.email || 'User',
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

  const displayName = user.display_name || user.email || 'User';

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-xl border border-gray-100 shadow-xl">
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Upload content</p>
            <h3 className="text-lg font-bold text-gray-900 mt-0.5">For {displayName}</h3>
            <p className="text-sm text-gray-500 mt-1">Choose what to upload to this creator&apos;s account.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
            aria-label="Close upload modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-2">
          {UPLOAD_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setSelectedType(option.id)}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-gray-200 hover:border-[#309605] hover:bg-green-50/50 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-[#309605]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{option.label}</p>
                  <p className="text-xs text-gray-500">{option.detail}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
