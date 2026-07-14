import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { isAppTarget } from '../lib/buildTarget';
import { Capacitor } from '@capacitor/core';
import {
  resetNativePushRegistrationSchedule,
  scheduleNativePushRegistration,
} from '../lib/scheduleNativePushRegistration';

/**
 * Wires push navigation + schedules permission prompt after auth on native builds.
 */
export function PushNotificationBootstrap(): null {
  const navigate = useNavigate();
  const { isAuthenticated, user, isInitialized, postLoginTransitionActive } = useAuth();
  const sessionRestoreScheduledRef = useRef(false);
  const prevOverlayActiveRef = useRef(postLoginTransitionActive);

  useEffect(() => {
    if (!isAppTarget() || !Capacitor.isNativePlatform()) return;

    let cancelled = false;

    void import('../lib/pushNotificationService').then(({ pushNotificationService }) => {
      if (cancelled) return;
      pushNotificationService.setNavigationHandler((path) => {
        navigate(path);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    if (!isAppTarget() || !Capacitor.isNativePlatform() || !isInitialized) return;

    if (!isAuthenticated || !user?.id) {
      sessionRestoreScheduledRef.current = false;
      resetNativePushRegistrationSchedule();
      void import('../lib/pushNotificationService').then(({ pushNotificationService }) => {
        void pushNotificationService.unregister();
      });
      return;
    }

    // Post-login overlay just finished — best moment for first-time permission prompt.
    const overlayJustDismissed =
      prevOverlayActiveRef.current && !postLoginTransitionActive;
    prevOverlayActiveRef.current = postLoginTransitionActive;

    if (overlayJustDismissed) {
      scheduleNativePushRegistration(user.id, 'post-login');
      return;
    }

    if (postLoginTransitionActive) return;

    // Returning user / cold start with existing session.
    if (!sessionRestoreScheduledRef.current) {
      sessionRestoreScheduledRef.current = true;
      scheduleNativePushRegistration(user.id, 'session-restore');
    }
  }, [isInitialized, isAuthenticated, user?.id, postLoginTransitionActive]);

  return null;
}
