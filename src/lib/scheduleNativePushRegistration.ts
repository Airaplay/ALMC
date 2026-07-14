import { Capacitor } from '@capacitor/core';
import { isAppTarget } from './buildTarget';

/** Post-login full-screen loader duration (keep in sync with AuthContext). */
export const POST_LOGIN_OVERLAY_MS = 900;

/** Wait for post-login overlay + UI settle before the OS permission sheet. */
const POST_LOGIN_PUSH_DELAY_MS = POST_LOGIN_OVERLAY_MS + 700;

/** Cold start: allow splash + auth bootstrap to finish first. */
const SESSION_RESTORE_PUSH_DELAY_MS = 1600;

type PushRegistrationSource = 'post-login' | 'session-restore';

const scheduledKeys = new Set<string>();

function scheduleKey(userId: string, source: PushRegistrationSource): string {
  return `${userId}:${source}`;
}

/**
 * Queue native push permission + FCM registration after auth.
 * Call from every successful login path (email, OAuth, session restore).
 */
export function scheduleNativePushRegistration(
  userId: string,
  source: PushRegistrationSource = 'session-restore',
): void {
  if (!isAppTarget() || !Capacitor.isNativePlatform() || !userId) return;

  const key = scheduleKey(userId, source);
  if (scheduledKeys.has(key)) return;
  scheduledKeys.add(key);

  const delayMs =
    source === 'post-login' ? POST_LOGIN_PUSH_DELAY_MS : SESSION_RESTORE_PUSH_DELAY_MS;

  window.setTimeout(() => {
    void import('./pushNotificationService').then(({ pushNotificationService }) => {
      void pushNotificationService.registerForUser(userId);
    });
  }, delayMs);
}

/** Clear dedupe keys on sign-out so the next login can prompt again. */
export function resetNativePushRegistrationSchedule(): void {
  scheduledKeys.clear();
}
