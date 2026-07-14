import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Music,
  Search,
  Plus,
  Trash2,
  Image as ImageIcon,
  Globe,
  Lock,
  Loader2,
  Check,
  ListMusic,
} from 'lucide-react';
import { supabase, addSongToPlaylist } from '../lib/supabase';
import { sanitizeForFilter } from '../lib/filterSecurity';
import { Link } from 'react-router-dom';
import { trackPlaylistCreated } from '../lib/contributionService';
import { NavigationBarSection } from '../screens/HomePlayer/sections/NavigationBarSection/NavigationBarSection';

interface CreatePlaylistModalProps {
  onClose: () => void;
  onSuccess: () => void;
  initialSongId?: string | null;
}

interface Song {
  id: string;
  title: string;
  artist_name: string;
  artistId?: string | null;
  duration_seconds: number;
  cover_image_url: string | null;
}

interface ArtistWithProfiles {
  id: string;
  name: string;
  artist_profiles?: { user_id: string }[];
}

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const inputCls =
  'w-full h-11 bg-white/[0.04] border border-white/[0.07] rounded-2xl px-4 text-white/90 text-sm outline-none focus:border-[#00ad74]/40 focus:bg-white/[0.06] transition-all font-["Inter",sans-serif] [color-scheme:dark]';

