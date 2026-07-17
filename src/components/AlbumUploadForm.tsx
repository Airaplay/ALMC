import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Disc3, Image as ImageIcon, Loader2, Calendar as CalendarIcon,
  Plus, X, Music2, CheckCircle2, ChevronRight, Upload, FileAudio, AlertCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase, getArtistProfile } from '../lib/supabase';
import { directUploadToBunny } from '../lib/directBunnyUpload';
import {
  validateAudioFile,
  validateImageFile,
  createSafeFilePath,
  ALLOWED_AUDIO_EXTENSIONS,
  ALLOWED_IMAGE_EXTENSIONS,
} from '../lib/fileSecurity';
import { compressAlbumCover } from '../lib/imageOptimization';
import { cache } from '../lib/cache';
import { smartCache } from '../lib/smartCache';
import { useUpload } from '../contexts/UploadContext';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from '../hooks/useLocation';
import { ParallelUploadManager } from '../lib/parallelUploadManager';
import { cn } from '../lib/utils';
import { AdminUploadContext, resolveContentOwnerUserId } from '../lib/adminUploadContext';
import { ConsoleUploadEmbed, ContentReleaseAction, resolveContentUploadStatus } from '../lib/consoleUploadEmbed';

/* ─── Types ─── */
interface Genre { id: string; name: string; }
interface Subgenre { id: string; name: string; parent_genre_id: string; }
interface Mood { id: string; name: string; description?: string; }
interface ArtistProfile { id: string; stage_name: string; artist_id: string | null; bio?: string; profile_photo_url?: string; is_verified?: boolean; }
interface TrackEntry {
  id: string;
  title: string;
  featuredArtist: string;
  audioFile: File | null;
}

let trackIdCounter = 0;
const newTrack = (): TrackEntry => ({ id: `track-${++trackIdCounter}`, title: '', featuredArtist: '', audioFile: null });

/* ─── Step config ─── */
const STEPS = ['Tracks', 'Details', 'Metadata'] as const;
type Step = 0 | 1 | 2;

interface AlbumUploadFormProps {
  onClose: () => void;
  onSuccess?: () => void;
  initialData?: any;
  adminUploadContext?: AdminUploadContext;
  consoleEmbed?: ConsoleUploadEmbed;
}

