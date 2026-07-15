import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Search, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AdminUploadContext } from '../../lib/adminUploadContext';
import type { OrgArtistItem } from '../../lib/orgAccess';
import SingleUploadForm from '../../components/SingleUploadForm';
import AlbumUploadForm from '../../components/AlbumUploadForm';
import VideoUploadForm from '../../components/VideoUploadForm';
import {
  CONTENT_TYPE_LABELS,
  CONTENT_UPLOAD_TYPES,
  CONTENT_WIZARD_STEPS,
  ContentUploadType,
  ContentWizardStepIndex,
  formStepToWizardStep,
} from '../constants/contentUploadWizard';
import { logOrgContentUpload } from '../utils/logOrgContentUpload';

interface OrgContentUploadWizardProps {
  organizationId: string;
  artists?: OrgArtistItem[];
  initialArtist?: OrgArtistItem | null;
  /** Shorthand when opening upload for one artist (skips to type step). */
  artist?: OrgArtistItem;
  onClose: () => void;
  onSuccess: () => void;
}

export function OrgContentUploadWizard({
  organizationId,
  artists = [],
  initialArtist = null,
  artist,
  onClose,
  onSuccess,
}: OrgContentUploadWizardProps) {
  const resolvedInitial = artist ?? initialArtist;
  const resolvedArtists = artists.length > 0 ? artists : artist ? [artist] : [];
  const activeArtists = useMemo(
    () => resolvedArtists.filter((a) => a.link_status === 'active' && a.user_id),
    [resolvedArtists]
  );

  const [wizardStep, setWizardStep] = useState<ContentWizardStepIndex>(
    resolvedInitial ? 1 : 0
  );
  const [selectedArtist, setSelectedArtist] = useState<OrgArtistItem | null>(resolvedInitial);
  const [formStep, setFormStep] = useState(0);
  const [artistSearch, setArtistSearch] = useState('');
  const [uploadTitle, setUploadTitle] = useState('');

  useEffect(() => {
    if (resolvedInitial) {
      setSelectedArtist(resolvedInitial);
      setWizardStep(1);
    }
  }, [resolvedInitial]);

  const [contentType, setContentType] = useState<ContentUploadType | null>(null);

  const displayStep = wizardStep >= 2 ? formStepToWizardStep(formStep) : wizardStep;
  const stepLabel = CONTENT_WIZARD_STEPS[displayStep];

  const filteredArtists = useMemo(() => {
    const q = artistSearch.trim().toLowerCase();
    if (!q) return activeArtists;
    return activeArtists.filter(
      (a) =>
        a.stage_name.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        (a.genre?.toLowerCase().includes(q) ?? false)
    );
  }, [activeArtists, artistSearch]);

  const uploadContext: AdminUploadContext | undefined = selectedArtist?.user_id
    ? {
        targetUserId: selectedArtist.user_id,
        targetDisplayName: selectedArtist.stage_name,
        organizationId,
        artistProfileId: selectedArtist.artist_profile_id ?? undefined,
      }
    : undefined;

  const goBack = useCallback(() => {
    if (wizardStep >= 2) {
      if (formStep > 0) return;
      setWizardStep(1);
      setContentType(null);
      setFormStep(0);
      return;
    }
    if (wizardStep === 1 && !resolvedInitial) {
      setWizardStep(0);
      setContentType(null);
      return;
    }
    if (wizardStep === 1 && resolvedInitial) {
      onClose();
      return;
    }
    onClose();
  }, [wizardStep, formStep, resolvedInitial, onClose]);

  const handleFormStepChange = useCallback((step: number) => {
    setFormStep(step);
  }, []);

  const handleUploadSuccess = useCallback(async () => {
    if (selectedArtist && contentType) {
      await logOrgContentUpload(
        organizationId,
        selectedArtist.artist_profile_id,
        uploadTitle || 'Untitled release',
        contentType
      );
    }
    onSuccess();
    onClose();
  }, [organizationId, selectedArtist, contentType, uploadTitle, onSuccess, onClose]);

  const handleTypeSelect = (type: ContentUploadType) => {
    setContentType(type);
    setFormStep(0);
    setWizardStep(2);
  };

  const renderArtistStep = () => (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={artistSearch}
          onChange={(e) => setArtistSearch(e.target.value)}
          placeholder="Search artists…"
          className="w-full rounded-xl border border-border bg-secondary py-2.5 pl-10 pr-4 text-sm text-foreground focus:border-[#309605]/40 focus:outline-none focus:ring-2 focus:ring-[#309605]/20"
        />
      </div>
      <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
        {filteredArtists.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No active artists match your search.</p>
        ) : (
          filteredArtists.map((artist) => {
            const selected = selectedArtist?.artist_profile_id === artist.artist_profile_id;
            return (
              <button
                key={artist.artist_profile_id ?? artist.link_id}
                type="button"
                onClick={() => setSelectedArtist(artist)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition',
                  selected
                    ? 'border-[#309605]/50 bg-[#309605]/10'
                    : 'border-border bg-secondary hover:border-[#309605]/30'
                )}
              >
                {artist.profile_photo_url ? (
                  <img
                    src={artist.profile_photo_url}
                    alt=""
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
                    {artist.stage_name.charAt(0)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-foreground">{artist.stage_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[artist.genre, artist.country].filter(Boolean).join(' · ') || artist.email}
                  </p>
                </div>
                {selected ? <CheckCircle2 className="h-5 w-5 shrink-0 text-[#3ba208]" /> : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  const renderTypeStep = () => (
    <div className="grid gap-3 sm:grid-cols-2">
      {CONTENT_UPLOAD_TYPES.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.label}
            type="button"
            disabled={!option.enabled}
            onClick={() => option.enabled && handleTypeSelect(option.id as ContentUploadType)}
            className={cn(
              'relative flex flex-col items-start gap-3 rounded-xl border p-4 text-left transition',
              option.enabled
                ? 'border-border bg-secondary hover:border-[#309605]/40'
                : 'cursor-not-allowed border-border/60 bg-secondary/50 opacity-60'
            )}
          >
            {option.badge ? (
              <span className="absolute right-3 top-3 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {option.badge}
              </span>
            ) : null}
            <div className="rounded-lg bg-[#309605]/15 p-2.5">
              <Icon className="h-5 w-5 text-[#3ba208]" />
            </div>
            <div>
              <p className="font-semibold text-foreground">{option.label}</p>
              <p className="text-sm text-muted-foreground">{option.detail}</p>
            </div>
          </button>
        );
      })}
    </div>
  );

  const renderEmbeddedForm = () => {
    if (!uploadContext || !contentType) return null;

    const embed = {
      hideChrome: true,
      onStepChange: handleFormStepChange,
      onExitFirstStep: () => {
        setWizardStep(1);
        setContentType(null);
        setFormStep(0);
      },
      showReleaseActions: true,
      onTitleChange: setUploadTitle,
    };

    if (contentType === 'single') {
      return (
        <SingleUploadForm
          adminUploadContext={uploadContext}
          consoleEmbed={embed}
          onClose={goBack}
          onSuccess={handleUploadSuccess}
        />
      );
    }
    if (contentType === 'album') {
      return (
        <AlbumUploadForm
          adminUploadContext={uploadContext}
          consoleEmbed={embed}
          onClose={goBack}
          onSuccess={handleUploadSuccess}
        />
      );
    }
    return (
      <VideoUploadForm
        adminUploadContext={uploadContext}
        consoleEmbed={embed}
        onClose={goBack}
        onSuccess={handleUploadSuccess}
      />
    );
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4">
      <div
        className={cn(
          'flex w-full flex-col rounded-2xl border border-border bg-card shadow-2xl',
          wizardStep >= 2 ? 'max-h-[92vh] max-w-3xl' : 'max-w-lg'
        )}
      >
        <div className="flex shrink-0 items-start justify-between border-b border-border p-5">
          <div className="min-w-0 pr-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Step {displayStep + 1} of {CONTENT_WIZARD_STEPS.length} — {stepLabel}
            </p>
            <h3 className="mt-1 text-lg font-bold text-foreground">Upload content</h3>
            {selectedArtist && contentType ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Upload for:{' '}
                <span className="font-medium text-foreground">{selectedArtist.stage_name}</span>
                {' · '}
                Type:{' '}
                <span className="font-medium text-foreground">{CONTENT_TYPE_LABELS[contentType]}</span>
              </p>
            ) : selectedArtist ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Upload for:{' '}
                <span className="font-medium text-foreground">{selectedArtist.stage_name}</span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Select an artist to upload on their behalf.</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 pt-4">
          <div className="flex gap-1">
            {CONTENT_WIZARD_STEPS.map((label, index) => (
              <div key={label} className="flex-1">
                <div
                  className={cn(
                    'h-1 rounded-full transition-colors',
                    index <= displayStep ? 'bg-[#3ba208]' : 'bg-border'
                  )}
                />
              </div>
            ))}
          </div>
        </div>

        <div
          className={cn(
            'flex-1 overflow-y-auto p-5',
            wizardStep >= 2 && 'min-h-0 bg-[#0a0a0b] text-white'
          )}
        >
          {wizardStep === 0 && renderArtistStep()}
          {wizardStep === 1 && renderTypeStep()}
          {wizardStep >= 2 && renderEmbeddedForm()}
        </div>

        {wizardStep < 2 && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border p-5">
            <button
              type="button"
              onClick={goBack}
              className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary"
            >
              {wizardStep === 0 ? 'Cancel' : 'Back'}
            </button>
            {wizardStep === 0 ? (
              <button
                type="button"
                disabled={!selectedArtist}
                onClick={() => setWizardStep(1)}
                className="rounded-xl bg-[#3ba208] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#3ba208]/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            ) : (
              <p className="text-xs text-muted-foreground">Select a content type above to continue</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
