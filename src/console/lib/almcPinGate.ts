const STORAGE_KEY = 'almc_console_pin_verified';

/** Re-verify after 12 hours in the same browser tab. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

type PinGateRecord = {
  userId: string;
  verifiedAt: number;
};

export function markAlmcPinVerified(userId: string): void {
  const record: PinGateRecord = { userId, verifiedAt: Date.now() };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}

export function isAlmcPinVerified(userId: string): boolean {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return false;

    const record = JSON.parse(raw) as PinGateRecord;
    if (record.userId !== userId) return false;

    if (Date.now() - record.verifiedAt > MAX_AGE_MS) {
      sessionStorage.removeItem(STORAGE_KEY);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function clearAlmcPinGate(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function toSecurityPinErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('INVALID_SECURITY_PIN')) {
    return 'Incorrect PIN. Please try again.';
  }
  if (msg.includes('SECURITY_PIN_LOCKED')) {
    return 'Too many failed attempts. Try again in 15 minutes.';
  }
  if (msg.includes('SECURITY_PIN_NOT_SET')) {
    return 'No security PIN on file. Create one to continue.';
  }
  if (msg.includes('4–6 digits') || msg.includes('4-6 digits')) {
    return 'PIN must be 4–6 digits.';
  }
  if (msg.includes('do not match') || msg.includes('must match')) {
    return 'PINs do not match.';
  }
  return msg || 'Could not verify PIN.';
}
