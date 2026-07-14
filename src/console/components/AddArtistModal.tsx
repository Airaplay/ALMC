import { useEffect, useState } from 'react';
import { X, Link2, UserPlus, Loader2, AlertCircle, Mail, ShieldCheck } from 'lucide-react';
import { cn } from '../../lib/utils';
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

type InviteMode = 'link_existing' | 'create_new';
type Step = 'details' | 'verify';

interface AddArtistModalProps {
  organizationId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialEmail?: string;
  initialStep?: Step;
}

export function AddArtistModal({
  organizationId,
  open,
  onClose,
  onSuccess,
  initialEmail,
  initialStep = 'details',
}: AddArtistModalProps): JSX.Element | null {
  const [mode, setMode] = useState<InviteMode>('link_existing');
  const [step, setStep] = useState<Step>(initialStep);
  const [email, setEmail] = useState(initialEmail ?? '');
  const [stageName, setStageName] = useState('');
  const [country, setCountry] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [lookup, setLookup] = useState<ArtistInviteCandidate | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  useEffect(() => {
    if (!open) {
      setMode('link_existing');
      setStep(initialStep);
      setEmail(initialEmail ?? '');
      setStageName('');
      setCountry('');
      setVerificationCode('');
      setLookup(null);
      setError(null);
      setEmailSent(false);
    }
  }, [open, initialEmail, initialStep]);

  useEffect(() => {
    if (!open || step !== 'details' || !email.trim() || !email.includes('@')) {
      if (step === 'details') setLookup(null);
      return;
    }

    const timer = setTimeout(async () => {
      setLookupLoading(true);
      setError(null);
      try {
        const result = await lookupArtistInviteCandidate(organizationId, email.trim());
        setLookup(result);
      } catch (err) {
        setLookup(null);
        setError(err instanceof Error ? err.message : 'Lookup failed');
      } finally {
        setLookupLoading(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [email, organizationId, open, mode, step]);

  if (!open) return null;

  const handleSendInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    if (mode === 'create_new' && !stageName.trim()) {
      setError('Stage name is required for new artist invites.');
      return;
    }

    if (lookup?.link_status === 'active') {
      setError('This artist is already linked to your organization.');
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
      const invitationType = mode === 'create_new' ? 'create_new' : 'link_existing';
      const result = await inviteArtistToOrganization(
        organizationId,
        email.trim(),
        invitationType,
        mode === 'create_new'
          ? { stage_name: stageName.trim(), country: country.trim() || undefined }
          : {}
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
    if (!email.trim() || normalizeInvitationCode(verificationCode).length < 8) {
      setError('Enter the full verification code from the artist.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await confirmArtistOrganizationInvitation(organizationId, email.trim(), verificationCode);
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
    if (lookup.has_account) return 'Account exists but has no artist profile yet — use Invite new artist.';
    return 'No Airaplay account yet — a verification code will be emailed to them.';
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/20 bg-[#0d0d0d]/97 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-[2px] bg-gradient-to-r from-transparent via-[#3ba208] to-transparent opacity-80" />

        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 className="text-xl font-bold text-foreground">
              {step === 'verify' ? 'Verify artist' : 'Add Artist'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {step === 'verify'
                ? 'Enter the verification code the artist received by email. You will not see the code — only they do.'
                : 'Link an existing Airaplay artist or invite someone new to your roster.'}
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
          <form onSubmit={handleConfirmArtist} className="space-y-4 px-6 py-6">
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
              <p className="text-sm text-foreground">
                Verification code sent to <strong>{email.trim()}</strong>
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
              <p className="mt-2 text-xs text-muted-foreground">
                The code must match exactly what was emailed to the artist. It is not shown here.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setStep('details');
                  setVerificationCode('');
                  setError(null);
                }}
                className="flex-1 rounded-xl border border-border py-3 text-sm text-secondary-foreground hover:bg-muted"
              >
                Back
              </button>
              <ConsolePrimaryButton
                type="submit"
                disabled={submitting || normalizeInvitationCode(verificationCode).length < 8}
                loading={submitting}
                className="flex-1"
              >
                <ConsoleSubmitArrow label="Confirm artist" />
              </ConsolePrimaryButton>
            </div>
          </form>
        ) : (
          <>
            <div className="px-6 pt-4">
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary p-1">
                <button
                  type="button"
                  onClick={() => setMode('link_existing')}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    mode === 'link_existing'
                      ? 'bg-card text-[#3ba208] shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Link2 className="h-4 w-4" />
                  Link existing
                </button>
                <button
                  type="button"
                  onClick={() => setMode('create_new')}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    mode === 'create_new'
                      ? 'bg-card text-[#3ba208] shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <UserPlus className="h-4 w-4" />
                  Invite new artist
                </button>
              </div>
            </div>

            <form onSubmit={handleSendInvitation} className="space-y-4 px-6 py-6">
              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-sm text-secondary-foreground">Artist email *</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="artist@email.com"
                  className={cn(consoleTheme.input, 'w-full')}
                />
                {lookupHint && (
                  <p
                    className={cn(
                      'mt-2 flex items-center gap-2 text-xs',
                      lookup?.link_status === 'active'
                        ? 'text-amber-400'
                        : lookup?.pending_invitation_id
                          ? 'text-amber-400'
                          : 'text-muted-foreground'
                    )}
                  >
                    {lookupLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                    {lookupHint}
                  </p>
                )}
              </div>

              {mode === 'create_new' && (
                <>
                  <div>
                    <label className="mb-1.5 block text-sm text-secondary-foreground">Stage name *</label>
                    <input
                      type="text"
                      required
                      value={stageName}
                      onChange={(e) => setStageName(e.target.value)}
                      placeholder="Artist stage name"
                      className={cn(consoleTheme.input, 'w-full')}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm text-secondary-foreground">Country</label>
                    <input
                      type="text"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      placeholder="Nigeria"
                      className={cn(consoleTheme.input, 'w-full')}
                    />
                  </div>
                </>
              )}

              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#3ba208]" />
                A verification code is emailed only to the artist. You will enter it on the next step to confirm them.
              </p>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-xl border border-border py-3 text-sm text-secondary-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                {lookup?.pending_invitation_id ? (
                  <ConsolePrimaryButton
                    type="button"
                    onClick={() => {
                      setStep('verify');
                      setError(null);
                    }}
                    className="flex-1"
                  >
                    <ConsoleSubmitArrow label="Enter verification code" />
                  </ConsolePrimaryButton>
                ) : (
                  <ConsolePrimaryButton
                    type="submit"
                    disabled={submitting || lookup?.link_status === 'active'}
                    loading={submitting}
                    className="flex-1"
                  >
                    <ConsoleSubmitArrow label="Send verification code" />
                  </ConsolePrimaryButton>
                )}
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
