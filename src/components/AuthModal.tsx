import React, { useState, useEffect, useRef } from 'react';
import { X, Eye, EyeOff, Loader2, ArrowRight, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useLocation } from '../hooks/useLocation';
import { countries } from '../lib/countries';
import { cn } from '../lib/utils';
import { toUserFacingAuthError } from '../lib/criticalErrorMessages';

interface AuthModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

// ─── Floating-label input (reference style, mobile-friendly) ─────────────────
interface FloatingInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  rightSlot?: React.ReactNode;
}
const FloatingInput = React.forwardRef<HTMLInputElement, FloatingInputProps>(
  ({ label, rightSlot, className, onFocus, onBlur, onChange, ...props }, ref) => {
    const [focused, setFocused] = useState(false);
    const [composing, setComposing] = useState(false);
    const hasValue = !!props.value;
    const lifted = focused || hasValue;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      // Always forward so the field updates. Some devices fire compositionstart for normal typing
      // and never fire compositionend, which left display name (and other fields) stuck with no input.
      onChange?.(e);
    };
    const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
      setComposing(false);
      if (onChange && e.target instanceof HTMLInputElement) {
        const synthetic = { ...e, target: e.target } as React.ChangeEvent<HTMLInputElement>;
        onChange(synthetic);
      }
    };

    return (
      <div className="relative group">
        <label
          className={cn(
            'absolute left-0 transition-all duration-200 pointer-events-none select-none font-["Inter",sans-serif]',
            lifted
              ? 'top-0 text-[10px] font-semibold tracking-[0.15em] uppercase text-[#3ba208]'
              : 'top-[17px] text-sm text-white/50'
          )}
        >
          {label}
        </label>
        <input
          ref={ref}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={handleCompositionEnd}
          onChange={handleChange}
          className={cn(
            'w-full pt-6 pb-2 bg-transparent border-0 border-b text-white text-sm font-["Inter",sans-serif] outline-none transition-colors duration-200 pr-8 placeholder-white/30',
            focused ? 'border-[#3ba208]' : 'border-white/20',
            className
          )}
          {...props}
        />
        {rightSlot && (
          <div className="absolute right-0 top-5 text-white/50">{rightSlot}</div>
        )}
      </div>
    );
  }
);
FloatingInput.displayName = 'FloatingInput';

