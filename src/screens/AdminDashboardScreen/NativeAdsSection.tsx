import { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Eye, EyeOff, ExternalLink, TrendingUp, CreditCard, Upload, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { NativeAdCard } from '../../lib/nativeAdService';
import { LoadingLogo } from '../../components/LoadingLogo';
import { directUploadToBunny } from '../../lib/directBunnyUpload';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const AUDIO_AD_PLACEHOLDER_IMAGE_URL = 'https://placehold.co/1200x1200/111827/FFFFFF?text=Audio+Ad';
const AUDIO_AD_DEFAULT_CLICK_URL = 'https://airaplay.com';
const AUDIO_MIME_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm'];
const VISUAL_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'video/mp4', 'video/webm', 'video/quicktime'];

type UploadedMediaType = 'visual' | 'audio';
type ListFilterType = 'all' | 'visual' | 'audio';
type StatusFilterType = 'all' | 'running' | 'finished';

const PLAYER_ONLY_PLACEMENTS = ['music_player', 'album_player', 'playlist_player', 'daily_mix_player'] as const;
const ALL_PLACEMENTS = [
  'home_popup',
  'trending_near_you_grid',
  'explore_grid',
  'home_grid',
  'home_featured_banner',
  'home_featured_banner_secondary',
  'music_player_popup',
  'album_player_popup',
  'playlist_player_popup',
  'daily_mix_player_popup',
  ...PLAYER_ONLY_PLACEMENTS,
] as const;

const PLACEMENT_LABELS: Record<string, string> = {
  home_popup: 'Home Screen Popup',
  trending_near_you_grid: 'Trending Near You',
  explore_grid: 'Explore Grid',
  home_grid: 'Home Grid',
  home_featured_banner: 'Home Featured Banner',
  home_featured_banner_secondary: 'Home Featured Banner 2',
  music_player: 'Music Player Screen',
  album_player: 'Album Player Screen',
  playlist_player: 'Playlist Player Screen',
  daily_mix_player: 'Daily Mix Player Screen',
  music_player_popup: 'Music Player Popup',
  album_player_popup: 'Album Player Popup',
  playlist_player_popup: 'Playlist Player Popup',
  daily_mix_player_popup: 'Daily Mix Player Popup',
};

