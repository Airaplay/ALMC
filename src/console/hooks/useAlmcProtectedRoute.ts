import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { almcRoutes } from '../../lib/almcRoutes';
import { isAlmcPinVerified } from '../lib/almcPinGate';

export function useAlmcProtectedRoute(): boolean {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;

      if (!session) {
        navigate(almcRoutes.login, { replace: true });
        return;
      }

      if (!isAlmcPinVerified(session.user.id)) {
        navigate(`${almcRoutes.login}?step=pin`, { replace: true });
        return;
      }

      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return ready;
}
