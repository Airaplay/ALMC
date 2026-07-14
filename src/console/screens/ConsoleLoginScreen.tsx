import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, AlertCircle, LogOut, User } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getMyOrganizations } from '../../lib/orgAccess';
import { almcRoutes } from '../../lib/almcRoutes';
import { performCompleteLogout } from '../../lib/logoutService';
import { toUserFacingAuthError } from '../../lib/criticalErrorMessages';
import { LoadingLogo } from '../../components/LoadingLogo';

export function ConsoleLoginScreen(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [pendingVerification, setPendingVerification] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
  const resendCooldownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkExistingAuth();
    return () => {
      if (resendCooldownIntervalRef.current) {
        clearInterval(resendCooldownIntervalRef.current);
      }
    };
  }, []);

  const startResendCooldown = () => {
    setResendCooldownSeconds(60);
    if (resendCooldownIntervalRef.current) {
      clearInterval(resendCooldownIntervalRef.current);
    }
    resendCooldownIntervalRef.current = setInterval(() => {
      setResendCooldownSeconds((seconds) => {
        if (seconds <= 1) {
          if (resendCooldownIntervalRef.current) {
            clearInterval(resendCooldownIntervalRef.current);
            resendCooldownIntervalRef.current = null;
          }
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
  };

  const checkExistingAuth = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.email) {
        setSignedInEmail(session.user.email);
      }
    } catch {
      // continue to login form
    } finally {
      setIsCheckingAuth(false);
    }
  };

  const routeAfterLogin = async () => {
    if (redirect && (redirect.startsWith('/console') || redirect.startsWith('/login') || redirect === almcRoutes.home)) {
      navigate(redirect, { replace: true });
      return;
    }
    const organizations = await getMyOrganizations();
    if (organizations.length === 0) {
      navigate(almcRoutes.onboarding, { replace: true });
    } else {
      navigate(almcRoutes.home, { replace: true });
    }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setError(null);
    try {
      await performCompleteLogout();
      setSignedInEmail(null);
      setPendingVerification(false);
      setOtpCode('');
      setIsSignUp(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign out failed');
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      if (isSignUp) {
        if (!displayName.trim()) {
          setError('Please enter your name.');
          return;
        }
        if (!agreedToTerms) {
          setError('Please accept the Terms & Conditions.');
          return;
        }

        const authRedirectBase =
          (import.meta.env.VITE_AIRAPLAY_CONSUMER_URL as string | undefined)?.replace(/\/$/, '') ||
          window.location.origin;

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              display_name: displayName.trim(),
            },
            emailRedirectTo: `${authRedirectBase}/auth/callback`,
          },
        });
        if (signUpError) throw signUpError;

        if (data.user) {
          const { error: insertError } = await supabase.from('users').insert({
            id: data.user.id,
            email: data.user.email || email.trim(),
            display_name: displayName.trim(),
            role: 'listener',
            country_last_changed_at: new Date().toISOString(),
          });
          if (
            insertError &&
            !insertError.message.includes('duplicate key') &&
            !insertError.code?.includes('23505')
          ) {
            console.error('Failed to create user record:', insertError);
          }
        }

        if (data.session) {
          setSignedInEmail(data.user?.email ?? email.trim());
          await routeAfterLogin();
          return;
        }

        setPendingVerification(true);
        setOtpCode('');
        startResendCooldown();
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      setSignedInEmail(email.trim());
      await routeAfterLogin();
    } catch (err) {
      setError(toUserFacingAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otpCode.trim().replace(/\s/g, '');
    if (code.length !== 6) {
      setError('Please enter the 6-digit code from your email.');
      return;
    }

    setIsVerifyingOtp(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code,
        type: 'email',
      });
      if (verifyError) throw verifyError;
      setSignedInEmail(email.trim());
      setPendingVerification(false);
      await routeAfterLogin();
    } catch (err) {
      setError(toUserFacingAuthError(err));
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const handleResendCode = async () => {
    if (resendCooldownSeconds > 0 || !email.trim()) return;
    setError(null);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
      });
      if (resendError) throw resendError;
      startResendCooldown();
    } catch (err) {
      setError(toUserFacingAuthError(err));
    }
  };

  if (isCheckingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0b]">
        <LoadingLogo />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#0a0a0b] p-4">
      {signedInEmail && (
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          title="Sign out"
          aria-label="Sign out"
          className="absolute right-4 top-4 rounded-xl border border-white/10 p-2.5 text-white/50 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50 sm:right-6 sm:top-6"
        >
          <LogOut className="h-5 w-5" />
        </button>
      )}

      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <img
            src="/official_airaplay_logo.png"
            alt="Airaplay"
            className="mx-auto mb-4 h-8 object-contain"
          />
          <h1 className="text-2xl font-bold text-white">Airaplay Console</h1>
          <p className="mt-2 text-sm text-white/50">Label & Management Console for organizations</p>
        </div>

        {signedInEmail && !pendingVerification && (
          <div className="mb-4 rounded-2xl border border-[#309605]/30 bg-[#309605]/10 p-4">
            <p className="text-sm text-white/80">
              Signed in as <span className="font-medium text-white">{signedInEmail}</span>
            </p>
            <button
              type="button"
              onClick={routeAfterLogin}
              className="mt-3 w-full rounded-xl bg-[#309605] py-2.5 text-sm font-semibold text-white hover:bg-[#3ba208]"
            >
              Continue to Console
            </button>
          </div>
        )}

        {pendingVerification ? (
          <form onSubmit={handleVerifyOtp} className="rounded-2xl border border-white/10 bg-[#141416] p-6 space-y-4">
            <div className="text-center">
              <h2 className="text-lg font-semibold text-white">Verify your email</h2>
              <p className="mt-1 text-sm text-white/50">Enter the 6-digit code sent to {email}</p>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="w-full rounded-xl border border-white/10 bg-[#0f0f11] py-3 text-center text-lg tracking-[0.3em] text-white focus:border-[#309605]/50 focus:outline-none"
              placeholder="000000"
            />

            <button
              type="submit"
              disabled={isVerifyingOtp || otpCode.length !== 6}
              className="w-full rounded-xl bg-[#309605] py-3 text-sm font-semibold text-white hover:bg-[#3ba208] disabled:opacity-50"
            >
              {isVerifyingOtp ? 'Verifying…' : 'Verify & continue'}
            </button>

            <button
              type="button"
              onClick={handleResendCode}
              disabled={resendCooldownSeconds > 0}
              className="w-full text-sm text-[#3ba208] hover:underline disabled:text-white/30 disabled:no-underline"
            >
              {resendCooldownSeconds > 0
                ? `Resend code in ${resendCooldownSeconds}s`
                : 'Resend code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-2xl border border-white/10 bg-[#141416] p-6 space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            {isSignUp && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-white/70">Full name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-[#0f0f11] py-2.5 pl-10 pr-4 text-sm text-white focus:border-[#309605]/50 focus:outline-none"
                    placeholder="Your name"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-white/70">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#0f0f11] py-2.5 pl-10 pr-4 text-sm text-white focus:border-[#309605]/50 focus:outline-none"
                  placeholder="you@label.com"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-white/70">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#0f0f11] py-2.5 pl-10 pr-10 text-sm text-white focus:border-[#309605]/50 focus:outline-none"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {isSignUp && (
              <label className="flex items-start gap-2 text-sm text-white/60">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 rounded border-white/20 bg-[#0f0f11] text-[#3ba208] focus:ring-[#309605]/50"
                />
                <span>
                  I agree to the{' '}
                  <a
                    href={almcRoutes.consumerTermsSignup()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#3ba208] hover:underline"
                  >
                    Terms & Conditions
                  </a>
                </span>
              </label>
            )}

            <button
              type="submit"
              disabled={isSubmitting || (isSignUp && !agreedToTerms)}
              className="w-full rounded-xl bg-[#309605] py-3 text-sm font-semibold text-white hover:bg-[#3ba208] disabled:opacity-50"
            >
              {isSubmitting
                ? isSignUp
                  ? 'Creating account…'
                  : 'Signing in…'
                : isSignUp
                  ? 'Create account'
                  : 'Sign in to Console'}
            </button>
          </form>
        )}

        {!pendingVerification && (
          <p className="mt-6 text-center text-sm text-white/40">
            {isSignUp ? 'Already have an account?' : 'New to Airaplay?'}{' '}
            <button
              type="button"
              onClick={() => {
                setIsSignUp((value) => !value);
                setError(null);
                setPendingVerification(false);
              }}
              className="font-medium text-[#3ba208] hover:underline"
            >
              {isSignUp ? 'Sign in' : 'Create account'}
            </button>
          </p>
        )}

        <p className="mt-4 text-center text-sm text-white/40">
          <a href={almcRoutes.consumerHome()} className="text-[#3ba208] hover:underline">
            Back to Airaplay
          </a>
        </p>
      </div>
    </div>
  );
}
