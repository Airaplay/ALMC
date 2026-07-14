import React, { useState, useEffect } from 'react';
import { AlertTriangle, Lock, X, ShieldAlert } from 'lucide-react';
import { supabase } from '../lib/supabase';

export interface AdminActionConfirmProps {
  isOpen: boolean;
  title: string;
  description: string;
  actionLabel: string;
  actionVariant?: 'danger' | 'warning';
  requirePasswordConfirm?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const AdminActionConfirmModal = ({
  isOpen,
  title,
  description,
  actionLabel,
  actionVariant = 'danger',
  requirePasswordConfirm = true,
  onConfirm,
  onCancel,
}: AdminActionConfirmProps): JSX.Element | null => {
  const [password, setPassword] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setPassword('');
      setError(null);
      setIsVerifying(false);
      setIsExecuting(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (requirePasswordConfirm) {
      if (!password.trim()) {
        setError('Please enter your password to confirm this action');
        return;
      }

      setIsVerifying(true);
      setError(null);

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.email) {
          setError('Unable to verify identity. Please sign in again.');
          setIsVerifying(false);
          return;
        }

        const { error: authError } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: password.trim(),
        });

        if (authError) {
          setError('Incorrect password. Action cancelled for security.');
          setIsVerifying(false);
          return;
        }
      } catch {
        setError('Verification failed. Please try again.');
        setIsVerifying(false);
        return;
      }

      setIsVerifying(false);
    }

    setIsExecuting(true);
    try {
      await onConfirm();
    } finally {
      setIsExecuting(false);
    }
  };

  const actionColor = actionVariant === 'danger'
    ? 'bg-red-600 hover:bg-red-700 text-white'
    : 'bg-orange-500 hover:bg-orange-600 text-white';

  const iconBg = actionVariant === 'danger' ? 'bg-red-100' : 'bg-orange-100';
  const iconColor = actionVariant === 'danger' ? 'text-red-500' : 'text-orange-500';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black bg-opacity-60" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 ${iconBg} rounded-full flex items-center justify-center`}>
              <ShieldAlert className={`w-5 h-5 ${iconColor}`} />
            </div>
            <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Warning banner */}
        <div className={`mx-6 mb-4 p-3 rounded-lg border flex items-start gap-2 ${
          actionVariant === 'danger'
            ? 'bg-red-50 border-red-200'
            : 'bg-orange-50 border-orange-200'
        }`}>
          <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${iconColor}`} />
          <p className={`text-sm ${actionVariant === 'danger' ? 'text-red-800' : 'text-orange-800'}`}>
            {description}
          </p>
        </div>

        {/* Password re-entry */}
        {requirePasswordConfirm && (
          <div className="px-6 mb-5">
            <label className="flex items-center gap-2 text-gray-700 text-sm font-medium mb-2">
              <Lock className="w-4 h-4" />
              Confirm your password to proceed
            </label>
            <input
              type="password"
              value={password}
              onChange={e => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
              placeholder="Enter your password"
              autoFocus
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent"
            />
            {error && (
              <p className="mt-2 text-sm text-red-600">{error}</p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={onCancel}
            disabled={isVerifying || isExecuting}
            className="flex-1 py-2.5 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isVerifying || isExecuting || (requirePasswordConfirm && !password.trim())}
            className={`flex-1 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${actionColor}`}
          >
            {isVerifying ? 'Verifying...' : isExecuting ? 'Processing...' : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export const useAdminActionConfirm = () => {
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    actionLabel: string;
    actionVariant: 'danger' | 'warning';
    requirePasswordConfirm: boolean;
    resolve: ((confirmed: boolean) => void) | null;
  }>({
    isOpen: false,
    title: '',
    description: '',
    actionLabel: 'Confirm',
    actionVariant: 'danger',
    requirePasswordConfirm: true,
    resolve: null,
  });

  const confirm = (options: {
    title: string;
    description: string;
    actionLabel?: string;
    actionVariant?: 'danger' | 'warning';
    requirePasswordConfirm?: boolean;
  }): Promise<boolean> => {
    return new Promise(resolve => {
      setConfirmState({
        isOpen: true,
        title: options.title,
        description: options.description,
        actionLabel: options.actionLabel ?? 'Confirm',
        actionVariant: options.actionVariant ?? 'danger',
        requirePasswordConfirm: options.requirePasswordConfirm ?? true,
        resolve,
      });
    });
  };

  const handleConfirm = () => {
    confirmState.resolve?.(true);
    setConfirmState(prev => ({ ...prev, isOpen: false, resolve: null }));
  };

  const handleCancel = () => {
    confirmState.resolve?.(false);
    setConfirmState(prev => ({ ...prev, isOpen: false, resolve: null }));
  };

  const ConfirmModal = () => (
    <AdminActionConfirmModal
      isOpen={confirmState.isOpen}
      title={confirmState.title}
      description={confirmState.description}
      actionLabel={confirmState.actionLabel}
      actionVariant={confirmState.actionVariant}
      requirePasswordConfirm={confirmState.requirePasswordConfirm}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );

  return { confirm, ConfirmModal };
};
