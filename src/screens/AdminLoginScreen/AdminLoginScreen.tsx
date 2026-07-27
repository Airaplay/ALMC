import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle, Clock, Shield, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getCurrentAdminAccess } from '../../lib/adminAccess';
import { LoadingLogo } from '../../components/LoadingLogo';
import { cacheInvalidation } from '../../lib/enhancedDataFetching';
import {
  canResumeAdminEmailOtpSession,
  clearAdminLoginTrustStorage,
  finalizeAdminEmailOtpSession,
  hasAdminPasswordAndEmailOtpStepUp,
  hasTrustedAdminEmailSecondFactor,
  markAdminPasswordStepBeforeEmailOtp,
  sendAdminLoginEmailOtp,
  verifyAdminLoginEmailOtp,
} from '../../lib/adminEmailOtpGate';

const getClientInfo = () => ({
  userAgent: navigator.userAgent || '',
  ip: '',
});

type OtpPhase = 'idle' | 'email_otp';

const glassCardClass =
  'w-full max-w-[420px] rounded-[2rem] border border-white/30 bg-white/15 p-10 shadow-[0_8px_32px_rgba(0,0,0,0.25)] backdrop-blur-[22px] sm:p-12';

const inputClass =
  'w-full rounded-md bg-white px-4 py-3.5 text-[15px] text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:ring-2 focus:ring-[#33AA2D]/40 disabled:cursor-not-allowed disabled:bg-white/80';

const labelClass = 'mb-2 block text-sm font-medium text-white/85';

const primaryBtnClass =
  'w-full rounded-md bg-[#33AA2D] py-3.5 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#2d9628] disabled:cursor-not-allowed disabled:opacity-70';

function AdminLoginShell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="relative flex min-h-screen w-full overflow-hidden">
      <div className="absolute inset-0 bg-[#07111f]" aria-hidden />
      <div
        className="absolute inset-0 bg-cover bg-center opacity-45"
        style={{ backgroundImage: "url('/admin-login-bg.png')" }}
        aria-hidden
      />
      <div
        className="absolute inset-0 bg-gradient-to-r from-[#07111f]/75 via-[#07111f]/35 to-[#07111f]/55"
        aria-hidden
      />

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col justify-center gap-12 px-6 py-12 lg:flex-row lg:items-center lg:justify-between lg:gap-16 lg:px-10">
        <div className="max-w-xl text-white lg:flex-1">
          <img
            src="/airaplay-console-logo.png"
            alt="Airaplay"
            className="mb-6 h-10 object-contain brightness-0 invert sm:h-12"
          />
          <h1 className="text-3xl font-extrabold leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
            Label & Management Console
          </h1>
          <p className="mt-5 text-base font-medium text-white/90 sm:text-lg">
            Where music meets control.
          </p>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-white/70 sm:text-[15px]">
            Sign in to manage artists, content, and the Airaplay platform from one secure console.
          </p>
        </div>

        <div className="w-full lg:flex lg:justify-end lg:flex-1">{children}</div>
      </div>
    </div>
  );
}

