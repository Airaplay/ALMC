import React, { useState } from 'react';
import { Loader2, Lock } from 'lucide-react';

export type SecurityPinGateMode = 'setup' | 'verify';

interface SecurityPinGateDialogProps {
  isOpen: boolean;
  mode: SecurityPinGateMode;
  title?: string;
  message?: string;
  confirmText?: string;
  onSubmit: (pin: string, confirmPin?: string) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export const SecurityPinGateDialog: React.FC<SecurityPinGateDialogProps> = ({
  isOpen,
  mode,
  title,
  message,
  confirmText,
  onSubmit,
  onCancel,
  isLoading = false,
  error = null,
}) => {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  if (!isOpen) return null;

  const handlePinChange = (value: string, setter: (v: string) => void) => {
    if (value === '' || /^\d{0,6}$/.test(value)) setter(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'setup') {
      await onSubmit(pin, confirmPin);
    } else {
      await onSubmit(pin);
    }
  };

  const canSubmit =
    mode === 'setup'
      ? pin.length >= 4 && pin === confirmPin && !isLoading
      : pin.length >= 4 && !isLoading;

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
      <form
        onSubmit={handleSubmit}
        className="bg-gradient-to-b from-[#1a1a1a] to-[#0d0d0d] rounded-2xl w-full max-w-sm border border-white/10 shadow-2xl"
      >
        <div className="p-6">
          <div className="flex items-start gap-4 mb-5">
            <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 bg-yellow-500/20">
              <Lock className="w-6 h-6 text-yellow-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-white mb-1">
                {title ?? (mode === 'setup' ? 'Create Security PIN' : 'Enter Security PIN')}
              </h3>
              <p className="text-sm text-white/70 leading-relaxed">
                {message ??
                  (mode === 'setup'
                    ? 'Set a 4–6 digit PIN to protect Treat sends and other wallet actions.'
                    : 'Enter your Security PIN to confirm this Treat send.')}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <input
              type="password"
              inputMode="numeric"
              autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
              maxLength={6}
              value={pin}
              onChange={(e) => handlePinChange(e.target.value, setPin)}
              placeholder={mode === 'setup' ? 'New PIN (4–6 digits)' : 'Your PIN'}
              className="w-full bg-white/[0.05] border border-white/[0.08] rounded-xl px-4 py-3 text-white text-center tracking-[0.4em] text-lg outline-none focus:border-yellow-500/40"
            />
            {mode === 'setup' && (
              <input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => handlePinChange(e.target.value, setConfirmPin)}
                placeholder="Confirm PIN"
                className="w-full bg-white/[0.05] border border-white/[0.08] rounded-xl px-4 py-3 text-white text-center tracking-[0.4em] text-lg outline-none focus:border-yellow-500/40"
              />
            )}
          </div>

          {error && (
            <p className="mt-3 text-sm text-red-400 font-medium">{error}</p>
          )}

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="flex-1 px-4 py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-medium transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 px-4 py-3 bg-yellow-400 hover:bg-yellow-300 rounded-xl text-black font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Please wait…
                </>
              ) : (
                confirmText ?? (mode === 'setup' ? 'Save PIN' : 'Confirm')
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
