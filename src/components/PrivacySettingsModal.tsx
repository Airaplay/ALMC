import React, { useState, useEffect } from 'react';
import { X, Shield, Globe, Lock } from 'lucide-react';
import { updateUserProfile } from '../lib/supabase';

interface PrivacySettingsModalProps {
  onClose: () => void;
  onSuccess: () => void;
  userProfile: any;
}

interface PrivacySettings {
  profile_visibility: string;
}

export const PrivacySettingsModal: React.FC<PrivacySettingsModalProps> = ({
  onClose,
  onSuccess,
  userProfile,
}) => {
  const [settings, setSettings] = useState<PrivacySettings>({
    profile_visibility: 'public',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (userProfile) {
      setSettings({
        profile_visibility: userProfile.profile_visibility ?? 'public',
      });
    }
  }, [userProfile]);

  const handleToggle = () => {
    setSettings(prev => ({
      ...prev,
      profile_visibility: prev.profile_visibility === 'public' ? 'private' : 'public'
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await updateUserProfile({
        profile_visibility: settings.profile_visibility,
      });

      onSuccess();
      onClose();
    } catch (err) {
      console.error('Error updating privacy settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to update privacy settings');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isPublic = settings.profile_visibility === 'public';

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[110] flex items-end justify-center">
      <div className="w-full max-h-[85vh] overflow-y-auto bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] rounded-t-3xl border-t border-white/10 shadow-2xl">
        <div className="sticky top-0 z-10 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-xl border-b border-white/10 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-green-500/20 rounded-xl flex items-center justify-center">
                <Shield className="w-6 h-6 text-green-400" />
              </div>
              <h2 className="font-bold text-white text-xl">
                Privacy Settings
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-full transition-all"
            >
              <X className="w-6 h-6 text-white/80" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-6">
          <p className="text-white/70 text-sm leading-relaxed">
            Control who can view your profile and content
          </p>

          {/* Profile Visibility Setting */}
          <div className="space-y-3">
            <h3 className="font-semibold text-white text-base mb-3">
              Profile Visibility
            </h3>

            <div
              onClick={() => !isSubmitting && handleToggle()}
              className={`rounded-xl border transition-all duration-300 cursor-pointer p-5 ${
                isPublic
                  ? 'bg-[#309605]/10 border-[#309605]/30 hover:border-[#309605]/50'
                  : 'bg-white/5 border-white/10 hover:bg-white/10'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    isPublic ? 'bg-[#309605]/20' : 'bg-white/10'
                  }`}>
                    <Globe className={`w-6 h-6 ${
                      isPublic ? 'text-[#309605]' : 'text-white/60'
                    }`} />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-white text-base mb-1">
                      Public Profile
                    </h4>
                    <p className="text-white/70 text-sm leading-relaxed">
                      Anyone can view your profile and content
                    </p>
                  </div>
                </div>
                {isPublic && (
                  <div className="w-6 h-6 bg-[#309605] rounded-full flex items-center justify-center flex-shrink-0">
                    <div className="w-2 h-2 bg-white rounded-full"></div>
                  </div>
                )}
              </div>
            </div>

            <div
              onClick={() => !isSubmitting && handleToggle()}
              className={`rounded-xl border transition-all duration-300 cursor-pointer p-5 ${
                !isPublic
                  ? 'bg-[#309605]/10 border-[#309605]/30 hover:border-[#309605]/50'
                  : 'bg-white/5 border-white/10 hover:bg-white/10'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    !isPublic ? 'bg-[#309605]/20' : 'bg-white/10'
                  }`}>
                    <Lock className={`w-6 h-6 ${
                      !isPublic ? 'text-[#309605]' : 'text-white/60'
                    }`} />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-white text-base mb-1">
                      Private Profile
                    </h4>
                    <p className="text-white/70 text-sm leading-relaxed">
                      Only you can view your profile content
                    </p>
                  </div>
                </div>
                {!isPublic && (
                  <div className="w-6 h-6 bg-[#309605] rounded-full flex items-center justify-center flex-shrink-0">
                    <div className="w-2 h-2 bg-white rounded-full"></div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Privacy Notice */}
          <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-4">
            <h4 className="font-semibold text-blue-400 text-sm mb-2">
              Privacy Notice
            </h4>
            <ul className="space-y-1.5 text-xs text-white/70">
              <li className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full mt-1.5 flex-shrink-0"></div>
                <span>Your email and personal information are always private</span>
              </li>
              <li className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full mt-1.5 flex-shrink-0"></div>
                <span>Private profiles hide your content from public discovery</span>
              </li>
              <li className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full mt-1.5 flex-shrink-0"></div>
                <span>You can change these settings anytime</span>
              </li>
            </ul>
          </div>

          {error && (
            <div className="rounded-xl bg-red-500/20 border border-red-500/30 p-4">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-4 pb-safe">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 h-14 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl font-medium text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 h-14 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#309605] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium text-white transition-all duration-200 shadow-xl"
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};