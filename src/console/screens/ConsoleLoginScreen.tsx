import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getMyOrganizations, OrgType } from '../../lib/orgAccess';
import { almcRoutes } from '../../lib/almcRoutes';
import { performCompleteLogout } from '../../lib/logoutService';
import { fetchHasSecurityPin, setSecurityPinRpc, verifySecurityPinForSession } from '../../lib/supabase';
import { toUserFacingAuthError } from '../../lib/criticalErrorMessages';
import { LoadingLogo } from '../../components/LoadingLogo';
import { ConsoleAuthShell } from '../components/ConsoleAuthShell';
import { ConsolePinStep, ConsolePinStepMode } from '../components/ConsolePinStep';
import {
  ConsoleErrorAlert,
  ConsolePasswordToggle,
} from '../components/ConsoleFormControls';
import { isAlmcPinVerified, markAlmcPinVerified } from '../lib/almcPinGate';

const ALMC_ORG_TYPE_OPTIONS: Array<{ value: OrgType; label: string }> = [
  { value: 'label', label: 'Record Label' },
  { value: 'management', label: 'Management Company' },
  { value: 'distributor', label: 'Distributor' },
  { value: 'entertainment', label: 'Entertainment Company' },
];

const ALMC_ORG_TYPE_VALUES = new Set<string>(ALMC_ORG_TYPE_OPTIONS.map((o) => o.value));

function isOrgType(value: unknown): value is OrgType {
  return typeof value === 'string' && ALMC_ORG_TYPE_VALUES.has(value);
}

async function ensureAlmcUserProfile(input: {
  userId: string;
  email: string;
  displayName: string;
  orgType: OrgType | null;
}): Promise<void> {
  const { error: insertError } = await supabase.from('users').insert({
    id: input.userId,
    email: input.email,
    display_name: input.displayName || null,
    // Platform consumer role — ALMC org roles live on organization_members.
    // For ALMC accounts, mirror the selected organization type into the platform profile role.
    role: input.orgType ?? 'listener',
    country_last_changed_at: new Date().toISOString(),
  });

  if (
    insertError &&
    !insertError.message.includes('duplicate key') &&
    !insertError.code?.includes('23505')
  ) {
    throw insertError;
  }

  if (input.orgType) {
    const { error: metaError } = await supabase.auth.updateUser({
      data: {
        almc_org_type: input.orgType,
        signup_source: 'almc',
      },
    });
    if (metaError) {
      console.error('Failed to persist ALMC org type metadata:', metaError);
    }
  }
}

type AuthStep = 'credentials' | 'email_otp' | 'pin_verify' | 'pin_setup';

