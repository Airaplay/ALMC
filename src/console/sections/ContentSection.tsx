import { useEffect, useState } from 'react';
import { Music, Disc3, Video, Upload, Plus } from 'lucide-react';
import { useOrganization } from '../contexts/OrganizationContext';
import { listOrganizationArtists, OrgArtistItem } from '../../lib/orgAccess';
import { OrgContentUploadWizard } from '../components/OrgContentUploadWizard';
import { LoadingLogo } from '../../components/LoadingLogo';

export function ContentSection() {
  const { organization, hasPermission } = useOrganization();
  const [artists, setArtists] = useState<OrgArtistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [uploadArtist, setUploadArtist] = useState<OrgArtistItem | null>(null);

  useEffect(() => {
    if (!organization?.id) return;
    listOrganizationArtists(organization.id, { status: 'active' })
      .then(({ items }) => setArtists(items))
      .finally(() => setLoading(false));
  }, [organization?.id]);

  if (!hasPermission('content.view')) {
    return <p className="text-muted-foreground">You don&apos;t have permission to view content.</p>;
  }

  if (loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <LoadingLogo />
      </div>
    );
  }

  const activeArtists = artists.filter((a) => a.link_status === 'active');

  const openWizard = (artist?: OrgArtistItem) => {
    setUploadArtist(artist ?? null);
    setWizardOpen(true);
  };

  const closeWizard = () => {
    setWizardOpen(false);
    setUploadArtist(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Content</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload singles, albums, and videos for your artists
          </p>
        </div>
        {hasPermission('content.upload') && activeArtists.length > 0 && (
          <button
            type="button"
            onClick={() => openWizard()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#3ba208] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#3ba208]/90"
          >
            <Plus className="h-4 w-4" />
            Upload
          </button>
        )}
      </div>

      {activeArtists.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <p className="text-muted-foreground">Link an artist before uploading content</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {activeArtists.map((artist) => (
            <button
              key={artist.artist_profile_id}
              type="button"
              onClick={() => hasPermission('content.upload') && openWizard(artist)}
              disabled={!hasPermission('content.upload')}
              className="rounded-2xl border border-border bg-card p-5 text-left transition hover:border-[#309605]/30 hover:bg-card/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                {artist.profile_photo_url ? (
                  <img src={artist.profile_photo_url} alt="" className="h-12 w-12 rounded-full object-cover" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-foreground">
                    {artist.stage_name.charAt(0)}
                  </div>
                )}
                <div>
                  <p className="font-semibold text-foreground">{artist.stage_name}</p>
                  <p className="text-xs text-muted-foreground">Upload content</p>
                </div>
              </div>
              <div className="mt-4 flex gap-2 text-xs text-muted-foreground/80">
                <span className="inline-flex items-center gap-1"><Music className="h-3 w-3" /> Single</span>
                <span className="inline-flex items-center gap-1"><Disc3 className="h-3 w-3" /> Album</span>
                <span className="inline-flex items-center gap-1"><Video className="h-3 w-3" /> Video</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {hasPermission('content.upload') && activeArtists.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-3">
            <Upload className="h-5 w-5 text-[#3ba208]" />
            <p className="text-sm text-secondary-foreground">
              Use the upload wizard to add singles, albums, or videos. All content stays on the
              artist&apos;s public profile.
            </p>
          </div>
        </div>
      )}

      {wizardOpen && organization && (
        <OrgContentUploadWizard
          organizationId={organization.id}
          artists={activeArtists}
          initialArtist={uploadArtist}
          onClose={closeWizard}
          onSuccess={closeWizard}
        />
      )}
    </div>
  );
}
