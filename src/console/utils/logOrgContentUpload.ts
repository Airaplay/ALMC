import { supabase } from '../../lib/supabase';
import type { ContentUploadType } from '../constants/contentUploadWizard';

export async function logOrgContentUpload(
  organizationId: string,
  artistProfileId: string | null | undefined,
  title: string,
  contentType: ContentUploadType
): Promise<void> {
  try {
    await supabase.rpc('log_organization_activity', {
      p_org_id: organizationId,
      p_action: 'content_uploaded',
      p_artist_profile_id: artistProfileId ?? null,
      p_resource_type: 'content',
      p_resource_id: null,
      p_metadata: { title, content_type: contentType },
    });
  } catch {
    // Activity logging is best-effort and must not block uploads.
  }
}