export const NativeAdsSection = (): JSX.Element => {
  const [ads, setAds] = useState<NativeAdCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingAd, setEditingAd] = useState<NativeAdCard | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [companionImageFile, setCompanionImageFile] = useState<File | null>(null);
  const [companionImagePreviewUrl, setCompanionImagePreviewUrl] = useState<string | null>(null);
  const [selectedMediaType, setSelectedMediaType] = useState<UploadedMediaType>('visual');
  const [selectedPlacementTypes, setSelectedPlacementTypes] = useState<string[]>(['trending_near_you_grid']);
  const [listFilterType, setListFilterType] = useState<ListFilterType>('all');
  const [statusFilterType, setStatusFilterType] = useState<StatusFilterType>('all');

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    image_url: '',
    companion_image_url: '',
    companion_cta_text: '',
    click_url: '',
    advertiser_name: '',
    placement_type: 'trending_near_you_grid',
    priority: 5,
    is_active: true,
    target_countries: '',
    target_genders: '',
    target_age_min: '',
    target_age_max: '',
    audio_insertion_interval_songs: 5,
    target_genres: '',
    expires_at: ''
  });

  useEffect(() => {
    fetchNativeAds();
  }, []);

  const openCreateForm = () => {
    if (showForm) {
      setShowForm(false);
      return;
    }
    // When admin is currently on the Audio Ads filter, default new ad form to audio mode.
    // This keeps "Audio tab" intent aligned with create flow.
    if (!editingAd && listFilterType === 'audio') {
      setSelectedMediaType('audio');
      setFormData((prev) => ({
        ...prev,
        click_url: prev.click_url || AUDIO_AD_DEFAULT_CLICK_URL,
      }));
    } else if (!editingAd) {
      setSelectedMediaType('visual');
    }
    setShowForm(true);
  };

  const fetchNativeAds = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('native_ad_cards')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      const rows = (data || []) as NativeAdCard[];

      // Auto-finish expired ads so they no longer show as "running".
      // "Finished" in the admin UI is derived from either `expires_at` or `is_active=false`,
      // but persisting `is_active=false` makes status consistent across surfaces.
      const now = Date.now();
      const expiredStillActiveIds = rows
        .filter((ad) => !!ad.expires_at && new Date(ad.expires_at).getTime() <= now && ad.is_active)
        .map((ad) => ad.id);

      if (expiredStillActiveIds.length > 0) {
        const { error: expireUpdateError } = await supabase
          .from('native_ad_cards')
          .update({ is_active: false })
          .in('id', expiredStillActiveIds);

        if (expireUpdateError) {
          // Do not block rendering list on best-effort auto-finish.
          console.warn('Failed to auto-finish expired native ads:', expireUpdateError);
        } else {
          for (const ad of rows) {
            if (expiredStillActiveIds.includes(ad.id)) {
              ad.is_active = false;
            }
          }
        }
      }

      setAds(rows);
    } catch (err) {
      console.error('Error fetching native ads:', err);
      setError('Failed to load native ads');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVisual = VISUAL_MIME_TYPES.includes(file.type);
    const isAudio = AUDIO_MIME_TYPES.includes(file.type);
    const expectedMimeTypes = selectedMediaType === 'audio' ? AUDIO_MIME_TYPES : VISUAL_MIME_TYPES;
    const isTypeAllowed = expectedMimeTypes.includes(file.type);

    if (!isVisual && !isAudio) {
      setError('Unsupported file type. Please select a valid ad media file (max 20MB).');
      return;
    }

    if (!isTypeAllowed) {
      setError(
        selectedMediaType === 'audio'
          ? 'Audio ad selected: please upload an audio file (MP3, M4A, AAC, WAV, OGG, WEBM).'
          : 'Visual ad selected: please upload an image/video file (JPG, PNG, WEBP, MP4, WEBM, MOV).'
      );
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setError('File size must be less than 20MB');
      return;
    }

    setSelectedFile(file);
    setError(null);
    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(URL.createObjectURL(file));
  };

  const uploadMedia = async (): Promise<{ url: string; type: UploadedMediaType } | null> => {
    if (!selectedFile) {
      return null;
    }

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      throw new Error('Authentication session expired. Please sign in again.');
    }

    const mediaType: UploadedMediaType = AUDIO_MIME_TYPES.includes(selectedFile.type) ? 'audio' : 'visual';
    const isVideoCreative = mediaType === 'visual' && selectedFile.type.startsWith('video/');

    // Do not depend on Edge Function transport for audio ad uploads.
    // This avoids "Failed to send a request to the Edge Function" failures in admin.
    if (mediaType === 'audio') {
      const audioUpload = await uploadAudioToSupabaseStorage(selectedFile, session.user.id);
      if (!audioUpload.url) {
        throw new Error(audioUpload.error || 'Failed to upload audio ad media to storage. Please try again.');
      }
      return { url: audioUpload.url, type: mediaType };
    }

    if (isVideoCreative) {
      const bunnyStreamUrl = await uploadVideoToBunnyStream(selectedFile);
      if (!bunnyStreamUrl) {
        throw new Error('Failed to upload video to Bunny Stream. Please try again.');
      }
      return { url: bunnyStreamUrl, type: mediaType };
    }

    const uploadResult = await directUploadToBunny(selectedFile, {
      userId: session.user.id,
      contentType: mediaType === 'audio' ? 'audio' : 'image',
      // Keep ad visuals in thumbnails-like public paths when image upload is routed via Supabase.
      customPath: mediaType === 'visual' ? 'thumbnails' : undefined,
    });
    if (uploadResult.success && uploadResult.publicUrl) {
      return { url: uploadResult.publicUrl, type: mediaType };
    }

    throw new Error(`Failed to upload media: ${uploadResult.error || 'Unknown upload error'}`);
  };

  const uploadCompanionImage = async (file: File): Promise<string> => {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      throw new Error('Authentication session expired. Please sign in again.');
    }

    const uploadResult = await directUploadToBunny(file, {
      userId: session.user.id,
      contentType: 'image',
      customPath: 'thumbnails',
    });

    if (!uploadResult.success || !uploadResult.publicUrl) {
      throw new Error(uploadResult.error || 'Failed to upload companion image.');
    }

    return uploadResult.publicUrl;
  };

  const handleCompanionImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (!allowedImageTypes.includes(file.type)) {
      setError('Companion image must be JPG, PNG, or WEBP.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('Companion image size must be less than 20MB.');
      return;
    }

    setCompanionImageFile(file);
    setError(null);

    if (companionImagePreviewUrl && companionImagePreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(companionImagePreviewUrl);
    }
    setCompanionImagePreviewUrl(URL.createObjectURL(file));
  };

  const uploadVideoToBunnyStream = async (file: File): Promise<string | null> => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', file.name.replace(/\.[^/.]+$/, ''));

      const { data, error } = await supabase.functions.invoke('bunny-stream-upload', {
        body: formData,
      });

      if (error) {
        console.error('Bunny Stream upload invoke failed:', error);
        return null;
      }

      const publicUrl = (data as { publicUrl?: string } | null)?.publicUrl;
      if (!publicUrl || typeof publicUrl !== 'string') {
        console.error('Bunny Stream upload returned invalid payload:', data);
        return null;
      }

      return publicUrl;
    } catch (error) {
      console.error('Bunny Stream upload error:', error);
      return null;
    }
  };

  const uploadAudioToSupabaseStorage = async (
    file: File,
    userId: string
  ): Promise<{ url: string | null; error?: string }> => {
    try {
      const fileExt = file.name.split('.').pop() || 'mp3';
      const safeExt = fileExt.toLowerCase().replace(/[^a-z0-9]/g, '');
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${safeExt}`;
      // Keep userId as first folder segment to satisfy storage RLS policies
      // that scope uploads to auth.uid() prefix.
      const filePath = `${userId}/native-ads/${fileName}`;
      const candidateBuckets = ['content-media', 'thumbnails', 'covers'] as const;
      const errors: string[] = [];

      for (const bucket of candidateBuckets) {
        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(filePath, file, {
            cacheControl: '2592000',
            upsert: true,
            contentType: file.type || 'audio/mpeg',
          });

        if (uploadError) {
          const message = uploadError.message || 'Unknown upload error';
          errors.push(`${bucket}: ${message}`);
          continue;
        }

        const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
        if (data?.publicUrl) {
          return { url: data.publicUrl };
        }
      }

      return {
        url: null,
        error: `Audio upload failed across buckets (${errors.join(' | ')})`,
      };
    } catch (error) {
      console.error('Audio fallback upload error:', error);
      return {
        url: null,
        error: error instanceof Error ? error.message : 'Unknown audio upload error',
      };
    }
  };

  const isPlacementTypesSchemaError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return message.toLowerCase().includes("could not find the 'placement_types' column");
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormSuccess(null);
    setError(null);

    try {
      const uploadedMedia = await uploadMedia();
      const isAudioAd = uploadedMedia?.type === 'audio' || (!uploadedMedia && !!editingAd?.audio_url);
      const finalImageUrl = uploadedMedia?.type === 'visual'
        ? uploadedMedia.url
        : (editingAd?.image_url || AUDIO_AD_PLACEHOLDER_IMAGE_URL);
      const finalAudioUrl = uploadedMedia?.type === 'audio'
        ? uploadedMedia.url
        : (isAudioAd ? (editingAd?.audio_url || null) : null);
      const playerOnlyPlacements = new Set([
        ...PLAYER_ONLY_PLACEMENTS,
        'music_player_popup',
        'album_player_popup',
        'playlist_player_popup',
        'daily_mix_player_popup',
      ]);

      if (selectedPlacementTypes.length === 0) {
        throw new Error('Please select at least one placement type.');
      }

      if (finalAudioUrl && selectedPlacementTypes.some((placement) => !playerOnlyPlacements.has(placement))) {
        throw new Error('Audio ads can only be assigned to music player placements.');
      }

      if (!editingAd && !uploadedMedia) {
        throw new Error('Ad media file is required');
      }

      const shouldPersistAudioSettings = isAudioAd || selectedMediaType === 'audio';

      let companionImageUrl = shouldPersistAudioSettings
        ? (editingAd?.companion_image_url || formData.companion_image_url || '')
        : '';

      if (shouldPersistAudioSettings && companionImageFile) {
        companionImageUrl = await uploadCompanionImage(companionImageFile);
      }

      if (shouldPersistAudioSettings && !companionImageUrl) {
        throw new Error('Companion image is required for audio ads.');
      }

      if (selectedMediaType === 'audio' && !(formData.advertiser_name?.trim())) {
        throw new Error('Advertiser name is required for audio ads.');
      }

      const adData = {
        title: formData.title,
        description: formData.description || null,
        image_url: finalImageUrl,
        audio_url: finalAudioUrl,
        companion_image_url: shouldPersistAudioSettings
          ? companionImageUrl
          : null,
        companion_cta_text: shouldPersistAudioSettings
          ? (formData.companion_cta_text?.trim() || null)
          : null,
        click_url: shouldPersistAudioSettings
          ? (formData.click_url?.trim() || AUDIO_AD_DEFAULT_CLICK_URL)
          : (formData.click_url?.trim() || ''),
        advertiser_name: formData.advertiser_name?.trim() || '',
        placement_type: selectedPlacementTypes[0],
        placement_types: selectedPlacementTypes,
        priority: formData.priority,
        is_active: formData.is_active,
        target_countries: formData.target_countries
          ? formData.target_countries.split(',').map(c => c.trim()).filter(Boolean)
          : null,
        target_genders: formData.target_genders
          ? formData.target_genders.split(',').map(g => g.trim().toLowerCase()).filter(Boolean)
          : null,
        target_age_min: formData.target_age_min ? Number(formData.target_age_min) : null,
        target_age_max: formData.target_age_max ? Number(formData.target_age_max) : null,
        audio_insertion_interval_songs: shouldPersistAudioSettings
          ? Number(formData.audio_insertion_interval_songs || 5)
          : null,
        target_genres: formData.target_genres
          ? formData.target_genres.split(',').map(g => g.trim()).filter(Boolean)
          : null,
        expires_at: formData.expires_at || null
      };

      if (editingAd) {
        // Update existing ad
        let { error: updateError } = await supabase
          .from('native_ad_cards')
          .update(adData)
          .eq('id', editingAd.id);

        // Backward compatibility: if DB migration not applied yet, retry without placement_types.
        if (updateError && isPlacementTypesSchemaError(updateError)) {
          const { placement_types, ...legacyPayload } = adData;
          const retry = await supabase
            .from('native_ad_cards')
            .update(legacyPayload)
            .eq('id', editingAd.id);
          updateError = retry.error;
        }

        if (updateError) throw updateError;
        setFormSuccess('Native ad updated successfully!');
      } else {
        // Create new ad
        let { error: insertError } = await supabase
          .from('native_ad_cards')
          .insert(adData);

        // Backward compatibility: if DB migration not applied yet, retry without placement_types.
        if (insertError && isPlacementTypesSchemaError(insertError)) {
          const { placement_types, ...legacyPayload } = adData;
          const retry = await supabase
            .from('native_ad_cards')
            .insert(legacyPayload);
          insertError = retry.error;
        }

        if (insertError) throw insertError;
        setFormSuccess('Native ad created successfully!');
      }

      // Reset form and refresh list
      resetForm();
      fetchNativeAds();
    } catch (err: any) {
      console.error('Error saving native ad:', err);
      setError(err.message || 'Failed to save native ad');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (ad: NativeAdCard) => {
    setEditingAd(ad);
    setFormData({
      title: ad.title,
      description: ad.description || '',
      image_url: ad.image_url,
      companion_image_url: ad.companion_image_url || '',
      companion_cta_text: ad.companion_cta_text ?? '',
      click_url: ad.click_url ?? '',
      advertiser_name: ad.advertiser_name ?? '',
      placement_type: ad.placement_type,
      priority: ad.priority,
      is_active: ad.is_active,
      target_countries: ad.target_countries?.join(', ') || '',
      target_genders: ad.target_genders?.join(', ') || '',
      target_age_min: ad.target_age_min?.toString() || '',
      target_age_max: ad.target_age_max?.toString() || '',
      audio_insertion_interval_songs: [2, 3, 5, 6, 8, 10].includes(Number(ad.audio_insertion_interval_songs))
        ? Number(ad.audio_insertion_interval_songs)
        : 5,
      target_genres: ad.target_genres?.join(', ') || '',
      expires_at: ad.expires_at ? new Date(ad.expires_at).toISOString().split('T')[0] : ''
    });
    setShowForm(true);
    setSelectedFile(null);
    setCompanionImageFile(null);
    setSelectedMediaType(ad.audio_url ? 'audio' : 'visual');
    setSelectedPlacementTypes(
      ad.placement_types && ad.placement_types.length > 0
        ? ad.placement_types
        : [ad.placement_type]
    );
    setPreviewUrl(ad.audio_url || ad.image_url);
    setCompanionImagePreviewUrl(ad.companion_image_url || null);
  };

  const handleToggleActive = async (ad: NativeAdCard) => {
    try {
      const nextIsActive = !ad.is_active;
      const { error: updateError } = await supabase
        .from('native_ad_cards')
        .update({ is_active: nextIsActive })
        .eq('id', ad.id);

      if (updateError) throw updateError;

      // Optimistically update list so the card moves immediately.
      setAds((prev) => prev.map((item) => (item.id === ad.id ? { ...item, is_active: nextIsActive } : item)));

      // If admin just finished (deactivated) an ad while looking at Running,
      // automatically move them to the Finished tab so the ad appears there.
      if (!nextIsActive) {
        setStatusFilterType('finished');
      }

      fetchNativeAds();
    } catch (err) {
      console.error('Error toggling ad status:', err);
      setError('Failed to update ad status');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this native ad?')) return;

    try {
      const { error: deleteError } = await supabase
        .from('native_ad_cards')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;
      fetchNativeAds();
    } catch (err) {
      console.error('Error deleting native ad:', err);
      setError('Failed to delete native ad');
    }
  };

  const resetForm = () => {
    setFormData({
      title: '',
      description: '',
      image_url: '',
      companion_image_url: '',
      companion_cta_text: '',
      click_url: '',
      advertiser_name: '',
      placement_type: 'trending_near_you_grid',
      priority: 5,
      is_active: true,
      target_countries: '',
      target_genders: '',
      target_age_min: '',
      target_age_max: '',
      audio_insertion_interval_songs: 5,
      target_genres: '',
      expires_at: ''
    });
    setEditingAd(null);
    setShowForm(false);
    setFormSuccess(null);
    setError(null);
    setSelectedFile(null);
    setCompanionImageFile(null);
    setSelectedMediaType('visual');
    setSelectedPlacementTypes(['trending_near_you_grid']);
    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
    if (companionImagePreviewUrl && companionImagePreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(companionImagePreviewUrl);
    }
    setPreviewUrl(null);
    setCompanionImagePreviewUrl(null);
  };

  const calculateCTR = (ad: NativeAdCard): string => {
    if (ad.impression_count === 0) return '0.00';
    return ((ad.click_count / ad.impression_count) * 100).toFixed(2);
  };

  const isAudioAd = (ad: NativeAdCard): boolean => !!ad.audio_url && ad.audio_url.trim().length > 0;
  const isFinishedAd = (ad: NativeAdCard): boolean => {
    const isExpired = !!ad.expires_at && new Date(ad.expires_at).getTime() <= Date.now();
    return isExpired || !ad.is_active;
  };

  const filteredAds = ads.filter((ad) => {
    const passesType =
      listFilterType === 'all' ? true : listFilterType === 'audio' ? isAudioAd(ad) : !isAudioAd(ad);
    const passesStatus =
      statusFilterType === 'all'
        ? true
        : statusFilterType === 'finished'
          ? isFinishedAd(ad)
          : !isFinishedAd(ad);
    return passesType && passesStatus;
  });

  const loadLogoDataUrl = async (): Promise<string | null> => {
    try {
      const response = await fetch('/official_airaplay_logo.png');
      if (!response.ok) return null;
      const blob = await response.blob();
      return await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  const drawReportHeader = (doc: jsPDF, logoDataUrl: string | null, title: string, subtitle: string) => {
    if (logoDataUrl) {
      doc.addImage(logoDataUrl, 'PNG', 24, 20, 34, 34);
    }
    doc.setFontSize(16);
    doc.text(title, 68, 38);
    doc.setFontSize(10);
    doc.text(subtitle, 68, 54);
  };

  const downloadPdfReportForAd = async (ad: NativeAdCard) => {
    const now = new Date();
    const logoDataUrl = await loadLogoDataUrl();

    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    drawReportHeader(doc, logoDataUrl, 'Native Ad Report', `${ad.title} • Generated: ${now.toLocaleString()}`);

    const status = isFinishedAd(ad) ? 'Finished' : 'Running';
    const type = isAudioAd(ad) ? 'Audio' : 'Visual';
    const placementValues =
      ad.placement_types && ad.placement_types.length > 0
        ? ad.placement_types
        : [ad.placement_type];
    const placement = placementValues
      .map((item) => PLACEMENT_LABELS[item] || item)
      .join(', ');
    const expiresLabel = ad.expires_at ? new Date(ad.expires_at).toLocaleString() : 'No expiry date';

    autoTable(doc, {
      startY: 84,
      head: [['Field', 'Value']],
      body: [
        ['Ad ID', ad.id],
        ['Title', ad.title],
        ['Advertiser', ad.advertiser_name],
        ['Type', type],
        ['Placement', placement],
        ['Status', status],
        ['Priority', String(ad.priority)],
        ['Impressions', String(ad.impression_count ?? 0)],
        ['Clicks', String(ad.click_count ?? 0)],
        ['CTR', `${calculateCTR(ad)}%`],
        ['Active Flag', ad.is_active ? 'Active' : 'Inactive'],
        ['Expires At', expiresLabel],
        ['Target Countries', ad.target_countries?.join(', ') || 'All'],
        ['Target Genres', ad.target_genres?.join(', ') || 'All'],
        ['Audio Interval', ad.audio_url ? `After ${ad.audio_insertion_interval_songs || 5} songs` : 'N/A'],
        ['Click URL', ad.click_url],
      ],
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: [48, 150, 5] },
      theme: 'grid',
      margin: { left: 24, right: 24 },
      didDrawPage: (data) => {
        drawReportHeader(doc, logoDataUrl, 'Native Ad Report', `${ad.title} • Generated: ${now.toLocaleString()}`);
        const pageNumber = doc.getNumberOfPages();
        doc.setFontSize(8);
        doc.text(`Page ${pageNumber}`, data.settings.margin.left, doc.internal.pageSize.getHeight() - 14);
      },
    });

    if (ad.description) {
      const finalY = (doc as any).lastAutoTable?.finalY || 360;
      doc.setFontSize(10);
      doc.text('Description:', 24, finalY + 24);
      doc.setFontSize(9);
      const wrapped = doc.splitTextToSize(ad.description, 540);
      doc.text(wrapped, 24, finalY + 40);
    }

    const safeTitle = ad.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'ad';
    const filename = `native-ad-report-${safeTitle}-${now.toISOString().slice(0, 10)}.pdf`;
    doc.save(filename);
  };

  const placementOptions =
    selectedMediaType === 'audio'
      ? [...PLAYER_ONLY_PLACEMENTS, 'music_player_popup', 'album_player_popup', 'playlist_player_popup', 'daily_mix_player_popup']
      : ALL_PLACEMENTS;

  const ensureValidPlacementForMediaType = (mediaType: UploadedMediaType) => {
    const validAudioPlacements = new Set([
      ...PLAYER_ONLY_PLACEMENTS,
      'music_player_popup',
      'album_player_popup',
      'playlist_player_popup',
      'daily_mix_player_popup',
    ]);
    if (mediaType === 'audio') {
      const filtered = selectedPlacementTypes.filter((placement) => validAudioPlacements.has(placement));
      setSelectedPlacementTypes(filtered.length > 0 ? filtered : ['music_player']);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingLogo />
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <CreditCard className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">Native Ad Cards</h2>
            <p className="text-sm text-gray-400 mt-0.5">Manage native advertisement cards displayed in the app feed</p>
          </div>
        </div>
        <button
          onClick={openCreateForm}
          className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          {showForm ? 'Cancel' : 'Create Ad'}
        </button>
      </div>

      {/* Success/Error Messages */}
      {formSuccess && (
        <div className="bg-green-500/20 border border-green-500/30 rounded-lg p-4">
          <p className="text-green-400">{formSuccess}</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-4">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* List Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setListFilterType('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            listFilterType === 'all'
              ? 'bg-[#309605] text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          All Ads
        </button>
        <button
          type="button"
          onClick={() => setListFilterType('visual')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            listFilterType === 'visual'
              ? 'bg-[#309605] text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Visual Ads
        </button>
        <button
          type="button"
          onClick={() => setListFilterType('audio')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            listFilterType === 'audio'
              ? 'bg-[#309605] text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Audio Ads
        </button>
          <button
            type="button"
            onClick={() => setStatusFilterType('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilterType === 'all'
                ? 'bg-[#0f172a] text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            All Status
          </button>
          <button
            type="button"
            onClick={() => setStatusFilterType('running')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilterType === 'running'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Running
          </button>
          <button
            type="button"
            onClick={() => setStatusFilterType('finished')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilterType === 'finished'
                ? 'bg-amber-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Finished
          </button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-lg p-6 space-y-4 border border-gray-100 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">
            {editingAd ? 'Edit Native Ad' : 'Create Native Ad'}
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            Upload visual or audio creative, set targeting and choose where this card appears.
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Ad Type *
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedMediaType('visual');
                  ensureValidPlacementForMediaType('visual');
                  if (previewUrl && previewUrl.startsWith('blob:')) {
                    URL.revokeObjectURL(previewUrl);
                  }
                  setPreviewUrl(editingAd?.image_url || null);
                  setSelectedFile(null);
                  setFormData((prev) => ({
                    ...prev,
                    click_url:
                      prev.click_url === AUDIO_AD_DEFAULT_CLICK_URL && !editingAd?.audio_url
                        ? ''
                        : prev.click_url,
                  }));
                  setError(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  selectedMediaType === 'visual'
                    ? 'bg-[#309605] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Visual Ad
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedMediaType('audio');
                  ensureValidPlacementForMediaType('audio');
                  if (previewUrl && previewUrl.startsWith('blob:')) {
                    URL.revokeObjectURL(previewUrl);
                  }
                  setPreviewUrl(editingAd?.audio_url || null);
                  setSelectedFile(null);
                  setFormData((prev) => ({
                    ...prev,
                    click_url: prev.click_url || AUDIO_AD_DEFAULT_CLICK_URL,
                  }));
                  setError(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  selectedMediaType === 'audio'
                    ? 'bg-[#309605] text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Audio Ad
              </button>
            </div>
            <p className="mt-1 text-[11px] text-gray-500">
              {selectedMediaType === 'audio'
                ? 'Audio ads require an audio file and player placement.'
                : 'Visual ads require an image or video creative.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Ad Title *
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]/70 focus:border-[#309605]"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Advertiser Name{' '}
                {selectedMediaType === 'audio' ? (
                  '*'
                ) : (
                  <span className="font-normal text-gray-500">(optional)</span>
                )}
              </label>
              <input
                type="text"
                value={formData.advertiser_name}
                onChange={(e) => setFormData({ ...formData, advertiser_name: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]/70 focus:border-[#309605]"
                required={selectedMediaType === 'audio'}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]/70 focus:border-[#309605]"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {selectedMediaType === 'audio' ? 'Audio File *' : 'Visual Media (image/video) *'}
              </label>
              {previewUrl ? (
                <div className="space-y-2">
                  <div className="relative rounded-lg overflow-hidden bg-white/10 h-32">
                    {selectedMediaType === 'audio' ? (
                      <div className="w-full h-full flex items-center justify-center bg-gray-50 border border-gray-200 rounded-lg px-4">
                        <audio src={previewUrl} controls className="w-full" />
                      </div>
                    ) : previewUrl.match(/\.(mp4|webm|mov)$/i) ? (
                      <video
                        src={previewUrl}
                        className="w-full h-full object-cover"
                        muted
                        autoPlay
                        loop
                      />
                    ) : (
                      <img
                        src={previewUrl}
                        alt="Ad preview"
                        className="w-full h-full object-cover"
                      />
                    )}
                    <button
                      type="button"
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center"
                      onClick={() => {
                        setSelectedFile(null);
                        const nextType: UploadedMediaType = editingAd?.audio_url ? 'audio' : 'visual';
                        setSelectedMediaType(nextType);
                        ensureValidPlacementForMediaType(nextType);
                        if (previewUrl && previewUrl.startsWith('blob:')) {
                          URL.revokeObjectURL(previewUrl);
                        }
                        setPreviewUrl(editingAd?.audio_url || editingAd?.image_url || null);
                      }}
                    >
                      <X className="w-4 h-4 text-white" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  <input
                    id="native-ad-media"
                    type="file"
                    accept={
                      selectedMediaType === 'audio'
                        ? 'audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/ogg,audio/webm'
                        : 'image/jpeg,image/png,image/webp,image/jpg,video/mp4,video/webm,video/quicktime'
                    }
                    className="hidden"
                    onChange={(e) => {
                      handleFileChange(e);
                    }}
                  />
                  <label
                    htmlFor="native-ad-media"
                    className="flex flex-col items-center justify-center w-full h-32 bg-gray-50 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-gray-400 transition"
                  >
                    <Upload className="w-5 h-5 text-gray-600 mb-1" />
                    <span className="text-xs text-gray-800">
                      {selectedMediaType === 'audio' ? 'Upload audio ad file' : 'Upload image or video ad'}
                    </span>
                    <span className="text-[11px] text-gray-500 mt-0.5">
                      {selectedMediaType === 'audio'
                        ? 'Max 20MB · MP3/M4A/AAC/WAV/OGG/WEBM'
                        : 'Max 20MB · JPG/PNG/WEBP/MP4/WEBM/MOV'}
                    </span>
                  </label>
                </div>
              )}
            </div>

            {selectedMediaType === 'visual' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Click URL <span className="font-normal text-gray-500">(optional)</span>
                </label>
                <input
                  type="url"
                  value={formData.click_url}
                  onChange={(e) => setFormData({ ...formData, click_url: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]/70 focus:border-[#309605]"
                  placeholder="https://…"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Leave blank for awareness-only placements (no outbound click).
                </p>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Click URL (Optional for audio)
                </label>
                <input
                  type="url"
                  value={formData.click_url}
                  onChange={(e) => setFormData({ ...formData, click_url: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]/70 focus:border-[#309605]"
                  placeholder={AUDIO_AD_DEFAULT_CLICK_URL}
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Audio ads do not require a click URL. A default value is used when empty.
                </p>
              </div>
            )}
          </div>

          {selectedMediaType === 'audio' ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Companion Image (640x640 recommended) *
                </label>
                <div className="space-y-2">
                  {companionImagePreviewUrl ? (
                    <div className="relative rounded-lg overflow-hidden bg-white/10 h-32 border border-gray-200">
                      <img
                        src={companionImagePreviewUrl}
                        alt="Companion preview"
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center"
                        onClick={() => {
                          setCompanionImageFile(null);
                          if (companionImagePreviewUrl && companionImagePreviewUrl.startsWith('blob:')) {
                            URL.revokeObjectURL(companionImagePreviewUrl);
                          }
                          setCompanionImagePreviewUrl(editingAd?.companion_image_url || null);
                        }}
                      >
                        <X className="w-4 h-4 text-white" />
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        id="native-ad-companion-image"
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/jpg"
                        className="hidden"
                        onChange={handleCompanionImageChange}
                      />
                      <label
                        htmlFor="native-ad-companion-image"
                        className="flex flex-col items-center justify-center w-full h-32 bg-gray-50 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-gray-400 transition"
                      >
                        <Upload className="w-5 h-5 text-gray-600 mb-1" />
                        <span className="text-xs text-gray-800">
                          Upload companion image
                        </span>
                        <span className="text-[11px] text-gray-500 mt-0.5">
                          JPG / PNG / WEBP · Max 20MB
                        </span>
                      </label>
                    </div>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-gray-500">
                  This image is shown on screen while the audio ad is playing.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  CTA Text <span className="font-normal text-gray-500">(optional)</span>
                </label>
                <input
                  type="text"
                  value={formData.companion_cta_text}
                  onChange={(e) => setFormData({ ...formData, companion_cta_text: e.target.value })}
                  placeholder="Learn More / Buy Now / Sign up — leave blank for app default"
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]/70 focus:border-[#309605]"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  If empty, the player uses its default label on the companion button.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Play This Audio Ad After *
                </label>
                <select
                  value={formData.audio_insertion_interval_songs}
                  onChange={(e) => setFormData({ ...formData, audio_insertion_interval_songs: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]/70 focus:border-[#309605]"
                >
                  {[2, 3, 5, 6, 8, 10].map((value) => (
                    <option key={value} value={value}>
                      After {value} songs
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-gray-500">
                  Applies to this specific audio ad only.
                </p>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-3 xl:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Placement Types *
              </label>
              <div className="max-h-44 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1 bg-white">
                {placementOptions.map((placement) => (
                  <label key={placement} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={selectedPlacementTypes.includes(placement)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSelectedPlacementTypes((prev) => {
                          if (checked) {
                            if (prev.includes(placement)) return prev;
                            return [...prev, placement];
                          }
                          return prev.filter((item) => item !== placement);
                        });
                      }}
                    />
                    <span className="text-sm text-gray-800">{PLACEMENT_LABELS[placement]}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-gray-500">
                Selected: {selectedPlacementTypes.length}
              </p>
              {selectedMediaType === 'audio' ? (
                <p className="mt-1 text-[11px] text-gray-500">
                  Audio ads are limited to player placements.
                </p>
              ) : null}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Priority (1-10) *
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]/70 focus:border-[#309605]"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Expires At
              </label>
              <input
                type="date"
                value={formData.expires_at}
                onChange={(e) => setFormData({ ...formData, expires_at: e.target.value })}
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]/70 focus:border-[#309605]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Target Countries (comma-separated codes)
              </label>
              <input
                type="text"
                value={formData.target_countries}
                onChange={(e) => setFormData({ ...formData, target_countries: e.target.value })}
                placeholder="e.g., NG, US, GB"
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]/70 focus:border-[#309605]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Target Genres (comma-separated IDs)
              </label>
              <input
                type="text"
                value={formData.target_genres}
                onChange={(e) => setFormData({ ...formData, target_genres: e.target.value })}
                placeholder="Leave empty for all genres"
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]/70 focus:border-[#309605]"
              />
            </div>
          </div>

          {selectedMediaType === 'audio' ? (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Target Genders
                </label>
                <input
                  type="text"
                  value={formData.target_genders}
                  onChange={(e) => setFormData({ ...formData, target_genders: e.target.value })}
                  placeholder="male, female"
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]/70 focus:border-[#309605]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Min Age
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.target_age_min}
                  onChange={(e) => setFormData({ ...formData, target_age_min: e.target.value })}
                  placeholder="e.g. 18"
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]/70 focus:border-[#309605]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Max Age
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.target_age_max}
                  onChange={(e) => setFormData({ ...formData, target_age_max: e.target.value })}
                  placeholder="e.g. 45"
                  className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]/70 focus:border-[#309605]"
                />
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active"
              checked={formData.is_active}
              onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              className="w-4 h-4"
            />
            <label htmlFor="is_active" className="text-sm text-gray-700">
              Active (show this ad)
            </label>
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg transition-colors disabled:opacity-50 text-sm font-medium"
            >
              {isSubmitting ? 'Saving...' : editingAd ? 'Update Ad' : 'Create Ad'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg transition-colors text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Ads List */}
      <div className="space-y-4">
        {filteredAds.length === 0 ? (
          <div className="bg-white/5 rounded-lg p-8 text-center">
            <p className="text-gray-400">No ads match this filter</p>
          </div>
        ) : (
          filteredAds.map((ad) => (
            <div key={ad.id} className="bg-white/5 rounded-lg p-4">
              <div className="flex items-start gap-4">
                {/* Ad Media */}
                {ad.audio_url ? (
                  <div className="w-24 h-24 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center p-2">
                    <audio src={ad.audio_url} controls className="w-full" />
                  </div>
                ) : (
                  <img
                    src={ad.image_url}
                    alt={ad.title}
                    className="w-24 h-24 object-cover rounded-lg"
                  />
                )}

                {/* Ad Details */}
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="text-white font-semibold">{ad.title}</h3>
                      <p className="text-gray-400 text-sm">{ad.advertiser_name}</p>
                      {isAudioAd(ad) ? (
                        <p className="text-xs text-blue-300 mt-1">Audio Ad (Player Placement)</p>
                      ) : (
                        <p className="text-xs text-gray-500 mt-1">Visual Ad</p>
                      )}
                      {ad.expires_at ? (
                        <p className="text-[11px] text-gray-500 mt-1">
                          Expires: {new Date(ad.expires_at).toLocaleDateString()}
                        </p>
                      ) : (
                        <p className="text-[11px] text-gray-500 mt-1">No expiry date</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded text-xs ${
                        ad.is_active ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {ad.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <span className={`px-2 py-1 rounded text-xs ${
                        isFinishedAd(ad)
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-emerald-500/20 text-emerald-400'
                      }`}>
                        {isFinishedAd(ad) ? 'Finished' : 'Running'}
                      </span>
                      <span className="px-2 py-1 rounded text-xs bg-blue-500/20 text-blue-400">
                        Priority: {ad.priority}
                      </span>
                    </div>
                  </div>

                  {ad.description && (
                    <p className="text-gray-400 text-sm mb-2">{ad.description}</p>
                  )}

                  <div className="flex items-center gap-4 text-sm text-gray-400 mb-3">
                    <div className="flex items-center gap-1">
                      <Eye className="w-4 h-4" />
                      <span>{ad.impression_count} views</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <ExternalLink className="w-4 h-4" />
                      <span>{ad.click_count} clicks</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <TrendingUp className="w-4 h-4" />
                      <span>CTR: {calculateCTR(ad)}%</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEdit(ad)}
                      className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded transition-colors flex items-center gap-1"
                    >
                      <Edit2 className="w-3 h-3" />
                      Edit
                    </button>
                    <button
                      onClick={() => handleToggleActive(ad)}
                      className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded transition-colors flex items-center gap-1"
                    >
                      {ad.is_active ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      {ad.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => handleDelete(ad.id)}
                      className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded transition-colors flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                    <button
                      onClick={() => { void downloadPdfReportForAd(ad); }}
                      className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded transition-colors"
                    >
                      Download PDF Report
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