// ─── Floating-label select ───────────────────────────────────────────────────
interface FloatingSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
}
const FloatingSelect = ({ label, children, className, ...props }: FloatingSelectProps) => {
  const [focused, setFocused] = useState(false);
  const hasValue = !!props.value;
  const lifted = focused || hasValue;
  return (
    <div className="relative group">
      <label
        className={cn(
          'absolute left-0 transition-all duration-200 pointer-events-none select-none z-10 font-["Inter",sans-serif]',
          lifted
            ? 'top-0 text-[10px] font-semibold tracking-[0.15em] uppercase text-[#3ba208]'
            : 'top-[17px] text-sm text-white/50'
        )}
      >
        {label}
      </label>
      <select
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={cn(
          'w-full pt-6 pb-2 bg-transparent border-0 border-b text-white text-sm font-["Inter",sans-serif] outline-none appearance-none transition-colors duration-200 pr-6 cursor-pointer',
          focused ? 'border-[#3ba208]' : 'border-white/20',
          !props.value && 'text-white/30',
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="absolute right-0 top-6 w-3.5 h-3.5 text-white/50 pointer-events-none" />
    </div>
  );
};

export const AuthModal: React.FC<AuthModalProps> = ({ onClose, onSuccess }) => {
  const navigate = useNavigate();
  const { location } = useLocation(true);
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [signUpEmailConfirmSent, setSignUpEmailConfirmSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [resendConfirmLoading, setResendConfirmLoading] = useState(false);
  const [resendConfirmMessage, setResendConfirmMessage] = useState<'success' | 'error' | null>(null);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
  const resendCooldownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    display_name: '',
    country: '',
    gender: '',
    referral_code: '',
  });
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  // Lock body scroll when modal is open so background doesn't move
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Account for mini music player so Create Account / form fits above it when visible
  const [isMiniPlayerActive, setIsMiniPlayerActive] = useState(false);
  useEffect(() => {
    const checkMiniPlayer = () => {
      setIsMiniPlayerActive(document.body.classList.contains('mini-player-active'));
    };
    checkMiniPlayer();
    const observer = new MutationObserver(checkMiniPlayer);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [isValidatingReferral, setIsValidatingReferral] = useState(false);
  const [referralValidationMessage, setReferralValidationMessage] = useState<string | null>(null);
  // Cache referral validation result to avoid duplicate RPC calls on submit
  const lastReferralValidationRef = useRef<{ code: string; valid: boolean; referrerUserId?: string; canRefer?: boolean } | null>(null);

  // Base URL for auth-related redirects (email confirmation, etc.)
  // For mobile apps, window.location.origin can be "capacitor://localhost",
  // which Supabase will reject. Use a dedicated web URL when provided.
  const AUTH_REDIRECT_BASE =
    import.meta.env.VITE_PUBLIC_WEB_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '');

  const validateReferralCode = async (code: string): Promise<boolean> => {
    const trimmed = code?.trim() ?? '';
    if (!trimmed) {
      setReferralValidationMessage(null);
      lastReferralValidationRef.current = null;
      return true;
    }

    setIsValidatingReferral(true);
    setReferralValidationMessage(null);
    lastReferralValidationRef.current = null;

    try {
      const { data: referralData, error: referralError } = await supabase
        .from('referral_codes')
        .select('user_id, code')
        .eq('code', trimmed)
        .maybeSingle();

      if (referralError) {
        console.error('Referral code lookup error:', referralError);
        setReferralValidationMessage('Unable to verify referral code. Please try again.');
        lastReferralValidationRef.current = { code: trimmed, valid: false };
        return false;
      }

      if (!referralData) {
        setReferralValidationMessage('Invalid referral code');
        lastReferralValidationRef.current = { code: trimmed, valid: false };
        return false;
      }

      const { data: limitCheck, error: limitError } = await supabase.rpc('check_referral_limit', {
        p_user_id: referralData.user_id,
      });

      if (limitError) {
        console.error('Error checking referral limit:', limitError);
        setReferralValidationMessage('Valid referral code');
        lastReferralValidationRef.current = { code: trimmed, valid: true, referrerUserId: referralData.user_id, canRefer: true };
        return true;
      }

      const canRefer = limitCheck?.can_refer ?? true;

      if (!canRefer) {
        const reason = limitCheck?.reason || 'Referrer has reached their limit';
        setReferralValidationMessage(reason);
        lastReferralValidationRef.current = { code: trimmed, valid: false };
        return false;
      }

      setReferralValidationMessage('Valid referral code');
      lastReferralValidationRef.current = { code: trimmed, valid: true, referrerUserId: referralData.user_id, canRefer: true };
      return true;
    } catch (err) {
      console.error('Unexpected error validating referral code:', err);
      setReferralValidationMessage('Network error. Please check your connection and try again.');
      lastReferralValidationRef.current = null;
      return false;
    } finally {
      setIsValidatingReferral(false);
    }
  };

  const handleReferralCodeBlur = () => {
    const code = formData.referral_code.trim();
    if (code && code.length > 0) {
      validateReferralCode(code);
    } else {
      setReferralValidationMessage(null);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const refCode = params.get('ref');
    if (refCode) {
      setIsSignUp(true);
      setReferralCode(refCode);
      setFormData(prev => ({ ...prev, referral_code: refCode }));
      sessionStorage.setItem('referralCode', refCode);
      validateReferralCode(refCode);
    } else {
      const savedRefCode = sessionStorage.getItem('referralCode');
      if (savedRefCode) {
        setReferralCode(savedRefCode);
        setFormData(prev => ({ ...prev, referral_code: savedRefCode }));
      }
    }
  }, []);

  useEffect(() => {
    if (location?.detected && location.location.countryCode) {
      setFormData(prev => ({ ...prev, country: location.location.countryCode }));
    }
  }, [location]);

  // Single cleanup: clear resend cooldown interval on unmount only
  useEffect(() => {
    return () => {
      if (resendCooldownIntervalRef.current) {
        clearInterval(resendCooldownIntervalRef.current);
        resendCooldownIntervalRef.current = null;
      }
    };
  }, []);

  // Validation functions
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  };

  const validatePassword = (password: string): { valid: boolean; message: string } => {
    if (password.length < 8) {
      return { valid: false, message: 'Password must be at least 8 characters long' };
    }
    if (password.length > 128) {
      return { valid: false, message: 'Password must be less than 128 characters' };
    }
    // Check for at least one letter and one number
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    if (!hasLetter || !hasNumber) {
      return { valid: false, message: 'Password must contain at least one letter and one number' };
    }
    return { valid: true, message: '' };
  };

  const validateDisplayName = (name: string): { valid: boolean; message: string } => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      return { valid: false, message: 'Display name must be at least 2 characters long' };
    }
    if (trimmed.length > 50) {
      return { valid: false, message: 'Display name must be less than 50 characters' };
    }
    // Allow Unicode letters, numbers, spaces, hyphens, and underscores
    // \p{L} matches any Unicode letter, \p{N} matches any Unicode number
    const nameRegex = /^[\p{L}\p{N}\s\-_]+$/u;
    if (!nameRegex.test(trimmed)) {
      return { valid: false, message: 'Display name can only contain letters, numbers, spaces, hyphens, and underscores' };
    }
    return { valid: true, message: '' };
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));

    if (name === 'referral_code') {
      setReferralValidationMessage(null);
      lastReferralValidationRef.current = null;
    }

    // Clear error when user starts typing
    if (error) {
      setError(null);
    }
  };

  const handleTermsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAgreedToTerms(e.target.checked);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email.trim()) {
      setError('Please enter your email address');
      return;
    }

    if (!validateEmail(formData.email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(formData.email, {
        // Use the same public web URL base as other auth redirects
        redirectTo: `${AUTH_REDIRECT_BASE}/reset-password`,
      });

      if (error) throw error;

      setResetEmailSent(true);
    } catch (err) {
      console.error('Password reset error:', err);
      setError(err instanceof Error ? err.message : 'Failed to send reset email');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isForgotPassword) {
      return handleForgotPassword(e);
    }

    // Validate email
    if (!formData.email.trim()) {
      setError('Please enter your email address');
      return;
    }

    if (!validateEmail(formData.email)) {
      setError('Please enter a valid email address');
      return;
    }

    // Validate password
    if (!formData.password) {
      setError('Please enter your password');
      return;
    }

    if (isSignUp) {
      const passwordValidation = validatePassword(formData.password);
      if (!passwordValidation.valid) {
        setError(passwordValidation.message);
        return;
      }

      // Validate display name for signup
      if (formData.display_name.trim()) {
        const nameValidation = validateDisplayName(formData.display_name);
        if (!nameValidation.valid) {
          setError(nameValidation.message);
          return;
        }
      }

      if (!agreedToTerms) {
        setError('You must agree to the terms and conditions to continue');
        return;
      }

      if (!formData.country) {
        setError('Please select your country');
        return;
      }

      if (!formData.gender) {
        setError('Please select your gender');
        return;
      }

      if (formData.referral_code.trim()) {
        const code = formData.referral_code.trim();
        const cached = lastReferralValidationRef.current;
        const useCached = cached && cached.code === code && cached.valid;
        if (!useCached) {
          if (referralValidationMessage && !referralValidationMessage.startsWith('Valid')) {
            setError('Please enter a valid referral code or leave it empty');
            return;
          }
          const isValid = await validateReferralCode(code);
          if (!isValid) {
            setError('Please enter a valid referral code or leave it empty');
            return;
          }
        }
      }
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (isSignUp) {
        const detectedCountry = location?.location?.countryCode || formData.country;
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: formData.email,
          password: formData.password,
          options: {
            data: {
              display_name: formData.display_name,
              country: detectedCountry,
            },
            // Always send users to the public web URL for confirmation,
            // not the in-app (capacitor://) origin, so Supabase accepts it.
            emailRedirectTo: `${AUTH_REDIRECT_BASE}/auth/callback`,
          },
        });
        if (signUpError) throw signUpError;
        if (data.user) {
          const finalCountry = detectedCountry || formData.country;
          const { error: insertError } = await supabase.from('users').insert({
            id: data.user.id,
            email: data.user.email || '',
            display_name: formData.display_name || null,
            role: 'listener',
            country: finalCountry,
            gender: formData.gender,
            country_last_changed_at: new Date().toISOString(),
          });
          
          // Ignore duplicate key errors (user already exists from trigger or previous attempt)
          if (insertError && !insertError.message.includes('duplicate key') && !insertError.code?.includes('23505')) {
            console.error('Failed to create user record:', insertError);
          }

          const finalReferralCode = formData.referral_code.trim() || (referralCode ?? '');

          if (finalReferralCode) {
            let referrerUserId: string | undefined;
            let canRefer = true;
            const cached = lastReferralValidationRef.current;
            const useCached = cached?.code === finalReferralCode && cached.valid && cached.referrerUserId != null;
            if (useCached) {
              referrerUserId = cached.referrerUserId;
              canRefer = cached.canRefer ?? true;
            } else {
              const { data: referrerData } = await supabase.from('referral_codes').select('user_id').eq('code', finalReferralCode).maybeSingle();
              referrerUserId = referrerData?.user_id;
              if (referrerUserId) {
                const { data: limitCheck } = await supabase.rpc('check_referral_limit', { p_user_id: referrerUserId });
                canRefer = limitCheck?.can_refer ?? true;
              }
            }
            if (referrerUserId) {
              const { error: referralInsertError } = await supabase.from('referrals').insert({
                referrer_id: referrerUserId,
                referred_id: data.user.id,
                referral_code: finalReferralCode,
                status: 'pending',
              });

              if (referralInsertError) {
                console.error('Failed to create referral record:', referralInsertError);
              } else if (canRefer) {
                const { error: incrementError } = await supabase.rpc('increment_referral_counts', {
                  p_user_id: referrerUserId,
                });
                if (incrementError) {
                  console.error('Failed to increment referral counts:', incrementError);
                }
              }

              sessionStorage.removeItem('referralCode');
            }
          }

          // Show OTP verification screen (no longer email link)
          setSignUpEmailConfirmSent(true);
          setOtpCode('');
          setResendConfirmMessage(null);
          setResendCooldownSeconds(60);
          if (resendCooldownIntervalRef.current) {
            clearInterval(resendCooldownIntervalRef.current);
          }
          resendCooldownIntervalRef.current = setInterval(() => {
            setResendCooldownSeconds((s) => {
              if (s <= 1) {
                if (resendCooldownIntervalRef.current) {
                  clearInterval(resendCooldownIntervalRef.current);
                  resendCooldownIntervalRef.current = null;
                }
                return 0;
              }
              return s - 1;
            });
          }, 1000);
          return;
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: formData.email,
          password: formData.password,
        });
        if (signInError) throw signInError;
      }
      onSuccess();
    } catch (err) {
      console.error('Auth error:', err);
      setError(toUserFacingAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleAuth = async () => {
    setIsGoogleLoading(true);
    setError(null);
    try {
      const refToUse = formData.referral_code.trim() || referralCode || '';
      if (refToUse) {
        sessionStorage.setItem('referralCode', refToUse);
      }
      // Redirect to /auth/callback so the callback screen can exchange the code and show success/error
      const redirectUrl = refToUse
        ? `${AUTH_REDIRECT_BASE}/auth/callback?ref=${encodeURIComponent(refToUse)}`
        : `${AUTH_REDIRECT_BASE}/auth/callback`;

      const { error: googleError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });
      if (googleError) throw googleError;
    } catch (err) {
      console.error('Google auth error:', err);
      setError(toUserFacingAuthError(err));
      setIsGoogleLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (resendCooldownSeconds > 0 || resendConfirmLoading || !formData.email.trim()) return;
    setResendConfirmLoading(true);
    setResendConfirmMessage(null);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: formData.email.trim(),
      });
      if (resendError) throw resendError;
      setResendConfirmMessage('success');
      setResendCooldownSeconds(60);
      if (resendCooldownIntervalRef.current) clearInterval(resendCooldownIntervalRef.current);
      resendCooldownIntervalRef.current = setInterval(() => {
        setResendCooldownSeconds((s) => {
          if (s <= 1) {
            if (resendCooldownIntervalRef.current) {
              clearInterval(resendCooldownIntervalRef.current);
              resendCooldownIntervalRef.current = null;
            }
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } catch (err) {
      console.error('Resend confirmation error:', err);
      setResendConfirmMessage('error');
    } finally {
      setResendConfirmLoading(false);
    }
  };

  const handleVerifyOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const code = otpCode.trim().replace(/\s/g, '');
    if (!code || code.length !== 6) {
      setError('Please enter the 6-digit code from your email');
      return;
    }
    setIsVerifyingOtp(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: formData.email.trim(),
        token: code,
        type: 'email',
      });
      if (verifyError) throw verifyError;
      if (resendCooldownIntervalRef.current) {
        clearInterval(resendCooldownIntervalRef.current);
        resendCooldownIntervalRef.current = null;
      }
      onSuccess();
    } catch (err) {
      console.error('OTP verification error:', err);
      setError(toUserFacingAuthError(err));
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const headline = signUpEmailConfirmSent
    ? 'Verify your email'
    : isForgotPassword
    ? 'Reset password'
    : isSignUp
    ? 'Create account'
    : 'Welcome back';
  const subline = signUpEmailConfirmSent
    ? `Enter the 6-digit code sent to ${formData.email}`
    : isForgotPassword
    ? "We'll send a reset link to your inbox"
    : isSignUp
    ? 'Join Airaplay — every play has value'
    : 'Sign in to continue listening';

  return (
    <>
      <div
        className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-[6px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="fixed inset-0 z-[110] pointer-events-none flex items-center justify-center"
        aria-hidden
      >
        <div
          className="w-[320px] sm:w-[420px] h-[320px] sm:h-[420px] rounded-full opacity-[0.07]"
          style={{ background: 'radial-gradient(circle, hsl(102,94%,30%) 0%, transparent 70%)' }}
        />
      </div>
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none overflow-hidden">
        <div
          className={cn(
            'relative w-full max-w-[400px] pointer-events-auto my-auto font-[\'Inter\',sans-serif] flex flex-col',
            isMiniPlayerActive ? 'max-h-[calc(100vh-4.5rem-env(safe-area-inset-bottom,0px)-2rem)]' : 'max-h-[90vh]'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={cn(
            'rounded-3xl border border-white/20 bg-[#0d0d0d]/97 backdrop-blur-2xl shadow-[0_32px_80px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col min-h-0',
            isMiniPlayerActive ? 'max-h-[calc(100vh-4.5rem-env(safe-area-inset-bottom,0px)-2rem)]' : 'max-h-[90vh]'
          )}>
            <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-[#3ba208] to-transparent opacity-80 shrink-0" />
            <div
              className={cn(
                'px-6 sm:px-8 pt-6 sm:pt-8 flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-6 sm:space-y-7 scrollbar-hide',
                isMiniPlayerActive
                  ? 'pb-[calc(2rem+4.5rem+env(safe-area-inset-bottom,0px))]'
                  : 'pb-[max(2rem,env(safe-area-inset-bottom,0px))]'
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-4 sm:space-y-5 min-w-0">
                  <div className="flex items-center">
                    <img src="/official_airaplay_logo.png" alt="Airaplay" className="h-7 sm:h-8 object-contain" />
                  </div>
                  <div>
                    <h1 className="text-2xl sm:text-[28px] font-black tracking-tight leading-none text-white">
                      {headline}
                    </h1>
                    <p className="mt-2 text-[13px] text-white/60 leading-snug">{subline}</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="mt-1 p-1.5 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-all flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {signUpEmailConfirmSent ? (
                <form onSubmit={handleVerifyOtp} className="space-y-6">
                  <div className="flex justify-center gap-1.5 sm:gap-2">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <input
                        key={i}
                        id={`otp-${i}`}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={otpCode[i] || ''}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/\D/g, '');
                          const val = raw.slice(-1);
                          const newCode = otpCode.split('');
                          newCode[i] = val;
                          setOtpCode(newCode.join('').slice(0, 6));
                          setError(null);
                          if (val && i < 5) document.getElementById(`otp-${i + 1}`)?.focus();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Backspace' && !otpCode[i] && i > 0) {
                            document.getElementById(`otp-${i - 1}`)?.focus();
                          }
                        }}
                        onPaste={(e) => {
                          e.preventDefault();
                          const pasted = e.clipboardData.getData('text').replace(/\D/g, '');
                          if (pasted.length > 0) {
                            const validCode = pasted.slice(0, 6);
                            setOtpCode(validCode);
                            setError(null);
                            const focusIdx = Math.min(validCode.length, 5);
                            setTimeout(() => {
                              document.getElementById(`otp-${focusIdx}`)?.focus();
                            }, 0);
                          }
                        }}
                        className="w-10 h-12 sm:w-11 sm:h-12 rounded-xl border border-white/20 bg-white/5 text-center text-lg font-bold text-white outline-none focus:border-[#3ba208] focus:ring-2 focus:ring-[#3ba208]/30 transition-all min-w-0"
                        autoFocus={i === 0}
                        aria-label={`Digit ${i + 1}`}
                      />
                    ))}
                  </div>
                  {error && (
                    <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20">
                      <div className="w-1 h-full rounded-full bg-red-400 mt-0.5 shrink-0" />
                      <p className="text-[12px] text-red-400 leading-relaxed">{error}</p>
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={isVerifyingOtp || otpCode.length !== 6}
                    className="w-full h-12 rounded-xl bg-[#3ba208] text-white font-bold text-[13px] tracking-wide hover:bg-[#3ba208]/90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isVerifyingOtp ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <span>Verify & continue</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                  <p className="text-center text-[12px] text-white/50">
                    Didn&apos;t receive a code?{' '}
                    <button
                      type="button"
                      onClick={handleResendConfirmation}
                      disabled={resendConfirmLoading || resendCooldownSeconds > 0}
                      className={cn(
                        'font-semibold transition-colors',
                        resendCooldownSeconds > 0 ? 'text-white/40 cursor-not-allowed' : 'text-[#3ba208] hover:text-[#3ba208]/80'
                      )}
                    >
                      {resendConfirmLoading ? 'Sending...' : resendCooldownSeconds > 0 ? `Resend in ${resendCooldownSeconds}s` : 'Resend code'}
                    </button>
                  </p>
                  {resendConfirmMessage === 'success' && (
                    <p className="text-center text-[12px] text-[#3ba208]">New code sent! Check your inbox.</p>
                  )}
                  {resendConfirmMessage === 'error' && (
                    <p className="text-center text-[12px] text-red-400">Couldn&apos;t send a new code. Try again in a moment.</p>
                  )}
                </form>
              ) : resetEmailSent ? (
                <div className="py-6 text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-[#3ba208]/15 ring-1 ring-[#3ba208]/30 flex items-center justify-center mx-auto">
                    <svg className="w-5 h-5 text-[#3ba208]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  </div>
                  <p className="text-sm font-medium text-white">Check your inbox</p>
                  <p className="text-xs text-white/60 leading-relaxed">
                    We sent a reset link to <span className="text-white font-medium">{formData.email}</span>
                  </p>
                </div>
              ) : (
                <>
                  {!isForgotPassword && (
                    <>
                      <button
                        type="button"
                        onClick={handleGoogleAuth}
                        disabled={isGoogleLoading || isSubmitting}
                        className="w-full h-11 rounded-xl bg-white flex items-center justify-center gap-3 text-[13px] font-semibold text-black hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
                      >
                        {isGoogleLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin opacity-60" />
                        ) : (
                          <svg className="w-4 h-4" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                          </svg>
                        )}
                        {isGoogleLoading ? 'Connecting…' : 'Continue with Google'}
                      </button>
                      <div className="flex items-center gap-4">
                        <div className="flex-1 h-px bg-white/20" />
                        <span className="text-[11px] font-semibold tracking-[0.15em] uppercase text-white/40">or</span>
                        <div className="flex-1 h-px bg-white/20" />
                      </div>
                    </>
                  )}
                  <form onSubmit={handleSubmit} className="space-y-6">
                    <FloatingInput
                      label="Email address"
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      required
                    />
                    {!isForgotPassword && (
                      <FloatingInput
                        label="Password"
                        type={showPassword ? 'text' : 'password'}
                        name="password"
                        value={formData.password}
                        onChange={handleInputChange}
                        required
                        rightSlot={
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="hover:text-white transition-colors"
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        }
                      />
                    )}
                    {!isSignUp && !isForgotPassword && (
                      <div className="-mt-2">
                        <button
                          type="button"
                          onClick={() => { setIsForgotPassword(true); setError(null); }}
                          className="text-[11px] font-semibold tracking-[0.12em] uppercase text-[#3ba208] hover:text-[#3ba208]/80 transition-colors"
                        >
                          Forgot password?
                        </button>
                      </div>
                    )}
                    {isSignUp && (
                      <>
                        <FloatingInput
                          label="Display name"
                          type="text"
                          name="display_name"
                          value={formData.display_name}
                          onChange={handleInputChange}
                        />
                        <FloatingSelect
                          label="Country *"
                          name="country"
                          value={formData.country}
                          onChange={handleInputChange}
                          required
                        >
                          <option value="" className="bg-[#0d0d0d] text-white/50" />
                          {countries.map((c) => (
                            <option key={c.code} value={c.code} className="bg-[#0d0d0d] text-white">{c.name}</option>
                          ))}
                        </FloatingSelect>
                        <FloatingSelect
                          label="Gender *"
                          name="gender"
                          value={formData.gender}
                          onChange={handleInputChange}
                          required
                        >
                          <option value="" className="bg-[#0d0d0d] text-white/50" />
                          <option value="male" className="bg-[#0d0d0d] text-white">Male</option>
                          <option value="female" className="bg-[#0d0d0d] text-white">Female</option>
                          <option value="other" className="bg-[#0d0d0d] text-white">Other</option>
                          <option value="prefer_not_to_say" className="bg-[#0d0d0d] text-white">Prefer not to say</option>
                        </FloatingSelect>
                        <FloatingInput
                          label="Referral code (optional)"
                          type="text"
                          name="referral_code"
                          value={formData.referral_code}
                          onChange={handleInputChange}
                          onBlur={handleReferralCodeBlur}
                        />
                        {isValidatingReferral && <p className="text-[11px] text-white/50 -mt-4">Validating…</p>}
                        {referralValidationMessage && (
                          <p className={cn('text-[11px] -mt-4', referralValidationMessage.startsWith('Valid') ? 'text-[#3ba208]' : 'text-red-400')}>
                            {referralValidationMessage}
                          </p>
                        )}
                        <label className="flex items-start gap-3 cursor-pointer group">
                          <div className="relative mt-0.5 shrink-0">
                            <input
                              type="checkbox"
                              checked={agreedToTerms}
                              onChange={handleTermsChange}
                              className="sr-only peer"
                            />
                            <div className="w-4 h-4 rounded border border-white/20 peer-checked:bg-[#3ba208] peer-checked:border-[#3ba208] transition-all flex items-center justify-center">
                              {agreedToTerms && (
                                <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="none">
                                  <polyline points="2 6 5 9 10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </div>
                          </div>
                          <span className="text-[12px] text-white/60 leading-relaxed">
                            I agree to the{' '}
                            <button
                              type="button"
                              onClick={() => { navigate('/terms/user-signup'); onClose(); }}
                              className="text-[#3ba208] underline underline-offset-2 hover:text-[#3ba208]/80 transition-colors"
                            >
                              Terms & Conditions
                            </button>
                          </span>
                        </label>
                      </>
                    )}
                    {error && (
                      <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20">
                        <div className="w-1 h-full rounded-full bg-red-400 mt-0.5 shrink-0" />
                        <p className="text-[12px] text-red-400 leading-relaxed">{error}</p>
                      </div>
                    )}
                    <button
                      type="submit"
                      disabled={isSubmitting || (isSignUp && !agreedToTerms)}
                      className="w-full h-12 rounded-xl bg-[#3ba208] text-white font-bold text-[13px] tracking-wide hover:bg-[#3ba208]/90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isSubmitting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <span>{isForgotPassword ? 'Send reset link' : isSignUp ? 'Create account' : 'Sign in'}</span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </form>
                </>
              )}

              <div className="pt-1 border-t border-white/10">
                {signUpEmailConfirmSent ? (
                  <button
                    type="button"
                    onClick={() => { setSignUpEmailConfirmSent(false); setIsSignUp(false); setOtpCode(''); setError(null); }}
                    className="text-[12px] text-white/50 hover:text-white transition-colors"
                  >
                    ← Back to sign up
                  </button>
                ) : isForgotPassword ? (
                  <button
                    type="button"
                    onClick={() => { setIsForgotPassword(false); setResetEmailSent(false); setError(null); }}
                    className="text-[12px] text-white/50 hover:text-white transition-colors"
                  >
                    ← Back to sign in
                  </button>
                ) : (
                  <p className="text-[12px] text-white/50 text-center">
                    {isSignUp ? 'Already have an account?' : 'New to Airaplay?'}{' '}
                    <button
                      type="button"
                      onClick={() => {
                        if (isSignUp) {
                          setSignUpEmailConfirmSent(false);
                          setIsSignUp(false);
                          setError(null);
                          const currentRef = formData.referral_code;
                          const detectedCountry = location?.location?.countryCode || '';
                          setFormData({ email: '', password: '', display_name: '', country: detectedCountry, gender: '', referral_code: currentRef });
                          setAgreedToTerms(false);
                          setReferralValidationMessage(null);
                        } else {
                          setIsSignUp(true);
                          setError(null);
                          // Clear password when switching to sign up for security
                          setFormData(prev => ({ ...prev, password: '' }));
                        }
                      }}
                      className="text-white font-semibold hover:text-[#3ba208] transition-colors"
                    >
                      {isSignUp ? 'Sign in' : 'Create account'}
                    </button>
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
