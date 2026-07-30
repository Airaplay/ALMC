import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AdminUploadContext } from '../../lib/adminUploadContext';
import type { OrgArtistItem } from '../../lib/orgAccess';
import type { ConsoleUploadEmbed } from '../../lib/consoleUploadEmbed';
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
import { consoleTheme } from '../consoleTheme';
import { AlmcModalShell } from './AlmcModalShell';

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
  const [contentType, setContentType] = useState<ContentUploadType | null>(null);

  useEffect(() => {
    if (resolvedInitial) {
      setSelectedArtist(resolvedInitial);
      setWizardStep(1);
    }
  }, [resolvedInitial]);

  const displayStep = wizardStep >= 2 ? formStepToWizardStep(formStep) : wizardStep;
  const stepLabel = CONTENT_WIZARD_STEPS[displayStep];

  const subtitle = useMemo(() => {
    if (selectedArtist && contentType) {
      return `Upload for ${selectedArtist.stage_name} · ${CONTENT_TYPE_LABELS[contentType]}`;
    }
    if (selectedArtist) {
      return `Upload for ${selectedArtist.stage_name}`;
    }
    return 'Select an artist to upload on their behalf.';
  }, [selectedArtist, contentType]);

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
          className={cn(consoleTheme.input, 'w-full pl-10')}
        />
      </div>
      <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
        {filteredArtists.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No active artists match your search.
          </p>
        ) : (
          filteredArtists.map((row) => {
            const selected = selectedArtist?.artist_profile_id === row.artist_profile_id;
            return (
              <button
                key={row.artist_profile_id ?? row.link_id}
                type="button"
                onClick={() => setSelectedArtist(row)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition',
                  selected
                    ? 'border-[var(--almc-lime-deep)]/40 bg-[var(--almc-lime)]/10 ring-2 ring-[var(--almc-lime-deep)]/20'
                    : `${consoleTheme.cardInner} hover:bg-muted/80`
                )}
              >
                {row.profile_photo_url ? (
                  <img
                    src={row.profile_photo_url}
                    alt=""
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
                    {row.stage_name.charAt(0)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="break-words font-semibold text-foreground">{row.stage_name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {[row.genre, row.country].filter(Boolean).join(' · ') || row.email}
                  </p>
                </div>
                {selected ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--almc-lime-deep)]" />
                ) : null}
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
              'relative flex flex-col items-start gap-3 rounded-2xl border p-4 text-left transition',
              option.enabled
                ? `${consoleTheme.cardInner} hover:border-[var(--almc-lime-deep)]/40 hover:bg-[var(--almc-lime)]/10`
                : 'cursor-not-allowed border-border/60 bg-secondary/50 opacity-60'
            )}
          >
            {option.badge ? (
              <span className="absolute right-3 top-3 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {option.badge}
              </span>
            ) : null}
            <div className={consoleTheme.iconWell}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-foreground">{option.label}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{option.detail}</p>
            </div>
          </button>
        );
      })}
    </div>
  );

  const renderEmbeddedForm = () => {
    if (!uploadContext || !contentType) return null;

    const embed: ConsoleUploadEmbed = {
      hideChrome: true,
      theme: 'almc',
      onStepChange: handleFormStepChange,
      onExitFirstStep: () => {
        setWizardStep(1);
        setContentType(null);
        setFormStep(0);
      },
      showReleaseActions: true,
      onTitleChange: setUploadTitle,
    };

    const form =
      contentType === 'single' ? (
        <SingleUploadForm
          adminUploadContext={uploadContext}
          consoleEmbed={embed}
          onClose={goBack}
          onSuccess={handleUploadSuccess}
        />
      ) : contentType === 'album' ? (
        <AlbumUploadForm
          adminUploadContext={uploadContext}
          consoleEmbed={embed}
          onClose={goBack}
          onSuccess={handleUploadSuccess}
        />
      ) : (
        <VideoUploadForm
          adminUploadContext={uploadContext}
          consoleEmbed={embed}
          onClose={goBack}
          onSuccess={handleUploadSuccess}
        />
      );

    return <div className="almc-upload-embed">{form}</div>;
  };

  const footer =
    wizardStep < 2 ? (
      <div className="flex gap-3">
        <button type="button" onClick={goBack} className={`${consoleTheme.btnSecondary} flex-1`}>
          {wizardStep === 0 ? 'Cancel' : 'Back'}
        </button>
        {wizardStep === 0 ? (
          <button
            type="button"
            disabled={!selectedArtist}
            onClick={() => setWizardStep(1)}
            className={`${consoleTheme.btnLime} flex-1`}
          >
            Next
          </button>
        ) : (
          <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a content type above to continue
          </p>
        )}
      </div>
    ) : null;

  return (
    <AlmcModalShell
      title="Upload content"
      subtitle={`Step ${displayStep + 1} of ${CONTENT_WIZARD_STEPS.length} — ${stepLabel}. ${subtitle}`}
      onClose={onClose}
      size={wizardStep >= 2 ? 'xl' : 'lg'}
      footer={footer}
    >
      <div className="mb-5">
        <div className="flex gap-1.5">
          {CONTENT_WIZARD_STEPS.map((label, index) => (
            <div key={label} className="flex-1" title={label}>
              <div
                className={cn(
                  'h-1.5 rounded-full transition-colors',
                  index <= displayStep ? 'bg-[var(--almc-lime)]' : 'bg-border'
                )}
              />
            </div>
          ))}
        </div>
      </div>

      {wizardStep === 0 && renderArtistStep()}
      {wizardStep === 1 && renderTypeStep()}
      {wizardStep >= 2 && renderEmbeddedForm()}
    </AlmcModalShell>
  );
}
