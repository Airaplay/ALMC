import React, { useState } from 'react';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';
import { requestAccountDeletion } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface AccountDeletionModalProps {
  onClose: () => void;
}

export const AccountDeletionModal: React.FC<AccountDeletionModalProps> = ({ onClose }) => {
  const { signOut } = useAuth();
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canSubmit = confirmText.trim().toUpperCase() === 'DELETE';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || isSubmitting) return;
    setError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      const result = await requestAccountDeletion(reason);
      if (!result.success) {
        throw new Error('Could not submit your account deletion request');
      }
      setSuccess(
        result.already_pending
          ? 'You already have a pending account deletion request. We signed you out for safety.'
          : 'Account deletion request submitted. We signed you out for safety.'
      );
      setTimeout(() => {
        void signOut();
        onClose();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit account deletion request');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[120] flex items-end justify-center">
      <div className="w-full max-h-[88vh] overflow-y-auto rounded-t-3xl border-t border-red-500/30 bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000]">
        <div className="sticky top-0 z-10 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm px-5 py-5 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-red-500/20 flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-400" />
              </div>
              <h2 className="text-white text-xl font-bold">Delete Account</h2>
            </div>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-all">
              <X className="w-5 h-5 text-white/80" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="text-xs text-white/80 leading-relaxed">
              Deletion is permanent after review. Your profile and access may be removed, and pending balances can be
              impacted by policy and fraud checks.
            </div>
          </div>

          <div>
            <label className="block text-white/70 text-xs mb-2">Reason (optional)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={400}
              className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white outline-none focus:border-red-500/40"
              placeholder="Tell us why you're deleting your account"
            />
          </div>

          <div>
            <label className="block text-white/70 text-xs mb-2">
              Type <span className="font-bold text-red-300">DELETE</span> to confirm
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white outline-none focus:border-red-500/40"
              placeholder="DELETE"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
          {success && <p className="text-[#00ad74] text-sm">{success}</p>}

          <div className="flex gap-3 pt-2 pb-safe">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 h-12 rounded-xl bg-white/10 border border-white/20 text-white/80"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit || isSubmitting}
              className="flex-1 h-12 rounded-xl bg-red-600 text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Request Deletion'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
