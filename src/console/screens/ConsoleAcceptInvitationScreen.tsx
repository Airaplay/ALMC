import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { acceptArtistOrganizationInvitation, acceptOrganizationMemberInvitation } from '../../lib/orgAccess';
import { almcRoutes } from '../../lib/almcRoutes';
import { supabase } from '../../lib/supabase';
import { LoadingLogo } from '../../components/LoadingLogo';
import { ConsoleAuthShell } from '../components/ConsoleAuthShell';
import { ConsolePrimaryButton, ConsoleSubmitArrow } from '../components/ConsoleFormControls';

type AcceptType = 'artist' | 'team';

export function ConsoleAcceptInvitationScreen({ type }: { type: AcceptType }): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'auth_required'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    acceptInvitation();
  }, [token, type]);

  const acceptInvitation = async () => {
    if (!token) {
      setStatus('error');
      setMessage('Missing invitation token');
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setStatus('auth_required');
        return;
      }

      if (type === 'artist') {
        await acceptArtistOrganizationInvitation(token);
        setMessage('You have joined the organization. Your artist profile remains fully yours.');
      } else {
        await acceptOrganizationMemberInvitation(token);
        setMessage('You have joined the organization workspace.');
      }
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Failed to accept invitation');
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingLogo />
      </div>
    );
  }

  if (status === 'auth_required') {
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
        <ConsolePrimaryButton
          type="button"
          onClick={() => navigate(type === 'team' ? almcRoutes.home : almcRoutes.consumerProfile())}
        >
          <ConsoleSubmitArrow label={type === 'team' ? 'Go to Console' : 'Go to Profile'} />
        </ConsolePrimaryButton>
      )}
    </ConsoleAuthShell>
  );
}

export function ConsoleAcceptArtistScreen(): JSX.Element {
  return <ConsoleAcceptInvitationScreen type="artist" />;
}

export function ConsoleAcceptTeamScreen(): JSX.Element {
  return <ConsoleAcceptInvitationScreen type="team" />;
}
