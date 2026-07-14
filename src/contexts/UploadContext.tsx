import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { ToastNotification } from '../components/ToastNotification';
import { createUploadSuccessNotification, createUploadErrorNotification } from '../lib/notificationService';
import { supabase } from '../lib/supabase';

export interface UploadTask {
  id: string;
  type: 'single' | 'album' | 'video';
  title: string;
  progress: number;
  status: 'uploading' | 'processing' | 'completed' | 'error';
  error?: string;
}

interface UploadContextType {
  uploads: UploadTask[];
  addUpload: (task: Omit<UploadTask, 'progress' | 'status'>) => void;
  updateUploadProgress: (id: string, progress: number) => void;
  updateUploadStatus: (id: string, status: UploadTask['status'], error?: string) => void;
  removeUpload: (id: string) => void;
  isModalVisible: boolean;
  setModalVisible: (visible: boolean) => void;
  onModalClose: (callback: () => void) => () => void;
}

interface ToastState {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

export const UploadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const [isModalVisible, setModalVisible] = useState(false);
  const [modalCloseCallbacks, setModalCloseCallbacks] = useState<Set<() => void>>(new Set());
  const [toasts, setToasts] = useState<ToastState[]>([]);

  const addUpload = useCallback((task: Omit<UploadTask, 'progress' | 'status'>) => {
    const newTask: UploadTask = {
      ...task,
      progress: 0,
      status: 'uploading'
    };
    setUploads(prev => [...prev, newTask]);
    setModalVisible(true);
  }, []);

  const updateUploadProgress = useCallback((id: string, progress: number) => {
    setUploads(prev =>
      prev.map(upload =>
        upload.id === id ? { ...upload, progress } : upload
      )
    );
  }, []);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'warning' | 'info') => {
    const toastId = `toast-${Date.now()}`;
    setToasts(prev => [...prev, { id: toastId, message, type }]);
  }, []);

  const removeToast = useCallback((toastId: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== toastId));
  }, []);

  const updateUploadStatus = useCallback(async (id: string, status: UploadTask['status'], error?: string) => {
    let upload: UploadTask | undefined;

    setUploads(prev => {
      const updated = prev.map(u =>
        u.id === id ? { ...u, status, error } : u
      );
      upload = updated.find(u => u.id === id);
      return updated;
    });

    if (!upload) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      if (status === 'completed') {
        await createUploadSuccessNotification(user.id, upload.title, upload.type);

        const typeLabel = upload.type === 'single' ? 'song' : upload.type === 'album' ? 'album' : 'video';
        showToast(`Your ${typeLabel} "${upload.title}" is now live!`, 'success');
      } else if (status === 'error' && error) {
        await createUploadErrorNotification(user.id, upload.title, upload.type, error);

        const typeLabel = upload.type === 'single' ? 'song' : upload.type === 'album' ? 'album' : 'video';
        showToast(`Failed to upload ${typeLabel} "${upload.title}"`, 'error');
      }
    } catch (err) {
      console.error('Error creating upload notification:', err);
    }
  }, [showToast]);

  const removeUpload = useCallback((id: string) => {
    setUploads(prev => prev.filter(upload => upload.id !== id));
  }, []);

  const handleSetModalVisible = useCallback((visible: boolean) => {
    setModalVisible(visible);
    // When modal is closed, trigger all registered callbacks
    if (!visible) {
      modalCloseCallbacks.forEach(callback => callback());
    }
  }, [modalCloseCallbacks]);

  const onModalClose = useCallback((callback: () => void) => {
    setModalCloseCallbacks(prev => {
      const newSet = new Set(prev);
      newSet.add(callback);
      return newSet;
    });

    // Return cleanup function
    return () => {
      setModalCloseCallbacks(prev => {
        const newSet = new Set(prev);
        newSet.delete(callback);
        return newSet;
      });
    };
  }, []);

  return (
    <UploadContext.Provider
      value={{
        uploads,
        addUpload,
        updateUploadProgress,
        updateUploadStatus,
        removeUpload,
        isModalVisible,
        setModalVisible: handleSetModalVisible,
        onModalClose
      }}
    >
      {children}
      {toasts.map(toast => (
        <ToastNotification
          key={toast.id}
          message={toast.message}
          type={toast.type}
          duration={5000}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </UploadContext.Provider>
  );
};

export const useUpload = () => {
  const context = useContext(UploadContext);
  if (!context) {
    throw new Error('useUpload must be used within UploadProvider');
  }
  return context;
};
