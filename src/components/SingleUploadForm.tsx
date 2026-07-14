import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Upload, Music2, Image as ImageIcon, Loader2, Calendar as CalendarIcon,
  CheckCircle2, FileAudio, ChevronRight, X, AlertCircle
} from "lucide-react";
import { format } from "date-fns";
import { supabase, getArtistProfile } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
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
import { useLocation } from '../hooks/useLocation';
import { LoadingLogo } from './LoadingLogo';
import { cn } from '../lib/utils';
import { AdminUploadContext, resolveContentOwnerUserId } from '../lib/adminUploadContext';

interface Genre { id: string; name: string; }
interface Subgenre { id: string; name: string; parent_genre_id: string; }
interface Mood { id: string; name: string; description?: string; }
interface ArtistProfile { 
  id: string; 
  stage_name: string; 
  artist_id: string | null;
  bio?: string;
  profile_photo_url?: string;
  is_verified?: boolean;
}

/* ── Step indicator ── */
const STEPS = ["Files", "Details", "Metadata"] as const;
type Step = 0 | 1 | 2;

interface SingleUploadFormProps {
  onClose?: () => void;
  onSuccess?: () => void;
  adminUploadContext?: AdminUploadContext;
}

const SingleUploadForm = ({ onClose, onSuccess, adminUploadContext }: SingleUploadFormProps) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { location } = useLocation(true);
  const { addUpload, updateUploadProgress, updateUploadStatus } = useUpload();
  const mountedRef = useRef(true);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const [artistProfile, setArtistProfile] = useState<ArtistProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [currentStep, setCurrentStep] = useState<Step>(0);

  // Form
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [releaseDate, setReleaseDate] = useState<Date>();
  const [releaseTime, setReleaseTime] = useState<string>('00:00');
  const [genreId, setGenreId] = useState("");
  const [subgenreId, setSubgenreId] = useState("");
  const [selectedMoods, setSelectedMoods] = useState<string[]>([]);
  const [featuredArtist, setFeaturedArtist] = useState("");

  // Files
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  // Reference data
  const [genres, setGenres] = useState<Genre[]>([]);
  const [subgenres, setSubgenres] = useState<Subgenre[]>([]);
  const [moods, setMoods] = useState<Mood[]>([]);

  // Upload
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [compressionStatus, setCompressionStatus] = useState<string | null>(null);
  const [uploadTaskId, setUploadTaskId] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const ownerUserId = resolveContentOwnerUserId(adminUploadContext, user?.id);

  useEffect(() => {
    if (!adminUploadContext && !user) {
      navigate('/');
      return;
    }
    if (!ownerUserId) {
      if (mountedRef.current) setLoadingProfile(false);
      return;
    }
    (async () => {
      try {
        let profile = adminUploadContext ? null : await getArtistProfile();
        if (!mountedRef.current) return;
        // Fallback: if cache returned null, fetch directly (creators may have profile that cache missed)
        if (!profile) {
          const { data: directProfile, error } = await supabase
            .from('artist_profiles')
            .select('id, user_id, stage_name, artist_id, bio, profile_photo_url, is_verified')
            .eq('user_id', ownerUserId)
            .maybeSingle();
          if (!mountedRef.current) return;
          if (!error && directProfile) profile = directProfile;
        }
        if (profile) {
          setArtistProfile({
            id: profile.id,
            stage_name: profile.stage_name,
            artist_id: profile.artist_id ?? null,
            bio: profile.bio,
            profile_photo_url: profile.profile_photo_url,
            is_verified: profile.is_verified
          });
        }
      } catch (err) {
        console.error("[SingleUpload] Profile error:", err);
      } finally {
        if (mountedRef.current) setLoadingProfile(false);
      }
    })();
  }, [user, navigate, adminUploadContext, ownerUserId]);

  useEffect(() => {
    const load = async () => {
      const [genreRes, subgenreRes, moodRes] = await Promise.all([
        supabase.from("genres").select("id, name").order("name"),
        supabase.from("subgenres").select("id, name, parent_genre_id").eq("is_active", true).order("name"),
        supabase.from("mood_categories").select("id, name, description").eq("is_active", true).order("name"),
      ]);
      if (!mountedRef.current) return;
      if (genreRes.data) setGenres(genreRes.data);
      if (subgenreRes.data) setSubgenres(subgenreRes.data);
      if (moodRes.data) setMoods(moodRes.data);
    };
    load();
  }, []);

  const filteredSubgenres = genreId ? subgenres.filter((s) => s.parent_genre_id === genreId) : [];

  useEffect(() => { setSubgenreId(""); }, [genreId]);

  const handleAudioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const validation = validateAudioFile(file);
      if (!validation.valid) {
        setError(validation.error || 'Please upload a valid audio file.');
        setAudioFile(null);
        return;
      }
      setAudioFile(file);
      setError(null);
    }
  };

  const handleCoverChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const validation = validateImageFile(file);
      if (!validation.valid) {
        setError(validation.error || 'Please upload a valid image file.');
        setCoverFile(null);
        return;
      }

      setError(null);
      setCompressionStatus('Compressing cover image to 467x467px...');

      try {
        const result = await compressAlbumCover(file, 467, 200, (status) => {
          setCompressionStatus(status);
        });

        setCoverFile(result.file);
        setCompressionStatus(null);

        if (coverPreview) {
          URL.revokeObjectURL(coverPreview);
        }
        const url = URL.createObjectURL(result.file);
        setCoverPreview(url);
      } catch (compressionError) {
        console.error('Image compression failed:', compressionError);
        setError('Failed to compress image. Please try a different image.');
        setCompressionStatus(null);
        setCoverFile(null);
      }
    }
  };

  const toggleMood = (moodId: string) => {
    setSelectedMoods((prev) =>
      prev.includes(moodId) ? prev.filter((id) => id !== moodId) : [...prev, moodId]
    );
  };

  const canProceedStep0 = !!audioFile;
  const canProceedStep1 = !!title.trim() && !!genreId;

  const handleNext = () => {
    if (currentStep < 2) setCurrentStep((s) => (s + 1) as Step);
  };
  const handleBack = () => {
    if (currentStep > 0) setCurrentStep((s) => (s - 1) as Step);
  };

  // Extract duration from an audio file client-side
  const getAudioDuration = (file: File): Promise<number | null> =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const audio = new Audio();
      audio.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Math.round(audio.duration)); };
      audio.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      audio.src = url;
    });

  const uploadFile = async (file: File, contentType: 'audio' | 'image', taskId?: string): Promise<string> => {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        throw new Error('Authentication required');
      }

      const customPath = contentType === 'image' ? 'covers' : 'audio';

      console.log(`🎵 Uploading ${contentType}: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

      const uploadUserId = ownerUserId ?? session.user.id;
      const result = await directUploadToBunny(file, {
        userId: uploadUserId,
        contentType,
        customPath,
        onProgress: (percent) => {
          setCompressionStatus(`Uploading: ${percent.toFixed(0)}%`);
          const currentTaskId = taskId || uploadTaskId;
          if (currentTaskId) {
            updateUploadProgress(currentTaskId, percent);
          }
        },
      });

      if (!result.success || !result.publicUrl) {
        throw new Error(result.error || 'Upload failed - no URL returned');
      }

      console.log('✅ Upload successful:', result.publicUrl);
      setCompressionStatus(null);
      return result.publicUrl;
    } catch (error) {
      console.error('Error uploading file to Bunny.net:', error);
      setCompressionStatus(null);
      throw new Error(`Upload failed for ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleUpload = async () => {
    if (!ownerUserId || !artistProfile) return;
    if (!title.trim() || !audioFile || !genreId) return;

    setUploading(true);
    setUploadProgress(0);
    setError(null);

    const taskId = `song-${Date.now()}`;
    setUploadTaskId(taskId);

    addUpload({
      id: taskId,
      type: 'single',
      title: title.trim()
    });

    try {
      const { data: { session }, error: authError } = await supabase.auth.getSession();
      if (authError || !session?.user) {
        throw new Error('User not authenticated. Please sign in.');
      }

      // Extract duration before uploading
      const durationSeconds = await getAudioDuration(audioFile);
      setUploadProgress(5);

      // Upload audio file
      const audioPublicUrl = await uploadFile(audioFile, 'audio', taskId);
      setUploadProgress(50);

      // Upload cover if provided
      let coverUrl: string | null = null;
      if (coverFile) {
        coverUrl = await uploadFile(coverFile, 'image', taskId);
      }
      setUploadProgress(75);

      // Resolve artist_id and display name — fetch by user_id so we always get current DB values
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const { data: freshProfileById } = await supabase
        .from('artist_profiles')
        .select('artist_id, stage_name')
        .eq('id', artistProfile.id)
        .maybeSingle();
      const { data: freshProfileByUser } = await supabase
        .from('artist_profiles')
        .select('artist_id, stage_name')
        .eq('user_id', ownerUserId)
        .maybeSingle();

      const freshProfile = freshProfileById || freshProfileByUser;
      let resolvedArtistId = freshProfile?.artist_id ?? artistProfile.artist_id ?? null;
      // Prefer stage_name from profile; fallback to user display_name so uploads always have a name
      let stageName =
        (freshProfile?.stage_name && freshProfile.stage_name.trim()) ||
        (artistProfile.stage_name && String(artistProfile.stage_name).trim()) ||
        '';

      if (!stageName) {
        const { data: userRow } = await supabase
          .from('users')
          .select('display_name')
          .eq('id', ownerUserId)
          .maybeSingle();
        stageName = userRow?.display_name || '';
      }
      if (!stageName && !adminUploadContext) {
        stageName = authUser?.user_metadata?.display_name || '';
      }
      stageName = String(stageName || '').trim();

      if (!resolvedArtistId) {
        if (!stageName) {
          throw new Error('Artist stage name is missing. Please complete your artist profile (or set your display name) before uploading.');
        }

        const { data: existingArtist } = await supabase
          .from('artists')
          .select('id')
          .ilike('name', stageName.trim())
          .maybeSingle();

        if (!existingArtist) {
          const createArtistResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-artist`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: stageName.trim(),
              bio: artistProfile.bio || null,
              image_url: artistProfile.profile_photo_url || null,
              verified: artistProfile.is_verified || false
            }),
          });

          if (!createArtistResponse.ok) {
            const errorData = await createArtistResponse.json().catch(() => ({}));
            throw new Error(`Failed to create artist record: ${errorData.error || 'Unknown error'}`);
          }

          const createResult = await createArtistResponse.json();
          if (!createResult.success) {
            throw new Error(`Failed to create artist record: ${createResult.error}`);
          }

          resolvedArtistId = createResult.artist.id;
        } else {
          resolvedArtistId = existingArtist.id;
        }

        // Always sync artist_id back to the profile
        await supabase
          .from('artist_profiles')
          .update({ artist_id: resolvedArtistId })
          .eq('id', artistProfile.id);
      }

      setUploadProgress(80);

      // Insert into songs table
      let songId: string | null = null;
      {
        const { data: songData, error: songErr } = await supabase.from("songs").insert({
          title: title.trim(),
          artist_id: resolvedArtistId,
          audio_url: audioPublicUrl,
          cover_image_url: coverUrl,
          release_date: releaseDate ? format(releaseDate, "yyyy-MM-dd") : null,
          country: location?.location?.countryCode ?? null,
          play_count: 0,
          album_id: null,
          duration_seconds: durationSeconds,
          featured_artists: featuredArtist ? [featuredArtist] : null,
        }).select("id").single();

        if (songErr) {
          console.error("[SingleUpload] songs insert error:", songErr);
          throw new Error(`Failed to save song: ${songErr.message}`);
        } else if (songData?.id) {
          songId = songData.id;

          // Link genre, subgenre, moods
          const genreInsert = supabase.from("song_genres").insert({ song_id: songId, genre_id: genreId });
          const subgenreInsert = subgenreId
            ? supabase.from("song_subgenres").insert({ song_id: songId, subgenre_id: subgenreId })
            : Promise.resolve();
          const moodInsert = selectedMoods.length > 0
            ? supabase.from("song_moods").insert(selectedMoods.map((mood_id) => ({ song_id: songId!, mood_id, confidence_score: 1.0 })))
            : Promise.resolve();
          await Promise.allSettled([genreInsert, subgenreInsert, moodInsert]);
        }
      }

      setUploadProgress(90);

      // Insert content_uploads
      const metadata: Record<string, unknown> = {
        song_id: songId,
        audio_url: audioPublicUrl,
        cover_url: coverUrl,
        duration_seconds: durationSeconds,
        genre_id: genreId,
        subgenre_id: subgenreId || null,
        mood_ids: selectedMoods,
        featured_artist: featuredArtist || null,
        release_date: releaseDate ? (releaseTime ? `${format(releaseDate, "yyyy-MM-dd")}T${releaseTime}:00` : format(releaseDate, "yyyy-MM-dd")) : null,
      };
      // songs.release_date is date-only for DB; full datetime lives in content_uploads.metadata.release_date

      const { error: insertErr } = await supabase.from("content_uploads").insert({
        user_id: ownerUserId,
        artist_profile_id: artistProfile.id,
        content_type: "single",
        title: title.trim(),
        description: description.trim() || null,
        status: "approved",
        metadata,
      });

      if (insertErr) throw insertErr;

      setUploadProgress(100);

      // Update upload status
      updateUploadStatus(taskId, 'completed');

      // Bust caches
      if (songId) {
        cache.deletePattern(`song.*${songId}`);
        cache.deletePattern('trending.*');
        cache.deletePattern('home.*');
        cache.deletePattern('new.*release.*');
        cache.deletePattern('explore.*');
        await smartCache.invalidate(`song.*${songId}`);
        await smartCache.invalidate('trending.*');
        await smartCache.invalidate('home.*');
        await smartCache.invalidate('new.*release.*');
        await smartCache.invalidate('explore.*');
      }

      // Success - call onSuccess if provided (e.g. close form in CreateScreen), else navigate to profile
      setTimeout(() => {
        if (onSuccess) {
          onSuccess();
        } else {
          navigate('/profile');
        }
      }, 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[SingleUpload] Error:", err);
      setError(message);
      updateUploadStatus(taskId, 'error', message);
    } finally {
      if (mountedRef.current) { 
        setUploading(false); 
        setUploadProgress(0); 
      }
    }
  };

  /* ── Guards ── */
  if (loadingProfile) {
    return (
      <div className="flex flex-col min-h-screen min-h-[100dvh] bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] items-center justify-center">
        <LoadingLogo variant="pulse" size={48} />
      </div>
    );
  }

  if (!adminUploadContext && !user) { 
    navigate("/"); 
    return null; 
  }

  if (!artistProfile) {
    return (
      <div className="flex flex-col min-h-screen min-h-[100dvh] overflow-y-auto bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav font-['Inter',sans-serif]">
        <div className="flex-1 flex flex-col items-center justify-center gap-5 px-3">
          <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center">
            <Music2 className="w-7 h-7 text-white/60" />
          </div>
          <div className="text-center space-y-1.5">
            <h2 className="text-xl font-semibold tracking-tight text-white">Artist Profile Required</h2>
            <p className="text-sm text-white/60 max-w-xs">
              {adminUploadContext
                ? `${adminUploadContext.targetDisplayName || 'This user'} needs an artist profile before content can be uploaded.`
                : 'Register as an artist to start uploading your music.'}
            </p>
          </div>
          {adminUploadContext ? (
            <button
              onClick={() => onClose?.()}
              className="px-6 py-3 bg-white/10 hover:bg-white/15 text-white rounded-full font-medium transition-all active:scale-95"
            >
              Go back
            </button>
          ) : (
            <button
              onClick={() => navigate("/artist-registration")}
              className="px-6 py-3 bg-[#00ad74] hover:bg-[#009c68] active:bg-[#008a5d] text-white rounded-full font-medium transition-all active:scale-95"
            >
              Register as Artist
            </button>
          )}
        </div>
      </div>
    );
  }

  const stepCompleteness = currentStep === 0
    ? (audioFile ? 100 : 0)
    : currentStep === 1
    ? (title && genreId ? 100 : title ? 50 : 0)
    : selectedMoods.length > 0 ? 60 : 20;

  return (
    <div className="flex flex-col min-h-screen min-h-[100dvh] overflow-y-auto bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav font-['Inter',sans-serif]">
      {/* ── Page header: back + title (same format as AlbumUploadForm “Curate your collection”) ── */}
      <header className="w-full py-5 px-5 sticky top-0 z-20 flex-shrink-0 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => (onClose ? onClose() : (window.history.length > 1 ? navigate(-1) : navigate('/')))}
            className="p-2 -ml-2 hover:bg-white/10 rounded-full transition-all duration-200 touch-manipulation flex-shrink-0"
            aria-label="Back"
          >
            <ArrowLeft className="w-6 h-6 text-white" />
          </button>
          <h1 className="font-['Inter',sans-serif] text-3xl font-black tracking-tight text-white leading-none">
            Release your<br />
            <span className="font-light italic text-white/60">track.</span>
          </h1>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-5 py-5 space-y-8 pb-28 w-full">
          {/* ── Step Navigator ── */}
          <div>
            <div className="flex items-center gap-0 mb-3">
              {STEPS.map((label, i) => {
                const isActive = i === currentStep;
                const isDone = i < currentStep;
                return (
                  <div key={label} className="flex items-center flex-1 last:flex-none">
                    <button
                      onClick={() => i < currentStep && setCurrentStep(i as Step)}
                      disabled={i > currentStep}
                      className={cn(
                        "flex items-center gap-2 text-xs font-semibold transition-colors min-h-[44px] touch-manipulation",
                        isActive && "text-white",
                        isDone && "text-white cursor-pointer",
                        !isActive && !isDone && "text-white/30 cursor-default"
                      )}
                    >
                      <span className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all",
                        isActive && "bg-[#00ad74] text-white ring-2 ring-[#00ad74]/30 ring-offset-2 ring-offset-[#0a0a0a]",
                        isDone && "bg-[#00ad74]/20 text-[#00ad74]",
                        !isActive && !isDone && "bg-white/10 text-white/30"
                      )}>
                        {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
                      </span>
                      {label}
                    </button>
                    {i < STEPS.length - 1 && (
                      <div className={cn(
                        "flex-1 h-px mx-3 transition-colors",
                        i < currentStep ? "bg-[#00ad74]/40" : "bg-white/10"
                      )} />
                    )}
                  </div>
                );
              })}
            </div>
            {/* Step progress bar */}
            <div className="h-0.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#00ad74] rounded-full transition-all duration-500"
                style={{ width: `${((currentStep / 2) * 100) + (stepCompleteness / 3)}%` }}
              />
            </div>
          </div>

          {/* ══════════════════════════════
              STEP 0 — FILES
          ══════════════════════════════ */}
          {currentStep === 0 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold tracking-tight text-white">Upload your files</h2>
                <p className="text-sm text-white/60">Add your audio file to get started. Cover art is optional.</p>
              </div>

              {/* Audio Drop Zone */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block">
                  Audio File <span className="text-[#00ad74]">*</span>
                </label>
                <label
                  className={cn(
                    "group relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-8 sm:p-12 cursor-pointer transition-all duration-200 min-h-[180px]",
                    audioFile
                      ? "border-[#00ad74]/40 bg-[#00ad74]/5"
                      : "border-white/10 hover:border-[#00ad74]/40 hover:bg-[#00ad74]/5"
                  )}
                >
                  <input
                    ref={audioInputRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={handleAudioChange}
                  />
                  {audioFile ? (
                    <>
                      <div className="w-14 h-14 rounded-2xl bg-[#00ad74]/20 flex items-center justify-center">
                        <FileAudio className="w-7 h-7 text-[#00ad74]" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-semibold text-white">{audioFile.name}</p>
                        <p className="text-xs text-white/60 mt-0.5">
                          {(audioFile.size / (1024 * 1024)).toFixed(1)} MB
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); setAudioFile(null); }}
                        className="absolute top-3 right-3 min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-white/10 flex items-center justify-center hover:bg-red-500/20 hover:text-red-400 transition-colors touch-manipulation"
                        aria-label="Remove audio file"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center transition-colors group-hover:bg-white/10">
                        <Upload className="w-6 h-6 text-white/60 group-hover:text-[#00ad74] transition-colors" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-semibold text-white">
                          Drop your audio file here
                        </p>
                        <p className="text-xs text-white/60 mt-1">or click to browse</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {["MP3", "WAV", "FLAC", "AAC"].map((fmt) => (
                          <span key={fmt} className="px-2 py-0.5 rounded-md bg-white/10 text-[10px] font-semibold text-white/60">
                            {fmt}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </label>
              </div>

              {/* Cover Art */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block">
                  Cover Art
                </label>
                <div className="flex items-stretch gap-5">
                  <label className="relative w-[120px] h-[120px] min-w-[120px] rounded-2xl border-2 border-dashed border-white/10 cursor-pointer overflow-hidden shrink-0 transition-all hover:border-[#00ad74]/40 group">
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleCoverChange}
                    />
                    {coverPreview ? (
                      <>
                        <img src={coverPreview} alt="Cover" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <ImageIcon className="w-5 h-5 text-white" />
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); setCoverFile(null); setCoverPreview(null); }}
                          className="absolute top-2 right-2 min-w-[44px] min-h-[44px] w-11 h-11 rounded-full bg-black/80 flex items-center justify-center hover:bg-red-500/80 transition-colors opacity-0 group-hover:opacity-100 touch-manipulation"
                          aria-label="Remove cover art"
                        >
                          <X className="w-4 h-4 text-white" />
                        </button>
                      </>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1.5">
                        <ImageIcon className="w-6 h-6 text-white/60 group-hover:text-[#00ad74] transition-colors" />
                        <span className="text-[10px] text-white/60 font-medium">Add art</span>
                      </div>
                    )}
                  </label>

                  <div className="flex flex-col justify-center gap-3 py-1">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {coverFile ? coverFile.name : "Album artwork"}
                      </p>
                      <p className="text-xs text-white/60 mt-0.5">
                        {coverFile
                          ? `${(coverFile.size / 1024).toFixed(0)} KB`
                          : "Recommended: 3000×3000px square"
                        }
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[11px] text-white/60">• JPG, PNG, WebP supported</p>
                      <p className="text-[11px] text-white/60">• Minimum 500 × 500px</p>
                      <p className="text-[11px] text-white/60">• Square format preferred</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Compression Status */}
              {compressionStatus && (
                <div className="rounded-xl border border-[#00ad74]/30 bg-[#00ad74]/10 p-4 sm:p-5">
                  <div className="flex items-center gap-4">
                    <Loader2 className="w-5 h-5 animate-spin text-[#00ad74]" />
                    <p className="text-sm text-white">{compressionStatus}</p>
                  </div>
                </div>
              )}

              {/* File checklist + CTA */}
              <div className={cn(
                "rounded-2xl border p-5 space-y-4 transition-all duration-300",
                canProceedStep0 ? "border-[#00ad74]/30 bg-[#00ad74]/5" : "border-white/10 bg-white/5"
              )}>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">Upload checklist</p>
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5">
                    <div className={cn(
                      "w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors",
                      audioFile ? "bg-[#00ad74]/20 text-[#00ad74]" : "bg-white/10 text-white/40"
                    )}>
                      {audioFile
                        ? <CheckCircle2 className="w-3.5 h-3.5" />
                        : <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      }
                    </div>
                    <span className={cn("text-sm transition-colors", audioFile ? "text-white font-medium" : "text-white/60")}>
                      Audio file {audioFile ? `— ${audioFile.name}` : "(required)"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className={cn(
                      "w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors",
                      coverFile ? "bg-[#00ad74]/20 text-[#00ad74]" : "bg-white/10 text-white/30"
                    )}>
                      {coverFile
                        ? <CheckCircle2 className="w-3.5 h-3.5" />
                        : <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      }
                    </div>
                    <span className={cn("text-sm transition-colors", coverFile ? "text-white font-medium" : "text-white/60")}>
                      Cover art {coverFile ? `— ${coverFile.name}` : "(optional)"}
                    </span>
                  </div>
                </div>

                <button
                  onClick={handleNext}
                  disabled={!canProceedStep0}
                  className={cn(
                    "w-full rounded-xl min-h-[48px] h-12 font-semibold gap-2 mt-2 transition-all flex items-center justify-center touch-manipulation",
                    canProceedStep0
                      ? "bg-[#00ad74] hover:bg-[#009c68] active:bg-[#008a5d] text-white"
                      : "bg-white/10 text-white/40 cursor-not-allowed"
                  )}
                >
                  {canProceedStep0 ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Continue to Details
                      <ChevronRight className="w-4 h-4 ml-auto" />
                    </>
                  ) : (
                    <>
                      Add an audio file to continue
                    </>
                  )}
                </button>
              </div>
            </div>
          )}


          {/* ══════════════════════════════
              STEP 1 — DETAILS
          ══════════════════════════════ */}
          {currentStep === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold tracking-tight text-white">Track details</h2>
                <p className="text-sm text-white/60">Name and categorize your release.</p>
              </div>

              {/* Track title */}
              <div className="space-y-2">
                <label htmlFor="title" className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block">
                  Track Title <span className="text-[#00ad74]">*</span>
                </label>
                <input
                  id="title"
                  placeholder="What's this track called?"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full min-h-[48px] h-12 bg-white/5 border border-white/10 focus:border-[#00ad74]/30 focus:ring-2 focus:ring-[#00ad74]/20 text-white placeholder:text-white/40 rounded-xl px-4 outline-none transition-all"
                />
                <p className="text-[11px] text-white/60">{title.length}/100 characters</p>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <label htmlFor="description" className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block">
                  Description
                  <span className="ml-2 text-[10px] normal-case tracking-normal font-normal text-white/40">optional</span>
                </label>
                <textarea
                  id="description"
                  rows={3}
                  placeholder="Tell your audience what this track is about..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#00ad74]/20 focus:border-[#00ad74]/30 resize-none transition-all min-h-[96px]"
                />
              </div>

              {/* Featured Artist */}
              <div className="space-y-2">
                <label htmlFor="featured" className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block">
                  Featured Artist
                  <span className="ml-2 text-[10px] normal-case tracking-normal font-normal text-white/40">optional</span>
                </label>
                <input
                  id="featured"
                  placeholder="e.g. REMA, Burna Boy"
                  value={featuredArtist}
                  onChange={(e) => setFeaturedArtist(e.target.value)}
                  className="w-full min-h-[48px] h-12 bg-white/5 border border-white/10 focus:border-[#00ad74]/30 focus:ring-2 focus:ring-[#00ad74]/20 text-white placeholder:text-white/40 rounded-xl px-4 outline-none transition-all"
                />
              </div>

              {/* Release Date */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block">
                  Release Date
                  <span className="ml-2 text-[10px] normal-case tracking-normal font-normal text-white/40">optional</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="relative">
                    <input
                      type="date"
                      value={releaseDate ? format(releaseDate, "yyyy-MM-dd") : ""}
                      onChange={(e) => setReleaseDate(e.target.value ? new Date(e.target.value) : undefined)}
                      className="w-full min-h-[48px] h-12 bg-white/5 border border-white/10 focus:border-[#00ad74]/30 focus:ring-2 focus:ring-[#00ad74]/20 text-white rounded-xl px-4 outline-none transition-all"
                    />
                    <CalendarIcon className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
                  </div>
                  <input
                    type="time"
                    value={releaseTime}
                    onChange={(e) => setReleaseTime(e.target.value || '00:00')}
                    className="w-full min-h-[48px] h-12 bg-white/5 border border-white/10 focus:border-[#00ad74]/30 focus:ring-2 focus:ring-[#00ad74]/20 text-white rounded-xl px-4 outline-none transition-all"
                  />
                </div>
              </div>

              {/* Genre */}
              <div className="grid grid-cols-1 gap-5">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block">
                    Genre <span className="text-[#00ad74]">*</span>
                  </label>
                  <select
                    value={genreId}
                    onChange={(e) => setGenreId(e.target.value)}
                    className="w-full min-h-[48px] h-12 bg-white/5 border border-white/10 focus:border-[#00ad74]/30 focus:ring-2 focus:ring-[#00ad74]/20 text-white rounded-xl px-4 outline-none transition-all"
                  >
                    <option value="" className="bg-[#0d0d0d]">Select genre</option>
                    {genres.map((g) => (
                      <option key={g.id} value={g.id} className="bg-[#0d0d0d]">{g.name}</option>
                    ))}
                  </select>
                </div>

                {filteredSubgenres.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block">
                      Subgenre
                      <span className="ml-1 text-[10px] normal-case tracking-normal font-normal text-white/40">optional</span>
                    </label>
                    <select
                      value={subgenreId}
                      onChange={(e) => setSubgenreId(e.target.value)}
                      className="w-full min-h-[48px] h-12 bg-white/5 border border-white/10 focus:border-[#00ad74]/30 focus:ring-2 focus:ring-[#00ad74]/20 text-white rounded-xl px-4 outline-none transition-all"
                    >
                      <option value="" className="bg-[#0d0d0d]">Select subgenre</option>
                      {filteredSubgenres.map((s) => (
                        <option key={s.id} value={s.id} className="bg-[#0d0d0d]">{s.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Error Message */}
              {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 sm:p-5">
                  <div className="flex items-start gap-4">
                    <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-red-200">{error}</p>
                  </div>
                </div>
              )}

              {/* Navigation */}
              <div className="pt-4 flex gap-3">
                <button
                  onClick={handleBack}
                  className="flex-1 rounded-xl min-h-[48px] gap-2 text-white/60 hover:text-white transition-colors flex items-center justify-center touch-manipulation border border-white/10"
                  aria-label="Back"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
                <button
                  onClick={handleNext}
                  disabled={!canProceedStep1}
                  className={cn(
                    "flex-1 rounded-xl min-h-[48px] h-12 font-semibold gap-2 transition-all flex items-center justify-center touch-manipulation",
                    canProceedStep1
                      ? "bg-[#00ad74] hover:bg-[#009c68] active:bg-[#008a5d] text-white"
                      : "bg-white/10 text-white/40 cursor-not-allowed"
                  )}
                >
                  Continue
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ══════════════════════════════
              STEP 2 — METADATA / MOODS
          ══════════════════════════════ */}
          {currentStep === 2 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold tracking-tight text-white">Mood & metadata</h2>
                <p className="text-sm text-white/60">
                  Help listeners discover you through moods that match your sound.
                </p>
              </div>

              {/* Mood selector */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-[0.12em] text-white/60 block">
                    Moods
                  </label>
                  {selectedMoods.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedMoods([])}
                      className="text-[11px] text-white/60 hover:text-white transition-colors"
                    >
                      Clear all
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {moods.map((mood) => {
                    const isSelected = selectedMoods.includes(mood.id);
                    return (
                      <button
                        key={mood.id}
                        type="button"
                        onClick={() => toggleMood(mood.id)}
                        className={cn(
                          "min-h-[44px] px-4 py-2.5 rounded-full text-xs font-semibold border transition-all duration-150 touch-manipulation",
                          isSelected
                            ? "bg-[#00ad74] text-white border-[#00ad74] shadow-[0_0_12px_rgba(0,173,116,0.25)]"
                            : "bg-white/5 text-white/60 border-white/10 hover:border-[#00ad74]/40 hover:text-white"
                        )}
                      >
                        {mood.name}
                      </button>
                    );
                  })}
                </div>
                {selectedMoods.length > 0 && (
                  <p className="text-[11px] text-white/60">
                    {selectedMoods.length} mood{selectedMoods.length !== 1 ? "s" : ""} selected
                  </p>
                )}
              </div>

              {/* Review summary card */}
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6 space-y-4">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">Release Summary</p>
                <div className="flex items-center gap-4">
                  {coverPreview ? (
                    <img src={coverPreview} alt="Cover" className="w-16 h-16 rounded-xl object-cover shrink-0" />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                      <Music2 className="w-6 h-6 text-white/60" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-base font-bold text-white truncate">{title}</p>
                    {featuredArtist && (
                      <p className="text-xs text-white/60 mt-0.5">ft. {featuredArtist}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5">
                      {genreId && genres.find(g => g.id === genreId) && (
                        <span className="px-2 py-0.5 rounded-md bg-white/10 text-[10px] font-semibold text-white/60">
                          {genres.find(g => g.id === genreId)?.name}
                        </span>
                      )}
                      {audioFile && (
                        <span className="text-[11px] text-white/60">
                          {audioFile.name.split('.').pop()?.toUpperCase()} · {(audioFile.size / (1024 * 1024)).toFixed(1)} MB
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-white/10">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40 mb-0.5">Release date</p>
                    <p className="text-xs font-medium text-white">
                      {releaseDate ? (releaseTime && releaseTime !== '00:00' ? `${format(releaseDate, "MMM d, yyyy")} at ${releaseTime}` : format(releaseDate, "MMM d, yyyy")) : "Immediate"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40 mb-0.5">Moods</p>
                    <p className="text-xs font-medium text-white">
                      {selectedMoods.length > 0 ? `${selectedMoods.length} selected` : "None"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Upload progress */}
              {uploading && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-white">Uploading to Bunny Storage…</p>
                    <p className="text-xs font-semibold text-white">{uploadProgress}%</p>
                  </div>
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-[#00ad74] rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-white/60">
                    {uploadProgress < 50 ? "Processing audio file…" : uploadProgress < 80 ? "Uploading cover art…" : "Finalizing…"}
                  </p>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 sm:p-5">
                  <div className="flex items-start gap-4">
                    <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-red-200">{error}</p>
                  </div>
                </div>
              )}

              {/* Navigation */}
              <div className="pt-4 flex gap-3">
                <button
                  onClick={handleBack}
                  disabled={uploading}
                  className="flex-1 rounded-xl min-h-[48px] gap-2 text-white/60 hover:text-white transition-colors flex items-center justify-center disabled:opacity-50 touch-manipulation border border-white/10"
                  aria-label="Back"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className={cn(
                    "flex-1 rounded-xl min-h-[48px] h-12 font-semibold gap-2 transition-all flex items-center justify-center touch-manipulation",
                    uploading
                      ? "bg-white/10 text-white/40 cursor-not-allowed"
                      : "bg-[#00ad74] hover:bg-[#009c68] active:bg-[#008a5d] text-white"
                  )}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Publish Track
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

      </div>
    </div>
  );
};

export default SingleUploadForm;
