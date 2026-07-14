import React, { useState, useEffect } from 'react';
import { X, Bell, Users, Music, List, Megaphone, CheckCircle2, Mail, Smartphone, Volume2, Moon } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { supabase } from '../lib/supabase';

interface NotificationSettingsModalProps {
  onClose: () => void;
  onSuccess: () => void;
  userProfile: any;
}

interface NotificationSettings {
  receive_new_follower_notifications: boolean;
  receive_content_notifications: boolean;
  receive_playlist_notifications: boolean;
  receive_system_notifications: boolean;
  email_notifications: boolean;
  push_notifications: boolean;
  notification_sound: boolean;
  quiet_hours_enabled: boolean;
}

export const NotificationSettingsModal: React.FC<NotificationSettingsModalProps> = ({
  onClose,
  onSuccess,
  userProfile,
}) => {
  const [settings, setSettings] = useState<NotificationSettings>({
    receive_new_follower_notifications: true,
    receive_content_notifications: true,
    receive_playlist_notifications: true,
    receive_system_notifications: true,
    email_notifications: true,
    push_notifications: true,
    notification_sound: true,
    quiet_hours_enabled: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (userProfile) {
      setSettings({
        receive_new_follower_notifications: userProfile.receive_new_follower_notifications ?? true,
        receive_content_notifications: userProfile.receive_content_notifications ?? true,
        receive_playlist_notifications: userProfile.receive_playlist_notifications ?? true,
        receive_system_notifications: userProfile.receive_system_notifications ?? true,
        email_notifications: userProfile.email_notifications ?? true,
        push_notifications: userProfile.push_notifications ?? true,
        notification_sound: userProfile.notification_sound ?? true,
        quiet_hours_enabled: userProfile.quiet_hours_enabled ?? false,
      });
    }
  }, [userProfile]);

  const handleToggle = async (key: keyof NotificationSettings) => {
    const newValue = !settings[key];

    setSettings(prev => ({
      ...prev,
      [key]: newValue
    }));

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error: updateError } = await supabase
        .from('users')
        .update({ [key]: newValue })
        .eq('id', user.id);

      if (updateError) throw updateError;

      setSuccessMessage('Setting updated');
      setTimeout(() => setSuccessMessage(null), 2000);
    } catch (err) {
      console.error('Error updating notification setting:', err);
      setSettings(prev => ({
        ...prev,
        [key]: !newValue
      }));
      setError(err instanceof Error ? err.message : 'Failed to update setting');
      setTimeout(() => setError(null), 3000);
    }
  };

  const handleClose = () => {
    onSuccess();
    onClose();
  };

  const ToggleSwitch = ({
    checked,
    onChange,
    disabled = false
  }: {
    checked: boolean;
    onChange: () => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-[#0d0d0d] ${
        checked ? 'bg-white shadow-lg' : 'bg-white/20'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:scale-105'}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full shadow-lg transition-all duration-300 ${
          checked ? 'translate-x-6 bg-black' : 'translate-x-1 bg-white'
        }`}
      />
    </button>
  );

  const contentNotifications = [
    {
      key: 'receive_new_follower_notifications' as keyof NotificationSettings,
      title: 'New Followers',
      description: 'Get notified when someone follows you',
      icon: Users,
    },
    {
      key: 'receive_content_notifications' as keyof NotificationSettings,
      title: 'New Content',
      description: 'Get notified about new content from artists you follow',
      icon: Music,
    },
    {
      key: 'receive_playlist_notifications' as keyof NotificationSettings,
      title: 'Playlist Updates',
      description: 'Get notified when your songs are added to playlists',
      icon: List,
    },
    {
      key: 'receive_system_notifications' as keyof NotificationSettings,
      title: 'System Announcements',
      description: 'Get notified about app updates and important announcements',
      icon: Megaphone,
    },
  ];

  const deliveryPreferences = [
    {
      key: 'email_notifications' as keyof NotificationSettings,
      title: 'Email Notifications',
      description: 'Receive notifications via email',
      icon: Mail,
    },
    {
      key: 'push_notifications' as keyof NotificationSettings,
      title: 'Push Notifications',
      description: 'Receive push notifications on your device',
      icon: Smartphone,
    },
    {
      key: 'notification_sound' as keyof NotificationSettings,
      title: 'Notification Sound',
      description: 'Play sound when receiving notifications',
      icon: Volume2,
    },
    {
      key: 'quiet_hours_enabled' as keyof NotificationSettings,
      title: 'Do Not Disturb',
      description: 'Mute notifications during quiet hours (10 PM - 8 AM)',
      icon: Moon,
    },
  ];

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[110] flex items-end justify-center">
      <div
        className="fixed inset-0 bg-black/80"
        onClick={handleClose}
      />

      <Card className="relative w-full bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] border-t border-white/10 shadow-2xl rounded-t-3xl max-h-[85vh] overflow-hidden">
        <CardContent className="p-0">
          {/* Header */}
          <div className="sticky top-0 z-10 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-xl border-b border-white/10 p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
                  <Bell className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl tracking-tight">
                    Notifications
                  </h2>
                  <p className="font-['Inter',sans-serif] text-gray-400 text-sm">
                    Manage your preferences
                  </p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-2.5 hover:bg-white/10 active:scale-95 rounded-full transition-all duration-200"
              >
                <X className="w-5 h-5 text-white/80" />
              </button>
            </div>
          </div>

          {/* Success/Error Messages */}
          {successMessage && (
            <div className="mx-6 mt-4 p-4 bg-gradient-to-r from-[#309605]/20 to-[#3ba208]/10 border border-[#309605]/30 rounded-xl">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#309605]" />
                <p className="font-['Inter',sans-serif] text-white text-sm font-medium">{successMessage}</p>
              </div>
            </div>
          )}

          {error && (
            <div className="mx-6 mt-4 p-4 bg-red-500/20 border border-red-500/30 rounded-xl">
              <p className="font-['Inter',sans-serif] text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Scrollable Content */}
          <div className="overflow-y-auto overflow-x-hidden max-h-[calc(85vh-200px)] px-5 py-4">
            {/* Content Notifications Section */}
            <div className="mb-6">
              <h3 className="font-['Inter',sans-serif] font-semibold text-white text-base mb-3 px-1">
                Content Notifications
              </h3>
              <div className="space-y-3">
                {contentNotifications.map((option) => {
                  const IconComponent = option.icon;
                  const isEnabled = settings[option.key];

                  return (
                    <div
                      key={option.key}
                      className="rounded-2xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] hover:border-white/20 transition-all duration-300 p-5"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center flex-shrink-0">
                            <IconComponent className="w-6 h-6 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-['Inter',sans-serif] font-semibold text-white text-base mb-1 tracking-tight">
                              {option.title}
                            </h4>
                            <p className="font-['Inter',sans-serif] text-gray-400 text-sm leading-relaxed">
                              {option.description}
                            </p>
                          </div>
                        </div>
                        <ToggleSwitch
                          checked={isEnabled}
                          onChange={() => handleToggle(option.key)}
                          disabled={false}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Delivery Preferences Section */}
            <div className="mb-6">
              <h3 className="font-['Inter',sans-serif] font-semibold text-white text-base mb-3 px-1">
                Delivery Preferences
              </h3>
              <div className="space-y-3">
                {deliveryPreferences.map((option) => {
                  const IconComponent = option.icon;
                  const isEnabled = settings[option.key];

                  return (
                    <div
                      key={option.key}
                      className="rounded-2xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] hover:border-white/20 transition-all duration-300 p-5"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center flex-shrink-0">
                            <IconComponent className="w-6 h-6 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-['Inter',sans-serif] font-semibold text-white text-base mb-1 tracking-tight">
                              {option.title}
                            </h4>
                            <p className="font-['Inter',sans-serif] text-gray-400 text-sm leading-relaxed">
                              {option.description}
                            </p>
                          </div>
                        </div>
                        <ToggleSwitch
                          checked={isEnabled}
                          onChange={() => handleToggle(option.key)}
                          disabled={false}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Info Card */}
            <div className="mb-4 p-5 bg-white/[0.03] border border-white/10 rounded-2xl">
              <p className="font-['Inter',sans-serif] text-gray-300 text-sm leading-relaxed">
                Changes are saved automatically. You can enable or disable notifications at any time.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-gradient-to-t from-[#0d0d0d] to-transparent backdrop-blur-xl border-t border-white/10 p-5 safe-bottom">
            <button
              onClick={handleClose}
              className="w-full h-14 bg-white hover:bg-gray-100 active:scale-[0.98] rounded-xl font-['Inter',sans-serif] font-semibold text-black text-base transition-all duration-200 shadow-lg"
            >
              Done
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
