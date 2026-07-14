import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { toUserFacingAuthError } from '../../lib/criticalErrorMessages';

type Status = 'loading' | 'success' | 'error';

/**
 * Handles the redirect after email confirmation or OAuth (e.g. Google).
 * Exchanges code for session (PKCE) or sets session from hash, then shows success/error.
 *
 * Supabase redirects here with ?code= (PKCE) or #access_token= (implicit).
 */
export const AuthCallbackScreen: React.FC = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOAuthSignIn, setIsOAuthSignIn] = useState(false);

  useEffect(() => {
    let mounted = true;
    let urlCleaned = false;

    const cleanUrl = () => {
      if (!urlCleaned && typeof window !== 'undefined') {
        urlCleaned = true;
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    };

    const pollForSession = async (maxAttempts: number = 10, delayMs: number = 300): Promise<Session | null> => {
      for (let i = 0; i < maxAttempts; i++) {
        if (!mounted) return null;
        
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          return session;
        }
        
        // Wait before next attempt
        await new Promise((r) => setTimeout(r, delayMs));
      }
      return null;
    };

    const run = async () => {
      // Parse potential error details from the hash (Supabase sends errors here)
      const rawHash = typeof window !== 'undefined' ? window.location.hash : '';
      const hash = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
      const hashParams = new URLSearchParams(hash);
      const urlError = hashParams.get('error') || hashParams.get('error_code');
      const urlErrorDescription =
        hashParams.get('error_description') || hashParams.get('error_message');

      // If there's an error in the URL, show it immediately
      if (urlError) {
        cleanUrl();
        setStatus('error');
        setErrorMessage(
          urlErrorDescription ||
            'We could not confirm your email. The link may have expired or already been used.'
        );
        return;
      }

      try {
        // Support both PKCE (`?code=`) and implicit (`#access_token=...`) flows.
        const searchParams = new URLSearchParams(window.location.search);
        const code = searchParams.get('code');
        
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else {
          const access_token = hashParams.get('access_token');
          const refresh_token = hashParams.get('refresh_token');
          if (access_token && refresh_token) {
            const { error: setSessionError } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            });
            if (setSessionError) throw setSessionError;
          }
        }

        // Poll for session with retries (handles slow connections)
        const session = await pollForSession();

        if (session?.user) {
          cleanUrl();
          // Preserve referral from callback URL if present (e.g. Google OAuth with ?ref=)
          const refFromUrl = searchParams.get('ref');
          if (refFromUrl && typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem('referralCode', refFromUrl);
          }
          const provider = session.user.app_metadata?.provider;
          setIsOAuthSignIn(provider === 'google' || provider === 'apple' || !!provider);
          setStatus('success');
        } else {
          cleanUrl();
          setStatus('error');
          setErrorMessage(
            'Something went wrong while confirming your email. Please request a new confirmation link and try again.'
          );
        }
      } catch (err) {
        console.error('Auth callback error:', err);
        cleanUrl();
        setStatus('error');
        setErrorMessage(toUserFacingAuthError(err));
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, []);

  const handleContinue = () => {
    navigate('/', { replace: true });
  };

  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center p-6">
      <div className="max-w-sm w-full bg-black/80 border border-white/15 rounded-2xl p-6 space-y-4 text-center">
        {status === 'loading' && (
          <>
            <p className="text-white/90 font-medium">Confirming your email…</p>
            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto" />
          </>
        )}

        {status === 'success' && (
          <>
            <p className="text-white font-semibold text-lg">
              {isOAuthSignIn ? "You're signed in" : 'Email confirmed'}
            </p>
            <p className="text-white/80 text-sm">
              {isOAuthSignIn
                ? "You're all set. Continue to the app."
                : 'Your email has been confirmed successfully. You can now log in to your account.'}
            </p>
            <button
              type="button"
              onClick={handleContinue}
              className="mt-2 w-full h-11 rounded-lg font-medium text-black bg-white shadow-lg hover:opacity-90 transition-opacity"
            >
              {isOAuthSignIn ? 'Continue' : 'Log in'}
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <p className="text-red-400 font-semibold text-lg">Email confirmation failed</p>
            <p className="text-white/80 text-sm">
              {errorMessage ||
                'We could not confirm your email. Please go back to the app and request a new confirmation link.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
};
