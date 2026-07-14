/**
 * Centralized user-facing error messages for auth and payments.
 * Use these so users see consistent, safe messages and "Try again" where appropriate.
 */

export const TRY_AGAIN_LABEL = 'Try again';
export const TRY_AGAIN_SUFFIX = ' Please try again.';

/** Map auth/network errors to a short, user-friendly message (no stack or internal detail). */
export function toUserFacingAuthError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message || '';
    if (/invalid.*login|invalid_credentials/i.test(msg)) return 'Invalid email or password.' + TRY_AGAIN_SUFFIX;
    if (/email.*not.*confirmed|signup_not_confirmed/i.test(msg)) return 'Please confirm your email before signing in.';
    if (/invalid.*token|expired|otp/i.test(msg)) return 'Invalid or expired code. Request a new code.';
    if (/rate limit|too many requests/i.test(msg)) return 'Too many attempts. Please wait a moment and try again.';
    if (/network|fetch|failed to fetch/i.test(msg)) return 'Connection problem.' + TRY_AGAIN_SUFFIX;
    if (/google|oauth/i.test(msg)) return 'Google sign-in failed.' + TRY_AGAIN_SUFFIX;
    // Generic but safe
    return 'Something went wrong.' + TRY_AGAIN_SUFFIX;
  }
  return 'Something went wrong.' + TRY_AGAIN_SUFFIX;
}

/** Map payment/withdrawal errors to a short, user-facing message. */
export function toUserFacingPaymentError(err: unknown, context: 'payment' | 'withdrawal' | 'load' = 'payment'): string {
  if (err instanceof Error) {
    const msg = err.message || '';
    if (/network|fetch|failed to fetch/i.test(msg)) return 'Connection problem.' + TRY_AGAIN_SUFFIX;
    if (/insufficient|balance|not enough/i.test(msg)) return context === 'withdrawal' ? 'Insufficient earned balance.' : 'Insufficient balance.' + TRY_AGAIN_SUFFIX;
    if (/disabled|not available/i.test(msg)) return context === 'withdrawal' ? 'Withdrawals are currently disabled.' : 'This option is not available right now.';
  }
  if (context === 'payment') return 'Payment could not be completed.' + TRY_AGAIN_SUFFIX;
  if (context === 'withdrawal') return 'Withdrawal failed.' + TRY_AGAIN_SUFFIX;
  return 'Something went wrong.' + TRY_AGAIN_SUFFIX;
}
