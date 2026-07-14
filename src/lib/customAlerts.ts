/**
 * Custom Alert/Confirm Utilities
 *
 * This module provides a migration path from native browser alerts/confirms to custom modals.
 * Import useAlert from AlertContext instead of using window.alert/confirm directly.
 *
 * Usage:
 *
 * import { useAlert } from '../contexts/AlertContext';
 *
 * const { showAlert, showConfirm } = useAlert();
 *
 * // Instead of: alert('Success!')
 * showAlert({ message: 'Success!', type: 'success' });
 *
 * // Instead of: if (confirm('Delete?'))
 * const confirmed = await showConfirm({
 *   message: 'Delete this item?',
 *   variant: 'danger'
 * });
 * if (confirmed) { ... }
 */

// Legacy functions for gradual migration (these will eventually be removed)
export const customAlert = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
  window.dispatchEvent(new CustomEvent('showCustomAlert', {
    detail: { message, type }
  }));
};

export const customConfirm = (message: string, variant: 'default' | 'danger' | 'warning' = 'default'): Promise<boolean> => {
  return new Promise((resolve) => {
    const handler = (event: CustomEvent) => {
      resolve(event.detail.confirmed);
      window.removeEventListener('customConfirmResponse', handler as EventListener);
    };

    window.addEventListener('customConfirmResponse', handler as EventListener);
    window.dispatchEvent(new CustomEvent('showCustomConfirm', {
      detail: { message, variant, responseId: Date.now() }
    }));
  });
};
