import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

/**
 * Haptic Feedback Utility
 * Provides tactile feedback for user interactions
 */

export const haptics = {
  /**
   * Light impact - for subtle interactions (button presses, toggles)
   */
  light: async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (error) {
      // Haptics not available on web, ignore
    }
  },

  /**
   * Medium impact - for standard interactions (selections, confirmations)
   */
  medium: async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch (error) {
      // Haptics not available on web, ignore
    }
  },

  /**
   * Heavy impact - for important actions (deletions, major changes)
   */
  heavy: async () => {
    try {
      await Haptics.impact({ style: ImpactStyle.Heavy });
    } catch (error) {
      // Haptics not available on web, ignore
    }
  },

  /**
   * Success notification - for successful operations
   */
  success: async () => {
    try {
      await Haptics.notification({ type: NotificationType.Success });
    } catch (error) {
      // Haptics not available on web, ignore
    }
  },

  /**
   * Warning notification - for warnings or cautions
   */
  warning: async () => {
    try {
      await Haptics.notification({ type: NotificationType.Warning });
    } catch (error) {
      // Haptics not available on web, ignore
    }
  },

  /**
   * Error notification - for errors or failures
   */
  error: async () => {
    try {
      await Haptics.notification({ type: NotificationType.Error });
    } catch (error) {
      // Haptics not available on web, ignore
    }
  },

  /**
   * Selection changed - for picker/selector changes
   */
  selectionChanged: async () => {
    try {
      await Haptics.selectionChanged();
    } catch (error) {
      // Haptics not available on web, ignore
    }
  },
};

// Export individual functions for convenience
export const { light, medium, heavy, success, warning, error: errorHaptic, selectionChanged } = haptics;