export function ConsoleLoginScreen(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect');
  const pinStepRequested = searchParams.get('step') === 'pin';
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [orgType, setOrgType] = useState<OrgType | ''>('');
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
  const pendingOrgTypeRef = useRef<OrgType | null>(null);
  const [authStep, setAuthStep] = useState<AuthStep>('credentials');
  const [pinStepMode, setPinStepMode] = useState<ConsolePinStepMode>('verify');
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
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
      if (session?.user) {
        if (pinStepRequested || !isAlmcPinVerified(session.user.id)) {
          await beginPinGate(session.user.id, session.user.email ?? null);
          return;
        }
        await routeAfterLogin();
        return;
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

  const beginPinGate = async (userId: string, userEmail: string | null) => {
    setSessionUserId(userId);
    setSignedInEmail(userEmail);

    if (isAlmcPinVerified(userId)) {
      await routeAfterLogin();
      return;
    }

    const hasPin = await fetchHasSecurityPin();
    setPinStepMode(hasPin ? 'verify' : 'setup');
    setAuthStep(hasPin ? 'pin_verify' : 'pin_setup');
  };

  const handlePinVerify = async (pin: string) => {
    if (!sessionUserId) {
      throw new Error('Session expired. Please sign in again.');
    }
    await verifySecurityPinForSession(pin);
    markAlmcPinVerified(sessionUserId);
    await routeAfterLogin();
  };

  const handlePinSetup = async (pin: string, confirmPin: string) => {
    if (!sessionUserId) {
      throw new Error('Session expired. Please sign in again.');
    }
    await setSecurityPinRpc(pin, confirmPin);
    markAlmcPinVerified(sessionUserId);
    await routeAfterLogin();
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
      setOrgType('');
      setAuthStep('credentials');
      setSessionUserId(null);
      pendingOrgTypeRef.current = null;
      window.location.replace(almcRoutes.login);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign out failed');
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
        if (!isOrgType(orgType)) {
          setError('Please select your organization type.');
          return;
        }
        if (!agreedToTerms) {
          setError('Please accept the Terms & Conditions.');
          return;
        }

        const selectedOrgType = orgType;
        pendingOrgTypeRef.current = selectedOrgType;

        const authRedirectBase =
          (import.meta.env.VITE_AIRAPLAY_CONSUMER_URL as string | undefined)?.replace(/\/$/, '') ||
          window.location.origin;

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              display_name: displayName.trim(),
              almc_org_type: selectedOrgType,
              signup_source: 'almc',
            },
            emailRedirectTo: `${authRedirectBase}/auth/callback`,
          },
        });
        if (signUpError) throw signUpError;

        if (data.user && data.session) {
          await ensureAlmcUserProfile({
            userId: data.user.id,
            email: data.user.email || email.trim(),
            displayName: displayName.trim(),
            orgType: selectedOrgType,
          });
          setSignedInEmail(data.user.email ?? email.trim());
          await beginPinGate(data.user.id, data.user.email ?? email.trim());
          return;
        }

        // Email confirmation required — profile is written after OTP verify (needs a session).
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

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Sign-in succeeded but no session was created. Please try again.');
      }

      await beginPinGate(session.user.id, session.user.email ?? email.trim());
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
      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code,
        type: 'email',
      });
      if (verifyError) throw verifyError;

      const verifiedUser = verifyData.user;
      if (verifiedUser) {
        const metaOrgType = verifiedUser.user_metadata?.almc_org_type;
        const selectedOrgType = pendingOrgTypeRef.current
          ?? (isOrgType(metaOrgType) ? metaOrgType : null);
        await ensureAlmcUserProfile({
          userId: verifiedUser.id,
          email: verifiedUser.email || email.trim(),
          displayName:
            displayName.trim() ||
            String(verifiedUser.user_metadata?.display_name ?? '').trim(),
          orgType: selectedOrgType,
        });
      }

      setSignedInEmail(email.trim());
      setPendingVerification(false);
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await beginPinGate(session.user.id, session.user.email ?? email.trim());
        return;
      }
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

  const headline = authStep === 'pin_verify' || authStep === 'pin_setup'
    ? authStep === 'pin_setup'
      ? 'Create security PIN'
      : 'Enter security PIN'
    : pendingVerification
    ? 'Verify your email'
    : isSignUp
      ? 'Create account'
      : undefined;
  const subline = authStep === 'pin_verify'
    ? 'One more step before you can open the console'
    : authStep === 'pin_setup'
      ? 'Protect your console with a PIN only you know'
    : pendingVerification
    ? `Enter the 6-digit code sent to ${email}`
    : isSignUp
      ? 'Join Airaplay — manage artists and releases'
      : undefined;

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
            {!pendingVerification && authStep === 'credentials' && (
              <p>
                {isSignUp ? 'Already have an account?' : 'Are you new?'}{' '}
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp((value) => !value);
                    setError(null);
                    setPendingVerification(false);
                    setOrgType('');
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
        {authStep === 'pin_verify' || authStep === 'pin_setup' ? (
          <ConsolePinStep
            mode={pinStepMode}
            email={signedInEmail}
            onSubmitVerify={handlePinVerify}
            onSubmitSetup={handlePinSetup}
          />
        ) : pendingVerification ? (
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
        ) : authStep === 'credentials' ? (
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

            {isSignUp && (
              <div>
                <label className={glassLabel} htmlFor="almc-org-type">Organization type</label>
                <select
                  id="almc-org-type"
                  required
                  value={orgType}
                  onChange={(e) => setOrgType(e.target.value as OrgType | '')}
                  className={glassInput}
                >
                  <option value="" disabled>
                    Select your organization type
                  </option>
                  {ALMC_ORG_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
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
              disabled={isSubmitting || (isSignUp && (!agreedToTerms || !orgType))}
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
