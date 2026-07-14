import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle, AlertCircle } from 'lucide-react';
import {
  acceptArtistOrganizationInvitation,
  acceptOrganizationMemberInvitation,
  formatInvitationCodeInput,
  normalizeInvitationCode,
} from '../../lib/orgAccess';
import { almcRoutes } from '../../lib/almcRoutes';
import { supabase } from '../../lib/supabase';
import { LoadingLogo } from '../../components/LoadingLogo';
import { ConsoleAuthShell } from '../components/ConsoleAuthShell';
import { ConsolePrimaryButton, ConsoleSubmitArrow } from '../components/ConsoleFormControls';
import { consoleTheme } from '../consoleTheme';
import { cn } from '../../lib/utils';

type AcceptType = 'artist' | 'team';

export function ConsoleAcceptInvitationScreen({ type }: { type: AcceptType }): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlCode = searchParams.get('code') ?? searchParams.get('token') ?? '';
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error' | 'auth_required'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (type === 'artist' && urlCode) {
      setCode(formatInvitationCodeInput(urlCode));
    }
  }, [type, urlCode]);

  useEffect(() => {
    if (type !== 'team' || !urlCode) return;

    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          if (!cancelled) setStatus('auth_required');
          return;
        }
        await acceptOrganizationMemberInvitation(urlCode);
        if (!cancelled) {
          setMessage('You have joined the organization workspace.');
          setStatus('success');
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setMessage(err instanceof Error ? err.message : 'Failed to accept invitation');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [type, urlCode]);

  const acceptArtistInvitation = async (e?: React.FormEvent) => {
    e?.preventDefault();

    const normalized = normalizeInvitationCode(code);
    if (normalized.length < 8) {
      setStatus('error');
      setMessage('Enter the full 8-character invitation code.');
      return;
    }

    setStatus('loading');
    setMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setStatus('auth_required');
        return;
      }

      const result = await acceptArtistOrganizationInvitation(code);
      if (result.requires_artist_profile) {
        setStatus('error');
        setMessage(
          'Create your artist profile on Airaplay first, then return here and enter the same invitation code.'
        );
        return;
      }
      setMessage('You have joined the organization. Your artist profile remains fully yours.');
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Failed to accept invitation');
    }
  };

  if (type === 'team' && status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingLogo />
      </div>
    );
  }

  if (type === 'team' && status === 'auth_required') {
    return (
      <ConsoleAuthShell
        title="Sign in to accept"
        subtitle="Please sign in with the account that received this invitation."
      >
        <ConsolePrimaryButton
          type="button"
          onClick={() =>
            navigate(
              `${almcRoutes.login}?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`
            )
          }
        >
          <ConsoleSubmitArrow label="Sign in" />
        </ConsolePrimaryButton>
      </ConsoleAuthShell>
    );
  }

  if (type === 'team' && (status === 'success' || status === 'error')) {
    return (
      <ConsoleAuthShell
        title={status === 'success' ? 'Invitation accepted' : 'Something went wrong'}
        subtitle={message}
      >
        <div className="flex justify-center py-2">
          {status === 'success' ? (
            <CheckCircle className="h-12 w-12 text-[#3ba208]" />
          ) : (
            <AlertCircle className="h-12 w-12 text-red-400" />
          )}
        </div>
        {status === 'success' && (
          <ConsolePrimaryButton type="button" onClick={() => navigate(almcRoutes.home)}>
            <ConsoleSubmitArrow label="Go to Console" />
          </ConsolePrimaryButton>
        )}
      </ConsoleAuthShell>
    );
  }

  if (type === 'artist' && status === 'auth_required') {
    return (
      <ConsoleAuthShell
        title="Sign in to accept"
        subtitle="Sign in with the email address that received the invitation, then enter your code."
      >
        <ConsolePrimaryButton
          type="button"
          onClick={() =>
            navigate(
              `${almcRoutes.login}?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`
            )
          }
        >
          <ConsoleSubmitArrow label="Sign in" />
        </ConsolePrimaryButton>
      </ConsoleAuthShell>
    );
  }

  if (type === 'artist' && status === 'success') {
    return (
      <ConsoleAuthShell title="Invitation accepted" subtitle={message}>
        <div className="flex justify-center py-2">
          <CheckCircle className="h-12 w-12 text-[#3ba208]" />
        </div>
        <ConsolePrimaryButton type="button" onClick={() => navigate(almcRoutes.consumerProfile())}>
          <ConsoleSubmitArrow label="Go to Profile" />
        </ConsolePrimaryButton>
      </ConsoleAuthShell>
    );
  }

  return (
    <ConsoleAuthShell
      title={type === 'artist' ? 'Enter invitation code' : 'Accept invitation'}
      subtitle={
        type === 'artist'
          ? 'Enter the 8-character code sent to your email to join the organization roster.'
          : message
      }
    >
      {type === 'artist' ? (
        <form onSubmit={acceptArtistInvitation} className="space-y-4">
          {status === 'error' && message && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
              {message}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm text-secondary-foreground">Invitation code</label>
            <input
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(formatInvitationCodeInput(e.target.value))}
              placeholder="XXXX-XXXX"
              className={cn(consoleTheme.input, 'w-full text-center font-mono text-xl tracking-[0.2em] uppercase')}
            />
          </div>

          <ConsolePrimaryButton
            type="submit"
            disabled={status === 'loading' || normalizeInvitationCode(code).length < 8}
            loading={status === 'loading'}
            className="w-full"
          >
            <ConsoleSubmitArrow label="Accept invitation" />
          </ConsolePrimaryButton>

          {message.includes('artist profile') && (
            <ConsolePrimaryButton
              type="button"
              onClick={() => navigate(almcRoutes.consumerBecomeArtist())}
              className="w-full"
            >
              <ConsoleSubmitArrow label="Become an artist" />
            </ConsolePrimaryButton>
          )}
        </form>
      ) : null}
    </ConsoleAuthShell>
  );
}

export function ConsoleAcceptArtistScreen(): JSX.Element {
  return <ConsoleAcceptInvitationScreen type="artist" />;
}

export function ConsoleAcceptTeamScreen(): JSX.Element {
  return <ConsoleAcceptInvitationScreen type="team" />;
}
