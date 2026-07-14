import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Camera,
  Check,
  Link as LinkIcon,
  Youtube,
  Instagram,
  Loader2,
  Lock,
  Mail,
  Eye,
  EyeOff,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { countries } from '../../lib/countries';
import { CustomAlertModal } from '../../components/CustomAlertModal';
import { LoadingLogo } from '../../components/LoadingLogo';

const TikTokIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
  </svg>
);

const FacebookIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);

interface UserProfile {
  id: string;
  email: string;
  display_name?: string;
  username?: string;
  bio?: string;
  country?: string;
  gender?: string;
  avatar_url?: string;
  social_media_platform?: string;
  social_media_url?: string;
  username_last_changed_at?: string;
}


const SOCIAL_PLATFORMS = [
  { id: 'youtube', name: 'YouTube', icon: Youtube, color: 'text-red-500' },
  { id: 'facebook', name: 'Facebook', icon: FacebookIcon, color: 'text-blue-600' },
  { id: 'tiktok', name: 'TikTok', icon: TikTokIcon, color: 'text-white' },
  { id: 'instagram', name: 'Instagram', icon: Instagram, color: 'text-pink-500' },
];

export const EditProfileScreen = (): JSX.Element => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    display_name: '',
    username: '',
    bio: '',
    country: '',
    gender: '',
    social_media_platform: '',
    social_media_url: '',
  });

  const [errors, setErrors] = useState({
    username: '',
    social_media_url: '',
  });

  const [canChangeUsername, setCanChangeUsername] = useState(true);
  const [daysUntilUsernameChange, setDaysUntilUsernameChange] = useState(0);
  const [canChangeCountry, setCanChangeCountry] = useState(true);
  const [daysUntilCountryChange, setDaysUntilCountryChange] = useState(0);
  const [instagramHandle, setInstagramHandle] = useState('');
  const [youtubeHandle, setYoutubeHandle] = useState('');
  const [tiktokHandle, setTiktokHandle] = useState('');

  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);

  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    title?: string;
    message: string;
    type?: 'info' | 'success' | 'error' | 'warning';
  }>({
    isOpen: false,
    message: '',
  });

  const showAlert = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info', title?: string) => {
    setAlertModal({ isOpen: true, message, type, title });
  };

  const closeAlert = () => {
    setAlertModal({ isOpen: false, message: '' });
  };

  useEffect(() => {
    loadUserProfile();
  }, []);

  const loadUserProfile = async () => {
    try {
      setIsLoading(true);
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        navigate('/profile');
        return;
      }

      // Column-level grants on public.users mean SELECT * fails. Only the
      // fields this screen edits/displays are projected.
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select(
          'id, email, display_name, username, avatar_url, bio, country, gender, ' +
          'social_media_platform, social_media_url, username_last_changed_at, ' +
          'country_last_changed_at, profile_visibility'
        )
        .eq('id', user.id)
        .single();

      if (userError) throw userError;

      setUserProfile(userData);
      setFormData({
        display_name: userData.display_name || '',
        username: userData.username || '',
        bio: userData.bio || '',
        country: userData.country || '',
        gender: userData.gender || '',
        social_media_platform: userData.social_media_platform || '',
        social_media_url: userData.social_media_url || '',
      });
      setAvatarPreview(userData.avatar_url || null);

      // Check username change restriction
      if (userData.username_last_changed_at) {
        const lastChanged = new Date(userData.username_last_changed_at);
        const now = new Date();
        const daysSinceChange = Math.floor((now.getTime() - lastChanged.getTime()) / (1000 * 60 * 60 * 24));

        if (daysSinceChange < 14) {
          setCanChangeUsername(false);
          setDaysUntilUsernameChange(14 - daysSinceChange);
        }
      }

      // Check country change restriction
      if (userData.country_last_changed_at) {
        const lastChanged = new Date(userData.country_last_changed_at);
        const now = new Date();
        const daysSinceChange = Math.floor((now.getTime() - lastChanged.getTime()) / (1000 * 60 * 60 * 24));

        if (daysSinceChange < 14) {
          setCanChangeCountry(false);
          setDaysUntilCountryChange(14 - daysSinceChange);
        }
      }

      // Load artist social media handles if user is a creator
      const { data: artistProfile } = await supabase
        .from('artist_profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (artistProfile) {
        const { data: socialLinks } = await supabase
          .from('artist_social_links')
          .select('platform, handle')
          .eq('artist_profile_id', artistProfile.id);

        if (socialLinks) {
          socialLinks.forEach(link => {
            if (link.platform === 'instagram') setInstagramHandle(link.handle);
            if (link.platform === 'youtube') setYoutubeHandle(link.handle);
            if (link.platform === 'tiktok') setTiktokHandle(link.handle);
          });
        }
      }
    } catch (error) {
      console.error('Error loading profile:', error);
      showAlert('Failed to load profile', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      showAlert('Image size should be less than 5MB', 'warning');
      return;
    }

    setAvatarFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setAvatarPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const validateUsername = (username: string): boolean => {
    if (!username) return true;

    if (username.length < 3 || username.length > 20) {
      setErrors(prev => ({ ...prev, username: 'Username must be 3-20 characters' }));
      return false;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setErrors(prev => ({ ...prev, username: 'Username can only contain letters, numbers, and underscores' }));
      return false;
    }

    setErrors(prev => ({ ...prev, username: '' }));
    return true;
  };

  const validateSocialMediaUrl = (url: string, platform: string): boolean => {
    if (!url || !platform) {
      setErrors(prev => ({ ...prev, social_media_url: '' }));
      return true;
    }

    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();

      const platformDomains: Record<string, string[]> = {
        youtube: ['youtube.com', 'youtu.be', 'www.youtube.com'],
        facebook: ['facebook.com', 'fb.com', 'www.facebook.com', 'www.fb.com'],
        tiktok: ['tiktok.com', 'www.tiktok.com'],
        instagram: ['instagram.com', 'www.instagram.com'],
      };

      const validDomains = platformDomains[platform] || [];
      const isValid = validDomains.some(domain => hostname.includes(domain));

      if (!isValid) {
        setErrors(prev => ({
          ...prev,
          social_media_url: `Please enter a valid ${platform} URL`
        }));
        return false;
      }

      setErrors(prev => ({ ...prev, social_media_url: '' }));
      return true;
    } catch {
      setErrors(prev => ({
        ...prev,
        social_media_url: 'Please enter a valid URL (e.g., https://...)'
      }));
      return false;
    }
  };

  const uploadToStorage = async (file: File, userId: string): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`;
    const filePath = `${userId}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('profile-photos')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true
      });

    if (uploadError) {
      throw new Error(uploadError.message || 'Upload failed');
    }

    const { data: { publicUrl } } = supabase.storage
      .from('profile-photos')
      .getPublicUrl(filePath);

    return publicUrl;
  };

  const handlePasswordChange = async () => {
    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      showAlert('Please fill in all password fields', 'warning');
      return;
    }

    if (passwordData.newPassword.length < 6) {
      showAlert('New password must be at least 6 characters long', 'warning');
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      showAlert('New passwords do not match', 'warning');
      return;
    }

    setIsChangingPassword(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordData.newPassword
      });

      if (error) throw error;

      showAlert('Password changed successfully!', 'success');
      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      setShowPasswordSection(false);
    } catch (error: any) {
      console.error('Error changing password:', error);
      showAlert(error.message || 'Failed to change password', 'error');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!userProfile?.email) {
      showAlert('No email address found', 'error');
      return;
    }

    setIsSendingReset(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(userProfile.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      showAlert('Password reset link has been sent to your email!', 'success');
      setShowPasswordSection(false);
    } catch (error: any) {
      console.error('Error sending reset email:', error);
      showAlert(error.message || 'Failed to send password reset email', 'error');
    } finally {
      setIsSendingReset(false);
    }
  };

  const handleSave = async () => {
    if (!userProfile) return;

    if (!validateUsername(formData.username)) return;

    if (formData.username !== userProfile.username && !canChangeUsername) {
      showAlert(`You can only change your username once every 14 days. Please wait ${daysUntilUsernameChange} more days.`, 'warning');
      return;
    }

    if (formData.country !== userProfile.country && !canChangeCountry) {
      showAlert(`You can only change your country once every 14 days. Please wait ${daysUntilCountryChange} more days.`, 'warning');
      return;
    }

    setIsSaving(true);

    try {
      let avatarUrl = userProfile.avatar_url;

      if (avatarFile) {
        try {
          avatarUrl = await uploadToStorage(avatarFile, userProfile.id);
        } catch (uploadError) {
          console.error('Error uploading avatar:', uploadError);
          showAlert('Failed to upload profile photo. Please try again.', 'error');
          setIsSaving(false);
          return;
        }
      }

      const updateData: any = {
        display_name: formData.display_name,
        bio: formData.bio,
        gender: formData.gender || null,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      };

      if (formData.username && formData.username !== userProfile.username) {
        const { data: existingUser } = await supabase
          .from('users')
          .select('id')
          .eq('username', formData.username)
          .neq('id', userProfile.id)
          .maybeSingle();

        if (existingUser) {
          showAlert('Username already taken. Please choose another.', 'warning');
          setIsSaving(false);
          return;
        }

        updateData.username = formData.username;
        updateData.username_last_changed_at = new Date().toISOString();
      }

      if (formData.country !== userProfile.country) {
        updateData.country = formData.country;
        updateData.country_last_changed_at = new Date().toISOString();
      }

      const { error: updateError } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', userProfile.id);

      if (updateError) throw updateError;

      const { data: artistData } = await supabase
        .from('artist_profiles')
        .select('id')
        .eq('user_id', userProfile.id)
        .maybeSingle();

      if (artistData && avatarUrl) {
        await supabase
          .from('artist_profiles')
          .update({
            profile_photo_url: avatarUrl,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userProfile.id);
      }

      showAlert('Profile updated successfully!', 'success');
      setTimeout(() => navigate('/profile'), 1500);
    } catch (error: any) {
      console.error('Error saving profile:', error);
      showAlert(error.message || 'Failed to update profile', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col min-h-screen bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white">
        <header className="w-full py-4 px-5 sticky top-0 z-20 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/10 rounded-full transition-all">
              <ArrowLeft className="w-6 h-6" />
            </button>
            <h1 className="font-bold text-lg">Edit Profile</h1>
            <div className="w-10"></div>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <LoadingLogo variant="pulse" size={60} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen overflow-y-auto bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav">
      <header className="w-full py-4 px-5 sticky top-0 z-20 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-white/10 rounded-full transition-all"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="font-bold text-lg">Edit Profile</h1>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="p-2 hover:bg-white/10 rounded-full transition-all disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <Check className="w-6 h-6 text-[#309605]" />
            )}
          </button>
        </div>
      </header>

      <div className="px-5 py-6 space-y-6">
        <div className="flex justify-center">
          <div className="relative">
            <div className="w-24 h-24 rounded-full overflow-hidden bg-white/5 border-2 border-white/10">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-white/20 to-white/5 flex items-center justify-center">
                  <span className="text-3xl font-bold">
                    {(formData.display_name || userProfile?.email || 'U').charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
            </div>
            <label
              htmlFor="avatar-upload"
              className="absolute bottom-0 right-0 w-8 h-8 bg-[#309605] rounded-full flex items-center justify-center cursor-pointer hover:bg-[#3ba208] transition-colors shadow-lg"
            >
              <Camera className="w-4 h-4 text-white" />
              <input
                id="avatar-upload"
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
              />
            </label>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">Display Name</label>
            <input
              type="text"
              value={formData.display_name}
              onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
              placeholder="Enter your display name"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:border-[#309605] transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">
              Username
              {!canChangeUsername && (
                <span className="text-xs text-yellow-500 ml-2">
                  (Can change in {daysUntilUsernameChange} days)
                </span>
              )}
            </label>
            <input
              type="text"
              value={formData.username}
              onChange={(e) => {
                setFormData({ ...formData, username: e.target.value });
                validateUsername(e.target.value);
              }}
              disabled={!canChangeUsername && formData.username === userProfile?.username}
              placeholder="Enter your username"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:border-[#309605] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            />
            {errors.username && (
              <p className="text-xs text-red-400 mt-1">{errors.username}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">Bio</label>
            <textarea
              value={formData.bio}
              onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
              placeholder="Tell us about yourself"
              rows={4}
              maxLength={200}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:border-[#309605] transition-colors resize-none"
            />
            <p className="text-xs text-white/40 mt-1 text-right">
              {formData.bio.length}/200
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">
              Country
              {!canChangeCountry && (
                <span className="text-xs text-yellow-500 ml-2">
                  (Can change in {daysUntilCountryChange} days)
                </span>
              )}
            </label>
            {!canChangeCountry && formData.country ? (
              <>
                <input
                  type="text"
                  value={countries.find(c => c.code === formData.country)?.name || formData.country}
                  readOnly
                  disabled
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white opacity-50 cursor-not-allowed"
                />
                <p className="text-xs text-white/50 mt-1">
                  You can only change your country once every 14 days
                </p>
              </>
            ) : (
              <select
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-[#309605] transition-colors"
              >
                <option value="" className="bg-[#1a1a1a]">Select your country</option>
                {countries.map((country) => (
                  <option key={country.code} value={country.code} className="bg-[#1a1a1a]">
                    {country.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-white/70 mb-2">Gender</label>
            <select
              value={formData.gender}
              onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-[#309605] transition-colors"
            >
              <option value="" className="bg-[#1a1a1a]">Select your gender</option>
              <option value="male" className="bg-[#1a1a1a]">Male</option>
              <option value="female" className="bg-[#1a1a1a]">Female</option>
              <option value="other" className="bg-[#1a1a1a]">Other</option>
              <option value="prefer_not_to_say" className="bg-[#1a1a1a]">Prefer not to say</option>
            </select>
          </div>

          {/* Password Management Section */}
          <div className="border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={() => setShowPasswordSection(!showPasswordSection)}
              className="w-full flex items-center justify-between px-4 py-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-white/70" />
                <span className="text-white font-medium">Password & Security</span>
              </div>
              <span className="text-white/50 text-sm">
                {showPasswordSection ? 'Hide' : 'Manage'}
              </span>
            </button>

            {showPasswordSection && (
              <div className="mt-4 space-y-4 px-2">
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    Change Password
                  </label>
                  <div className="space-y-3">
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                      <input
                        type={showPasswords.current ? 'text' : 'password'}
                        value={passwordData.currentPassword}
                        onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                        placeholder="Current password"
                        className="w-full pl-12 pr-12 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:border-[#309605] transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasswords({ ...showPasswords, current: !showPasswords.current })}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                      >
                        {showPasswords.current ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>

                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                      <input
                        type={showPasswords.new ? 'text' : 'password'}
                        value={passwordData.newPassword}
                        onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                        placeholder="New password (min. 6 characters)"
                        className="w-full pl-12 pr-12 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:border-[#309605] transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasswords({ ...showPasswords, new: !showPasswords.new })}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                      >
                        {showPasswords.new ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>

                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                      <input
                        type={showPasswords.confirm ? 'text' : 'password'}
                        value={passwordData.confirmPassword}
                        onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                        placeholder="Confirm new password"
                        className="w-full pl-12 pr-12 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:border-[#309605] transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasswords({ ...showPasswords, confirm: !showPasswords.confirm })}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                      >
                        {showPasswords.confirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handlePasswordChange}
                      disabled={isChangingPassword}
                      className="w-full py-3 bg-[#309605] hover:bg-[#3ba208] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium text-white transition-all duration-200 flex items-center justify-center gap-2"
                    >
                      {isChangingPassword ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Changing Password...
                        </>
                      ) : (
                        'Change Password'
                      )}
                    </button>
                  </div>
                </div>

                <div className="border-t border-white/10 pt-4">
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    Forgot Password?
                  </label>
                  <p className="text-xs text-white/50 mb-3">
                    We'll send you a password reset link to {userProfile?.email}
                  </p>
                  <button
                    type="button"
                    onClick={handlePasswordReset}
                    disabled={isSendingReset}
                    className="w-full py-3 bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium text-white transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    {isSendingReset ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Sending Reset Link...
                      </>
                    ) : (
                      <>
                        <Mail className="w-5 h-5" />
                        Send Password Reset Link
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Artist Social Media Handles (Read-only) */}
          {(instagramHandle || youtubeHandle || tiktokHandle) && (
            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Artist Social Media
              </label>
              <div className="space-y-2">
                {instagramHandle && (
                  <div className="flex items-center gap-2 px-4 py-3 bg-white/5 border border-white/10 rounded-xl">
                    <Instagram className="w-4 h-4 text-pink-500" />
                    <span className="text-white/70 text-sm">@{instagramHandle}</span>
                  </div>
                )}
                {youtubeHandle && (
                  <div className="flex items-center gap-2 px-4 py-3 bg-white/5 border border-white/10 rounded-xl">
                    <Youtube className="w-4 h-4 text-red-500" />
                    <span className="text-white/70 text-sm">@{youtubeHandle}</span>
                  </div>
                )}
                {tiktokHandle && (
                  <div className="flex items-center gap-2 px-4 py-3 bg-white/5 border border-white/10 rounded-xl">
                    <TikTokIcon className="w-4 h-4 text-white" />
                    <span className="text-white/70 text-sm">@{tiktokHandle}</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-white/40 mt-1">
                Artist social media is managed from your Artist Profile
              </p>
            </div>
          )}
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full h-12 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#3ba208] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium text-white transition-all duration-200 shadow-lg flex items-center justify-center gap-2"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Changes'
          )}
        </button>
      </div>

      {/* Custom Alert Modal */}
      <CustomAlertModal
        isOpen={alertModal.isOpen}
        title={alertModal.title}
        message={alertModal.message}
        type={alertModal.type}
        onClose={closeAlert}
      />
    </div>
  );
};
