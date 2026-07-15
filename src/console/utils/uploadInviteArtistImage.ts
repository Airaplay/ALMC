import { supabase } from '../../lib/supabase';
import { validateProfileImage } from '../../lib/profileImageUpload';

export async function uploadInviteArtistImage(
  organizationId: string,
  file: File,
  kind: 'profile' | 'cover'
): Promise<string> {
  const label = kind === 'profile' ? 'Profile photo' : 'Cover image';
  const validationError = validateProfileImage(file, label);
  if (validationError) throw new Error(validationError);

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error('You must be signed in to upload images.');

  const fileExt = file.name.split('.').pop() || 'jpg';
  const filePath = `almc-invites/${organizationId}/${kind}-${Date.now()}.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from('profile-photos')
    .upload(filePath, file, { cacheControl: '3600', upsert: true });

  if (uploadError) {
    throw new Error(uploadError.message || 'Image upload failed.');
  }

  const { data: { publicUrl } } = supabase.storage.from('profile-photos').getPublicUrl(filePath);
  return publicUrl;
}
