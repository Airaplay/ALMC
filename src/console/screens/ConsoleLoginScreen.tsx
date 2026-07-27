import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getMyOrganizations } from '../../lib/orgAccess';
import { almcRoutes } from '../../lib/almcRoutes';
import { performCompleteLogout } from '../../lib/logoutService';
import { toUserFacingAuthError } from '../../lib/criticalErrorMessages';
import { LoadingLogo } from '../../components/LoadingLogo';
import { ConsoleAuthShell } from '../components/ConsoleAuthShell';
import {
  ConsoleErrorAlert,
  ConsolePasswordToggle,
} from '../components/ConsoleFormControls';

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
            data: { display_name: displayName.trim() },
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

  const headline = pendingVerification
    ? 'Verify your email'
    : isSignUp
      ? 'Create account'
      : undefined;
  const subline = pendingVerification
    ? `Enter the 6-digit code sent to ${email}`
    : isSignUp
      ? 'Join Airaplay — manage artists and releases'
      : 'Sign in with your Airaplay account';

  const glassLabel = 'mb-2 block text-sm font-medium text-white/85';
  const glassInput =
    'w-full rounded-md bg-white px-4 py-3.5 text-[15px] text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:ring-2 focus:ring-[#33AA2D]/40';
  const glassBtn =
    'inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#33AA2D] text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#2d9628] disabled:cursor-not-allowed disabled:opacity-70';
  const glassLink =
    'text-white underline decoration-white/50 underline-offset-2 transition hover:decoration-white';

  if (isCheckingAuth) {
    return (
      <ConsoleAuthShell subtitle="Loading…">
        <div className="flex items-center justify-center gap-3 py-6">
          <LoadingLogo />
        </div>
      </ConsoleAuthShell>
    );
  }

  return (
    <ConsoleAuthShell
        title={headline}
        subtitle={subline}
        headerAction={
          signedInEmail ? (
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isSigningOut}
              title="Sign out"
              aria-label="Sign out"
              className="rounded-full p-2.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <LogOut className="h-5 w-5" />
            </button>
          ) : undefined
        }
        footer={
          <div className="mt-6 space-y-3 text-center text-[13px] text-white/80">
            {!pendingVerification && (
              <p>
                {isSignUp ? 'Already have an account?' : 'Are you new?'}{' '}
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp((value) => !value);
                    setError(null);
                    setPendingVerification(false);
                  }}
                  className={glassLink}
                >
                  {isSignUp ? 'Sign in' : 'Create an Account'}
                </button>
              </p>
            )}
            <p>
              <a href={almcRoutes.consumerHome()} className={glassLink}>
                Back to Airaplay
              </a>
            </p>
          </div>
        }
      >
        {signedInEmail && !pendingVerification && (
          <div className="rounded-lg border border-white/25 bg-white/10 p-4">
            <p className="text-[13px] text-white/85">
              Signed in as <span className="font-medium text-white">{signedInEmail}</span>
            </p>
            <button type="button" onClick={routeAfterLogin} className={`${glassBtn} mt-3`}>
              Continue to Console
            </button>
          </div>
        )}

        {pendingVerification ? (
          <form onSubmit={handleVerifyOtp} className="space-y-5">
            {error ? <ConsoleErrorAlert message={error} /> : null}
            <div className="flex justify-center gap-1.5 sm:gap-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <input
                  key={i}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={otpCode[i] || ''}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(-1);
                    const next = otpCode.split('');
                    next[i] = val;
                    setOtpCode(next.join('').slice(0, 6));
                    setError(null);
                  }}
                  className="h-12 w-10 min-w-0 rounded-md bg-white text-center text-lg font-bold text-zinc-900 outline-none transition focus:ring-2 focus:ring-[#33AA2D]/40 sm:h-12 sm:w-11"
                />
              ))}
            </div>
            <button
              type="submit"
              disabled={isVerifyingOtp || otpCode.length !== 6}
              className={glassBtn}
            >
              {isVerifyingOtp ? 'Verifying…' : 'Verify & continue'}
            </button>
            <button
              type="button"
              onClick={handleResendCode}
              disabled={resendCooldownSeconds > 0}
              className="w-full text-sm text-white underline decoration-white/50 underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
            >
              {resendCooldownSeconds > 0
                ? `Resend code in ${resendCooldownSeconds}s`
                : 'Resend code'}
            </button>
          </form>
        ) : !signedInEmail ? (
          <form onSubmit={handleSubmit} className="space-y-5">
            {error ? <ConsoleErrorAlert message={error} /> : null}

            {isSignUp && (
              <div>
                <label className={glassLabel} htmlFor="almc-name">Full name</label>
                <input
                  id="almc-name"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className={glassInput}
                  placeholder="Enter your name"
                />
              </div>
            )}

            <div>
              <label className={glassLabel} htmlFor="almc-email">Email</label>
              <input
                id="almc-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={glassInput}
                placeholder="Enter your email"
              />
            </div>

            <div>
              <label className={glassLabel} htmlFor="almc-password">Password</label>
              <div className="relative">
                <input
                  id="almc-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${glassInput} pr-11`}
                  placeholder="••••••••"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400">
                  <ConsolePasswordToggle show={showPassword} onToggle={() => setShowPassword((v) => !v)} />
                </div>
              </div>
            </div>

            {isSignUp && (
              <label className="flex items-start gap-2 text-[12px] text-white/75">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 rounded border-white/40 bg-white/20 text-[#33AA2D] focus:ring-[#33AA2D]/30"
                />
                <span>
                  I agree to the{' '}
                  <a
                    href={almcRoutes.consumerTermsSignup()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={glassLink}
                  >
                    Terms & Conditions
                  </a>
                </span>
              </label>
            )}

            <button
              type="submit"
              disabled={isSubmitting || (isSignUp && !agreedToTerms)}
              className={glassBtn}
            >
              {isSubmitting
                ? isSignUp
                  ? 'Creating…'
                  : 'Signing in…'
                : isSignUp
                  ? 'Create account'
                  : 'Sign In'}
            </button>
          </form>
        ) : null}
      </ConsoleAuthShell>
  );
}
