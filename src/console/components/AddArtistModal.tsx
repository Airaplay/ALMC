import { useEffect, useRef, useState } from 'react';
import {
  X,
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
  formatInvitationCodeInput,
  inviteArtistToOrganization,
  lookupArtistInviteCandidate,
  normalizeInvitationCode,
} from '../../lib/orgAccess';
import { consoleTheme } from '../consoleTheme';
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

  const invitationType = tab === 'create_new' ? 'create_new' : 'link_existing';

  const resetForm = () => {
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
  }, [open, initialEmail, initialStep]);

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
      setProfileFile(file);
      setProfilePreview(url);
    } else {
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
      : 'No Airaplay account yet — a verification code will be emailed to them.';
  })();

  if (!open) return null;

  const submitDisabled =
    submitting ||
    lookup?.link_status === 'active' ||
    (tab === 'invite_existing' && lookup?.has_account && !lookup?.has_artist_profile);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div
        className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/20 bg-[#0d0d0d]/97 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-[2px] shrink-0 bg-gradient-to-r from-transparent via-[#3ba208] to-transparent opacity-80" />

        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 className="text-xl font-bold text-foreground">
              {step === 'verify' ? 'Verify artist' : 'Add Artist'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {step === 'verify'
                ? 'Enter the verification code the artist received by email.'
                : 'Create a new artist profile or invite an existing Airaplay artist.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === 'verify' ? (
          <form onSubmit={handleConfirmArtist} className="space-y-4 overflow-y-auto px-6 py-6">
            {error && <ErrorBanner message={error} />}

            <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
              <p className="text-sm text-foreground">
                Verification code sent to <strong>{form.email.trim()}</strong>
              </p>
              {emailSent && (
                <p className="mt-2 flex items-center gap-2 text-xs text-emerald-400">
                  <Mail className="h-3.5 w-3.5" />
                  Email queued — ask the artist to share their code with you
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-secondary-foreground">
                Verification code from artist *
              </label>
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
            </div>

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
            />
          </form>
        ) : (
          <>
            <div className="shrink-0 border-b border-border/60 px-6 pt-4">
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1 sm:grid-cols-4">
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
                        ? 'bg-card text-[#3ba208] shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleSendInvitation} className="flex min-h-0 flex-1 flex-col">
              <div className="space-y-4 overflow-y-auto px-6 py-6">
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
                    {lookupHint && (
                      <p
                        className={cn(
                          'mt-2 flex items-center gap-2 text-xs',
                          lookup?.link_status === 'active' || lookup?.pending_invitation_id
                            ? 'text-amber-400'
                            : 'text-muted-foreground'
                        )}
                      >
                        {lookupLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                        {lookupHint}
                      </p>
                    )}
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
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#3ba208]" />
                  A verification code is emailed only to the artist. Enter it on the next step to
                  confirm them.
                </p>
              </div>

              <div className="shrink-0 border-t border-border/60 px-6 py-4">
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
                  onSubmitOverride={
                    lookup?.pending_invitation_id
                      ? () => {
                          setStep('verify');
                          setError(null);
                        }
                      : undefined
                  }
                />
              </div>
            </form>
          </>
        )}
      </div>
    </div>
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

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
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
        className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-4 py-3 text-left hover:bg-muted/40"
      >
        {preview ? (
          <img src={preview} alt="" className="h-12 w-12 rounded-lg object-cover" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
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
}: {
  onCancel: () => void;
  cancelLabel: string;
  submitLabel: string;
  submitting: boolean;
  submitDisabled?: boolean;
  onSubmitOverride?: () => void;
}) {
  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={onCancel}
        className="flex-1 rounded-xl border border-border py-3 text-sm text-secondary-foreground hover:bg-muted"
      >
        {cancelLabel}
      </button>
      {onSubmitOverride ? (
        <ConsolePrimaryButton type="button" onClick={onSubmitOverride} className="flex-1">
          <ConsoleSubmitArrow label={submitLabel} />
        </ConsolePrimaryButton>
      ) : (
        <ConsolePrimaryButton type="submit" disabled={submitDisabled} loading={submitting} className="flex-1">
          <ConsoleSubmitArrow label={submitLabel} />
        </ConsolePrimaryButton>
      )}
    </div>
  );
}
