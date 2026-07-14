import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadProfileHeroImage } from '../lib/profileImageUpload';

interface UseProfileHeroUploadOptions {
  userId: string | undefined;
  onSuccess: (backgroundImageUrl: string) => void;
  onError?: (message: string) => void;
}

export function useProfileHeroUpload({
  userId,
  onSuccess,
  onError,
}: UseProfileHeroUploadOptions) {
  const heroInputRef = useRef<HTMLInputElement>(null);
  const [isHeroUploading, setIsHeroUploading] = useState(false);
  const [heroPreviewUrl, setHeroPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    setHeroPreviewUrl(null);
  }, [userId]);

  const triggerHeroUpload = useCallback(() => {
    heroInputRef.current?.click();
  }, []);

  const handleHeroFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || !userId) return;

      const objectUrl = URL.createObjectURL(file);
      setHeroPreviewUrl(objectUrl);
      setIsHeroUploading(true);

      try {
        const publicUrl = await uploadProfileHeroImage(userId, file);
        URL.revokeObjectURL(objectUrl);
        setHeroPreviewUrl(publicUrl);
        onSuccess(publicUrl);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        setHeroPreviewUrl(null);
        onError?.(error instanceof Error ? error.message : 'Failed to upload cover photo.');
      } finally {
        setIsHeroUploading(false);
      }
    },
    [userId, onSuccess, onError],
  );

  return {
    heroInputRef,
    isHeroUploading,
    heroPreviewUrl,
    triggerHeroUpload,
    handleHeroFileChange,
  };
}
