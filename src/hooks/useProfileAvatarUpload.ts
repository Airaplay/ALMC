import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadProfileAvatarImage } from '../lib/profileImageUpload';

interface UseProfileAvatarUploadOptions {
  userId: string | undefined;
  onSuccess: (avatarUrl: string) => void;
  onError?: (message: string) => void;
}

export function useProfileAvatarUpload({
  userId,
  onSuccess,
  onError,
}: UseProfileAvatarUploadOptions) {
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    setAvatarPreviewUrl(null);
  }, [userId]);

  const triggerAvatarUpload = useCallback(() => {
    avatarInputRef.current?.click();
  }, []);

  const handleAvatarFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || !userId) return;

      const objectUrl = URL.createObjectURL(file);
      setAvatarPreviewUrl(objectUrl);
      setIsAvatarUploading(true);

      try {
        const publicUrl = await uploadProfileAvatarImage(userId, file);
        URL.revokeObjectURL(objectUrl);
        setAvatarPreviewUrl(publicUrl);
        onSuccess(publicUrl);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        setAvatarPreviewUrl(null);
        onError?.(error instanceof Error ? error.message : 'Failed to upload profile photo.');
      } finally {
        setIsAvatarUploading(false);
      }
    },
    [userId, onSuccess, onError],
  );

  return {
    avatarInputRef,
    isAvatarUploading,
    avatarPreviewUrl,
    triggerAvatarUpload,
    handleAvatarFileChange,
  };
}
