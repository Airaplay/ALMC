import React, { useState } from 'react';
import { X, AlertCircle, Flag } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface ReportModalProps {
  contentType: 'song' | 'video' | 'short_clip' | 'album' | 'comment' | 'user' | 'playlist';
  contentId: string;
  contentTitle?: string;
  reportedUserId?: string | null;
  onClose: () => void;
  onSuccess?: () => void;
}

const REPORT_REASONS = {
  song: [
    { value: 'inappropriate_content', label: 'Inappropriate Content' },
    { value: 'copyright_infringement', label: 'Copyright Infringement' },
    { value: 'spam', label: 'Spam' },
    { value: 'misleading', label: 'Misleading Information' },
    { value: 'other', label: 'Other' }
  ],
  video: [
    { value: 'inappropriate_content', label: 'Inappropriate Content' },
    { value: 'copyright_infringement', label: 'Copyright Infringement' },
    { value: 'spam', label: 'Spam' },
    { value: 'misleading', label: 'Misleading Information' },
    { value: 'violence', label: 'Violence or Harmful Content' },
    { value: 'other', label: 'Other' }
  ],
  short_clip: [
    { value: 'inappropriate_content', label: 'Inappropriate Content' },
    { value: 'copyright_infringement', label: 'Copyright Infringement' },
    { value: 'spam', label: 'Spam' },
    { value: 'misleading', label: 'Misleading Information' },
    { value: 'violence', label: 'Violence or Harmful Content' },
    { value: 'other', label: 'Other' }
  ],
  album: [
    { value: 'inappropriate_content', label: 'Inappropriate Content' },
    { value: 'copyright_infringement', label: 'Copyright Infringement' },
    { value: 'spam', label: 'Spam' },
    { value: 'misleading', label: 'Misleading Information' },
    { value: 'other', label: 'Other' }
  ],
  comment: [
    { value: 'harassment', label: 'Harassment or Bullying' },
    { value: 'hate_speech', label: 'Hate Speech' },
    { value: 'spam', label: 'Spam' },
    { value: 'inappropriate_content', label: 'Inappropriate Content' },
    { value: 'other', label: 'Other' }
  ],
  user: [
    { value: 'harassment', label: 'Harassment or Bullying' },
    { value: 'impersonation', label: 'Impersonation' },
    { value: 'spam', label: 'Spam Account' },
    { value: 'inappropriate_content', label: 'Inappropriate Content' },
    { value: 'other', label: 'Other' }
  ],
  playlist: [
    { value: 'inappropriate_content', label: 'Inappropriate Content' },
    { value: 'spam', label: 'Spam' },
    { value: 'misleading', label: 'Misleading Information' },
    { value: 'other', label: 'Other' }
  ]
};

export const ReportModal: React.FC<ReportModalProps> = ({
  contentType,
  contentId,
  contentTitle,
  reportedUserId,
  onClose,
  onSuccess
}) => {
  const [selectedReason, setSelectedReason] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const reasons = REPORT_REASONS[contentType] || REPORT_REASONS.song;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedReason) {
      setError('Please select a reason for reporting');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setError('You must be signed in to report content');
        return;
      }

      const contentUrl = contentType === 'song' ? `/song/${contentId}` :
                        contentType === 'video' ? `/video/${contentId}` :
                        contentType === 'short_clip' ? `/loops/${contentId}` :
                        contentType === 'album' ? `/album/${contentId}` :
                        contentType === 'user' ? `/profile/${reportedUserId || contentId}` :
                        contentType === 'playlist' ? `/playlist/${contentId}` :
                        contentType === 'comment' ? `#comment-${contentId}` : null;

      const { error: reportError } = await supabase
        .from('reports')
        .insert({
          reporter_id: user.id,
          reported_item_type: contentType,
          reported_item_id: contentId,
          reported_user_id: reportedUserId,
          reason: selectedReason,
          description: description.trim() || null,
          status: 'pending',
          content_url: contentUrl
        });

      if (reportError) throw reportError;

      setSuccess(true);
      onSuccess?.();

      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      console.error('Error submitting report:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit report');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[110] flex items-end sm:items-center justify-center animate-in fade-in duration-200">
      <div className="bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm px-5 py-4 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-red-500/20 rounded-full flex items-center justify-center">
                <Flag className="w-4.5 h-4.5 text-red-400" />
              </div>
              <h2 className="font-bold text-white text-base">
                Report {contentType === 'short_clip' ? 'Clip' : contentType.charAt(0).toUpperCase() + contentType.slice(1)}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-2.5 active:bg-white/10 rounded-full transition-colors touch-manipulation"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-white/70" />
            </button>
          </div>
        </div>

        {success ? (
          <div className="p-8 text-center">
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="font-bold text-white text-lg mb-2">
              Report Submitted
            </h3>
            <p className="text-white/70 text-sm leading-relaxed">
              Thank you for helping keep our community safe. We&apos;ll review your report shortly.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="overflow-y-auto scrollbar-hide" style={{ maxHeight: 'calc(92vh - 73px)' }}>
            <div className="px-5 py-5 space-y-5">
              {/* Content Title */}
              {contentTitle && (
                <div className="p-3.5 bg-white/5 rounded-xl border border-white/10">
                  <p className="text-white/60 text-xs mb-1">
                    Reporting:
                  </p>
                  <p className="text-white text-sm font-medium truncate">
                    {contentTitle}
                  </p>
                </div>
              )}

              {/* Reason Selection */}
              <div className="space-y-2.5">
                <label className="text-white text-sm font-semibold block">
                  Reason for Report <span className="text-red-400">*</span>
                </label>
                <div className="space-y-2">
                  {reasons.map((reason) => (
                    <label
                      key={reason.value}
                      className={`flex items-center p-3.5 rounded-xl border cursor-pointer transition-all touch-manipulation active:scale-[0.98] ${
                        selectedReason === reason.value
                          ? 'border-white bg-white/10'
                          : 'border-white/10 active:border-white/20 bg-white/5 active:bg-white/10'
                      }`}
                    >
                      <input
                        type="radio"
                        name="reason"
                        value={reason.value}
                        checked={selectedReason === reason.value}
                        onChange={(e) => setSelectedReason(e.target.value)}
                        className="w-5 h-5 text-white bg-transparent border-white/30 focus:ring-white focus:ring-offset-0 cursor-pointer"
                      />
                      <span className="ml-3 text-white text-sm font-medium flex-1">
                        {reason.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Additional Details */}
              <div className="space-y-2.5">
                <label className="text-white text-sm font-semibold block">
                  Additional Details (Optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Provide any additional context..."
                  rows={4}
                  maxLength={500}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-white/50 focus:border-white/50 resize-none transition-all touch-manipulation"
                />
                <p className="text-white/40 text-xs text-right">
                  {description.length}/500
                </p>
              </div>

              {/* Error Message */}
              {error && (
                <div className="flex items-start gap-2.5 p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-400 text-sm leading-relaxed">
                    {error}
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-3.5 bg-white/10 active:bg-white/15 border border-white/10 rounded-xl font-semibold text-white text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation active:scale-[0.98]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !selectedReason}
                  className="flex-1 px-4 py-3.5 bg-white active:bg-white/90 rounded-xl font-semibold text-black text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation active:scale-[0.98]"
                >
                  {isSubmitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                      Submitting...
                    </span>
                  ) : (
                    'Submit Report'
                  )}
                </button>
              </div>

              {/* Warning Text */}
              <p className="text-white/50 text-xs text-center pb-2 leading-relaxed">
                False reports may result in account restrictions
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
