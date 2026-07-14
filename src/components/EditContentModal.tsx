import { useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { directUploadToBunny } from '../lib/directBunnyUpload';

interface ContentUpload {
  id: string;
  title: string;
  content_type: string;
  status: string;
  created_at: string;
  description?: string;
  metadata: {
    file_url?: string;
    file_name?: string;
    file_size?: number;
    file_type?: string;
    cover_url?: string;
    thumbnail_url?: string;
    audio_url?: string;
    song_id?: string;
    album_id?: string;
    duration_seconds?: number;
    release_date?: string;
    release_type?: string;
    genre_id?: string;
  };
}

interface EditContentModalProps {
  upload: ContentUpload;
  onClose: () => void;
  onSuccess: () => void;
  targetUserId?: string;
  theme?: 'default' | 'admin';
}

export const EditContentModal: React.FC<EditContentModalProps> = ({
  upload,
  onClose,
  onSuccess,
  targetUserId,
  theme = 'default',
}) => {
  const isAdminTheme = theme === 'admin';
  const initialReleaseDate = useMemo(() => {
    const raw = upload.metadata?.release_date;
    if (!raw || typeof raw !== 'string') return '';
    const [datePart] = raw.split('T');
    return datePart || '';
  }, [upload.metadata]);

  const initialReleaseTime = useMemo(() => {
    const raw = upload.metadata?.release_date;
    if (!raw || typeof raw !== 'string' || !raw.includes('T')) return '00:00';
    const [, timePart] = raw.split('T');
    return timePart ? timePart.slice(0, 5) : '00:00';
  }, [upload.metadata]);

  const [title, setTitle] = useState(upload.title ?? '');
  const [description, setDescription] = useState(upload.description ?? '');
  const [releaseDate, setReleaseDate] = useState(initialReleaseDate);
  const [releaseTime, setReleaseTime] = useState(initialReleaseTime);
  const [newArtworkFile, setNewArtworkFile] = useState<File | null>(null);
  const [newThumbnailFile, setNewThumbnailFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadThumbnailToSupabase = async (file: File, userId: string): Promise<string> => {
    const cleanName = file.name.replace(/\s+/g, '-');
    const path = `${userId}/${Date.now()}-${cleanName}`;
    const { data, error } = await supabase.storage.from('thumbnails').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });
    if (error) throw error;
    const { data: pub } = supabase.storage.from('thumbnails').getPublicUrl(data.path);
    return pub.publicUrl;
  };

  const handleSave = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Title is required.');
      return;
    }

    setIsSaving(true);
    setError(null);

    const nextReleaseDate = releaseDate
      ? `${releaseDate}T${(releaseTime || '00:00')}:00`
      : null;

    const nextMetadata: Record<string, any> = {
      ...(upload.metadata || {}),
      release_date: nextReleaseDate,
    };

    try {
      const { data: auth } = await supabase.auth.getSession();
      const session = auth.session;
      if (!session?.user) throw new Error('Authentication required.');
      const userId = targetUserId ?? session.user.id;

      if (upload.content_type === 'single') {
        if (newArtworkFile) {
          const art = await directUploadToBunny(newArtworkFile, {
            userId,
            contentType: 'image',
            customPath: 'covers',
          });
          if (!art.success || !art.publicUrl) throw new Error(art.error || 'Artwork upload failed.');
          nextMetadata.cover_url = art.publicUrl;
        }
      }

      if (upload.content_type === 'album' && newArtworkFile) {
        const art = await directUploadToBunny(newArtworkFile, {
          userId,
          contentType: 'image',
          customPath: 'albums/covers',
        });
        if (!art.success || !art.publicUrl) throw new Error(art.error || 'Album artwork upload failed.');
        nextMetadata.cover_url = art.publicUrl;
      }

      if (upload.content_type === 'video') {
        if (newThumbnailFile) {
          const thumbUrl = await uploadThumbnailToSupabase(newThumbnailFile, userId);
          nextMetadata.thumbnail_url = thumbUrl;
        }
      }

      const { error: contentError } = await supabase
        .from('content_uploads')
        .update({
          title: trimmedTitle,
          description: description.trim() || null,
          metadata: nextMetadata,
        })
        .eq('id', upload.id);

      if (contentError) throw contentError;

      if (upload.content_type === 'single' && upload.metadata?.song_id) {
        const { error: songError } = await supabase
          .from('songs')
          .update({
            title: trimmedTitle,
            release_date: releaseDate || null,
            audio_url: upload.metadata?.audio_url || upload.metadata?.file_url || undefined,
            cover_image_url: nextMetadata.cover_url || undefined,
          })
          .eq('id', upload.metadata.song_id);
        if (songError) throw songError;
      }

      if (upload.content_type === 'album' && upload.metadata?.album_id) {
        const { error: albumError } = await supabase
          .from('albums')
          .update({
            title: trimmedTitle,
            description: description.trim() || null,
            release_date: releaseDate || null,
            cover_image_url: nextMetadata.cover_url || undefined,
          })
          .eq('id', upload.metadata.album_id);
        if (albumError) throw albumError;
      }

      onSuccess();
    } catch (e: any) {
      setError(e?.message || 'Failed to save changes.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-[120] flex items-end sm:items-center justify-center ${isAdminTheme ? 'bg-black/50' : 'bg-black/70 backdrop-blur-sm'}`}>
      <div className={`w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 ${
        isAdminTheme
          ? 'bg-white border border-gray-100 shadow-xl text-gray-900'
          : 'bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] border border-white/10 text-white'
      }`}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className={`text-[10px] font-bold tracking-[0.2em] uppercase ${isAdminTheme ? 'text-gray-400' : 'text-white/50'}`}>Edit Upload</p>
            <h2 className="text-2xl font-black tracking-tight mt-1">Update details</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`p-2 rounded-full transition-colors ${isAdminTheme ? 'hover:bg-gray-100 text-gray-500' : 'hover:bg-white/10'}`}
            aria-label="Close edit modal"
          >
            <X className={`w-5 h-5 ${isAdminTheme ? 'text-gray-500' : 'text-white/70'}`} />
          </button>
        </div>

        <p className={`text-xs mb-5 ${isAdminTheme ? 'text-gray-500' : 'text-white/50'}`}>You can update details and optionally replace media files.</p>

        <div className="space-y-4">
          <div>
            <label className={`block text-xs font-bold uppercase tracking-[0.1em] mb-2 ${isAdminTheme ? 'text-gray-500' : 'text-white/60'}`}>Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={`w-full h-12 px-4 rounded-xl border text-sm focus:outline-none ${
                isAdminTheme
                  ? 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-[#309605]'
                  : 'bg-white/5 border-white/10 text-white placeholder-white/40 focus:border-white/30'
              }`}
              placeholder="Content title"
            />
          </div>

          <div>
            <label className={`block text-xs font-bold uppercase tracking-[0.1em] mb-2 ${isAdminTheme ? 'text-gray-500' : 'text-white/60'}`}>Description</label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`w-full px-4 py-3 rounded-xl border text-sm resize-none focus:outline-none ${
                isAdminTheme
                  ? 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-[#309605]'
                  : 'bg-white/5 border-white/10 text-white placeholder-white/40 focus:border-white/30'
              }`}
              placeholder="Optional description"
            />
          </div>

          <div>
            <label className={`block text-xs font-bold uppercase tracking-[0.1em] mb-2 ${isAdminTheme ? 'text-gray-500' : 'text-white/60'}`}>Release schedule</label>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="date"
                value={releaseDate}
                onChange={(e) => setReleaseDate(e.target.value)}
                className={`w-full h-12 px-4 rounded-xl border text-sm focus:outline-none ${
                  isAdminTheme
                    ? 'bg-gray-50 border-gray-200 text-gray-900 focus:ring-2 focus:ring-[#309605]'
                    : 'bg-white/5 border-white/10 text-white focus:border-white/30'
                }`}
              />
              <input
                type="time"
                value={releaseTime}
                onChange={(e) => setReleaseTime(e.target.value || '00:00')}
                disabled={!releaseDate}
                className={`w-full h-12 px-4 rounded-xl border text-sm focus:outline-none disabled:opacity-40 ${
                  isAdminTheme
                    ? 'bg-gray-50 border-gray-200 text-gray-900 focus:ring-2 focus:ring-[#309605]'
                    : 'bg-white/5 border-white/10 text-white focus:border-white/30'
                }`}
              />
            </div>
          </div>

          {upload.content_type === 'single' && (
            <>
              <div>
                <label className={`block text-xs font-bold uppercase tracking-[0.1em] mb-2 ${isAdminTheme ? 'text-gray-500' : 'text-white/60'}`}>Song audio</label>
                <div className={`w-full rounded-xl border px-4 py-3 text-sm ${isAdminTheme ? 'border-gray-200 bg-gray-50 text-gray-500' : 'border-white/10 bg-white/5 text-white/50'}`}>
                  Uploaded audio cannot be changed or reuploaded.
                </div>
              </div>
              <div>
                <label className={`block text-xs font-bold uppercase tracking-[0.1em] mb-2 ${isAdminTheme ? 'text-gray-500' : 'text-white/60'}`}>Replace cover artwork (optional)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setNewArtworkFile(e.target.files?.[0] || null)}
                  className={`w-full text-sm ${isAdminTheme ? 'text-gray-600 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200' : 'text-white/70 file:bg-white/10 file:text-white hover:file:bg-white/20'} file:mr-4 file:rounded-lg file:border-0 file:px-3 file:py-2`}
                />
              </div>
            </>
          )}

          {upload.content_type === 'album' && (
            <div>
              <label className={`block text-xs font-bold uppercase tracking-[0.1em] mb-2 ${isAdminTheme ? 'text-gray-500' : 'text-white/60'}`}>Replace album artwork (optional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setNewArtworkFile(e.target.files?.[0] || null)}
                className={`w-full text-sm ${isAdminTheme ? 'text-gray-600 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200' : 'text-white/70 file:bg-white/10 file:text-white hover:file:bg-white/20'} file:mr-4 file:rounded-lg file:border-0 file:px-3 file:py-2`}
              />
            </div>
          )}

          {upload.content_type === 'video' && (
            <>
              <div>
                <label className={`block text-xs font-bold uppercase tracking-[0.1em] mb-2 ${isAdminTheme ? 'text-gray-500' : 'text-white/60'}`}>Video file</label>
                <div className={`w-full rounded-xl border px-4 py-3 text-sm ${isAdminTheme ? 'border-gray-200 bg-gray-50 text-gray-500' : 'border-white/10 bg-white/5 text-white/50'}`}>
                  Uploaded video cannot be changed or reuploaded.
                </div>
              </div>
              <div>
                <label className={`block text-xs font-bold uppercase tracking-[0.1em] mb-2 ${isAdminTheme ? 'text-gray-500' : 'text-white/60'}`}>Replace thumbnail (optional)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setNewThumbnailFile(e.target.files?.[0] || null)}
                  className={`w-full text-sm ${isAdminTheme ? 'text-gray-600 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200' : 'text-white/70 file:bg-white/10 file:text-white hover:file:bg-white/20'} file:mr-4 file:rounded-lg file:border-0 file:px-3 file:py-2`}
                />
              </div>
            </>
          )}

          {error && (
            <div className={`rounded-xl border px-4 py-3 text-sm ${isAdminTheme ? 'border-red-200 bg-red-50 text-red-600' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
              {error}
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className={`flex-1 h-12 rounded-xl border transition-all disabled:opacity-50 ${
              isAdminTheme
                ? 'border-gray-200 text-gray-600 hover:bg-gray-50'
                : 'border-white/15 text-white/80 hover:text-white hover:bg-white/10'
            }`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className={`flex-1 h-12 rounded-xl text-white font-semibold transition-all disabled:opacity-60 inline-flex items-center justify-center gap-2 ${
              isAdminTheme ? 'bg-[#309605] hover:bg-[#3ba208]' : 'bg-[#00ad74] hover:bg-[#009c68]'
            }`}
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
};