import { supabase } from './supabase';

export interface DirectUploadOptions {
  userId: string;
  contentType: 'audio' | 'image' | 'video';
  customPath?: string;
  /** When set, Edge Function allows org-delegated upload for this workspace. */
  organizationId?: string;
  onProgress?: (percent: number) => void;
}

export interface DirectUploadResult {
  success: boolean;
  publicUrl?: string;
  error?: string;
}

/**
 * Smart upload routing:
 * - Audio files → Bunny Storage (via Edge Function)
 * - Image files → Supabase Storage (direct upload)
 * - Video files → Bunny Storage (via Edge Function)
 */
export async function directUploadToBunny(
  file: File,
  options: DirectUploadOptions
): Promise<DirectUploadResult> {
  if (options.contentType === 'image') {
    return uploadToSupabaseStorage(file, options);
  } else {
    return uploadToBunnyStorage(file, options);
  }
}

/**
 * Upload images to Supabase Storage
 */
async function uploadToSupabaseStorage(
  file: File,
  options: DirectUploadOptions
): Promise<DirectUploadResult> {
  try {
    console.log('🚀 Uploading image to Supabase Storage:', {
      fileName: file.name,
      fileSize: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
      contentType: options.contentType
    });

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      throw new Error('Authentication required');
    }

    const bucket = getBucketForContentType(options.contentType, options.customPath);
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`;
    const filePath = `${options.userId}/${fileName}`;

    console.log('📤 Uploading to Supabase Storage:', { bucket, filePath });

    if (options.onProgress) {
      options.onProgress(50);
    }

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, file, {
        cacheControl: '2592000', // 30 days cache for images (covers, avatars)
        upsert: true
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw new Error(uploadError.message || 'Upload failed');
    }

    const { data: { publicUrl } } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath);

    console.log('✅ Upload successful to Supabase Storage:', publicUrl);

    if (options.onProgress) {
      options.onProgress(100);
    }

    return {
      success: true,
      publicUrl
    };
  } catch (error) {
    console.error('❌ Supabase Storage upload failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Upload audio/video to Bunny Storage via Edge Function
 */
async function uploadToBunnyStorage(
  file: File,
  options: DirectUploadOptions
): Promise<DirectUploadResult> {
  try {
    console.log('🚀 Uploading to Bunny Storage:', {
      fileName: file.name,
      fileSize: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
      contentType: options.contentType
    });

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      throw new Error('Authentication required');
    }

    const customPath = getPathForBunnyContentType(options.contentType);

    console.log('📤 Uploading to Bunny Storage via Edge Function:', { customPath });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('contentType', options.contentType);
    formData.append('userId', options.userId);
    if (customPath) {
      formData.append('customPath', customPath);
    }
    if (options.organizationId) {
      formData.append('organizationId', options.organizationId);
    }
    formData.append('skipHash', 'true');

    // Prefer Supabase function invoke to avoid browser-level XHR/CORS network errors.
    const { data, error } = await supabase.functions.invoke('upload-to-bunny', {
      body: formData,
    });

    if (error) {
      // FunctionsHttpError often hides the JSON body; surface details when present.
      const ctx = error as { context?: Response; message?: string };
      let detail = error.message || 'Failed to invoke upload-to-bunny function';
      try {
        if (ctx.context && typeof ctx.context.json === 'function') {
          const body = (await ctx.context.json()) as {
            error?: string;
            details?: string;
          };
          detail = body.details || body.error || detail;
        }
      } catch {
        /* keep generic message */
      }
      throw new Error(detail);
    }

    const response = data as {
      success?: boolean;
      publicUrl?: string;
      error?: string;
      details?: string;
    } | null;
    if (!response?.success || !response.publicUrl) {
      throw new Error(response?.details || response?.error || 'Upload failed');
    }

    console.log('✅ Upload successful to Bunny Storage:', response.publicUrl);

    if (options.onProgress) {
      options.onProgress(100);
    }

    return {
      success: true,
      publicUrl: response.publicUrl
    };
  } catch (error) {
    console.error('❌ Bunny Storage upload failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

function getBucketForContentType(contentType: string, customPath?: string): string {
  if (customPath === 'profile-photos') {
    return 'profile-photos';
  }

  if (customPath === 'covers') {
    return 'covers';
  }

  if (customPath === 'thumbnails') {
    return 'thumbnails';
  }

  if (customPath === 'banners') {
    return 'banners';
  }

  switch (contentType) {
    case 'image':
      return 'covers';
    case 'audio':
    case 'video':
      return 'content-media';
    default:
      return 'content-media';
  }
}

function getPathForBunnyContentType(contentType: string): string {
  switch (contentType) {
    case 'audio':
      return 'audio';
    case 'video':
      return 'video';
    default:
      return 'audio';
  }
}
