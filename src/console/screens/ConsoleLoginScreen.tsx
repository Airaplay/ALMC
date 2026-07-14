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
  ConsoleFloatingInput,
  ConsolePasswordToggle,
  ConsolePrimaryButton,
  ConsoleSubmitArrow,
} from '../components/ConsoleFormControls';
import { consoleTheme } from '../consoleTheme';

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
      : 'Label & Management Console';
  const subline = pendingVerification
    ? `Enter the 6-digit code sent to ${email}`
    : isSignUp
      ? 'Join Airaplay — manage artists and releases'
      : 'Sign in with your Airaplay account';

  if (isCheckingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingLogo />
      </div>
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
              className="absolute right-4 top-4 rounded-full p-2.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50 sm:right-6 sm:top-6"
            >
              <LogOut className="h-5 w-5" />
            </button>
          ) : undefined
        }
        footer={
          <div className="mt-6 space-y-3 text-center text-[13px] text-white/50">
            {!pendingVerification && (
              <p>
                {isSignUp ? 'Already have an account?' : 'New to Airaplay?'}{' '}
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp((value) => !value);
                    setError(null);
                    setPendingVerification(false);
                  }}
                  className={consoleTheme.link}
                >
                  {isSignUp ? 'Sign in' : 'Create account'}
                </button>
              </p>
            )}
            <p>
              <a href={almcRoutes.consumerHome()} className={consoleTheme.link}>
                Back to Airaplay
              </a>
            </p>
          </div>
        }
      >
        {signedInEmail && !pendingVerification && (
          <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
            <p className="text-[13px] text-white/80">
              Signed in as <span className="font-medium text-white">{signedInEmail}</span>
            </p>
            <ConsolePrimaryButton type="button" onClick={routeAfterLogin} className="mt-3">
              Continue to Console
            </ConsolePrimaryButton>
          </div>
        )}

        {pendingVerification ? (
          <form onSubmit={handleVerifyOtp} className="space-y-6">
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
                  className="h-12 w-10 min-w-0 rounded-xl border border-white/20 bg-white/5 text-center text-lg font-bold text-white outline-none transition-all focus:border-[#3ba208] focus:ring-2 focus:ring-[#3ba208]/30 sm:h-12 sm:w-11"
                />
              ))}
            </div>
            <ConsolePrimaryButton
              type="submit"
              disabled={isVerifyingOtp || otpCode.length !== 6}
              loading={isVerifyingOtp}
            >
              <ConsoleSubmitArrow label="Verify & continue" />
            </ConsolePrimaryButton>
            <button
              type="button"
              onClick={handleResendCode}
              disabled={resendCooldownSeconds > 0}
              className="w-full text-[12px] font-semibold text-[#3ba208] disabled:text-white/30"
            >
              {resendCooldownSeconds > 0
                ? `Resend code in ${resendCooldownSeconds}s`
                : 'Resend code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {error ? <ConsoleErrorAlert message={error} /> : null}

            {isSignUp && (
              <ConsoleFloatingInput
                label="Full name"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            )}

            <ConsoleFloatingInput
              label="Email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <ConsoleFloatingInput
              label="Password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              rightSlot={
                <ConsolePasswordToggle show={showPassword} onToggle={() => setShowPassword((v) => !v)} />
              }
            />

            {isSignUp && (
              <label className="flex items-start gap-2 text-[12px] text-white/60">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 rounded border-white/20 bg-transparent text-[#3ba208] focus:ring-[#3ba208]/30"
                />
                <span>
                  I agree to the{' '}
                  <a
                    href={almcRoutes.consumerTermsSignup()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={consoleTheme.link}
                  >
                    Terms & Conditions
                  </a>
                </span>
              </label>
            )}

            <ConsolePrimaryButton
              type="submit"
              disabled={isSubmitting || (isSignUp && !agreedToTerms)}
              loading={isSubmitting}
            >
              <ConsoleSubmitArrow
                label={
                  isSignUp
                    ? 'Create account'
                    : 'Sign in to Console'
                }
              />
            </ConsolePrimaryButton>
          </form>
        )}
      </ConsoleAuthShell>
  );
}
