import { useState, useEffect } from 'react';
import { ArrowLeft, User, FileText, MapPin, Globe, Instagram, Youtube, Tag, Link as LinkIcon, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { countries } from '../../lib/countries';

interface Genre {
  id: string;
  name: string;
}

interface FormData {
  stage_name: string;
  full_name: string;
  bio: string;
  hometown: string;
  country: string;
  label: string;
  website: string;
  genre_id: string;
  instagram_handle: string;
  youtube_handle: string;
  tiktok_handle: string;
}

export const ArtistRegistrationScreen = (): JSX.Element => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState<FormData>({
    stage_name: '',
    full_name: '',
    bio: '',
    hometown: '',
    country: '',
    label: '',
    website: '',
    genre_id: '',
    instagram_handle: '',
    youtube_handle: '',
    tiktok_handle: '',
  });
  const [genres, setGenres] = useState<Genre[]>([]);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [userCountry, setUserCountry] = useState<string>('');
  const [canChangeCountry, setCanChangeCountry] = useState(true);
  const [daysUntilCountryChange, setDaysUntilCountryChange] = useState(0);

  useEffect(() => {
    fetchGenres();
    fetchUserData();
  }, []);

  useEffect(() => {
    if (formData.stage_name) {
      updateDisplayName(formData.stage_name);
    }
  }, [formData.stage_name]);

  const fetchGenres = async () => {
    try {
      const { data, error } = await supabase
        .from('genres')
        .select('id, name')
        .order('name', { ascending: true });

      if (error) throw error;
      setGenres(data || []);
    } catch (err) {
      console.error('Error fetching genres:', err);
      setError('Failed to load genres. Please try again.');
    }
  };

  const fetchUserData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: userData, error } = await supabase
        .from('users')
        .select('country, country_last_changed_at')
        .eq('id', session.user.id)
        .single();

      if (error) throw error;

      if (userData?.country) {
        setUserCountry(userData.country);
        setFormData(prev => ({ ...prev, country: userData.country }));

        // Check if country can be changed (14-day restriction)
        if (userData.country_last_changed_at) {
          const lastChanged = new Date(userData.country_last_changed_at);
          const now = new Date();
          const daysSinceChange = Math.floor((now.getTime() - lastChanged.getTime()) / (1000 * 60 * 60 * 24));

          if (daysSinceChange < 14) {
            setCanChangeCountry(false);
            setDaysUntilCountryChange(14 - daysSinceChange);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching user data:', err);
    }
  };

  const updateDisplayName = async (stageName: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      await supabase
        .from('users')
        .update({ display_name: stageName })
        .eq('id', session.user.id);
    } catch (err) {
      console.error('Error updating display name:', err);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const validateSocialMedia = () => {
    const { instagram_handle, youtube_handle, tiktok_handle } = formData;
    const hasSocial = instagram_handle.trim() || youtube_handle.trim() || tiktok_handle.trim();

    if (!hasSocial) {
      setError('Please provide at least one social media handle (Instagram, YouTube, or TikTok)');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!agreedToTerms) {
      setError('You must agree to the terms and conditions to continue');
      return;
    }

    if (!validateSocialMedia()) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const { data: { session }, error: authError } = await supabase.auth.getSession();

      if (authError || !session?.user) {
        throw new Error('No active session found. Please sign in again.');
      }

      const userId = session.user.id;

      const { data: existingRequest, error: checkError } = await supabase
        .from('creator_requests')
        .select('id, status')
        .eq('user_id', userId)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') {
        throw new Error(`Error checking existing request: ${checkError.message}`);
      }

      if (existingRequest) {
        if (existingRequest.status === 'pending') {
          throw new Error('You already have a pending creator request. Please wait for admin approval.');
        } else if (existingRequest.status === 'approved') {
          throw new Error('Your creator request has already been approved. You are already a creator.');
        } else if (existingRequest.status === 'rejected') {
          throw new Error('Your previous creator request was rejected. Please contact support for more information.');
        } else if (existingRequest.status === 'banned') {
          throw new Error('Your account has been suspended. Please contact support.');
        }
      }

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('email, display_name')
        .eq('id', userId)
        .single();

      if (userError || !userData) {
        throw new Error('Failed to fetch user data');
      }

      const socialLinks: any = {};

      if (formData.instagram_handle.trim()) {
        socialLinks.instagram = `https://www.instagram.com/${formData.instagram_handle.trim()}`;
      }

      if (formData.youtube_handle.trim()) {
        socialLinks.youtube = `https://www.youtube.com/@${formData.youtube_handle.trim()}`;
      }

      if (formData.tiktok_handle.trim()) {
        socialLinks.tiktok = `https://www.tiktok.com/@${formData.tiktok_handle.trim()}`;
      }

      const genreName = genres.find(g => g.id === formData.genre_id)?.name || 'Unknown';

      const { data: creatorRequestSettings, error: settingsError } = await supabase
        .from('creator_request_settings')
        .select('approval_mode')
        .eq('single_row_marker', 1)
        .maybeSingle();

      if (settingsError) {
        throw new Error(`Failed to read creator request settings: ${settingsError.message}`);
      }

      const approvalMode: 'manual' | 'automatic' =
        creatorRequestSettings?.approval_mode === 'automatic' ? 'automatic' : 'manual';

      const { data: insertedRequest, error: insertError } = await supabase
        .from('creator_requests')
        .insert({
          user_id: userId,
          artist_name: formData.stage_name,
          real_name: formData.full_name || userData.display_name || formData.stage_name,
          email: userData.email,
          phone: null,
          country: formData.country,
          genre: genreName,
          bio: formData.bio || null,
          social_links: socialLinks,
          id_document_url: null,
          cover_art_url: null,
          status: 'pending'
        })
        .select('id')
        .single();

      if (insertError) {
        throw new Error(`Failed to submit creator request: ${insertError.message}`);
      }

      if (approvalMode === 'automatic') {
        const { error: autoApproveError } = await supabase.rpc('approve_creator_request', {
          request_id: insertedRequest.id
        });

        if (autoApproveError) {
          throw new Error(`Creator request was submitted but automatic approval failed: ${autoApproveError.message}`);
        }
      }

      setSuccessMessage(
        approvalMode === 'automatic'
          ? 'Your creator access is now active. Check your Create(+) to start uploading your contents.'
          : 'Creator request submitted successfully! An admin will review your request shortly. Check your Notifications for updates.'
      );

      setTimeout(() => {
        navigate('/profile');
      }, 4000);

    } catch (err) {
      console.error('Error in artist registration:', err);

      let errorMessage = 'An error occurred during registration';

      if (err instanceof Error) {
        errorMessage = err.message;
      }

      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const TikTokIcon = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
    </svg>
  );

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav overflow-y-auto">
      <header className="w-full py-4 px-5 sticky top-0 z-20 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="p-2 hover:bg-white/10 rounded-full transition-all"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="font-bold text-lg">Become an Artist</h1>
          <div className="w-10"></div>
        </div>
      </header>

      <div className="px-5 py-6">
        <div className="mb-6">
          <p className="text-white/70 text-sm">
            Fill out the form below to create your artist profile and start sharing your music with the world.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="flex items-center gap-2 font-medium text-white/80 text-sm mb-2">
              <User className="w-4 h-4" />
              Full Name *
            </label>
            <input
              type="text"
              name="full_name"
              value={formData.full_name}
              onChange={handleInputChange}
              required
              className="w-full h-12 px-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-[#309605]/50 focus:border-[#309605]/50 transition-all duration-200"
              placeholder="Enter your full legal name"
            />
            <p className="text-white/50 text-xs mt-1">
              Your legal name as it appears on official documents
            </p>
          </div>

          <div>
            <label className="flex items-center gap-2 font-medium text-white/80 text-sm mb-2">
              <User className="w-4 h-4" />
              Stage Name *
            </label>
            <input
              type="text"
              name="stage_name"
              value={formData.stage_name}
              onChange={handleInputChange}
              required
              className="w-full h-12 px-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-[#309605]/50 focus:border-[#309605]/50 transition-allduration-200"
              placeholder="Enter your stage name"
            />
            <p className="text-white/50 text-xs mt-1">
              Your display name will automatically update to match your stage name
            </p>
          </div>

          <div>
            <label className="flex items-center gap-2 font-medium text-white/80 text-sm mb-2">
              <Tag className="w-4 h-4" />
              Genre *
            </label>
            <select
              name="genre_id"
              value={formData.genre_id}
              onChange={handleInputChange}
              required
              className="w-full h-12 px-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#309605]/50 focus:border-[#309605]/50 transition-all duration-200 appearance-none cursor-pointer"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='zhttp://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L6 6L11 1' stroke='white' stroke-opacity='0.6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 1rem center',
                backgroundSize: '12px 8px',
              }}
            >
              <option value="" disabled className="bg-[#1a1a1a]">Select your genre</option>
              {genres.map((genre) => (
                <option key={genre.id} value={genre.id} className="bg-[#1a1a1a]">
                  {genre.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="flex items-center gap-2 font-medium text-white/80 text-sm mb-2">
              <FileText className="w-4 h-4" />
              Bio
            </label>
            <textarea
              name="bio"
              value={formData.bio}
              onChange={handleInputChange}
              rows={3}
              className="w-full px-4 py-3 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-[#309605]/50 focus:border-[#309605]/50 transition-all duration-200 resize-none"
              placeholder="Tell us about yourself..."
            />
          </div>

          <div>
            <label className="flex items-center gap-2 font-medium text-white/80 text-sm mb-2">
              <MapPin className="w-4 h-4" />
              Hometown
            </label>
            <input
              type="text"
              name="hometown"
              value={formData.hometown}
              onChange={handleInputChange}
              className="w-full h-12 px-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-[#309605]/50 focus:border-[#309605]/50 transition-all duration-200"
              placeholder="Where are you from?"
            />
          </div>

          <div>
            <label className="flex items-center gap-2 font-medium text-white/80 text-sm mb-2">
              <Globe className="w-4 h-4" />
              Country
              {!canChangeCountry && (
                <span className="text-xs text-yellow-500 ml-2">
                  (Can change in {daysUntilCountryChange} days)
                </span>
              )}
            </label>
            {userCountry ? (
              <div className="relative">
                <input
                  type="text"
                  value={countries.find(c => c.code === formData.country)?.name || formData.country}
                  readOnly
                  disabled
                  className="w-full h-12 px-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white cursor-not-allowed opacity-75"
                />
                <p className="text-white/50 text-xs mt-1">
                  Country pre-filled from your profile and locked for 14 days from signup
                </p>
              </div>
            ) : (
              <>
                <div className="relative">
                  <select
                    name="country"
                    value={formData.country}
                    onChange={handleInputChange}
                    disabled={!canChangeCountry}
                    className={`w-full h-12 px-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#309605]/50 focus:border-[#309605]/50 transition-all duration-200 appearance-none ${
                      !canChangeCountry ? 'cursor-not-allowed opacity-75' : ''
                    }`}
                  >
                    <option value="" disabled className="bg-[#1a1a1a]">Select your country</option>
                    {countries.map((country) => (
                      <option key={country.code} value={country.code} className="bg-[#1a1a1a]">
                        {country.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/60 pointer-events-none" />
                </div>
                {!canChangeCountry && (
                  <p className="text-white/50 text-xs mt-1">
                    You can only change your country once every 14 days
                  </p>
                )}
              </>
            )}
          </div>

          <div>
            <label className="flex items-center gap-2 font-medium text-white/80 text-sm mb-2">
              <Tag className="w-4 h-4" />
              Label (Optional)
            </label>
            <input
              type="text"
              name="label"
              value={formData.label}
              onChange={handleInputChange}
              className="w-full h-12 px-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-[#309605]/50 focus:border-[#309605]/50 transition-all duration-200"
              placeholder="Record label name"
            />
          </div>

          <div>
            <label className="flex items-center gap-2 font-medium text-white/80 text-sm mb-2">
              <LinkIcon className="w-4 h-4" />
              Website (Optional)
            </label>
            <input
              type="url"
              name="website"
              value={formData.website}
              onChange={handleInputChange}
              className="w-full h-12 px-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-[#309605]/50 focus:border-[#309605]/50 transition-all duration-200"
              placeholder="https://yourwebsite.com"
            />
          </div>

          <div className="pt-2">
            <h3 className="font-semibold text-white text-base mb-3">
              Social Media (At least one required) *
            </h3>
            <p className="text-white/60 text-xs mb-4">
              Provide at least one social media handle
            </p>

            <div className="space-y-4">
              <div>
                <label className="flex items-center gap-2 font-medium text-white/80 text-sm mb-2">
                  <Instagram className="w-4 h-4" />
                  Instagram Handle
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/60 text-sm">
                    @
                  </span>
                  <input
                    type="text"
                    name="instagram_handle"
                    value={formData.instagram_handle}
                    onChange={handleInputChange}
                    className="w-full h-12 pl-8 pr-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-[#309605]/50 focus:border-[#309605]/50 transition-all duration-200"
                    placeholder="your_instagram_handle"
                  />
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2 font-medium text-white/80 text-sm mb-2">
                  <Youtube className="w-4 h-4" />
                  YouTube Handle
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/60 text-sm">
                    @
                  </span>
                  <input
                    type="text"
                    name="youtube_handle"
                    value={formData.youtube_handle}
                    onChange={handleInputChange}
                    className="w-full h-12 pl-8 pr-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-[#309605]/50 focus:border-[#309605]/50 transition-all duration-200"
                    placeholder="your_youtube_handle"
                  />
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2 font-medium text-white/80 text-sm mb-2">
                  <TikTokIcon className="w-4 h-4" />
                  TikTok Handle
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/60 text-sm">
                    @
                  </span>
                  <input
                    type="text"
                    name="tiktok_handle"
                    value={formData.tiktok_handle}
                    onChange={handleInputChange}
                    className="w-full h-12 pl-8 pr-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-[#309605]/50 focus:border-[#309605]/50 transition-all duration-200"
                    placeholder="your_tiktok_handle"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="pt-2">
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative flex-shrink-0 mt-0.5">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-5 h-5 rounded border-2 transition-all duration-200 ${
                  agreedToTerms
                    ? 'bg-[#309605] border-[#309605]'
                    : 'border-white/40 group-hover:border-white/60'
                }`}>
                  {agreedToTerms && (
                    <svg className="w-3 h-3 text-white absolute top-0.5 left-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              </div>
              <span className="text-white/80 text-sm leading-relaxed group-hover:text-white transition-colors duration-200">
                By checking this box, you agree to our{' '}
                <button
                  type="button"
                  onClick={() => navigate('/terms/artist-registration')}
                  className="text-[#309605] hover:text-[#00c483] underline cursor-pointer"
                >
                  Terms and Conditions
                </button>
              </span>
            </label>
          </div>

          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-green-500/20 border border-green-500/30 rounded-lg">
              <p className="text-green-400 text-sm">{successMessage}</p>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex-1 h-12 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl font-medium text-white transition-all duration-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !formData.stage_name.trim() || !formData.genre_id || !agreedToTerms}
              className="flex-1 h-12 bg-gradient-to-r from-[#309605] to-[#00c483] hover:from-[#00c483] hover:to-[#309605] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium text-white transition-all duration-200 shadow-lg shadow-[#309605]/25"
            >
              {isSubmitting ? 'Creating...' : 'Become Artist'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