export default function AlbumUploadForm({ onClose, onSuccess, initialData, adminUploadContext, consoleEmbed }: AlbumUploadFormProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { location } = useLocation(true);
  const { addUpload, updateUploadProgress, updateUploadStatus } = useUpload();
  const mountedRef = useRef(true);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const [artistProfile, setArtistProfile] = useState<ArtistProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [currentStep, setCurrentStep] = useState<Step>(0);

  const [albumTitle, setAlbumTitle] = useState('');
  const [description, setDescription] = useState('');
  const [releaseDate, setReleaseDate] = useState<Date | undefined>();
  const [releaseTime, setReleaseTime] = useState<string>('00:00');
  const [genreId, setGenreId] = useState('');
  const [subgenreId, setSubgenreId] = useState('');
  const [selectedMoods, setSelectedMoods] = useState<string[]>([]);

  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [tracks, setTracks] = useState<TrackEntry[]>([newTrack()]);

  const [genres, setGenres] = useState<Genre[]>([]);
  const [subgenres, setSubgenres] = useState<Subgenre[]>([]);
  const [moods, setMoods] = useState<Mood[]>([]);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploadTaskId, setUploadTaskId] = useState<string | null>(null);
  const [compressionStatus, setCompressionStatus] = useState<string | null>(null);

  const filteredSubgenres = genreId ? subgenres.filter((s) => s.parent_genre_id === genreId) : [];
  useEffect(() => { setSubgenreId(''); }, [genreId]);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    consoleEmbed?.onStepChange?.(currentStep);
  }, [currentStep, consoleEmbed]);

  useEffect(() => {
    consoleEmbed?.onTitleChange?.(albumTitle);
  }, [albumTitle, consoleEmbed]);

  const ownerUserId = resolveContentOwnerUserId(adminUploadContext, user?.id);

  useEffect(() => {
    if (!adminUploadContext && !user) return;
    if (!ownerUserId) {
      if (mountedRef.current) setLoadingProfile(false);
      return;
    }
    (async () => {
      try {
        let profile = adminUploadContext ? null : await getArtistProfile();
        if (!mountedRef.current) return;
        if (!profile && adminUploadContext?.artistProfileId) {
          const { data } = await supabase
            .from('artist_profiles')
            .select('id, stage_name, artist_id, bio, profile_photo_url, is_verified')
            .eq('id', adminUploadContext.artistProfileId)
            .maybeSingle();
          if (data) profile = data;
        }
        if (profile) setArtistProfile({ id: profile.id, stage_name: profile.stage_name, artist_id: profile.artist_id ?? null, bio: profile.bio, profile_photo_url: profile.profile_photo_url, is_verified: profile.is_verified });
        else {
          const { data } = await supabase.from('artist_profiles').select('id, stage_name, artist_id, bio, profile_photo_url, is_verified').eq('user_id', ownerUserId).maybeSingle();
          if (data) setArtistProfile({ id: data.id, stage_name: data.stage_name, artist_id: data.artist_id ?? null, bio: data.bio, profile_photo_url: data.profile_photo_url, is_verified: data.is_verified });
        }
      } finally {
        if (mountedRef.current) setLoadingProfile(false);
      }
    })();
  }, [user, adminUploadContext, ownerUserId]);

  useEffect(() => {
    (async () => {
      const [g, s, m] = await Promise.all([
        supabase.from('genres').select('id, name').order('name'),
        supabase.from('subgenres').select('id, name, parent_genre_id').eq('is_active', true).order('display_order'),
        supabase.from('mood_categories').select('id, name, description').eq('is_active', true).order('name'),
      ]);
      if (!mountedRef.current) return;
      if (g.data) setGenres(g.data);
      if (s.data) setSubgenres(s.data);
      if (m.data) setMoods(m.data);
    })();
  }, []);

  useEffect(() => {
    return () => {
      if (coverPreview && coverPreview.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

  const handleCoverChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setError(validation.error || 'Invalid image file.');
      return;
    }
    setError(null);
    setCompressionStatus('Compressing cover...');
    try {
      const result = await compressAlbumCover(file, 1200, 200, (s) => setCompressionStatus(s));
      setCoverFile(result.file);
      setCompressionStatus(null);
      if (coverPreview) URL.revokeObjectURL(coverPreview);
      setCoverPreview(URL.createObjectURL(result.file));
    } catch {
      setError('Failed to compress image.');
      setCompressionStatus(null);
    }
  };

  const toggleMood = (moodId: string) =>
    setSelectedMoods((prev) => (prev.includes(moodId) ? prev.filter((id) => id !== moodId) : [...prev, moodId]));

  const updateTrack = (id: string, field: keyof TrackEntry, value: string | File | null) =>
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));

  const removeTrack = (id: string) =>
    setTracks((prev) => (prev.length <= 1 ? prev : prev.filter((t) => t.id !== id)));

  const addTrack = () => setTracks((prev) => [...prev, newTrack()]);

  const validTracks = tracks.filter((t) => t.title.trim() && t.audioFile);
  const canProceedStep0 = validTracks.length > 0 && !!coverFile;
  const canProceedStep1 = albumTitle.trim().length > 0;
  const canSubmit = canProceedStep0 && canProceedStep1 && !!genreId;

  const stepCompleteness = currentStep === 0
    ? (validTracks.length > 0 && coverFile ? 100 : validTracks.length > 0 ? 50 : 0)
    : currentStep === 1
    ? (albumTitle ? 100 : 0)
    : genreId ? 80 : 20;

  const getAudioDuration = (audioUrl: string): Promise<number> =>
    new Promise((resolve) => {
      const audio = new Audio(audioUrl);
      audio.onloadedmetadata = () => resolve(audio.duration);
      audio.onerror = () => resolve(0);
      audio.load();
    });

  const uploadFile = useCallback(async (file: File, path: string, taskId?: string): Promise<string> => {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) throw new Error('Authentication required');
    const uploadUserId = ownerUserId ?? session.user.id;
    let contentType: 'audio' | 'image' | 'video' = file.type.startsWith('image/') ? 'image' : 'audio';
    let customPath = contentType === 'image' ? 'covers' : 'audio';
    const result = await directUploadToBunny(file, {
      userId: uploadUserId,
      contentType,
      customPath,
      organizationId: adminUploadContext?.organizationId,
      onProgress: (percent) => {
        setCompressionStatus(`Uploading: ${percent.toFixed(0)}%`);
        const tid = taskId || uploadTaskId;
        if (tid) updateUploadProgress(tid, percent);
      },
    });
    setCompressionStatus(null);
    if (!result.success || !result.publicUrl) throw new Error(result.error || 'Upload failed');
    return result.publicUrl;
  }, [uploadTaskId, updateUploadProgress, ownerUserId, adminUploadContext?.organizationId]);

  const handleUpload = async (releaseAction: ContentReleaseAction = 'publish') => {
    if (!ownerUserId || !artistProfile) return;
    if (releaseAction === 'schedule' && !releaseDate) {
      setError('Pick a release date to schedule this album.');
      return;
    }
    setError(null);
    setUploading(true);
    setUploadProgress(5);
    const taskId = `album-${Date.now()}`;
    setUploadTaskId(taskId);
    addUpload({ id: taskId, type: 'album', title: albumTitle.trim() });

    type AudioFile = { file: File; id: string; title: string; featuredArtists: string[] };
    const audioFiles: AudioFile[] = validTracks.map((t) => ({
      file: t.audioFile!,
      id: t.id,
      title: t.title.trim(),
      featuredArtists: t.featuredArtist.trim() ? [t.featuredArtist.trim()] : [],
    }));
    const releaseDateStr = releaseDate ? format(releaseDate, 'yyyy-MM-dd') : null;
    const releaseDateTimeStr = releaseDate ? (releaseTime ? `${format(releaseDate, 'yyyy-MM-dd')}T${releaseTime}:00` : format(releaseDate, 'yyyy-MM-dd')) : null;
    const formData = { title: albumTitle.trim(), description: description.trim(), releaseDate: releaseDateStr, releaseDateTime: releaseDateTimeStr, genre: genres.find((g) => g.id === genreId)?.name ?? '' };

    try {
      let finalArtistId = artistProfile.artist_id;
      if (!finalArtistId) {
        const { data: existing } = await supabase.from('artists').select('id').ilike('name', artistProfile.stage_name).maybeSingle();
        if (existing) {
          finalArtistId = existing.id;
          await supabase.from('artist_profiles').update({ artist_id: existing.id }).eq('id', artistProfile.id);
        } else {
          const { data: newArtist, error: createErr } = await supabase.from('artists').insert({
            name: artistProfile.stage_name,
            bio: artistProfile.bio,
            image_url: artistProfile.profile_photo_url,
            verified: artistProfile.is_verified || false,
          }).select('id').single();
          if (createErr || !newArtist) throw new Error(createErr?.message || 'Failed to create artist');
          finalArtistId = newArtist.id;
          await supabase.from('artist_profiles').update({ artist_id: newArtist.id }).eq('id', artistProfile.id);
        }
      }

      setUploadProgress(10);
      const coverPath = createSafeFilePath(ownerUserId, 'albums/covers', coverFile!.name, ALLOWED_IMAGE_EXTENSIONS);
      if (!coverPath) throw new Error('Invalid cover image');
      const coverImageUrl = await uploadFile(coverFile!, coverPath, taskId);

      setUploadProgress(15);
      const { data: albumData, error: albumErr } = await supabase.from('albums').insert({
        title: formData.title,
        artist_id: finalArtistId,
        cover_image_url: coverImageUrl,
        release_date: formData.releaseDate,
        description: formData.description || null,
      }).select('id').single();
      if (albumErr) throw new Error(`Failed to create album: ${albumErr.message}`);

      if (genreId) {
        await supabase.from('album_genres').insert({ album_id: albumData.id, genre_id: genreId });
        if (subgenreId) await supabase.from('album_subgenres').insert({ album_id: albumData.id, subgenre_id: subgenreId });
        if (selectedMoods.length > 0) await supabase.from('album_moods').insert(selectedMoods.map((mood_id) => ({ album_id: albumData.id, mood_id })));
      }

      const filesToUpload = audioFiles.map((af) => {
        const path = createSafeFilePath(ownerUserId, `albums/${albumData.id}/songs`, af.file.name, ALLOWED_AUDIO_EXTENSIONS);
        return path ? { file: af.file, path, audioFile: af } : null;
      }).filter(Boolean) as Array<{ file: File; path: string; audioFile: AudioFile }>;

      const uploadManager = new ParallelUploadManager({
        maxConcurrency: 3,
        maxRetries: 3,
        uploadFunction: (file, path, onProgress) => uploadFile(file, path, taskId),
        onProgress: (p) => {
          setUploadProgress(15 + Math.round((p.completedFiles / p.totalFiles) * 65));
          updateUploadProgress(taskId, 15 + (p.completedFiles / p.totalFiles) * 65);
        },
        onFileFailed: (t) => console.error('Upload failed:', t.file.name),
      });
      uploadManager.addFiles(filesToUpload.map((item) => ({ file: item.file, path: item.path })));
      await uploadManager.uploadAll();

      const successfulUploads = uploadManager.getCompletedUploads();
      const songInserts = await Promise.all(
        successfulUploads.map(async (uploadTask) => {
          const item = filesToUpload.find((i) => i.file === uploadTask.file);
          if (!item || !uploadTask.result) return null;
          const duration = await getAudioDuration(uploadTask.result);
          return {
            title: item.audioFile.title,
            artist_id: finalArtistId,
            album_id: albumData.id,
            duration_seconds: Math.round(duration),
            audio_url: uploadTask.result,
            cover_image_url: coverImageUrl,
            release_date: formData.releaseDate,
            country: location?.location?.countryCode || null,
            featured_artists: item.audioFile.featuredArtists.length > 0 ? item.audioFile.featuredArtists : null,
          };
        })
      );
      const validInserts = songInserts.filter(Boolean);
      const songIds: string[] = [];
      if (validInserts.length > 0) {
        const { data: songsData, error: songsErr } = await supabase.from('songs').insert(validInserts).select('id');
        if (songsErr) throw new Error(`Failed to create songs: ${songsErr.message}`);
        songIds.push(...(songsData?.map((s) => s.id) ?? []));
        if (genreId && songsData?.length) {
          await supabase.from('song_genres').insert(songsData.map((s) => ({ song_id: s.id, genre_id: genreId })));
          if (subgenreId) await supabase.from('song_subgenres').insert(songsData.map((s) => ({ song_id: s.id, subgenre_id: subgenreId })));
          if (selectedMoods.length > 0) {
            await supabase.from('song_moods').insert(
              songsData.flatMap((s) => selectedMoods.map((mood_id) => ({ song_id: s.id, mood_id, confidence_score: 1.0 })))
            );
          }
        }
      }

      setUploadProgress(95);
      const uploadStatus = resolveContentUploadStatus(releaseAction, releaseDate);
      const { error: contentErr } = await supabase.from('content_uploads').insert({
        user_id: ownerUserId,
        artist_profile_id: artistProfile.id,
        content_type: 'album',
        title: formData.title,
        description: formData.description || null,
        status: uploadStatus,
        metadata: {
          album_id: albumData.id,
          cover_url: coverImageUrl,
          song_ids: songIds,
          tracks_count: songIds.length,
          release_date: formData.releaseDateTime ?? formData.releaseDate,
          genre: formData.genre || null,
          release_action: releaseAction,
          featured_artists: audioFiles.reduce((acc, af) => {
            if (af.featuredArtists.length) acc[af.title] = af.featuredArtists;
            return acc;
          }, {} as Record<string, string[]>),
          ...(adminUploadContext?.organizationId
            ? { uploaded_by_org_id: adminUploadContext.organizationId }
            : {}),
        },
      });
      if (contentErr) throw new Error(`Album created but failed to add to Library: ${contentErr.message}`);

      setUploadProgress(100);
      updateUploadStatus(taskId, 'completed');
      cache.deletePattern('library.*');
      cache.deletePattern('uploads.*');
      cache.deletePattern('home.*');
      cache.deletePattern('trending.*');
      cache.deletePattern('explore.*');
      await smartCache.invalidate('library.*');
      await smartCache.invalidate('uploads.*');
      await smartCache.invalidate('home.*');
      await smartCache.invalidate('explore.*');

      setTimeout(() => { onSuccess?.(); onClose(); }, 1500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      updateUploadStatus(taskId, 'error', msg);
    } finally {
      if (mountedRef.current) {
        setUploading(false);
        setUploadProgress(0);
      }
    }
  };

  if (loadingProfile) {
    return (
      <div className="flex flex-col min-h-screen min-h-[100dvh] bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      </div>
    );
  }
  if (!adminUploadContext && !user) {
    navigate('/');
    return null;
  }
  if (!artistProfile) {
    return (
      <div className="flex flex-col min-h-screen min-h-[100dvh] overflow-y-auto bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav font-['Inter',sans-serif]">
        <div className="flex-1 flex flex-col items-center justify-center gap-5 px-3">
          <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center">
            <Disc3 className="w-7 h-7 text-white/60" />
          </div>
          <div className="text-center space-y-1.5">
            <h2 className="text-xl font-semibold tracking-tight text-white">Artist profile required</h2>
            <p className="text-sm text-white/60 max-w-xs">
              {adminUploadContext
                ? `${adminUploadContext.targetDisplayName || 'This user'} needs an artist profile before content can be uploaded.`
                : 'Register as an artist to upload albums.'}
            </p>
          </div>
          {adminUploadContext ? (
            <button onClick={onClose} className="px-6 py-3 bg-white/10 hover:bg-white/15 text-white rounded-full font-medium transition-all active:scale-95">
              Go back
            </button>
          ) : (
            <button
              onClick={() => navigate('/become-artist')}
              className="px-6 py-3 bg-[#00ad74] hover:bg-[#009c68] active:bg-[#008a5d] text-white rounded-full font-medium transition-all active:scale-95"
            >
              Become a creator
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      consoleEmbed?.hideChrome
        ? "flex flex-col text-white font-['Inter',sans-serif]"
        : "flex flex-col min-h-screen min-h-[100dvh] overflow-y-auto bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav font-['Inter',sans-serif]"
    )}>
      {!consoleEmbed?.hideChrome && (
      <header className="w-full py-5 px-5 sticky top-0 z-20 flex-shrink-0 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onClose}
            className="p-2 -ml-2 hover:bg-white/10 rounded-full transition-all touch-manipulation flex-shrink-0"
            aria-label="Back"
          >
            <ArrowLeft className="w-6 h-6 text-white" />
          </button>
          <h1 className="font-['Inter',sans-serif] text-3xl font-black tracking-tight text-white leading-none">
            Curate your<br />
            <span className="font-light italic text-white/60">collection.</span>
          </h1>
        </div>
      </header>
      )}
      <div className={cn('flex-1 min-h-0 overflow-y-auto scrollbar-hide space-y-8 w-full', consoleEmbed?.hideChrome ? 'py-1' : 'px-5 py-5 pb-28')}>
        {!consoleEmbed?.hideChrome && (
        <div>
          <div className="flex items-center gap-0 mb-3">
            {STEPS.map((label, i) => {
              const isActive = i === currentStep;
              const isDone = i < currentStep;
              return (
                <div key={label} className="flex items-center flex-1 last:flex-none">
                  <button
                    type="button"
                    onClick={() => i < currentStep && setCurrentStep(i as Step)}
                    disabled={i > currentStep}
                    className={cn(
                      'flex items-center gap-2 text-xs font-semibold transition-colors min-h-[44px] touch-manipulation',
                      isActive && 'text-white',
                      isDone && 'text-white cursor-pointer',
                      !isActive && !isDone && 'text-white/30 cursor-default'
                    )}
                  >
                    <span
                      className={cn(
                        'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all',
                        isActive && 'bg-[#00ad74] text-white ring-2 ring-[#00ad74]/30 ring-offset-2 ring-offset-[#0a0a0a]',
                        isDone && 'bg-[#00ad74]/20 text-[#00ad74]',
                        !isActive && !isDone && 'bg-white/10 text-white/30'
                      )}
                    >
                      {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
                    </span>
                    {label}
                  </button>
                  {i < STEPS.length - 1 && (
                    <div className={cn('flex-1 h-px mx-3', i < currentStep ? 'bg-[#00ad74]/40' : 'bg-white/10')} />
                  )}
                </div>
              );
            })}
          </div>
          <div className="h-0.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#00ad74] rounded-full transition-all duration-500"
              style={{ width: `${(currentStep / (STEPS.length - 1)) * 100 + stepCompleteness / (STEPS.length * 10)}%` }}
            />
          </div>
        </div>
        )}

        {/* Step 0 — Tracks + Cover */}
        {currentStep === 0 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            {consoleEmbed?.hideChrome && (
              <button
                type="button"
                onClick={() => consoleEmbed.onExitFirstStep?.()}
                className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to content type
              </button>
            )}
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight text-white">Upload your files</h2>
              <p className="text-sm text-white/60">Add cover art and at least one track with audio.</p>
            </div>

            <div className="flex gap-4 items-start">
              <div className="flex-shrink-0">
                <label className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block mb-2">Album cover</label>
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  className={cn(
                    'relative w-32 h-32 sm:w-40 sm:h-40 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center overflow-hidden transition-all',
                    coverPreview ? 'border-[#00ad74]/40 bg-transparent' : 'border-white/10 hover:border-[#00ad74]/40 hover:bg-[#00ad74]/5'
                  )}
                >
                  {coverPreview ? (
                    <>
                      <img src={coverPreview} alt="Cover" className="w-full h-full object-cover" />
                      <span className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 flex items-center justify-center text-xs font-medium">Change</span>
                    </>
                  ) : (
                    <>
                      <ImageIcon className="w-8 h-8 text-white/40 mb-1" />
                      <span className="text-[11px] text-white/60">Tap to upload</span>
                    </>
                  )}
                </button>
                <p className="text-[10px] text-white/50 mt-1">Min 500×500px</p>
                <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverChange} />
              </div>
              <div className="flex-1 min-w-0 pt-8">
                {coverFile ? (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-[#00ad74]/10 border border-[#00ad74]/20">
                    <CheckCircle2 className="w-4 h-4 text-[#00ad74] flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{coverFile.name}</p>
                      <p className="text-[11px] text-white/60">{(coverFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl border border-dashed border-white/10 bg-white/5">
                    <p className="text-xs text-white/60">No cover selected</p>
                    <p className="text-[11px] text-white/40 mt-0.5">Cover art is required</p>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white">Tracks</h3>
                  <p className="text-xs text-white/60 mt-0.5">At least one track with audio</p>
                </div>
                <button type="button" onClick={addTrack} className="flex items-center gap-1.5 text-xs font-semibold text-[#00ad74] hover:text-[#00ad74]/80 touch-manipulation">
                  <Plus className="w-3.5 h-3.5" /> Add track
                </button>
              </div>

              <div className="space-y-3">
                {tracks.map((track, idx) => (
                  <div
                    key={track.id}
                    className={cn(
                      'rounded-2xl border p-4 space-y-3 transition-all',
                      track.title && track.audioFile ? 'border-[#00ad74]/20 bg-[#00ad74]/5' : 'border-white/10 bg-white/5'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold',
                            track.title && track.audioFile ? 'bg-[#00ad74] text-white' : 'bg-white/10 text-white/40'
                          )}
                        >
                          {track.title && track.audioFile ? <CheckCircle2 className="w-3.5 h-3.5" /> : idx + 1}
                        </span>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-white/50">Track {idx + 1}</span>
                      </div>
                      {tracks.length > 1 && (
                        <button type="button" onClick={() => removeTrack(track.id)} className="p-1.5 rounded-lg text-white/50 hover:text-red-400 hover:bg-red-500/10 touch-manipulation">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <input
                        type="text"
                        placeholder="Track title *"
                        value={track.title}
                        onChange={(e) => updateTrack(track.id, 'title', e.target.value)}
                        className="w-full min-h-[44px] bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white placeholder:text-white/40 focus:ring-2 focus:ring-[#00ad74]/20 focus:border-[#00ad74]/30 outline-none transition-all"
                      />
                      <input
                        type="text"
                        placeholder="Featured artist (optional)"
                        value={track.featuredArtist}
                        onChange={(e) => updateTrack(track.id, 'featuredArtist', e.target.value)}
                        className="w-full min-h-[44px] bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white placeholder:text-white/40 focus:ring-2 focus:ring-[#00ad74]/20 focus:border-[#00ad74]/30 outline-none transition-all"
                      />
                    </div>
                    <label
                      className={cn(
                        'flex items-center gap-3 rounded-xl border border-dashed p-3.5 cursor-pointer transition-all min-h-[44px] touch-manipulation',
                        track.audioFile ? 'border-[#00ad74]/30 bg-[#00ad74]/5' : 'border-white/10 hover:border-[#00ad74]/40 hover:bg-[#00ad74]/5'
                      )}
                    >
                      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', track.audioFile ? 'bg-[#00ad74]/20' : 'bg-white/10')}>
                        {track.audioFile ? <CheckCircle2 className="w-4 h-4 text-white" /> : <FileAudio className="w-4 h-4 text-white/40" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-white truncate">{track.audioFile ? track.audioFile.name : 'Upload audio'}</p>
                        <p className="text-[11px] text-white/60">{track.audioFile ? `${(track.audioFile.size / 1024 / 1024).toFixed(2)} MB` : 'MP3, WAV, FLAC, AAC'}</p>
                      </div>
                      <input
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            const validation = validateAudioFile(f);
                            if (validation.valid) updateTrack(track.id, 'audioFile', f);
                            else setError(validation.error ?? 'Invalid audio');
                          }
                        }}
                      />
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {compressionStatus && (
              <div className="rounded-xl border border-[#00ad74]/30 bg-[#00ad74]/10 p-4 flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-[#00ad74]" />
                <p className="text-sm text-white">{compressionStatus}</p>
              </div>
            )}

            <div className={cn('rounded-2xl border p-5 space-y-4', canProceedStep0 ? 'border-[#00ad74]/30 bg-[#00ad74]/5' : 'border-white/10 bg-white/5')}>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">Checklist</p>
              <div className="space-y-2">
                <div className="flex items-center gap-2.5 text-xs">
                  <div className={cn('w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0', coverFile ? 'bg-[#00ad74]' : 'bg-white/10')}>
                    {coverFile ? <CheckCircle2 className="w-3 h-3 text-white" /> : <span className="w-1.5 h-1.5 rounded-full bg-white/40" />}
                  </div>
                  <span className={coverFile ? 'text-white font-medium' : 'text-white/60'}>Album cover</span>
                </div>
                <div className="flex items-center gap-2.5 text-xs">
                  <div className={cn('w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0', validTracks.length > 0 ? 'bg-[#00ad74]' : 'bg-white/10')}>
                    {validTracks.length > 0 ? <CheckCircle2 className="w-3 h-3 text-white" /> : <span className="w-1.5 h-1.5 rounded-full bg-white/40" />}
                  </div>
                  <span className={validTracks.length > 0 ? 'text-white font-medium' : 'text-white/60'}>
                    {validTracks.length > 0 ? `${validTracks.length} track(s) ready` : 'At least one track with audio'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => canProceedStep0 && setCurrentStep(1)}
                disabled={!canProceedStep0}
                className={cn(
                  'w-full min-h-[48px] py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 touch-manipulation transition-all',
                  canProceedStep0 ? 'bg-[#00ad74] hover:bg-[#009c68] active:bg-[#008a5d] text-white' : 'bg-white/10 text-white/40 cursor-not-allowed'
                )}
              >
                {canProceedStep0 ? <><CheckCircle2 className="w-4 h-4" /> Continue to Details <ChevronRight className="w-4 h-4" /></> : 'Complete the checklist to continue'}
              </button>
            </div>
          </div>
        )}

        {/* Step 1 — Details */}
        {currentStep === 1 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight text-white">Album details</h2>
              <p className="text-sm text-white/60">Title and description.</p>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block">Album title <span className="text-[#00ad74]">*</span></label>
              <input
                type="text"
                placeholder="Give your album a title"
                value={albumTitle}
                onChange={(e) => setAlbumTitle(e.target.value)}
                className="w-full min-h-[48px] bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white placeholder:text-white/40 focus:ring-2 focus:ring-[#00ad74]/20 focus:border-[#00ad74]/30 outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block">Description <span className="text-[10px] normal-case text-white/40">optional</span></label>
              <textarea
                rows={4}
                placeholder="Tell listeners what this album is about..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full min-h-[96px] bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/40 focus:ring-2 focus:ring-[#00ad74]/20 focus:border-[#00ad74]/30 outline-none resize-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block">Release date & time <span className="text-[10px] normal-case text-white/40">optional</span></label>
              <div className="grid grid-cols-2 gap-3">
                <div className="relative">
                  <input
                    type="date"
                    value={releaseDate ? format(releaseDate, 'yyyy-MM-dd') : ''}
                    onChange={(e) => setReleaseDate(e.target.value ? new Date(e.target.value) : undefined)}
                    className="w-full min-h-[48px] bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white focus:ring-2 focus:ring-[#00ad74]/20 focus:border-[#00ad74]/30 outline-none transition-all"
                  />
                  <CalendarIcon className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
                </div>
                <input
                  type="time"
                  value={releaseTime}
                  onChange={(e) => setReleaseTime(e.target.value || '00:00')}
                  className="w-full min-h-[48px] bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white focus:ring-2 focus:ring-[#00ad74]/20 focus:border-[#00ad74]/30 outline-none transition-all"
                />
              </div>
            </div>
            <div className="pt-4 flex gap-3">
              <button type="button" onClick={() => setCurrentStep(0)} className="flex-1 min-h-[48px] py-3.5 rounded-xl font-semibold text-sm border border-white/10 hover:bg-white/10 text-white touch-manipulation">
                Back
              </button>
              <button
                type="button"
                onClick={() => canProceedStep1 && setCurrentStep(2)}
                disabled={!canProceedStep1}
                className={cn(
                  'flex-[2] min-h-[48px] py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 touch-manipulation transition-all',
                  canProceedStep1 ? 'bg-[#00ad74] hover:bg-[#009c68] text-white' : 'bg-white/10 text-white/40 cursor-not-allowed'
                )}
              >
                Continue to Metadata <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — Metadata */}
        {currentStep === 2 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight text-white">Genre & mood</h2>
              <p className="text-sm text-white/60">Help listeners discover your album.</p>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block">Genre <span className="text-[#00ad74]">*</span></label>
              <select
                value={genreId}
                onChange={(e) => setGenreId(e.target.value)}
                className="w-full min-h-[48px] bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white focus:ring-2 focus:ring-[#00ad74]/20 focus:border-[#00ad74]/30 outline-none transition-all"
              >
                <option value="" className="bg-[#0d0d0d]">Select genre</option>
                {genres.map((g) => (
                  <option key={g.id} value={g.id} className="bg-[#0d0d0d]">{g.name}</option>
                ))}
              </select>
            </div>
            {filteredSubgenres.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block">Subgenre <span className="text-[10px] normal-case text-white/40">optional</span></label>
                <select
                  value={subgenreId}
                  onChange={(e) => setSubgenreId(e.target.value)}
                  className="w-full min-h-[48px] bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white focus:ring-2 focus:ring-[#00ad74]/20 focus:border-[#00ad74]/30 outline-none transition-all"
                >
                  <option value="" className="bg-[#0d0d0d]">Select subgenre</option>
                  {filteredSubgenres.map((s) => (
                    <option key={s.id} value={s.id} className="bg-[#0d0d0d]">{s.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block">Moods <span className="text-[10px] normal-case text-white/40">optional</span></label>
              <div className="flex flex-wrap gap-2">
                {moods.map((mood) => {
                  const sel = selectedMoods.includes(mood.id);
                  return (
                    <button
                      key={mood.id}
                      type="button"
                      onClick={() => toggleMood(mood.id)}
                      className={cn(
                        'px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all touch-manipulation min-h-[36px]',
                        sel ? 'bg-[#00ad74]/20 text-[#00ad74] border-[#00ad74]/30' : 'bg-white/5 text-white/70 border-white/10 hover:border-[#00ad74]/30 hover:text-white'
                      )}
                    >
                      {mood.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {uploading && (
              <div className="space-y-2 rounded-xl border border-[#00ad74]/30 bg-[#00ad74]/10 p-4">
                <div className="flex justify-between text-xs">
                  <span className="text-white/80 font-medium">Uploading album…</span>
                  <span className="font-bold text-white">{uploadProgress}%</span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-[#00ad74] rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
                <p className="text-[11px] text-white/60">Processing {validTracks.length} track(s). Please don’t close.</p>
              </div>
            )}

            {!uploading && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-white/50">Summary</p>
                <div className="flex items-center gap-3">
                  {coverPreview && <img src={coverPreview} alt="" className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">{albumTitle || 'Untitled'}</p>
                    <p className="text-[11px] text-white/60">{validTracks.length} track(s) · {genres.find((g) => g.id === genreId)?.name ?? 'No genre'}</p>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-200">{error}</p>
              </div>
            )}

            <div className={cn('pt-4 flex gap-3', consoleEmbed?.showReleaseActions && 'flex-col sm:flex-row')}>
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                disabled={uploading}
                className="flex-1 min-h-[48px] py-3.5 rounded-xl font-semibold text-sm border border-white/10 hover:bg-white/10 text-white touch-manipulation disabled:opacity-50"
              >
                Back
              </button>
              {consoleEmbed?.showReleaseActions ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleUpload('draft')}
                    disabled={uploading || !canSubmit}
                    className="flex-1 min-h-[48px] rounded-xl border border-white/10 text-sm font-semibold text-white/80 hover:bg-white/5 disabled:opacity-50"
                  >
                    Save Draft
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpload('schedule')}
                    disabled={uploading || !canSubmit}
                    className="flex-1 min-h-[48px] rounded-xl border border-[#00ad74]/40 text-sm font-semibold text-[#00ad74] hover:bg-[#00ad74]/10 disabled:opacity-50"
                  >
                    Schedule
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpload('publish')}
                    disabled={uploading || !canSubmit}
                    className={cn(
                      'flex-1 min-h-[48px] py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 touch-manipulation transition-all',
                      canSubmit && !uploading ? 'bg-[#00ad74] hover:bg-[#009c68] text-white' : 'bg-white/10 text-white/40 cursor-not-allowed'
                    )}
                  >
                    {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</> : <><Upload className="w-4 h-4" /> Publish Now</>}
                  </button>
                </>
              ) : (
              <button
                type="button"
                onClick={() => handleUpload('publish')}
                disabled={uploading || !canSubmit}
                className={cn(
                  'flex-[2] min-h-[48px] py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 touch-manipulation transition-all',
                  canSubmit && !uploading ? 'bg-[#00ad74] hover:bg-[#009c68] text-white' : 'bg-white/10 text-white/40 cursor-not-allowed'
                )}
              >
                {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</> : <><Upload className="w-4 h-4" /> Submit album</>}
              </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