export const CreatePlaylistModal: React.FC<CreatePlaylistModalProps> = ({
  onClose,
  onSuccess,
  initialSongId,
}) => {
  const [formData, setFormData] = useState({ title: '', description: '' });
  const [isPublic, setIsPublic] = useState(true);
  const [selectedCoverFile, setSelectedCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [selectedSongs, setSelectedSongs] = useState<Song[]>([]);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const searchSongs = useCallback(
    async (query: string) => {
      if (!query.trim()) return;
      setIsSearching(true);
      try {
        const { data, error: err } = await supabase
          .from('songs')
          .select(
            `id, title, duration_seconds, cover_image_url, artist:artist_id(id, name, artist_profiles(user_id))`
          )
          .ilike('title', `%${sanitizeForFilter(query?.trim() || '')}%`)
          .limit(10);
        if (err) throw err;
        if (!data) {
          setSearchResults([]);
          return;
        }
        const formatted = (data as any[]).map((row) => {
          const artist = row.artist as ArtistWithProfiles;
          return {
            id: row.id,
            title: row.title,
            artist_name: artist?.name || 'Unknown Artist',
            artistId: artist?.artist_profiles?.[0]?.user_id ?? null,
            duration_seconds: row.duration_seconds ?? 0,
            cover_image_url: row.cover_image_url,
          };
        });
        const selectedIds = new Set(selectedSongs.map((s) => s.id));
        setSearchResults(formatted.filter((s) => !selectedIds.has(s.id)));
      } catch (e) {
        console.error('Error in song search:', e);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    },
    [selectedSongs]
  );

  useEffect(() => {
    return () => {
      if (coverPreviewUrl && coverPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(coverPreviewUrl);
      }
    };
  }, [coverPreviewUrl]);

  useEffect(() => {
    if (initialSongId) fetchInitialSong(initialSongId);
  }, [initialSongId]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (searchQuery.trim().length >= 2) searchSongs(searchQuery);
      else setSearchResults([]);
    }, 500);
    return () => clearTimeout(t);
  }, [searchQuery, searchSongs]);

  const fetchInitialSong = async (songId: string) => {
    try {
      const { data, error: err } = await supabase
        .from('songs')
        .select(
          `id, title, duration_seconds, cover_image_url, artist:artist_id(id, name, artist_profiles(user_id))`
        )
        .eq('id', songId)
        .single();
      if (err || !data) return;
      const artist = (data as any).artist as ArtistWithProfiles;
      setSelectedSongs([
        {
          id: data.id,
          title: data.title,
          artist_name: artist?.name || 'Unknown Artist',
          artistId: artist?.artist_profiles?.[0]?.user_id ?? null,
          duration_seconds: data.duration_seconds ?? 0,
          cover_image_url: data.cover_image_url,
        },
      ]);
    } catch (e) {
      console.error('Error fetching initial song:', e);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCoverFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setError('Please select a valid image (JPEG, PNG, or WebP).');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setError('Cover image must be under 5MB.');
      return;
    }
    setError(null);
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    setSelectedCoverFile(file);
    setCoverPreviewUrl(URL.createObjectURL(file));
  };

  const clearCover = () => {
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    setSelectedCoverFile(null);
    setCoverPreviewUrl(null);
  };

  const addSongToSelection = (song: Song) => {
    if (!selectedSongs.some((s) => s.id === song.id)) {
      setSelectedSongs((prev) => [...prev, song]);
    }
    setSearchQuery('');
    setSearchResults([]);
  };

  const removeSongFromSelection = (songId: string) => {
    setSelectedSongs((prev) => prev.filter((s) => s.id !== songId));
  };

  const uploadCoverFile = async (userId: string): Promise<{ url: string; storagePath: string } | null> => {
    if (!selectedCoverFile) return null;
    const ext = selectedCoverFile.name.split('.').pop() || 'jpg';
    const filePath = `${userId}/playlists/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('covers')
      .upload(filePath, selectedCoverFile, { cacheControl: '3600', upsert: true });
    if (uploadError) throw new Error(uploadError.message || 'Upload failed');
    const { data: { publicUrl } } = supabase.storage.from('covers').getPublicUrl(filePath);
    return { url: publicUrl, storagePath: filePath };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!formData.title.trim()) {
      setError('Playlist title is required');
      return;
    }
    setIsSubmitting(true);
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        throw new Error('Please sign in to continue.');
      }
      const userId = session.user.id;
      let coverResult = null;
      if (selectedCoverFile) coverResult = await uploadCoverFile(userId);
      const { data: playlistData, error: insertError } = await supabase
        .from('playlists')
        .insert({
          user_id: userId,
          title: formData.title.trim(),
          description: formData.description.trim() || null,
          cover_image_url: coverResult?.url ?? null,
          is_public: isPublic,
        })
        .select('id, title, description, cover_image_url, is_public, user_id, created_at')
        .single();
      if (insertError) throw new Error(insertError.message || 'Failed to create playlist.');
      if (selectedSongs.length > 0 && playlistData) {
        for (const song of selectedSongs) {
          await addSongToPlaylist(playlistData.id, song.id);
        }
      }
      if (playlistData) await trackPlaylistCreated(playlistData.id).catch(console.error);
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Error creating playlist:', err);
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: string }).message)
          : err instanceof Error
            ? err.message
            : 'Something went wrong.';
      setError(message || 'Something went wrong.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Ensure mini music player stays visible above this modal (see index.css: body.create-playlist-modal-open .mini-music-player)
  useEffect(() => {
    document.body.classList.add('create-playlist-modal-open');
    return () => document.body.classList.remove('create-playlist-modal-open');
  }, []);

  // When mini player is visible, add bottom space so action bar and nav aren't covered
  const [isMiniPlayerActive, setIsMiniPlayerActive] = useState(false);
  useEffect(() => {
    const checkMiniPlayer = () => {
      setIsMiniPlayerActive(document.body.classList.contains('mini-player-active'));
    };
    checkMiniPlayer();
    const observer = new MutationObserver(checkMiniPlayer);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const wrapperPaddingBottom = isMiniPlayerActive
    ? 'calc(72px + 4.5rem + env(safe-area-inset-bottom, 0px))' // nav bar + mini player height
    : 'calc(72px + env(safe-area-inset-bottom, 0px))';

  return (
    <div className="fixed inset-0 bg-[#0a0a0a] z-[110] flex flex-col overflow-hidden font-['Inter',sans-serif]">
      {/* Wrapper: reserve bottom space for in-modal nav bar (+ mini player when visible) */}
      <div
        className="flex-1 flex flex-col min-h-0 transition-[padding-bottom] duration-200"
        style={{ paddingBottom: wrapperPaddingBottom }}
      >
        {/* Header */}
        <header className="px-5 pt-6 pb-4 bg-[#0a0a0a]/90 backdrop-blur-xl border-b border-white/[0.04] flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-white/[0.05] border border-white/[0.07] flex items-center justify-center active:scale-[0.93] active:bg-white/[0.08] transition-all flex-shrink-0"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-white/70" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/35">New Playlist</p>
              <h1 className="font-black text-white text-xl tracking-tight leading-tight">
                Curate your collection.
              </h1>
            </div>
          </div>
        </header>

        {/* Scrollable body — pb-28 like SingleUploadForm so content clears action bar */}
        <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-hide pb-28">
        <form id="create-playlist-form" onSubmit={handleSubmit} className="px-5 py-5 pb-6 space-y-5">
          {/* Identity: Cover + Title + Description */}
          <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 font-['Inter',sans-serif] mb-4">
                Identity
              </p>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  className={`relative w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden flex-shrink-0 border-2 border-dashed transition-all flex items-center justify-center group ${
                    coverPreviewUrl ? 'border-transparent' : 'border-white/[0.12] hover:border-[#00ad74]/40'
                  }`}
                >
                  {coverPreviewUrl ? (
                    <>
                      <img src={coverPreviewUrl} alt="Cover" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <ImageIcon className="w-5 h-5 text-white" />
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          clearCover();
                        }}
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        aria-label="Remove cover"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 text-white/35">
                      <ImageIcon className="w-6 h-6" />
                      <span className="text-[10px] font-semibold uppercase tracking-widest">Cover</span>
                    </div>
                  )}
                </button>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp"
                  className="hidden"
                  onChange={handleCoverFileChange}
                />
                <div className="flex-1 min-w-0 space-y-3">
                  <div>
                    <label htmlFor="playlist-title" className="text-[10px] font-bold uppercase tracking-widest text-white/35 block mb-1.5">
                      Title <span className="text-[#00ad74]">*</span>
                    </label>
                    <input
                      id="playlist-title"
                      type="text"
                      name="title"
                      value={formData.title}
                      onChange={handleInputChange}
                      placeholder="My awesome playlist"
                      maxLength={100}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label htmlFor="playlist-desc" className="text-[10px] font-bold uppercase tracking-widest text-white/35 block mb-1.5">
                      Description
                    </label>
                    <textarea
                      id="playlist-desc"
                      name="description"
                      value={formData.description}
                      onChange={handleInputChange}
                      placeholder="What's this playlist about?"
                      maxLength={500}
                      rows={2}
                      className={`${inputCls} h-auto py-3 resize-none`}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Visibility */}
          <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 font-['Inter',sans-serif] mb-4">
                Visibility
              </p>
              <div className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                      isPublic ? 'bg-[#00ad74]/10' : 'bg-white/[0.06]'
                    }`}
                  >
                    {isPublic ? (
                      <Globe className="w-4 h-4 text-[#00ad74]" />
                    ) : (
                      <Lock className="w-4 h-4 text-white/40" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white font-['Inter',sans-serif]">
                      {isPublic ? 'Public' : 'Private'}
                    </p>
                    <p className="text-xs text-white/40 font-['Inter',sans-serif]">
                      {isPublic ? 'Anyone can find and listen' : 'Only you can see this playlist'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPublic(!isPublic)}
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    isPublic ? 'bg-[#00ad74]' : 'bg-white/20'
                  }`}
                  aria-label={isPublic ? 'Set to private' : 'Set to public'}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      isPublic ? 'translate-x-6' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Add Tracks */}
          <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 font-['Inter',sans-serif] mb-4">
                Add Tracks
              </p>
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search for songs…"
                  className={`${inputCls} pl-10`}
                />
                {isSearching && (
                  <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 animate-spin" />
                )}
              </div>

              {searchResults.length > 0 && (
                <div className="mt-3 rounded-2xl border border-white/[0.07] bg-[#0a0a0a] overflow-hidden max-h-56 overflow-y-auto">
                  {searchResults.map((song) => (
                    <button
                      key={song.id}
                      type="button"
                      onClick={() => addSongToSelection(song)}
                      className="w-full flex items-center gap-3 px-4 py-3 active:bg-white/[0.06] transition-colors text-left border-b border-white/[0.04] last:border-0"
                    >
                      <div className="w-10 h-10 rounded-xl overflow-hidden bg-white/[0.06] flex-shrink-0 flex items-center justify-center">
                        {song.cover_image_url ? (
                          <img src={song.cover_image_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Music className="w-4 h-4 text-white/30" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-white/90 truncate font-['Inter',sans-serif]">
                          {song.title}
                        </p>
                        <p className="text-[11px] text-white/40 truncate font-['Inter',sans-serif]">
                          {song.artist_name}
                        </p>
                      </div>
                      <span className="text-[11px] text-white/35 tabular-nums font-['Inter',sans-serif]">
                        {formatDuration(song.duration_seconds)}
                      </span>
                      <div className="w-7 h-7 rounded-full bg-[#00ad74]/15 flex items-center justify-center flex-shrink-0">
                        <Plus className="w-3.5 h-3.5 text-[#00ad74]" />
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {searchQuery.length >= 2 && !isSearching && searchResults.length === 0 && (
                <p className="text-[12px] text-white/40 text-center py-4 font-['Inter',sans-serif]">
                  No songs found for &quot;{searchQuery}&quot;
                </p>
              )}
            </div>
          </div>

          {/* Tracklist */}
          {selectedSongs.length > 0 && (
            <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
              <div className="px-5 pt-5 pb-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 font-['Inter',sans-serif]">
                    Tracklist
                  </p>
                  <span className="text-[11px] font-semibold text-white/40 tabular-nums font-['Inter',sans-serif]">
                    {selectedSongs.length} {selectedSongs.length === 1 ? 'track' : 'tracks'}
                  </span>
                </div>
                <div className="space-y-0.5 rounded-2xl border border-white/[0.06] overflow-hidden bg-white/[0.02]">
                  {selectedSongs.map((song, idx) => (
                    <div
                      key={song.id}
                      className="flex items-center gap-3 px-4 py-3 group border-b border-white/[0.04] last:border-0 active:bg-white/[0.04]"
                    >
                      <span className="w-5 text-center text-[11px] font-black tabular-nums text-white/25 flex-shrink-0 font-['Inter',sans-serif]">
                        {idx + 1}
                      </span>
                      <div className="w-10 h-10 rounded-xl overflow-hidden bg-white/[0.06] flex-shrink-0 flex items-center justify-center">
                        {song.cover_image_url ? (
                          <img src={song.cover_image_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Music className="w-4 h-4 text-white/30" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-white/90 truncate font-['Inter',sans-serif]">
                          {song.title}
                        </p>
                        <p className="text-[11px] text-white/40 truncate font-['Inter',sans-serif]">
                          {song.artistId ? (
                            <Link
                              to={`/user/${song.artistId}`}
                              className="hover:text-[#00ad74] transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {song.artist_name}
                            </Link>
                          ) : (
                            song.artist_name
                          )}
                        </p>
                      </div>
                      <span className="text-[11px] text-white/35 tabular-nums font-['Inter',sans-serif]">
                        {formatDuration(song.duration_seconds)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeSongFromSelection(song.id)}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 active:text-red-400 active:bg-red-500/10 flex-shrink-0 touch-manipulation"
                        aria-label="Remove song"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2.5 p-4 rounded-2xl bg-red-500/8 border border-red-500/20">
              <ListMusic className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-400 text-sm font-['Inter',sans-serif] leading-relaxed">{error}</p>
            </div>
          )}
        </form>
      </div>

        {/* Action bar — Cancel / Create (above bottom nav, like SingleUploadForm) */}
        <div className="flex-shrink-0 px-5 py-4 bg-[#0a0a0a] border-t border-white/[0.04]">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 py-4 rounded-2xl bg-white/[0.05] border border-white/[0.07] text-white/60 text-sm font-bold font-['Inter',sans-serif] active:scale-[0.98] disabled:opacity-40 transition-transform"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="create-playlist-form"
              disabled={isSubmitting || !formData.title.trim()}
              className="flex-1 py-4 rounded-2xl bg-[#00ad74] text-black text-sm font-black font-['Inter',sans-serif] flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-transform"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Create Playlist
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Bottom navigation bar — same as SingleUploadForm / app nav */}
      <NavigationBarSection />
    </div>
  );
};
