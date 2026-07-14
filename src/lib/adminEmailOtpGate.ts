import type { SupabaseClient } from '@supabase/supabase-js';

export const ADMIN_PORTAL_ROLES = ['admin', 'manager', 'editor', 'account'] as const;

/** Supabase often refreshes JWT after email OTP so `amr` may only list `otp`, not `password`. We pair that with a short-lived client marker set only after a successful password sign-in. */
const LS_PW_PENDING = 'airaplay_admin_pw_pending';
const LS_2STEP_TRUST = 'airaplay_admin_2step_trust_uid';
const PW_PENDING_TTL_MS = 20 * 60 * 1000;

type PwPendingPayload = { uid: string; exp: number };

export function canResumeAdminEmailOtpSession(userId: string): boolean {
  const p = readPwPending();
  return !!p && p.uid === userId;
}

function readPwPending(): PwPendingPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_PW_PENDING);
    if (!raw) return null;
    const p = JSON.parse(raw) as PwPendingPayload;
    if (!p?.uid || typeof p.exp !== 'number') return null;
    if (Date.now() > p.exp) {
      localStorage.removeItem(LS_PW_PENDING);
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

/** Call after password sign-in succeeds and admin role is confirmed, before sending email OTP. */
export function markAdminPasswordStepBeforeEmailOtp(userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(LS_2STEP_TRUST);
    const payload: PwPendingPayload = { uid: userId, exp: Date.now() + PW_PENDING_TTL_MS };
    localStorage.setItem(LS_PW_PENDING, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function clearAdminLoginTrustStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(LS_PW_PENDING);
    localStorage.removeItem(LS_2STEP_TRUST);
  } catch {
    // ignore
  }
}

/**
 * After verifyOtp: JWT may already prove password+otp, or only otp — accept if password step was recorded for this uid.
 */
export function finalizeAdminEmailOtpSession(accessToken: string | undefined, userId: string): boolean {
  if (hasAdminPasswordAndEmailOtpStepUp(accessToken)) {
    clearAdminLoginTrustStorage();
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(LS_2STEP_TRUST, userId);
      } catch {
        // ignore
      }
    }
    return true;
  }

  const pending = readPwPending();
  if (pending && pending.uid === userId) {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(LS_PW_PENDING);
        localStorage.setItem(LS_2STEP_TRUST, userId);
      } catch {
        // ignore
      }
    }
    return true;
  }

  return false;
}

/** Dashboard / session refresh: allow if JWT shows two-step auth OR we finalized email OTP after password in this browser. */
export function hasTrustedAdminEmailSecondFactor(accessToken: string | undefined, userId: string | undefined): boolean {
  if (!userId) return false;
  if (hasAdminPasswordAndEmailOtpStepUp(accessToken)) return true;
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(LS_2STEP_TRUST) === userId;
  } catch {
    return false;
  }
}

export function isAdminPortalRole(role: string | null | undefined): boolean {
  return ADMIN_PORTAL_ROLES.includes((role ?? '') as (typeof ADMIN_PORTAL_ROLES)[number]);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    return JSON.parse(atob(b64 + pad)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Reads Auth JWT `amr` (authentication methods reference).
 * After password + email OTP, Supabase typically includes both `password` and `otp`
 * (or `email` / `magiclink` depending on project templates).
 */
export function parseJwtAmrMethods(accessToken: string | undefined): string[] {
  if (!accessToken) return [];
  const payload = decodeJwtPayload(accessToken);
  const amr = payload?.amr;
  if (!Array.isArray(amr)) return [];
  return amr
    .map((e) => (typeof e === 'object' && e !== null && 'method' in e ? String((e as { method: string }).method) : ''))
    .filter(Boolean)
    .map((m) => m.toLowerCase());
}

export function hasAdminPasswordAndEmailOtpStepUp(accessToken: string | undefined): boolean {
  if (!accessToken) return false;
  const payload = decodeJwtPayload(accessToken);
  const amr = payload?.amr;
  if (!Array.isArray(amr)) return false;
  const methods = parseJwtAmrMethods(accessToken);
  const set = new Set(methods);
  const hasPassword = set.has('password');
  const hasOtpLike =
    set.has('otp') ||
    set.has('email') ||
    set.has('magiclink') ||
    set.has('magic_link') ||
    set.has('totp');
  if (hasPassword && hasOtpLike) return true;
  // Some sessions list multiple `amr` steps; password + email OTP can appear as a two-step chain
  if (hasOtpLike && amr.length >= 2) return true;
  // After verifyOtp, some projects only emit a single `otp` entry — use finalizeAdminEmailOtpSession + hasTrustedAdminEmailSecondFactor instead
  return false;
}

/**
 * Sends a Supabase Auth email OTP (6-digit code) to an existing user.
 * Dashboard Auth → Email templates should be configured for OTP / magic link per your project.
 */
export async function sendAdminLoginEmailOtp(
  client: SupabaseClient,
  email: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) {
    return { ok: false, message: 'Email is required.' };
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const { error } = await client.auth.signInWithOtp({
    email: trimmed,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: origin ? `${origin}/admin/login` : undefined,
    },
  });

  if (error) {
    return { ok: false, message: error.message ?? 'Failed to send email code.' };
  }
  return { ok: true };
}

export async function verifyAdminLoginEmailOtp(
  client: SupabaseClient,
  email: string,
  token: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const trimmed = token.replace(/\s/g, '');
  if (!/^\d{6}$/.test(trimmed)) {
    return { ok: false, message: 'Enter the 6-digit code from your email.' };
  }

  const { error } = await client.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: trimmed,
    type: 'email',
  });

  if (error) {
    return { ok: false, message: error.message ?? 'Invalid or expired code.' };
  }

  await client.auth.getSession();
  return { ok: true };
}
