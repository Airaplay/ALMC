import { useEffect, useState } from 'react';
import { X, Link2, UserPlus, Copy, Check, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  ArtistInviteCandidate,
  inviteArtistToOrganization,
  lookupArtistInviteCandidate,
} from '../../lib/orgAccess';
import { almcRoutes } from '../../lib/almcRoutes';
import { consoleTheme } from '../consoleTheme';
import { ConsolePrimaryButton, ConsoleSubmitArrow } from './ConsoleFormControls';

type InviteMode = 'link_existing' | 'create_new';

interface AddArtistModalProps {
  organizationId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddArtistModal({
  organizationId,
  open,
  onClose,
  onSuccess,
}: AddArtistModalProps): JSX.Element | null {
  const [mode, setMode] = useState<InviteMode>('link_existing');
  const [email, setEmail] = useState('');
  const [stageName, setStageName] = useState('');
  const [country, setCountry] = useState('');
  const [lookup, setLookup] = useState<ArtistInviteCandidate | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setMode('link_existing');
      setEmail('');
      setStageName('');
      setCountry('');
      setLookup(null);
      setError(null);
      setInviteLink(null);
      setCopied(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !email.trim() || !email.includes('@')) {
      setLookup(null);
      return;
    }

    const timer = setTimeout(async () => {
      setLookupLoading(true);
      setError(null);
      try {
        const result = await lookupArtistInviteCandidate(organizationId, email.trim());
        setLookup(result);
        if (result.recommended_invitation_type === 'create_new' && mode === 'link_existing' && !result.has_artist_profile) {
          // Keep mode but show guidance in UI
        }
      } catch (err) {
        setLookup(null);
        setError(err instanceof Error ? err.message : 'Lookup failed');
      } finally {
        setLookupLoading(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [email, organizationId, open, mode]);

  if (!open) return null;

  const handleCopy = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const invitationType =
        mode === 'create_new' ? 'create_new' : 'link_existing';

      if (mode === 'create_new' && !stageName.trim()) {
        setError('Stage name is required for new artist invites.');
        return;
      }

      if (lookup?.pending_invitation_id) {
        setError('An invitation is already pending for this email.');
        return;
      }

      if (lookup?.link_status === 'active') {
        setError('This artist is already linked to your organization.');
        return;
      }

      const { token } = await inviteArtistToOrganization(
        organizationId,
        email.trim(),
        invitationType,
        mode === 'create_new'
          ? { stage_name: stageName.trim(), country: country.trim() || undefined }
          : {}
      );

      setInviteLink(almcRoutes.acceptArtistInviteUrl(token));
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invitation');
    } finally {
      setSubmitting(false);
    }
  };

  const lookupHint = (() => {
    if (lookupLoading) return 'Checking Airaplay account…';
    if (!lookup) return null;
    if (lookup.link_status === 'active') return 'Already linked to your roster.';
    if (lookup.link_status === 'pending_invite') return 'Invitation already pending for this artist.';
    if (lookup.pending_invitation_id) return 'An invitation email is already pending.';
    if (lookup.has_artist_profile) {
      return `Found artist profile: ${lookup.stage_name ?? lookup.display_name ?? 'Artist'}`;
    }
    if (lookup.has_account) return 'Account exists but has no artist profile yet — use Invite new artist.';
    return 'No Airaplay account yet — they will receive an invite to sign up and join.';
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
            <h2 className="text-xl font-bold text-foreground">Add Artist</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Link an existing Airaplay artist or invite someone new to your roster.
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

        {inviteLink ? (
          <div className="space-y-4 px-6 py-6">
            <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
              <p className="text-sm font-medium text-foreground">Invitation sent</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Share this link with the artist. They keep full ownership of their profile and catalog.
              </p>
              <code className="mt-3 block break-all rounded-lg bg-black/30 p-3 text-xs text-[#3ba208]">
                {inviteLink}
              </code>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-secondary py-2.5 text-sm text-foreground hover:bg-muted"
                >
                  {copied ? <Check className="h-4 w-4 text-[#3ba208]" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <ConsolePrimaryButton type="button" onClick={onClose} className="flex-1">
                  Done
                </ConsolePrimaryButton>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 px-6 py-6">
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
                    lookup?.link_status === 'active' || lookup?.pending_invitation_id
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
                <p className="text-xs text-muted-foreground">
                  They will sign up on Airaplay, create their artist profile, then accept the invitation to join your roster.
                </p>
              </>
            )}

            {mode === 'link_existing' && (
              <p className="text-xs text-muted-foreground">
                The artist must already have an Airaplay artist profile on this email. They accept the invite to grant your organization management access.
              </p>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border border-border py-3 text-sm text-secondary-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <ConsolePrimaryButton
                type="submit"
                disabled={submitting || lookup?.link_status === 'active' || !!lookup?.pending_invitation_id}
                loading={submitting}
                className="flex-1"
              >
                <ConsoleSubmitArrow label={mode === 'create_new' ? 'Send invite' : 'Send link invite'} />
              </ConsolePrimaryButton>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
