import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle, AlertCircle, Building2 } from 'lucide-react';
import { acceptArtistOrganizationInvitation, acceptOrganizationMemberInvitation } from '../../lib/orgAccess';
import { almcRoutes } from '../../lib/almcRoutes';
import { supabase } from '../../lib/supabase';
import { LoadingLogo } from '../../components/LoadingLogo';

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
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0b]">
        <LoadingLogo />
      </div>
    );
  }

  if (status === 'auth_required') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0b] p-4">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#141416] p-8 text-center">
          <Building2 className="mx-auto h-12 w-12 text-[#FF3366]" />
          <h1 className="mt-4 text-xl font-semibold text-white">Sign in to accept</h1>
          <p className="mt-2 text-sm text-white/50">
            Please sign in with the account that received this invitation.
          </p>
          <button
            type="button"
            onClick={() => navigate(`${almcRoutes.login}?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`)}
            className="mt-6 w-full rounded-xl bg-[#FF3366] py-3 text-sm font-semibold text-white"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0b] p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#141416] p-8 text-center">
        {status === 'success' ? (
          <CheckCircle className="mx-auto h-12 w-12 text-emerald-400" />
        ) : (
          <AlertCircle className="mx-auto h-12 w-12 text-red-400" />
        )}
        <h1 className="mt-4 text-xl font-semibold text-white">
          {status === 'success' ? 'Invitation accepted' : 'Something went wrong'}
        </h1>
        <p className="mt-2 text-sm text-white/50">{message}</p>
        {status === 'success' && (
          <button
            type="button"
            onClick={() => navigate(type === 'team' ? almcRoutes.home : almcRoutes.consumerProfile())}
            className="mt-6 w-full rounded-xl bg-[#FF3366] py-3 text-sm font-semibold text-white"
          >
            {type === 'team' ? 'Go to Console' : 'Go to Profile'}
          </button>
        )}
      </div>
    </div>
  );
}

export function ConsoleAcceptArtistScreen(): JSX.Element {
  return <ConsoleAcceptInvitationScreen type="artist" />;
}

export function ConsoleAcceptTeamScreen(): JSX.Element {
  return <ConsoleAcceptInvitationScreen type="team" />;
}
