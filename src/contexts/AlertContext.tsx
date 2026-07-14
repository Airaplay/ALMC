import React, { createContext, useContext, useState, useCallback } from 'react';
import { CustomAlertModal } from '../components/CustomAlertModal';
import { CustomConfirmModal } from '../components/CustomConfirmModal';

interface AlertOptions {
  title?: string;
  message: string;
  type?: 'info' | 'success' | 'error' | 'warning';
}

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger' | 'warning';
}

interface AlertContextType {
  showAlert: (optionsOrMessage: AlertOptions | string, type?: 'info' | 'success' | 'error' | 'warning') => void;
  showConfirm: (options: ConfirmOptions) => Promise<boolean>;
}

const AlertContext = createContext<AlertContextType | undefined>(undefined);

export const AlertProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    title?: string;
    message: string;
    type: 'info' | 'success' | 'error' | 'warning';
  }>({
    isOpen: false,
    message: '',
    type: 'info',
  });

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title?: string;
    message: string;
    confirmText: string;
    cancelText: string;
    variant: 'default' | 'danger' | 'warning';
    resolve?: (value: boolean) => void;
  }>({
    isOpen: false,
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    variant: 'default',
  });

  const showAlert = useCallback((optionsOrMessage: AlertOptions | string, type?: 'info' | 'success' | 'error' | 'warning') => {
    if (typeof optionsOrMessage === 'string') {
      setAlertState({
        isOpen: true,
        message: optionsOrMessage,
        type: type || 'info',
      });
    } else {
      setAlertState({
        isOpen: true,
        title: optionsOrMessage.title,
        message: optionsOrMessage.message,
        type: optionsOrMessage.type || 'info',
      });
    }
  }, []);

  const showConfirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({
        isOpen: true,
        title: options.title,
        message: options.message,
        confirmText: options.confirmText || 'Confirm',
        cancelText: options.cancelText || 'Cancel',
        variant: options.variant || 'default',
        resolve,
      });
    });
  }, []);

  const handleAlertClose = useCallback(() => {
    setAlertState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleConfirmConfirm = useCallback(() => {
    if (confirmState.resolve) {
      confirmState.resolve(true);
    }
    setConfirmState((prev) => ({ ...prev, isOpen: false }));
  }, [confirmState.resolve]);

  const handleConfirmCancel = useCallback(() => {
    if (confirmState.resolve) {
      confirmState.resolve(false);
    }
    setConfirmState((prev) => ({ ...prev, isOpen: false }));
  }, [confirmState.resolve]);

  return (
    <AlertContext.Provider value={{ showAlert, showConfirm }}>
      {children}
      <CustomAlertModal
        isOpen={alertState.isOpen}
        title={alertState.title}
        message={alertState.message}
        type={alertState.type}
        onClose={handleAlertClose}
      />
      <CustomConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        cancelText={confirmState.cancelText}
        variant={confirmState.variant}
        onConfirm={handleConfirmConfirm}
        onCancel={handleConfirmCancel}
      />
    </AlertContext.Provider>
  );
};

export const useAlert = (): AlertContextType => {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useAlert must be used within an AlertProvider');
  }
  return context;
};
