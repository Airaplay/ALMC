import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

/**
 * Hook to handle Android hardware back button
 * @param handler - Function to handle back button press. Return true to prevent default, false to allow.
 * @param priority - Priority for this handler (higher = executed first)
 */
export function useAndroidBackButton(
  handler: () => boolean | Promise<boolean>,
  priority: number = 0
) {
  useEffect(() => {
    // Only register on Android
    if (Capacitor.getPlatform() !== 'android') {
      return;
    }

    const listener = App.addListener('backButton', async ({ canGoBack }) => {
      const shouldPreventDefault = await handler();

      if (!shouldPreventDefault && !canGoBack) {
        // If at root and handler doesn't prevent, exit app
        App.exitApp();
      }
    });

    return () => {
      listener.remove();
    };
  }, [handler, priority]);
}

/**
 * Hook for modal/sheet back button handling
 * Returns cleanup function
 */
export function useModalBackButton(isOpen: boolean, onClose: () => void) {
  useAndroidBackButton(() => {
    if (isOpen) {
      onClose();
      return true; // Prevent default back navigation
    }
    return false; // Allow default back navigation
  });
}
