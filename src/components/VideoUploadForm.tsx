import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Video, Image as ImageIcon, Loader2, Calendar as CalendarIcon,
  CheckCircle2, FileVideo, ChevronRight, Sparkles, X, Upload,
} from 'lucide-react';
import { format } from 'date-fns';
import { supabase, getArtistProfile } from '../lib/supabase';
import { bunnyStreamService } from '../lib/bunnyStreamService';
import { MediaCompression } from '../lib/mediaCompression';
import {
  validateVideoFile,
  validateImageFile,
  createSafeFilePath,
  ALLOWED_IMAGE_EXTENSIONS,
} from '../lib/fileSecurity';
import { cache } from '../lib/cache';
import { smartCache } from '../lib/smartCache';
import { useUpload } from '../contexts/UploadContext';
import { useAuth } from '../contexts/AuthContext';
import { cn } from '../lib/utils';
import { AdminUploadContext, resolveContentOwnerUserId } from '../lib/adminUploadContext';
import {
  ConsoleUploadEmbed,
  ContentReleaseAction,
  resolveContentUploadStatus,
} from '../lib/consoleUploadEmbed';

const STEPS = ['Media', 'Details'] as const;
type Step = 0 | 1;

interface VideoUploadFormProps {
  onClose: () => void;
  onSuccess?: () => void;
  initialData?: any;
  adminUploadContext?: AdminUploadContext;
  consoleEmbed?: ConsoleUploadEmbed;
}

