import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

type Status = 'loading' | 'ready' | 'success' | 'error';

export const ResetPasswordScreen: React.FC = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>('loading');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      // Give Supabase a moment to process the URL and create a recovery session
      await new Promise((r) => setTimeout(r, 600));
      if (!mounted) return;

      try {
        // Support both PKCE (`?code=`) and implicit (`#access_token=...`) flows.
        const searchParams = new URLSearchParams(window.location.search);
        const code = searchParams.get('code');

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
          // Remove code from URL after exchange
          window.history.replaceState({}, document.title, window.location.pathname);
        } else if (window.location.hash) {
          const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
          const access_token = hashParams.get('access_token');
          const refresh_token = hashParams.get('refresh_token');
          if (access_token && refresh_token) {
            const { error: setSessionError } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            });
            if (setSessionError) throw setSessionError;
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        }

        const { data: { session } } = await supabase.auth.getSession();

        if (session?.user) {
          setStatus('ready');
        } else {
          setStatus('error');
          setError(
            'This password reset link is invalid or has expired. Please request a new reset link from the app.'
          );
        }
      } catch (err) {
        console.error('Reset password init error:', err);
        setStatus('error');
        setError(
          'We could not verify your reset link. Please request a new reset link from the app.'
        );
      }
    };

    init();
    return () => {
      mounted = false;
    };
  }, []);

  const validatePassword = (value: string): string | null => {
    if (value.length < 8) {
      return 'Password must be at least 8 characters long';
    }
    if (value.length > 128) {
      return 'Password must be less than 128 characters';
    }
    const hasLetter = /[a-zA-Z]/.test(value);
    const hasNumber = /[0-9]/.test(value);
    if (!hasLetter || !hasNumber) {
      return 'Password must contain at least one letter and one number';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setError(null);

    if (!password || !confirmPassword) {
      setError('Please enter and confirm your new password');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    const pwError = validatePassword(password);
    if (pwError) {
      setError(pwError);
      return;
    }

    setIsSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      setStatus('success');
    } catch (err) {
      console.error('Reset password submit error:', err);
      setStatus('error');
      setError(
        err instanceof Error
          ? err.message
          : 'We could not update your password. Please request a new reset link and try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoToLogin = () => {
    navigate('/?auth=login', { replace: true });
  };

  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center p-6">
      <div className="max-w-sm w-full bg-black/80 border border-white/15 rounded-2xl p-6 space-y-4">
        {status === 'loading' && (
          <div className="text-center space-y-4">
            <p className="text-white/90 font-medium">Preparing password reset…</p>
            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto" />
          </div>
        )}

        {status === 'ready' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <h2 className="text-white font-semibold text-lg text-center">Set a new password</h2>
            <p className="text-white/70 text-sm text-center">
              Enter a strong password you haven&apos;t used before on Airaplay.
            </p>

            <div>
              <label className="block text-white/80 text-sm mb-1">New password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-11 px-4 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:ring-2 focus:ring-[#3ba208]/60 outline-none"
                placeholder="Enter new password"
              />
            </div>

            <div>
              <label className="block text-white/80 text-sm mb-1">Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full h-11 px-4 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:ring-2 focus:ring-[#3ba208]/60 outline-none"
                placeholder="Re-enter new password"
              />
            </div>

            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-md text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-11 rounded-lg font-medium text-black bg-white shadow-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {isSubmitting ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}

        {status === 'success' && (
          <div className="text-center space-y-3">
            <p className="text-white font-semibold text-lg">Password updated</p>
            <p className="text-white/80 text-sm">
              Your password has been changed successfully. You can now log in with your new
              password.
            </p>
            <button
              type="button"
              onClick={handleGoToLogin}
              className="mt-2 w-full h-11 rounded-lg font-medium text-black bg-white shadow-lg hover:opacity-90 transition-opacity"
            >
              Log in
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center space-y-3">
            <p className="text-red-400 font-semibold text-lg">Password reset failed</p>
            <p className="text-white/80 text-sm">
              {error ||
                'We could not complete your password reset. Please go back to the app and request a new reset link.'}
            </p>
            <button
              type="button"
              onClick={handleGoToLogin}
              className="mt-2 w-full h-11 rounded-lg font-medium text-black bg-white shadow-lg hover:opacity-90 transition-opacity"
            >
              Go to app to request a new link
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

