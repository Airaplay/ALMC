import { supabase } from './supabase';

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

export function validateProfileImage(file: File, label = 'Image'): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return `Please choose a JPEG, PNG, or WebP ${label.toLowerCase()}.`;
  }
  if (file.size > MAX_BYTES) {
    return `${label} must be 5 MB or smaller.`;
  }
  return null;
}

async function assertAuthenticatedUser(userId: string): Promise<void> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.user || session.user.id !== userId) {
    throw new Error('You must be signed in to update your profile images.');
  }
}

async function uploadProfileImageFile(
  userId: string,
  file: File,
  folder: 'avatar' | 'hero',
): Promise<string> {
  const fileExt = file.name.split('.').pop() || 'jpg';
  const filePath = `${userId}/${folder}/${Date.now()}.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from('profile-photos')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: true,
    });

  if (uploadError) {
    throw new Error(uploadError.message || 'Upload failed.');
  }

  const { data: { publicUrl } } = supabase.storage.from('profile-photos').getPublicUrl(filePath);
  return publicUrl;
}

export async function uploadProfileHeroImage(userId: string, file: File): Promise<string> {
  const validationError = validateProfileImage(file, 'Cover photo');
  if (validationError) throw new Error(validationError);

  await assertAuthenticatedUser(userId);
  const publicUrl = await uploadProfileImageFile(userId, file, 'hero');

  const { error: updateError } = await supabase
    .from('users')
    .update({
      background_image_url: publicUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (updateError) {
    throw new Error(updateError.message || 'Failed to save cover photo.');
  }

  return publicUrl;
}

export async function uploadProfileAvatarImage(userId: string, file: File): Promise<string> {
  const validationError = validateProfileImage(file, 'Profile photo');
  if (validationError) throw new Error(validationError);

  await assertAuthenticatedUser(userId);
  const publicUrl = await uploadProfileImageFile(userId, file, 'avatar');

  const { error: updateError } = await supabase
    .from('users')
    .update({
      avatar_url: publicUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (updateError) {
    throw new Error(updateError.message || 'Failed to save profile photo.');
  }

  const { data: artistProfile } = await supabase
    .from('artist_profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (artistProfile) {
    const { error: artistUpdateError } = await supabase
      .from('artist_profiles')
      .update({
        profile_photo_url: publicUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', artistProfile.id);

    if (artistUpdateError) {
      throw new Error(artistUpdateError.message || 'Failed to save creator profile photo.');
    }
  }

  return publicUrl;
}
