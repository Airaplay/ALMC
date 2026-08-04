import { useEffect, useRef, useState } from 'react';
import {
  Loader2,
  AlertCircle,
  Mail,
  ShieldCheck,
  Upload,
  ImageIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { supabase } from '../../lib/supabase';
import {
  ArtistInviteCandidate,
  confirmArtistOrganizationInvitation,
  createArtistForOrganization,
  formatInvitationCodeInput,
  inviteArtistToOrganization,
  lookupArtistInviteCandidate,
  normalizeInvitationCode,
} from '../../lib/orgAccess';
import { consoleTheme } from '../consoleTheme';
import { AlmcModalShell } from './AlmcModalShell';
import { ConsolePrimaryButton, ConsoleSubmitArrow } from './ConsoleFormControls';
import {
  ADD_ARTIST_TABS,
  ARTIST_INVITE_COUNTRIES,
  ARTIST_PERMISSION_PRESETS,
  AddArtistTab,
  ArtistPermissionPreset,
} from '../constants/artistInviteForm';
import { uploadInviteArtistImage } from '../utils/uploadInviteArtistImage';

type Step = 'details' | 'verify';

interface GenreOption {
  id: string;
  name: string;
}

interface AddArtistModalProps {
  organizationId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialEmail?: string;
  initialStep?: Step;
}

const EMPTY_FORM = {
  stageName: '',
  email: '',
  phone: '',
  genre: '',
  country: '',
  biography: '',
  permissionPreset: 'full_management' as ArtistPermissionPreset,
};

export function AddArtistModal({
  organizationId,
  open,
  onClose,
  onSuccess,
  initialEmail,
  initialStep = 'details',
}: AddArtistModalProps): JSX.Element | null {
  const [tab, setTab] = useState<AddArtistTab>('create_new');
  const [step, setStep] = useState<Step>(initialStep);
  const [form, setForm] = useState({ ...EMPTY_FORM, email: initialEmail ?? '' });
  const [verificationCode, setVerificationCode] = useState('');
  const [genres, setGenres] = useState<GenreOption[]>([]);
  const [profileFile, setProfileFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [profilePreview, setProfilePreview] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [lookup, setLookup] = useState<ArtistInviteCandidate | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const profileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const profilePreviewRef = useRef<string | null>(null);
  const coverPreviewRef = useRef<string | null>(null);

  const invitationType = tab === 'create_new' ? 'create_new' : 'link_existing';

  const revokePreview = (url: string | null) => {
    if (url) URL.revokeObjectURL(url);
  };

  const resetForm = () => {
    revokePreview(profilePreviewRef.current);
    revokePreview(coverPreviewRef.current);
    profilePreviewRef.current = null;
    coverPreviewRef.current = null;
    setTab('create_new');
    setStep(initialStep);
    setForm({ ...EMPTY_FORM, email: initialEmail ?? '' });
    setVerificationCode('');
    setProfileFile(null);
    setCoverFile(null);
    setProfilePreview(null);
    setCoverPreview(null);
    setLookup(null);
    setError(null);
    setEmailSent(false);
  };

  useEffect(() => {
    if (!open) resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when modal opens/closes or seed values change
  }, [open, initialEmail, initialStep]);

  useEffect(() => {
    return () => {
      revokePreview(profilePreviewRef.current);
      revokePreview(coverPreviewRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    supabase
      .from('genres')
      .select('id, name')
      .order('name')
      .then(({ data }) => setGenres((data ?? []) as GenreOption[]));
  }, [open]);

  useEffect(() => {
    if (!open || step !== 'details' || !form.email.trim() || !form.email.includes('@')) {
      if (step === 'details') setLookup(null);
      return;
    }

    const timer = setTimeout(async () => {
      setLookupLoading(true);
      setError(null);
      try {
        const result = await lookupArtistInviteCandidate(organizationId, form.email.trim());
        setLookup(result);
      } catch (err) {
        setLookup(null);
        setError(err instanceof Error ? err.message : 'Lookup failed');
      } finally {
        setLookupLoading(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [form.email, organizationId, open, tab, step]);

  const updateForm = (patch: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const handleImageSelect = (file: File | undefined, kind: 'profile' | 'cover') => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (kind === 'profile') {
      revokePreview(profilePreviewRef.current);
      profilePreviewRef.current = url;
      setProfileFile(file);
      setProfilePreview(url);
    } else {
      revokePreview(coverPreviewRef.current);
      coverPreviewRef.current = url;
      setCoverFile(file);
      setCoverPreview(url);
    }
  };

  const buildMetadata = async (): Promise<Record<string, unknown>> => {
    const metadata: Record<string, unknown> = {
      permission_preset: form.permissionPreset,
    };

    if (tab === 'create_new') {
      metadata.stage_name = form.stageName.trim();
      metadata.phone = form.phone.trim() || undefined;
      metadata.genre = form.genre;
      metadata.country = form.country;
      metadata.biography = form.biography.trim() || undefined;
    }

    if (profileFile) {
      metadata.profile_photo_url = await uploadInviteArtistImage(organizationId, profileFile, 'profile');
    }
    if (coverFile) {
      metadata.cover_image_url = await uploadInviteArtistImage(organizationId, coverFile, 'cover');
      metadata.cover_photo_url = metadata.cover_image_url;
    }

    return metadata;
  };

  const validateDetails = (): string | null => {
    if (!form.email.trim() || !form.email.includes('@')) return 'Email is required.';
    if (tab === 'create_new') {
      if (!form.stageName.trim()) return 'Artist name is required.';
      if (!form.genre) return 'Genre is required.';
      if (!form.country) return 'Country is required.';
    }
    if (lookup?.link_status === 'active') return 'This artist is already linked to your organization.';
    if (tab === 'invite_existing' && lookup?.has_account && !lookup?.has_artist_profile) {
      return 'This account has no artist profile. Use Create New instead.';
    }
    if (tab === 'invite_existing' && lookup && !lookup.has_account) {
      return 'No Airaplay account found for this email. Use Create New instead.';
    }
    return null;
  };

  const handleSendInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validateDetails();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (lookup?.pending_invitation_id) {
      setStep('verify');
      setError(null);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const metadata = await buildMetadata();

      // Create New: provision artist/creator immediately from the ALMC dashboard.
      if (tab === 'create_new') {
        await createArtistForOrganization(organizationId, form.email.trim(), metadata);
        onSuccess();
        onClose();
        return;
      }

      const result = await inviteArtistToOrganization(
        organizationId,
        form.email.trim(),
        invitationType,
        metadata
      );
      setEmailSent(result.email_sent !== false);
      setStep('verify');
      setVerificationCode('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send invitation';
      if (message.includes('already pending')) {
        setStep('verify');
        setError(null);
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmArtist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email.trim() || normalizeInvitationCode(verificationCode).length < 8) {
      setError('Enter the full verification code from the artist.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await confirmArtistOrganizationInvitation(organizationId, form.email.trim(), verificationCode);
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setSubmitting(false);
    }
  };

  const lookupHint = (() => {
    if (step !== 'details') return null;
    if (lookupLoading) return 'Checking Airaplay account…';
    if (!lookup) return null;
    if (lookup.link_status === 'active') return 'Already linked to your roster.';
    if (lookup.link_status === 'pending_invite' || lookup.pending_invitation_id) {
      return 'Invitation pending — enter the verification code from the artist.';
    }
    if (lookup.has_artist_profile) {
      return `Found artist profile: ${lookup.stage_name ?? lookup.display_name ?? 'Artist'}`;
    }
    if (lookup.has_account) return 'Account exists but has no artist profile — use Create New.';
    return tab === 'invite_existing'
      ? 'No Airaplay account yet — switch to Create New.'
      : 'No Airaplay account yet — Create New will create one for them.';
  })();

  if (!open) return null;

  const submitDisabled =
    submitting ||
    lookup?.link_status === 'active' ||
    (tab === 'invite_existing' && lookup?.has_account && !lookup?.has_artist_profile) ||
    (tab === 'invite_existing' && !!lookup && !lookup.has_account);

  const footer =
    step === 'verify' ? (
      <ModalFooter
        onCancel={() => {
          setStep('details');
          setVerificationCode('');
          setError(null);
        }}
        cancelLabel="Back"
        submitLabel="Confirm artist"
        submitting={submitting}
        submitDisabled={submitting || normalizeInvitationCode(verificationCode).length < 8}
        formId="almc-add-artist-verify"
      />
    ) : (
      <ModalFooter
        onCancel={onClose}
        cancelLabel="Cancel"
        submitLabel={
          lookup?.pending_invitation_id
            ? 'Enter verification code'
            : tab === 'create_new'
              ? 'Create Artist'
              : 'Send invitation'
        }
        submitting={submitting}
        submitDisabled={submitDisabled}
        formId={lookup?.pending_invitation_id ? undefined : 'almc-add-artist-details'}
        onSubmitOverride={
          lookup?.pending_invitation_id
            ? () => {
                setStep('verify');
                setError(null);
              }
            : undefined
        }
      />
    );

  return (
    <AlmcModalShell
      title={step === 'verify' ? 'Verify artist' : 'Add Artist'}
      subtitle={
        step === 'verify'
          ? 'Enter the verification code the artist received by email.'
          : 'Create a new artist profile or invite an existing Airaplay artist.'
      }
      onClose={onClose}
      footer={footer}
      size="md"
    >
      {step === 'verify' ? (
        <form id="almc-add-artist-verify" onSubmit={handleConfirmArtist} className="space-y-4">
          {error && <ErrorBanner message={error} />}

          <div className="rounded-2xl border border-[var(--almc-lime)]/30 bg-[var(--almc-lime)]/10 p-4">
            <p className="text-sm text-foreground">
              Verification code sent to <strong>{form.email.trim()}</strong>
            </p>
            {emailSent && (
              <p className="mt-2 flex items-center gap-2 text-xs text-[var(--almc-lime-deep)]">
                <Mail className="h-3.5 w-3.5" />
                Email queued — ask the artist to share their code with you
              </p>
            )}
          </div>

          <Field label="Verification code from artist *">
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              autoFocus
              required
              value={verificationCode}
              onChange={(e) => setVerificationCode(formatInvitationCodeInput(e.target.value))}
              placeholder="Enter code"
              className={cn(consoleTheme.input, 'w-full text-center font-mono text-lg tracking-[0.15em] uppercase')}
            />
          </Field>
        </form>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-border bg-card p-1 sm:grid-cols-4">
            {ADD_ARTIST_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={item.disabled}
                title={item.disabled ? item.disabledReason : undefined}
                onClick={() => !item.disabled && setTab(item.id)}
                className={cn(
                  'rounded-lg px-2 py-2 text-xs font-medium transition-colors sm:text-sm',
                  item.disabled && 'cursor-not-allowed opacity-40',
                  tab === item.id
                    ? 'bg-[var(--almc-lime)]/40 text-[var(--almc-lime-deep)]'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <form id="almc-add-artist-details" onSubmit={handleSendInvitation} className="space-y-4">
            {error && <ErrorBanner message={error} />}

            {tab === 'create_new' ? (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Artist name *">
                    <input
                      type="text"
                      required
                      value={form.stageName}
                      onChange={(e) => updateForm({ stageName: e.target.value })}
                      placeholder="Stage name"
                      className={cn(consoleTheme.input, 'w-full')}
                    />
                  </Field>
                  <Field label="Email *">
                    <input
                      type="email"
                      required
                      value={form.email}
                      onChange={(e) => updateForm({ email: e.target.value })}
                      placeholder="artist@email.com"
                      className={cn(consoleTheme.input, 'w-full')}
                    />
                    {lookupHint && <LookupHint text={lookupHint} lookup={lookup} loading={lookupLoading} />}
                  </Field>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Phone">
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => updateForm({ phone: e.target.value })}
                      placeholder="+234..."
                      className={cn(consoleTheme.input, 'w-full')}
                    />
                  </Field>
                  <Field label="Genre *">
                    <select
                      required
                      value={form.genre}
                      onChange={(e) => updateForm({ genre: e.target.value })}
                      className={cn(consoleTheme.input, 'w-full')}
                    >
                      <option value="">Select genre</option>
                      {genres.map((genre) => (
                        <option key={genre.id} value={genre.name}>
                          {genre.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Field label="Country *">
                  <select
                    required
                    value={form.country}
                    onChange={(e) => updateForm({ country: e.target.value })}
                    className={cn(consoleTheme.input, 'w-full')}
                  >
                    <option value="">Select country</option>
                    {ARTIST_INVITE_COUNTRIES.map((country) => (
                      <option key={country} value={country}>
                        {country}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Biography">
                  <textarea
                    rows={3}
                    value={form.biography}
                    onChange={(e) => updateForm({ biography: e.target.value })}
                    placeholder="Short artist bio"
                    className={cn(consoleTheme.input, 'w-full resize-none')}
                  />
                </Field>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <ImageUploadField
                    label="Profile photo"
                    preview={profilePreview}
                    inputRef={profileInputRef}
                    onSelect={(file) => handleImageSelect(file, 'profile')}
                  />
                  <ImageUploadField
                    label="Cover image"
                    preview={coverPreview}
                    inputRef={coverInputRef}
                    onSelect={(file) => handleImageSelect(file, 'cover')}
                  />
                </div>
              </>
            ) : (
              <Field label="Artist email *">
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => updateForm({ email: e.target.value })}
                  placeholder="artist@email.com"
                  className={cn(consoleTheme.input, 'w-full')}
                />
                {lookupHint && <LookupHint text={lookupHint} lookup={lookup} loading={lookupLoading} />}
              </Field>
            )}

            <Field label="Permissions preset">
              <select
                value={form.permissionPreset}
                onChange={(e) =>
                  updateForm({ permissionPreset: e.target.value as ArtistPermissionPreset })
                }
                className={cn(consoleTheme.input, 'w-full')}
              >
                {ARTIST_PERMISSION_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {
                  ARTIST_PERMISSION_PRESETS.find((p) => p.value === form.permissionPreset)
                    ?.description
                }
              </p>
            </Field>

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--almc-lime-deep)]" />
              {tab === 'create_new'
                ? 'Creates the artist profile on Airaplay and adds them to your roster immediately. We’ll email them so they can claim their account.'
                : 'A verification code is emailed only to the artist. Enter it on the next step to confirm them.'}
            </p>
          </form>
        </>
      )}
    </AlmcModalShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm text-secondary-foreground">{label}</label>
      {children}
    </div>
  );
}

function LookupHint({
  text,
  lookup,
  loading,
}: {
  text: string;
  lookup: ArtistInviteCandidate | null;
  loading: boolean;
}) {
  return (
    <p
      className={cn(
        'mt-2 flex items-center gap-2 text-xs',
        lookup?.link_status === 'active' || lookup?.pending_invitation_id
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-muted-foreground'
      )}
    >
      {loading && <Loader2 className="h-3 w-3 animate-spin" />}
      {text}
    </p>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

function ImageUploadField({
  label,
  preview,
  inputRef,
  onSelect,
}: {
  label: string;
  preview: string | null;
  inputRef: React.RefObject<HTMLInputElement>;
  onSelect: (file: File | undefined) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm text-secondary-foreground">{label}</label>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => onSelect(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-border/80 bg-card px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        {preview ? (
          <img src={preview} alt="" className="h-12 w-12 rounded-xl object-cover" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
        <div>
          <p className="text-sm font-medium text-foreground">Upload</p>
          <p className="text-xs text-muted-foreground">JPEG, PNG, or WebP · max 5 MB</p>
        </div>
        <Upload className="ml-auto h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  );
}

function ModalFooter({
  onCancel,
  cancelLabel,
  submitLabel,
  submitting,
  submitDisabled,
  onSubmitOverride,
  formId,
}: {
  onCancel: () => void;
  cancelLabel: string;
  submitLabel: string;
  submitting: boolean;
  submitDisabled?: boolean;
  onSubmitOverride?: () => void;
  formId?: string;
}) {
  return (
    <div className="flex gap-3">
      <button type="button" onClick={onCancel} className={cn(consoleTheme.btnSecondary, 'flex-1')}>
        {cancelLabel}
      </button>
      {onSubmitOverride ? (
        <ConsolePrimaryButton type="button" onClick={onSubmitOverride} className="flex-1">
          <ConsoleSubmitArrow label={submitLabel} />
        </ConsolePrimaryButton>
      ) : (
        <ConsolePrimaryButton
          type="submit"
          form={formId}
          disabled={submitDisabled}
          loading={submitting}
          className="flex-1"
        >
          <ConsoleSubmitArrow label={submitLabel} />
        </ConsolePrimaryButton>
      )}
    </div>
  );
}