export default function VideoUploadForm({ onClose, onSuccess, initialData, adminUploadContext, consoleEmbed }: VideoUploadFormProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { addUpload, updateUploadProgress, updateUploadStatus } = useUpload();
  const mountedRef = useRef(true);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  const isEditing = !!initialData;
  const [artistProfile, setArtistProfile] = useState<{ id: string; stage_name: string; artist_id: string | null; bio?: string; profile_photo_url?: string; is_verified?: boolean } | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [currentStep, setCurrentStep] = useState<Step>(isEditing ? 1 : 0);

  const [title, setTitle] = useState(initialData?.title ?? '');
  const [description, setDescription] = useState(initialData?.description ?? '');
  const [releaseDate, setReleaseDate] = useState<Date | undefined>(
    initialData?.metadata?.release_date ? new Date(initialData.metadata.release_date) : undefined
  );
  const [releaseTime, setReleaseTime] = useState<string>(() => {
    const rd = initialData?.metadata?.release_date;
    if (!rd || typeof rd !== 'string' || !rd.includes('T')) return '00:00';
    const t = rd.split('T')[1];
    return t ? t.slice(0, 5) : '00:00';
  });

  const [selectedVideoFile, setSelectedVideoFile] = useState<File | null>(null);
  const [selectedThumbnailFile, setSelectedThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState<string | null>(initialData?.metadata?.thumbnail_url ?? null);
  const [thumbnailOption, setThumbnailOption] = useState<'auto' | 'upload'>('auto');
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const [autoThumbnailGenerated, setAutoThumbnailGenerated] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStep, setUploadStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploadTaskId, setUploadTaskId] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (thumbnailPreviewUrl && thumbnailPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(thumbnailPreviewUrl);
    };
  }, []);

  const ownerUserId = resolveContentOwnerUserId(adminUploadContext, user?.id);

  useEffect(() => {
    consoleEmbed?.onStepChange?.(currentStep);
  }, [currentStep, consoleEmbed]);

  useEffect(() => {
    consoleEmbed?.onTitleChange?.(title);
  }, [title, consoleEmbed]);

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
        if (profile) {
          setArtistProfile({ id: profile.id, stage_name: profile.stage_name, artist_id: profile.artist_id ?? null, bio: profile.bio, profile_photo_url: profile.profile_photo_url, is_verified: profile.is_verified });
        } else {
          const { data } = await supabase.from('artist_profiles').select('id, stage_name, artist_id, bio, profile_photo_url, is_verified').eq('user_id', ownerUserId).maybeSingle();
          if (data) setArtistProfile({ id: data.id, stage_name: data.stage_name, artist_id: data.artist_id ?? null, bio: data.bio, profile_photo_url: data.profile_photo_url, is_verified: data.is_verified });
        }
      } finally {
        if (mountedRef.current) setLoadingProfile(false);
      }
    })();
  }, [user, adminUploadContext, ownerUserId]);

  const generateThumbnailFromVideo = useCallback(async (videoFile: File): Promise<File | null> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      const url = URL.createObjectURL(videoFile);
      video.src = url;
      video.onloadedmetadata = () => { video.currentTime = Math.min(Math.max(video.duration / 5, 2), 5); };
      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) { URL.revokeObjectURL(url); resolve(null); return; }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            URL.revokeObjectURL(url);
            resolve(blob ? new File([blob], 'thumbnail.jpg', { type: 'image/jpeg' }) : null);
          }, 'image/jpeg', 0.85);
        } catch { URL.revokeObjectURL(url); resolve(null); }
      };
      video.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    });
  }, []);

  const handleVideoChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validation = validateVideoFile(file);
    if (!validation.valid) { setError(validation.error ?? 'Invalid video file.'); return; }
    setError(null);
    setSelectedVideoFile(file);
    setAutoThumbnailGenerated(false);
    if (thumbnailOption === 'auto') {
      setIsGeneratingThumbnail(true);
      const thumb = await generateThumbnailFromVideo(file);
      if (!mountedRef.current) return;
      if (thumb) {
        setSelectedThumbnailFile(thumb);
        if (thumbnailPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(thumbnailPreviewUrl);
        setThumbnailPreviewUrl(URL.createObjectURL(thumb));
        setAutoThumbnailGenerated(true);
      }
      setIsGeneratingThumbnail(false);
    }
  }, [thumbnailOption, generateThumbnailFromVideo, thumbnailPreviewUrl]);

  const handleThumbnailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validation = validateImageFile(file);
    if (!validation.valid) { setError(validation.error ?? 'Invalid image.'); return; }
    setError(null);
    if (thumbnailPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(thumbnailPreviewUrl);
    setSelectedThumbnailFile(file);
    setThumbnailPreviewUrl(URL.createObjectURL(file));
  };

  const handleThumbnailOptionChange = (option: 'auto' | 'upload') => {
    setThumbnailOption(option);
    if (thumbnailPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(thumbnailPreviewUrl);
    setThumbnailPreviewUrl(null);
    setSelectedThumbnailFile(null);
    setAutoThumbnailGenerated(false);
    if (thumbInputRef.current) thumbInputRef.current.value = '';
    if (option === 'auto' && selectedVideoFile) {
      setIsGeneratingThumbnail(true);
      generateThumbnailFromVideo(selectedVideoFile).then((thumb) => {
        if (!mountedRef.current) return;
        if (thumb) {
          setSelectedThumbnailFile(thumb);
          setThumbnailPreviewUrl(URL.createObjectURL(thumb));
          setAutoThumbnailGenerated(true);
        }
        setIsGeneratingThumbnail(false);
      });
    }
  };

  const uploadImageToSupabase = async (file: File, path: string): Promise<string> => {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        throw new Error('Authentication required');
      }

      let fileToUpload = file;

      try {
        const compressionResult = await MediaCompression.compressImage(file, {
          quality: 0.85,
          maxWidth: 1920,
          maxHeight: 1920
        });
        fileToUpload = compressionResult.file;
        console.log('Thumbnail compressed:',
          `${(compressionResult.originalSize / 1024 / 1024).toFixed(2)} MB → ${(compressionResult.compressedSize / 1024 / 1024).toFixed(2)} MB`);
      } catch (compressionError) {
        console.warn('Thumbnail compression failed, uploading original:', compressionError);
      }

      const { data, error } = await supabase.storage
        .from('thumbnails')
        .upload(path, fileToUpload, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        throw error;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('thumbnails')
        .getPublicUrl(data.path);

      return publicUrl;
    } catch (error) {
      console.error('Error uploading thumbnail:', error);
      throw new Error(`Thumbnail upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleSubmit = async (releaseAction: ContentReleaseAction = 'publish') => {
    setError(null);
    setSuccess(null);
    setUploadProgress(0);
    if (!title.trim()) { setError('Video title is required.'); return; }
    if (!isEditing && !selectedVideoFile) { setError('Video file is required.'); return; }
    if (releaseAction === 'schedule' && !releaseDate) {
      setError('Pick a release date to schedule this video.');
      return;
    }

    setIsSubmitting(true);
    const taskId = `video-${Date.now()}`;
    setUploadTaskId(taskId);
    addUpload({ id: taskId, type: 'video', title: title.trim() });

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.user) throw new Error('User not authenticated.');
      const authUser = session.user;
      const contentOwnerId = ownerUserId ?? authUser.id;

      const profile = artistProfile;
      if (!profile) throw new Error('Artist profile not found. Please register as an artist first.');

      // Resolve artist_id from fresh DB so we get current value (same as SingleUploadForm)
      const { data: freshProfileById } = await supabase.from('artist_profiles').select('artist_id, stage_name').eq('id', profile.id).maybeSingle();
      const { data: freshProfileByUser } = await supabase.from('artist_profiles').select('artist_id, stage_name').eq('user_id', contentOwnerId).maybeSingle();
      const freshProfile = freshProfileById || freshProfileByUser;
      let finalArtistId = freshProfile?.artist_id ?? profile.artist_id ?? null;
      let stageName =
        (freshProfile?.stage_name && freshProfile.stage_name.trim()) ||
        (profile.stage_name && String(profile.stage_name).trim()) ||
        '';
      if (!stageName) {
        const { data: userRow } = await supabase.from('users').select('display_name').eq('id', contentOwnerId).maybeSingle();
        stageName = (userRow?.display_name || '').trim();
      }
      if (!stageName && !adminUploadContext) {
        stageName = (authUser?.user_metadata?.display_name || '').trim();
      } else {
        stageName = String(stageName).trim();
      }

      if (!finalArtistId) {
        if (!stageName) throw new Error('Artist stage name is missing. Please complete your artist profile before uploading.');
        const { data: existing } = await supabase.from('artists').select('id').ilike('name', stageName).maybeSingle();
        if (existing) {
          finalArtistId = existing.id;
          await supabase.from('artist_profiles').update({ artist_id: finalArtistId }).eq('id', profile.id);
        } else {
          const createArtistResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-artist`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: stageName,
              bio: profile.bio || null,
              image_url: profile.profile_photo_url || null,
              verified: profile.is_verified || false,
            }),
          });
          if (!createArtistResponse.ok) {
            const errorData = await createArtistResponse.json().catch(() => ({}));
            throw new Error(`Failed to create artist record: ${errorData.error || 'Unknown error'}`);
          }
          const createResult = await createArtistResponse.json();
          if (!createResult.success) throw new Error(`Failed to create artist record: ${createResult.error || 'Unknown error'}`);
          finalArtistId = createResult.artist?.id;
          if (finalArtistId) await supabase.from('artist_profiles').update({ artist_id: finalArtistId }).eq('id', profile.id);
        }
      }

      let videoUrl = initialData?.metadata?.video_url ?? '';
      let videoGuid = initialData?.metadata?.video_guid ?? '';
      let thumbnailUrl: string | null = initialData?.metadata?.thumbnail_url ?? null;
      let duration = initialData?.metadata?.duration_seconds ?? 0;

      if (selectedVideoFile) {
        setUploadStep('Uploading…');
        const uploadResult = await bunnyStreamService.uploadVideo(selectedVideoFile, {
          title: title.trim(),
          onProgress: (p) => { if (mountedRef.current) { setUploadProgress(Math.round(p * 0.7)); updateUploadProgress(taskId, p); } },
        });
        if (!uploadResult.success || !uploadResult.publicUrl || !uploadResult.videoGuid) throw new Error(uploadResult.error ?? 'Video upload failed');
        if (!uploadResult.publicUrl.startsWith('https://') || !uploadResult.publicUrl.includes('.b-cdn.net') || !uploadResult.publicUrl.includes('/playlist.m3u8')) throw new Error('Invalid video URL from server');
        videoUrl = uploadResult.publicUrl;
        videoGuid = uploadResult.videoGuid;
        setUploadProgress(70);
        try { duration = await bunnyStreamService.getVideoDuration(uploadResult.publicUrl); } catch { /* ignore */ }
      }

      if (selectedThumbnailFile) {
        setUploadStep('Uploading thumbnail…');
        const path = createSafeFilePath(contentOwnerId, 'thumbnails', selectedThumbnailFile.name, ALLOWED_IMAGE_EXTENSIONS);
        if (path) thumbnailUrl = await uploadImageToSupabase(selectedThumbnailFile, path);
        setUploadProgress(85);
      }

      setUploadStep('Saving…');
      setUploadProgress(90);

      const metadata: Record<string, any> = {
        video_url: videoUrl,
        video_guid: videoGuid,
        thumbnail_url: thumbnailUrl,
        duration_seconds: Math.round(duration),
        release_date: releaseDate ? (releaseTime ? `${format(releaseDate, 'yyyy-MM-dd')}T${releaseTime}:00` : format(releaseDate, 'yyyy-MM-dd')) : null,
        file_name: selectedVideoFile?.name ?? initialData?.metadata?.file_name ?? null,
        file_size: selectedVideoFile?.size ?? initialData?.metadata?.file_size ?? null,
        file_type: selectedVideoFile?.type ?? initialData?.metadata?.file_type ?? null,
        artist_id: finalArtistId,
        bunny_stream: true,
        release_action: releaseAction,
        ...(adminUploadContext?.organizationId
          ? { uploaded_by_org_id: adminUploadContext.organizationId }
          : {}),
      };

      const uploadStatus = resolveContentUploadStatus(releaseAction, releaseDate);

      if (isEditing && initialData?.id) {
        const { error: updateError } = await supabase.from('content_uploads').update({ title: title.trim(), description: description.trim() || null, metadata: { ...initialData.metadata, ...metadata } }).eq('id', initialData.id);
        if (updateError) throw updateError;
        cache.deletePattern(`video.*${initialData.id}`);
        await smartCache.invalidate(`video.*${initialData.id}`);
      } else {
        if (!videoUrl || !videoGuid) throw new Error('Video upload failed: no playable URL available');
        const { error: insertError } = await supabase.from('content_uploads').insert({
          user_id: contentOwnerId,
          artist_profile_id: profile.id,
          content_type: 'video',
          title: title.trim(),
          description: description.trim() || null,
          status: uploadStatus,
          metadata,
        });
        if (insertError) throw insertError;
      }

      setUploadProgress(100);
      setUploadStep('Complete!');
      updateUploadStatus(taskId, 'completed');
      setSuccess(isEditing ? 'Video updated successfully!' : 'Video uploaded successfully!');
      setTimeout(() => { onSuccess?.(); onClose(); }, 800);
    } catch (err: any) {
      const msg = err?.message ?? 'An unexpected error occurred.';
      setError(msg);
      updateUploadStatus(taskId, 'error', msg);
    } finally {
      if (mountedRef.current) { setIsSubmitting(false); setUploadStep(''); }
    }
  };

  if (!adminUploadContext && !user) { navigate('/'); return null; }

  if (loadingProfile) {
    return (
      <div className="flex flex-col min-h-screen min-h-[100dvh] bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      </div>
    );
  }

  if (!artistProfile) {
    return (
      <div className="flex flex-col min-h-screen min-h-[100dvh] overflow-y-auto bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav font-['Inter',sans-serif]">
        <div className="flex-1 flex flex-col items-center justify-center gap-5 px-5">
          <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center">
            <Video className="w-7 h-7 text-white/60" />
          </div>
          <div className="text-center space-y-1.5">
            <h2 className="text-xl font-semibold tracking-tight text-white">Artist profile required</h2>
            <p className="text-sm text-white/60 max-w-xs">
              {adminUploadContext
                ? `${adminUploadContext.targetDisplayName || 'This user'} needs an artist profile before content can be uploaded.`
                : 'Register as an artist to upload videos.'}
            </p>
          </div>
          {adminUploadContext ? (
            <button onClick={onClose} className="px-6 py-3 bg-white/10 hover:bg-white/15 text-white rounded-full font-medium transition-all active:scale-95">
              Go back
            </button>
          ) : (
            <button onClick={() => navigate('/become-artist')} className="px-6 py-3 bg-[#00ad74] hover:bg-[#009c68] text-white rounded-full font-medium transition-all active:scale-95">
              Become a creator
            </button>
          )}
        </div>
      </div>
    );
  }

  const canProceedStep0 = isEditing || !!selectedVideoFile;
  const canSubmit = title.trim().length > 0 && canProceedStep0;
  const progressPct = (currentStep / (STEPS.length - 1)) * 100;

  return (
    <div className={cn(
      consoleEmbed?.hideChrome
        ? "flex flex-col text-white font-['Inter',sans-serif]"
        : "flex flex-col min-h-screen min-h-[100dvh] overflow-y-auto bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav font-['Inter',sans-serif]"
    )}>
      {!consoleEmbed?.hideChrome && (
      <header className="w-full py-5 px-5 sticky top-0 z-20 flex-shrink-0 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <button type="button" onClick={onClose} className="p-2 -ml-2 hover:bg-white/10 rounded-full transition-all duration-200 touch-manipulation flex-shrink-0" aria-label="Back">
            <ArrowLeft className="w-6 h-6 text-white" />
          </button>
          <h1 className="font-['Inter',sans-serif] text-3xl font-black tracking-tight text-white leading-none">
            {isEditing ? 'Update your' : 'Share your'}<br />
            <span className="font-light italic text-white/60">{isEditing ? 'video.' : 'visual.'}</span>
          </h1>
        </div>
      </header>
      )}

      <div className={cn('flex-1 min-h-0 overflow-y-auto scrollbar-hide space-y-8 w-full', consoleEmbed?.hideChrome ? 'py-1' : 'px-5 py-5 pb-28')}>
        {!isEditing && !consoleEmbed?.hideChrome && (
          <div>
            <div className="flex items-center gap-0 mb-3">
              {STEPS.map((label, i) => {
                const isActive = i === currentStep;
                const isDone = i < currentStep;
                return (
                  <div key={label} className="flex items-center flex-1 last:flex-none">
                    <button type="button" onClick={() => i < currentStep && setCurrentStep(i as Step)} disabled={i > currentStep} className={cn('flex items-center gap-2 text-xs font-semibold transition-colors min-h-[44px] touch-manipulation', isActive && 'text-white', isDone && 'text-white cursor-pointer', !isActive && !isDone && 'text-white/30 cursor-default')}>
                      <span className={cn('w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all', isActive && 'bg-[#00ad74] text-white ring-2 ring-[#00ad74]/30 ring-offset-2 ring-offset-[#0a0a0a]', isDone && 'bg-[#00ad74]/20 text-[#00ad74]', !isActive && !isDone && 'bg-white/10 text-white/30')}>
                        {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
                      </span>
                      {label}
                    </button>
                    {i < STEPS.length - 1 && <div className={cn('flex-1 h-px mx-3 transition-colors', i < currentStep ? 'bg-[#00ad74]/40' : 'bg-white/10')} />}
                  </div>
                );
              })}
            </div>
            <div className="h-0.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-[#00ad74] rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        {/* Step 0 — Media */}
        {currentStep === 0 && !isEditing && (
          <div className="space-y-6">
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
              <h2 className="text-lg font-semibold tracking-tight text-white">Video file</h2>
              <p className="text-sm text-white/60">MP4, WebM, MOV, AVI, MKV · Max 500 MB</p>
            </div>
            <button type="button" onClick={() => videoInputRef.current?.click()} className={cn('relative w-full rounded-2xl border-2 border-dashed flex flex-col items-center justify-center transition-all overflow-hidden min-h-[160px]', selectedVideoFile ? 'border-[#00ad74]/40 bg-[#00ad74]/5 py-6' : 'border-white/10 hover:border-[#00ad74]/40 hover:bg-[#00ad74]/5 py-12')}>
              <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoChange} />
              {selectedVideoFile ? (
                <div className="flex items-center gap-4 px-4 w-full">
                  {thumbnailPreviewUrl && <img src={thumbnailPreviewUrl} alt="Preview" className="w-20 h-14 rounded-xl object-cover flex-shrink-0 border border-white/10" />}
                  <div className="text-left min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <CheckCircle2 className="w-4 h-4 text-white flex-shrink-0" />
                      <p className="text-[13px] font-bold text-white truncate">{selectedVideoFile.name}</p>
                    </div>
                    <p className="text-[12px] text-white/60">{(selectedVideoFile.size / (1024 * 1024)).toFixed(1)} MB</p>
                    {isGeneratingThumbnail && <p className="text-[11px] text-white mt-1 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Generating thumbnail…</p>}
                    {autoThumbnailGenerated && !isGeneratingThumbnail && <p className="text-[11px] text-white mt-1 flex items-center gap-1"><Sparkles className="w-3 h-3" /> Thumbnail auto-generated</p>}
                  </div>
                  <span className="text-[11px] font-semibold text-white px-3 py-1.5 rounded-full bg-white/10">Change</span>
                </div>
              ) : (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center mb-3">
                    <FileVideo className="w-7 h-7 text-white/60" />
                  </div>
                  <p className="text-sm font-semibold text-white mb-0.5">Tap to select a video</p>
                  <p className="text-[12px] text-white/60">or drag and drop</p>
                </>
              )}
            </button>
            <div className="space-y-3">
              <h2 className="text-base font-semibold text-white">Thumbnail</h2>
              <p className="text-xs text-white/60">Preview image viewers see before playing</p>
              <div className="flex gap-2">
                {(['auto', 'upload'] as const).map((mode) => (
                  <button key={mode} type="button" onClick={() => handleThumbnailOptionChange(mode)} className={cn('px-4 py-2 rounded-full text-[12px] font-semibold border transition-all', thumbnailOption === mode ? 'bg-[#00ad74] text-white border-transparent' : 'bg-white/5 text-white/60 border-white/10 hover:border-[#00ad74]/30 hover:text-white')}>
                    {mode === 'auto' ? 'Auto-generate' : 'Upload custom'}
                  </button>
                ))}
              </div>
              {thumbnailOption === 'auto' ? (
                <div className={cn('rounded-2xl border p-4 flex items-center gap-4 transition-all', thumbnailPreviewUrl && autoThumbnailGenerated ? 'border-[#00ad74]/20 bg-[#00ad74]/5' : 'border-white/10 bg-white/5')}>
                  {thumbnailPreviewUrl && autoThumbnailGenerated ? (
                    <>
                      <img src={thumbnailPreviewUrl} alt="Thumbnail" className="w-20 h-14 rounded-xl object-cover flex-shrink-0 border border-white/10" />
                      <div>
                        <p className="text-[13px] font-semibold text-white flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-white" /> Thumbnail generated</p>
                        <p className="text-[11px] text-white/60 mt-0.5">From ~20% into your video</p>
                      </div>
                    </>
                  ) : isGeneratingThumbnail ? (
                    <p className="text-[12px] text-white/60 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Generating thumbnail…</p>
                  ) : (
                    <p className="text-[12px] text-white/60">Select a video above to auto-generate a thumbnail.</p>
                  )}
                </div>
              ) : (
                <button type="button" onClick={() => thumbInputRef.current?.click()} className={cn('w-full flex items-center gap-4 rounded-2xl border-2 border-dashed p-4 transition-all', thumbnailPreviewUrl && thumbnailOption === 'upload' ? 'border-[#00ad74]/30 bg-[#00ad74]/5' : 'border-white/10 hover:border-[#00ad74]/40 hover:bg-[#00ad74]/5')}>
                  <input ref={thumbInputRef} type="file" accept="image/*" className="hidden" onChange={handleThumbnailChange} />
                  {thumbnailPreviewUrl && thumbnailOption === 'upload' ? (
                    <>
                      <img src={thumbnailPreviewUrl} alt="Thumbnail" className="w-20 h-14 rounded-xl object-cover flex-shrink-0" />
                      <div className="text-left">
                        <p className="text-[13px] font-semibold text-white">{selectedThumbnailFile?.name ?? 'Custom thumbnail'}</p>
                        <p className="text-[11px] text-white/60 mt-0.5">Tap to change</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0"><ImageIcon className="w-5 h-5 text-white/60" /></div>
                      <div className="text-left">
                        <p className="text-[13px] font-semibold text-white">Upload thumbnail</p>
                        <p className="text-[11px] text-white/60">JPG, PNG, WebP · Max 10 MB · 16:9 recommended</p>
                      </div>
                    </>
                  )}
                </button>
              )}
            </div>
            <button type="button" onClick={() => canProceedStep0 && setCurrentStep(1)} disabled={!canProceedStep0} className={cn('w-full h-12 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 mt-2', canProceedStep0 ? 'bg-[#00ad74] text-white hover:bg-[#009c68]' : 'bg-white/10 text-white/40 cursor-not-allowed')}>
              {canProceedStep0 ? <><CheckCircle2 className="w-4 h-4" /> Continue to Details <ChevronRight className="w-4 h-4" /></> : 'Select a video file to continue'}
            </button>
          </div>
        )}

        {/* Step 1 — Details */}
        {(currentStep === 1 || isEditing) && (
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block">Title <span className="text-[#00ad74]">*</span></label>
              <input type="text" placeholder={isEditing ? 'Video title' : 'Give your video a title'} value={title} onChange={(e) => setTitle(e.target.value)} className="w-full h-12 bg-white/5 border border-white/10 focus:border-[#00ad74]/30 focus:ring-2 focus:ring-[#00ad74]/20 text-white placeholder:text-white/40 rounded-xl px-4 outline-none transition-all" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block">Description <span className="ml-2 text-[10px] normal-case tracking-normal font-normal text-white/40">optional</span></label>
              <textarea rows={4} placeholder="Tell viewers about this video…" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#00ad74]/20 focus:border-[#00ad74]/30 resize-none transition-all min-h-[96px]" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block">Release date & time <span className="ml-2 text-[10px] normal-case tracking-normal font-normal text-white/40">optional</span></label>
              <div className="grid grid-cols-2 gap-3">
                <input type="date" value={releaseDate ? format(releaseDate, 'yyyy-MM-dd') : ''} onChange={(e) => setReleaseDate(e.target.value ? new Date(e.target.value) : undefined)} className="w-full h-12 bg-white/5 border border-white/10 focus:border-[#00ad74]/30 focus:ring-2 focus:ring-[#00ad74]/20 text-white rounded-xl px-4 outline-none transition-all" />
                <input type="time" value={releaseTime} onChange={(e) => setReleaseTime(e.target.value || '00:00')} className="w-full h-12 bg-white/5 border border-white/10 focus:border-[#00ad74]/30 focus:ring-2 focus:ring-[#00ad74]/20 text-white rounded-xl px-4 outline-none transition-all" />
              </div>
            </div>
            {isEditing && (
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block">Thumbnail <span className="text-[10px] normal-case text-white/40">optional</span></label>
                <button type="button" onClick={() => thumbInputRef.current?.click()} className="w-full flex items-center gap-4 rounded-2xl border-2 border-dashed border-white/10 hover:border-[#00ad74]/40 hover:bg-[#00ad74]/5 p-4 transition-all">
                  <input ref={thumbInputRef} type="file" accept="image/*" className="hidden" onChange={handleThumbnailChange} />
                  {thumbnailPreviewUrl ? <img src={thumbnailPreviewUrl} alt="Thumbnail" className="w-20 h-14 rounded-xl object-cover flex-shrink-0" /> : <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0"><ImageIcon className="w-5 h-5 text-white/60" /></div>}
                  <div className="text-left">
                    <p className="text-[13px] font-semibold text-white">{selectedThumbnailFile?.name ?? (thumbnailPreviewUrl ? 'Current thumbnail' : 'Upload thumbnail')}</p>
                    <p className="text-[11px] text-white/60 mt-0.5">JPG, PNG, WebP · 16:9 recommended</p>
                  </div>
                </button>
              </div>
            )}
            {isSubmitting && (
              <div className="space-y-2.5 rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="flex justify-between text-[12px]">
                  <span className="text-white/60 font-medium">{uploadStep || 'Uploading…'}</span>
                  <span className="font-bold text-white">{uploadProgress}%</span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-[#00ad74] rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
                <p className="text-[11px] text-white/50">Please do not close this page while uploading.</p>
              </div>
            )}
            {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3"><p className="text-sm text-red-400">{error}</p></div>}
            {success && <div className="rounded-xl border border-[#00ad74]/30 bg-[#00ad74]/10 px-4 py-3"><p className="text-sm text-[#00ad74]">{success}</p></div>}
            {!isSubmitting && !isEditing && selectedVideoFile && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">Submission summary</p>
                <div className="flex items-center gap-3">
                  {thumbnailPreviewUrl && <img src={thumbnailPreviewUrl} alt="Thumb" className="w-14 h-10 rounded-xl object-cover flex-shrink-0 border border-white/10" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold text-white truncate">{title || 'Untitled Video'}</p>
                    <p className="text-[11px] text-white/60">{selectedVideoFile.name} · {(selectedVideoFile.size / (1024 * 1024)).toFixed(1)} MB</p>
                  </div>
                </div>
              </div>
            )}
            <div className={cn('flex gap-3 pt-2', consoleEmbed?.showReleaseActions && !isEditing && 'flex-col sm:flex-row')}>
              {!isEditing && (
                <button type="button" onClick={() => setCurrentStep(0)} disabled={isSubmitting} className="flex-1 min-h-[48px] py-3.5 rounded-xl font-semibold text-sm border border-white/10 hover:bg-white/10 text-white touch-manipulation disabled:opacity-50">Back</button>
              )}
              {consoleEmbed?.showReleaseActions && !isEditing ? (
                <>
                  <button type="button" onClick={() => handleSubmit('draft')} disabled={isSubmitting || !canSubmit} className="flex-1 min-h-[48px] rounded-xl border border-white/10 text-sm font-semibold text-white/80 hover:bg-white/5 disabled:opacity-50">Save Draft</button>
                  <button type="button" onClick={() => handleSubmit('schedule')} disabled={isSubmitting || !canSubmit} className="flex-1 min-h-[48px] rounded-xl border border-[#00ad74]/40 text-sm font-semibold text-[#00ad74] hover:bg-[#00ad74]/10 disabled:opacity-50">Schedule</button>
                  <button type="button" onClick={() => handleSubmit('publish')} disabled={isSubmitting || !canSubmit} className={cn('flex-1 min-h-[48px] py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 touch-manipulation', canSubmit && !isSubmitting ? 'bg-[#00ad74] text-white hover:bg-[#009c68]' : 'bg-white/10 text-white/40 cursor-not-allowed disabled:opacity-50')}>
                    {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> {uploadStep || 'Uploading…'}</> : <><Upload className="w-4 h-4" /> Publish Now</>}
                  </button>
                </>
              ) : (
              <button type="button" onClick={() => handleSubmit('publish')} disabled={isSubmitting || !canSubmit} className={cn('min-h-[48px] py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 touch-manipulation', isEditing ? 'flex-1' : 'flex-[2]', canSubmit && !isSubmitting ? 'bg-[#00ad74] text-white hover:bg-[#009c68]' : 'bg-white/10 text-white/40 cursor-not-allowed disabled:opacity-50')}>
                {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> {uploadStep || 'Uploading…'}</> : isEditing ? <><CheckCircle2 className="w-4 h-4" /> Save changes</> : <><Upload className="w-4 h-4" /> Publish video</>}
              </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}