export const AdminLoginScreen = (): JSX.Element => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [failuresRemaining, setFailuresRemaining] = useState<number | null>(null);
  const lockoutTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resendCooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [otpPhase, setOtpPhase] = useState<OtpPhase>('idle');
  const [otpEmail, setOtpEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
  const [isSendingOtp, setIsSendingOtp] = useState(false);

  useEffect(() => {
    checkExistingAuth();
    return () => {
      if (lockoutTimerRef.current) clearInterval(lockoutTimerRef.current);
      if (resendCooldownRef.current) clearInterval(resendCooldownRef.current);
    };
  }, []);

  const startLockoutTimer = (seconds: number) => {
    setLockoutSeconds(seconds);
    if (lockoutTimerRef.current) clearInterval(lockoutTimerRef.current);
    lockoutTimerRef.current = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(lockoutTimerRef.current!);
          setError(null);
          setFailuresRemaining(5);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const startResendCooldown = (seconds: number) => {
    setResendCooldownSeconds(seconds);
    if (resendCooldownRef.current) clearInterval(resendCooldownRef.current);
    resendCooldownRef.current = setInterval(() => {
      setResendCooldownSeconds((s) => {
        if (s <= 1) {
          if (resendCooldownRef.current) {
            clearInterval(resendCooldownRef.current);
            resendCooldownRef.current = null;
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const getSessionEmail = async (): Promise<string> => {
    const { data: { session } } = await supabase.auth.getSession();
    return (session?.user?.email ?? formData.email).trim();
  };

  const finishLoginSuccess = async () => {
    const email = (await getSessionEmail()).toLowerCase();
    await clearAttempts(email);
    await recordAttempt(email, true);

    try {
      const { userAgent } = getClientInfo();
      const access = await getCurrentAdminAccess();
      await supabase.rpc('log_admin_activity_with_context', {
        action_type_param: 'admin_login',
        details_param: { role: access.roleName || access.roleKey || access.legacyRole, email },
        ip_address_param: '',
        user_agent_param: userAgent,
      });
    } catch {
      // Non-critical
    }

    await cacheInvalidation.byTags(['user', 'auth']);
    const { data: { session: s } } = await supabase.auth.getSession();
    if (s?.user?.id && s.access_token) {
      finalizeAdminEmailOtpSession(s.access_token, s.user.id);
    }
    setOtpPhase('idle');
    navigate('/admin');
  };

  /** After password + admin role: require Supabase email OTP so JWT `amr` includes password + otp. */
  const applyEmailOtpGate = async (): Promise<'complete' | 'otp_ui' | 'abort'> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setError('Session missing after sign-in.');
      return 'abort';
    }
    if (
      hasAdminPasswordAndEmailOtpStepUp(session.access_token) ||
      hasTrustedAdminEmailSecondFactor(session.access_token, session.user.id)
    ) {
      return 'complete';
    }

    const email = (session.user.email ?? formData.email).trim().toLowerCase();
    if (!email) {
      setError('No email address on this account.');
      await supabase.auth.signOut();
      return 'abort';
    }

    setIsSendingOtp(true);
    const sent = await sendAdminLoginEmailOtp(supabase, email);
    setIsSendingOtp(false);

    if (!sent.ok) {
      setError(sent.message);
      await supabase.auth.signOut();
      return 'abort';
    }

    setOtpEmail(email);
    setOtpCode('');
    setOtpPhase('email_otp');
    startResendCooldown(60);
    return 'otp_ui';
  };

  const checkExistingAuth = async () => {
    try {
      setIsCheckingAuth(true);
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) return;

      const access = await getCurrentAdminAccess();
      if (!access.hasAccess) return;

      if (hasTrustedAdminEmailSecondFactor(session.access_token, session.user.id)) {
        navigate('/admin');
        return;
      }

      if (!canResumeAdminEmailOtpSession(session.user.id)) {
        await supabase.auth.signOut();
        return;
      }

      const email = (session.user.email ?? '').trim().toLowerCase();
      if (!email) return;

      setOtpEmail(email);
      setOtpCode('');
      setOtpPhase('email_otp');
      setIsSendingOtp(true);
      const sent = await sendAdminLoginEmailOtp(supabase, email);
      setIsSendingOtp(false);
      if (!sent.ok) {
        setError(sent.message);
        await supabase.auth.signOut();
        setOtpPhase('idle');
      } else {
        startResendCooldown(60);
      }
    } catch (error) {
      console.error('Error checking auth:', error);
    } finally {
      setIsCheckingAuth(false);
    }
  };

  const checkRateLimit = async (email: string): Promise<{ locked: boolean; secondsRemaining: number; attemptsRemaining: number | null }> => {
    try {
      const { data, error } = await supabase.rpc('check_admin_login_rate_limit', {
        email_param: email.toLowerCase().trim(),
      });
      if (error || !data) return { locked: false, secondsRemaining: 0, attemptsRemaining: null };
      return {
        locked: data.locked ?? false,
        secondsRemaining: data.seconds_remaining ?? 0,
        attemptsRemaining: typeof data.attempts_remaining === 'number' ? data.attempts_remaining : null,
      };
    } catch {
      return { locked: false, secondsRemaining: 0, attemptsRemaining: null };
    }
  };

  const recordAttempt = async (email: string, success: boolean) => {
    try {
      const { userAgent } = getClientInfo();
      await supabase.rpc('record_admin_login_attempt', {
        email_param: email.toLowerCase().trim(),
        success_param: success,
        ip_address_param: '',
        user_agent_param: userAgent,
      });
    } catch {
      // Non-critical
    }
  };

  const clearAttempts = async (email: string) => {
    try {
      await supabase.rpc('clear_admin_login_attempts', {
        email_param: email.toLowerCase().trim(),
      });
    } catch {
      // Non-critical
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error && lockoutSeconds === 0) setError(null);
  };

  const handleCancelOtp = async () => {
    setOtpPhase('idle');
    setOtpEmail('');
    setOtpCode('');
    setError(null);
    if (resendCooldownRef.current) {
      clearInterval(resendCooldownRef.current);
      resendCooldownRef.current = null;
    }
    setResendCooldownSeconds(0);
    clearAdminLoginTrustStorage();
    await supabase.auth.signOut();
  };

  const handleResendOtp = async () => {
    if (resendCooldownSeconds > 0 || !otpEmail) return;
    setIsSendingOtp(true);
    setError(null);
    const sent = await sendAdminLoginEmailOtp(supabase, otpEmail);
    setIsSendingOtp(false);
    if (!sent.ok) {
      setError(sent.message);
      return;
    }
    startResendCooldown(60);
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpEmail) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const v = await verifyAdminLoginEmailOtp(supabase, otpEmail, otpCode);
      if (!v.ok) {
        setError(v.message);
        setIsSubmitting(false);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) {
        setError('Session missing after verification.');
        setIsSubmitting(false);
        return;
      }
      if (!finalizeAdminEmailOtpSession(session.access_token, uid)) {
        setError(
          'Could not confirm this login. Go back, sign in with email and password again, then enter the new code from your email.'
        );
        setIsSubmitting(false);
        return;
      }
      await finishLoginSuccess();
    } catch (err) {
      console.error('OTP error:', err);
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.email.trim() || !formData.password.trim()) {
      setError('Please enter both email and password');
      return;
    }

    if (lockoutSeconds > 0) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const rateLimit = await checkRateLimit(formData.email);
      if (rateLimit.locked) {
        startLockoutTimer(rateLimit.secondsRemaining);
        setError(`Too many failed attempts. Please wait ${Math.ceil(rateLimit.secondsRemaining / 60)} minute(s) before trying again.`);
        setIsSubmitting(false);
        return;
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password,
      });

      if (signInError) {
        await recordAttempt(formData.email, false);

        const updatedLimit = await checkRateLimit(formData.email);
        if (updatedLimit.locked) {
          startLockoutTimer(updatedLimit.secondsRemaining);
          setError(`Too many failed attempts. Account locked for 15 minutes.`);
        } else {
          const remaining = updatedLimit.attemptsRemaining;
          setFailuresRemaining(remaining);
          if (remaining !== null && remaining <= 2) {
            setError(`Invalid credentials. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before lockout.`);
          } else {
            setError('Invalid email or password. Please try again.');
          }
        }
        throw new Error('skip');
      }

      if (!data.user) {
        await recordAttempt(formData.email, false);
        throw new Error('Authentication failed');
      }

      const access = await getCurrentAdminAccess();

      if (!access.hasAccess) {
        await supabase.auth.signOut();
        await recordAttempt(formData.email, false);
        setError('Access denied. You do not have admin privileges.');
        setIsSubmitting(false);
        return;
      }

      markAdminPasswordStepBeforeEmailOtp(data.user.id);
      const gate = await applyEmailOtpGate();
      if (gate === 'complete') {
        await finishLoginSuccess();
        return;
      }
      if (gate === 'abort') {
        return;
      }
    } catch (err) {
      if (err instanceof Error && err.message !== 'skip') {
        console.error('Login error:', err);
        setError(err.message || 'An error occurred during login');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatLockoutTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m > 0) return `${m}:${s.toString().padStart(2, '0')}`;
    return `${s}s`;
  };

  if (isCheckingAuth) {
    return (
      <AdminLoginShell>
        <div className={`${glassCardClass} flex items-center justify-center gap-3`}>
          <LoadingLogo variant="pulse" size={28} />
          <p className="font-medium text-white">Checking authentication...</p>
        </div>
      </AdminLoginShell>
    );
  }

  const isLocked = lockoutSeconds > 0;

  if (otpPhase === 'email_otp' && otpEmail) {
    return (
      <AdminLoginShell>
        <div className={glassCardClass}>
          <div className="mb-6">
            <h2 className="text-2xl font-bold tracking-tight text-white">Check your email</h2>
            <p className="mt-2 text-sm text-white/75">
              We sent a one-time code to{' '}
              <span className="font-medium text-white">{otpEmail}</span>. Enter it to finish signing in.
            </p>
          </div>

          <div className="mb-5 flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3.5 py-2.5">
            <Shield className="h-4 w-4 flex-shrink-0 text-white/90" strokeWidth={1.75} />
            <p className="text-xs text-white/80">Admin login uses password plus an email code.</p>
          </div>

          <form onSubmit={handleOtpSubmit} className="space-y-5">
            <div>
              <label className={labelClass}>6-digit code</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className={`${inputClass} text-center text-lg tracking-[0.35em]`}
                placeholder="••••••"
                maxLength={6}
                required
              />
            </div>

            {error && (
              <div className="flex items-start gap-3 rounded-lg border border-red-300/40 bg-red-500/20 p-3.5">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-200" />
                <p className="text-sm text-red-50">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || otpCode.length !== 6}
              className={primaryBtnClass}
            >
              {isSubmitting ? 'Verifying...' : 'Continue'}
            </button>

            <button
              type="button"
              onClick={handleResendOtp}
              disabled={resendCooldownSeconds > 0 || isSendingOtp}
              className="flex w-full items-center justify-center gap-2 py-1 text-sm text-white underline decoration-white/50 underline-offset-2 hover:decoration-white disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
            >
              <RefreshCw className={`h-4 w-4 ${isSendingOtp ? 'animate-spin' : ''}`} strokeWidth={1.75} />
              {resendCooldownSeconds > 0
                ? `Resend code in ${resendCooldownSeconds}s`
                : isSendingOtp
                  ? 'Sending...'
                  : 'Resend code'}
            </button>

            <button
              type="button"
              onClick={() => handleCancelOtp()}
              className="w-full py-1 text-sm text-white/70 underline decoration-white/40 underline-offset-2 hover:text-white hover:decoration-white"
            >
              Cancel and sign out
            </button>
          </form>
        </div>
      </AdminLoginShell>
    );
  }

  return (
    <AdminLoginShell>
      <div className={glassCardClass}>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="mb-1 flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3.5 py-2.5">
            <Shield className="h-4 w-4 flex-shrink-0 text-white/90" strokeWidth={1.75} />
            <p className="text-xs text-white/80">
              Protected area. Password, then a one-time email code.
            </p>
          </div>

          <div>
            <label className={labelClass} htmlFor="admin-email">
              Email
            </label>
            <input
              id="admin-email"
              type="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              required
              disabled={isLocked}
              className={inputClass}
              placeholder="Enter your email"
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="admin-password">
              Password
            </label>
            <div className="relative">
              <input
                id="admin-password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                required
                disabled={isLocked}
                className={`${inputClass} pr-11`}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {isLocked && (
            <div className="flex items-start gap-3 rounded-lg border border-orange-300/40 bg-orange-500/20 p-3.5">
              <Clock className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-200" />
              <div>
                <p className="text-sm font-medium text-orange-50">Account temporarily locked</p>
                <p className="mt-1 text-sm text-orange-100/90">
                  Too many failed attempts. Try again in{' '}
                  <span className="font-bold tabular-nums">{formatLockoutTime(lockoutSeconds)}</span>
                </p>
              </div>
            </div>
          )}

          {error && !isLocked && (
            <div
              className={`flex items-start gap-3 rounded-lg border p-3.5 ${
                failuresRemaining !== null && failuresRemaining <= 2
                  ? 'border-orange-300/40 bg-orange-500/20'
                  : 'border-red-300/40 bg-red-500/20'
              }`}
            >
              <AlertCircle
                className={`mt-0.5 h-5 w-5 flex-shrink-0 ${
                  failuresRemaining !== null && failuresRemaining <= 2
                    ? 'text-orange-200'
                    : 'text-red-200'
                }`}
              />
              <p
                className={`text-sm ${
                  failuresRemaining !== null && failuresRemaining <= 2
                    ? 'text-orange-50'
                    : 'text-red-50'
                }`}
              >
                {error}
              </p>
            </div>
          )}

          <button type="submit" disabled={isSubmitting || isLocked} className={primaryBtnClass}>
            {isSubmitting
              ? 'Signing In...'
              : isLocked
                ? `Locked (${formatLockoutTime(lockoutSeconds)})`
                : 'Sign In'}
          </button>

          <div className="pt-1 text-center">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="text-sm text-white underline decoration-white/50 underline-offset-2 transition hover:decoration-white"
            >
              Back to Home
            </button>
          </div>
        </form>
      </div>
    </AdminLoginShell>
  );
};
