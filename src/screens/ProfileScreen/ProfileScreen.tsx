import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { AuthModal } from '../../components/AuthModal';
import { HelpSupportModal } from '../../components/HelpSupportModal';
import { NotificationSettingsModal } from '../../components/NotificationSettingsModal';
import { PrivacySettingsModal } from '../../components/PrivacySettingsModal';
import { AccountDeletionModal } from '../../components/AccountDeletionModal';
import { PurchaseTreatsModal } from '../../components/PurchaseStreatsModal';
import { TippingModal } from '../../components/TippingModal';
import { TreatPromotionModal } from '../../components/TreatPromotionModal';
import { TreatWithdrawalModal } from '../../components/TreatWithdrawalModal';
import { Top1PercentClub } from '../../components/Top1PercentClub';
import { AnalyticsTab } from './AnalyticsTab';
import { AccountProfileHero, AccountProfileSkeleton } from './AccountProfileHero';
import {
  AccountSettingsTabs,
  AccountTabContent,
  EarningsTabPanel,
  type AccountTabId,
} from './AccountSettingsUi';
import { countries } from '../../lib/countries';
import {
  supabase,
  getArtistProfile,
  getArtistSocialLinks,
  getFollowerCount,
  getFollowingCount,
  CREATOR_ACCESS_CHANGED_EVENT,
  fetchOwnUserProfile,
} from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { useTabPersistence } from '../../hooks/useTabPersistence';
import { useProfileHeaderScroll } from '../../hooks/useProfileHeaderScroll';
import { useProfileHeroUpload } from '../../hooks/useProfileHeroUpload';
import { useProfileAvatarUpload } from '../../hooks/useProfileAvatarUpload';
import { persistentCache } from '../../lib/persistentCache';
import {
  clearProfileSession,
  readProfileSession,
  writeProfileSession,
} from '../../lib/profileSessionCache';
import { useMusicPlayer } from '../../contexts/MusicPlayerContext';
import { useAuth } from '../../contexts/AuthContext';
import { fetchEarningsWithdrawalSettings } from '../../lib/earningsWithdrawalSettings';
import { resolveProfileAvatarUrl } from '../PublicProfileScreen/profileUiUtils';

export interface ProfileScreenProps {
  onFormVisibilityChange?: (isVisible: boolean) => void;
}

interface UserProfile {
  id: string;
  email: string;
  display_name?: string;
  role: string;
  bio?: string;
  country?: string;
  username?: string;
  wallet_address?: string;
  total_earnings?: number;
  avatar_url?: string;
  background_image_url?: string;
  show_artist_badge?: boolean;
  username_changed?: boolean;
  receive_new_follower_notifications?: boolean;
  receive_content_notifications?: boolean;
  receive_playlist_notifications?: boolean;
  receive_system_notifications?: boolean;
  email_notifications?: boolean;
  push_notifications?: boolean;
  notification_sound?: boolean;
  quiet_hours_enabled?: boolean;
  show_listening_history?: boolean;
  profile_visibility?: string;
}

interface ArtistProfile {
  id: string;
  stage_name: string;
  bio?: string;
  hometown?: string;
  country?: string;
  profile_photo_url?: string;
  is_verified?: boolean;
  artist_id?: string;
}

interface SocialLink {
  id: string;
  platform: string;
  handle: string;
  url: string;
}

interface WithdrawalHistoryItem {
  id: string;
  amount: number | null;
  net_amount: number | null;
  currency_code: string | null;
  currency_symbol: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  requested_date: string | null;
  request_date?: string | null;
  created_at?: string | null;
  processed_date: string | null;
  payment_reference: string | null;
  method_type: 'usdt_wallet' | 'bank_account' | null;
}

export const ProfileScreen = ({
  onFormVisibilityChange,
}: ProfileScreenProps): JSX.Element => {
  const navigate = useNavigate();
  const { containerRef } = useTabPersistence('profile-screen');
  const { hideMiniPlayer, hideFullPlayer } = useMusicPlayer();
  const { signOut: authSignOut, isAuthenticated: authIsAuthenticated, isInitialized, user } = useAuth();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(() => {
    const uid = user?.id;
    if (!uid) return null;
    return (readProfileSession(uid)?.userProfile as UserProfile | undefined) ?? null;
  });
  const [artistProfile, setArtistProfile] = useState<ArtistProfile | null>(() => {
    const uid = user?.id;
    if (!uid) return null;
    return (readProfileSession(uid)?.artistProfile as ArtistProfile | undefined) ?? null;
  });
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>(() => {
    const uid = user?.id;
    if (!uid) return [];
    return (readProfileSession(uid)?.socialLinks as SocialLink[] | undefined) ?? [];
  });
  const [followerCount, setFollowerCount] = useState(() => {
    const uid = user?.id;
    if (!uid) return 0;
    return readProfileSession(uid)?.followerCount ?? 0;
  });
  const [followingCount, setFollowingCount] = useState(() => {
    const uid = user?.id;
    if (!uid) return 0;
    return readProfileSession(uid)?.followingCount ?? 0;
  });
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(() => {
    const uid = user?.id;
    if (!uid) return true;
    return !readProfileSession(uid)?.userProfile;
  });
  const [isLoadingUserProfile, setIsLoadingUserProfile] = useState(() => {
    const uid = user?.id;
    if (!uid) return true;
    return !readProfileSession(uid)?.userProfile;
  });
  const [isLoadingArtistData, setIsLoadingArtistData] = useState(false);
  const [isLoadingCounts, setIsLoadingCounts] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalDismissed, setAuthModalDismissed] = useState(false);
  const [showArtistForm, setShowArtistForm] = useState(false);
  const [showHelpSupportModal, setShowHelpSupportModal] = useState(false);
  const [showNotificationSettingsModal, setShowNotificationSettingsModal] =
    useState(false);
  const [showPrivacySettingsModal, setShowPrivacySettingsModal] =
    useState(false);
  const [showAccountDeletionModal, setShowAccountDeletionModal] = useState(false);
  const [showPurchaseTreatsModal, setShowPurchaseTreatsModal] = useState(false);
  const [showTippingModal, setShowTippingModal] = useState(false);
  const [showTreatPromotionModal, setShowTreatPromotionModal] = useState(false);
  const [showTreatWithdrawalModal, setShowTreatWithdrawalModal] =
    useState(false);
  const [activeTab, setActiveTab] = useState<AccountTabId>('account');
  const [bioExpanded, setBioExpanded] = useState(false);
  const [useCoverGradient, setUseCoverGradient] = useState(false);
  const [verifiedBadgeUrl, setVerifiedBadgeUrl] = useState<string | null>(null);
  const [admobRevenueStatus, setAdmobRevenueStatus] = useState<{
    ready: boolean;
    message: string;
    has_successful_sync: boolean;
  } | null>(null);
  const [withdrawalHistory, setWithdrawalHistory] = useState<WithdrawalHistoryItem[]>([]);
  const [isLoadingWithdrawalHistory, setIsLoadingWithdrawalHistory] = useState(false);
  const [earningsWithdrawalMin, setEarningsWithdrawalMin] = useState(10);
  const profileLoadInFlightRef = useRef(false);
  const withdrawalLoadInFlightRef = useRef(false);
  const lastProfileLoadAtRef = useRef(0);
  const lastWithdrawalLoadAtRef = useRef(0);
  const headerProgress = useProfileHeaderScroll(containerRef, !!userProfile);

  const isDev = typeof import.meta !== 'undefined' && !!import.meta.env?.DEV;
  const canSeeInternalRevenueStatus = isDev && userProfile?.role === 'admin';

  const getEarningsStatusMessage = (): string | null => {
    if (!admobRevenueStatus || admobRevenueStatus.ready) return null;

    // Never show internal/implementation messages to end-users.
    // Backend RPCs may return operational strings (e.g. AdMob config issues) that are not user-facing.
    const defaultUserMessage = 'Earnings will appear once confirmed';

    if (canSeeInternalRevenueStatus) {
      return admobRevenueStatus.message || defaultUserMessage;
    }

    return defaultUserMessage;
  };

  const applyProfileBundle = (cached: {
    userProfile: UserProfile;
    artistProfile: ArtistProfile | null;
    socialLinks: SocialLink[];
    followerCount: number;
    followingCount: number;
  }) => {
    setUserProfile(cached.userProfile);
    setArtistProfile(cached.artistProfile);
    setSocialLinks(cached.socialLinks || []);
    setFollowerCount(cached.followerCount || 0);
    setFollowingCount(cached.followingCount || 0);
    setIsLoading(false);
    setIsLoadingUserProfile(false);
    setIsLoadingArtistData(false);
    setIsLoadingCounts(false);
    if (user?.id) {
      writeProfileSession(user.id, cached);
    }
  };

  // Handle form visibility changes (exclude auth modal - it's handled globally)
  useEffect(() => {
    const isAnyModalOpen =
      showArtistForm ||
      showHelpSupportModal ||
      showNotificationSettingsModal ||
      showPrivacySettingsModal ||
      showAccountDeletionModal ||
      showPurchaseTreatsModal ||
      showTippingModal ||
      showTreatPromotionModal ||
      showTreatWithdrawalModal;
    onFormVisibilityChange?.(isAnyModalOpen);
  }, [
    showArtistForm,
    showHelpSupportModal,
    showNotificationSettingsModal,
    showPrivacySettingsModal,
    showAccountDeletionModal,
    showPurchaseTreatsModal,
    showTippingModal,
    showTreatPromotionModal,
    showTreatWithdrawalModal,
    onFormVisibilityChange,
  ]);

  useEffect(() => {
    if (authIsAuthenticated && user?.id) {
      void loadProfileData();
      void loadAdmobRevenueStatus();
      void loadWithdrawalHistory();
    } else if (!authIsAuthenticated && isInitialized) {
      clearProfileSession();
      setUserProfile(null);
      setArtistProfile(null);
      setSocialLinks([]);
      setFollowerCount(0);
      setFollowingCount(0);
      setWithdrawalHistory([]);
      setIsLoading(false);
    }
  }, [authIsAuthenticated, isInitialized, user?.id]);

  useLayoutEffect(() => {
    if (!user?.id || userProfile) return;
    const session = readProfileSession(user.id);
    if (!session?.userProfile) return;
    applyProfileBundle({
      userProfile: session.userProfile as UserProfile,
      artistProfile: session.artistProfile as ArtistProfile | null,
      socialLinks: (session.socialLinks as SocialLink[]) || [],
      followerCount: session.followerCount || 0,
      followingCount: session.followingCount || 0,
    });
  }, [user?.id, userProfile]);

  useEffect(() => {
    const handleFocus = () => {
      if (authIsAuthenticated && user) {
        void loadProfileData();
        void loadWithdrawalHistory();
      }
    };
    const handleVisibilityChange = () => {
      if (!document.hidden && authIsAuthenticated && user) {
        void loadProfileData();
        void loadWithdrawalHistory();
      }
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authIsAuthenticated, user]);

  useEffect(() => {
    const onCreatorAccessChanged = () => {
      void loadProfileData({ force: true });
    };
    window.addEventListener(CREATOR_ACCESS_CHANGED_EVENT, onCreatorAccessChanged);
    return () => window.removeEventListener(CREATOR_ACCESS_CHANGED_EVENT, onCreatorAccessChanged);
  }, [authIsAuthenticated, user?.id]);

  // Ensure withdrawal history refreshes when the user views the earnings tab.
  // (Tab persistence can keep this screen mounted while routing elsewhere.)
  useEffect(() => {
    if (authIsAuthenticated && user && activeTab === 'earnings') {
      // Earnings tab needs fresh withdrawal timeline; avoid redundant full profile refresh.
      void loadWithdrawalHistory({ force: true });
    }
  }, [authIsAuthenticated, user?.id, activeTab]);

  useEffect(() => {
    if (!userProfile?.role) return;
    fetchEarningsWithdrawalSettings(userProfile.role).then((settings) => {
      setEarningsWithdrawalMin(settings.minimumWithdrawalUsd);
    });
  }, [userProfile?.role]);

  useEffect(() => {
    supabase
      .from('verified_badge_config' as any)
      .select('badge_url')
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) setVerifiedBadgeUrl((data as { badge_url: string }).badge_url);
      });
  }, []);

  const handleAvatarUploadSuccess = useCallback(async (nextAvatarUrl: string) => {
    if (!user?.id) return;

    setUserProfile((prev) => {
      if (!prev) return prev;
      return { ...prev, avatar_url: nextAvatarUrl };
    });

    setArtistProfile((prev) => {
      if (!prev) return prev;
      return { ...prev, profile_photo_url: nextAvatarUrl };
    });

    const session = readProfileSession(user.id);
    if (session) {
      const bundle = {
        ...session,
        userProfile: {
          ...(session.userProfile as UserProfile),
          avatar_url: nextAvatarUrl,
        },
        artistProfile: session.artistProfile
          ? { ...(session.artistProfile as ArtistProfile), profile_photo_url: nextAvatarUrl }
          : session.artistProfile,
      };
      writeProfileSession(user.id, bundle);
      await persistentCache.set(`profile-data:${user.id}`, bundle, 10 * 60 * 1000);
    }
  }, [user?.id]);

  const handleAvatarUploadError = useCallback((message: string) => {
    alert(message);
  }, []);

  const {
    avatarInputRef,
    isAvatarUploading,
    avatarPreviewUrl,
    triggerAvatarUpload,
    handleAvatarFileChange,
  } = useProfileAvatarUpload({
    userId: user?.id,
    onSuccess: handleAvatarUploadSuccess,
    onError: handleAvatarUploadError,
  });

  const handleHeroUploadSuccess = useCallback(async (backgroundImageUrl: string) => {
    if (!user?.id) return;

    setUserProfile((prev) => {
      if (!prev) return prev;
      return { ...prev, background_image_url: backgroundImageUrl };
    });
    setUseCoverGradient(false);

    const session = readProfileSession(user.id);
    if (session) {
      const bundle = {
        ...session,
        userProfile: {
          ...(session.userProfile as UserProfile),
          background_image_url: backgroundImageUrl,
        },
      };
      writeProfileSession(user.id, bundle);
      await persistentCache.set(`profile-data:${user.id}`, bundle, 10 * 60 * 1000);
    }
  }, [user?.id]);

  const handleHeroUploadError = useCallback((message: string) => {
    alert(message);
  }, []);

  const {
    heroInputRef,
    isHeroUploading,
    heroPreviewUrl,
    triggerHeroUpload,
    handleHeroFileChange,
  } = useProfileHeroUpload({
    userId: user?.id,
    onSuccess: handleHeroUploadSuccess,
    onError: handleHeroUploadError,
  });

  const avatarUrl = resolveProfileAvatarUrl(
    avatarPreviewUrl,
    userProfile?.avatar_url,
    artistProfile?.profile_photo_url,
  );

  const heroUrl =
    !useCoverGradient && (heroPreviewUrl || userProfile?.background_image_url)
      ? heroPreviewUrl || userProfile?.background_image_url
      : null;

  useEffect(() => {
    setUseCoverGradient(false);
    setBioExpanded(false);
  }, [userProfile?.background_image_url, userProfile?.avatar_url, artistProfile?.profile_photo_url, userProfile?.id, heroPreviewUrl, avatarPreviewUrl]);

  // Realtime subscription for Live Balance updates
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`users:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'users',
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          if (!payload.new) return;

          if ('total_earnings' in payload.new) {
            setUserProfile((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                total_earnings: payload.new.total_earnings,
              };
            });
          }

          if ('role' in payload.new) {
            const nextRole = payload.new.role as string;
            setUserProfile((prev) => {
              if (!prev || prev.role === nextRole) return prev;
              return { ...prev, role: nextRole };
            });
            if (nextRole === 'creator' || nextRole === 'admin') {
              void loadProfileData({ force: true });
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // Navigate to artist registration screen
  useEffect(() => {
    if (showArtistForm) {
      navigate('/become-artist');
      setShowArtistForm(false);
    }
  }, [showArtistForm, navigate]);

  // Auto-open auth modal for unauthenticated users (only if not dismissed)
  useEffect(() => {
    if (isInitialized && !authIsAuthenticated && !showAuthModal && !authModalDismissed) {
      setShowAuthModal(true);
    }
  }, [isInitialized, authIsAuthenticated]);

  useEffect(() => {
    if (!isInitialized) return;
    if (!authIsAuthenticated && authModalDismissed) {
      navigate('/');
    }
  }, [isInitialized, authIsAuthenticated, authModalDismissed, navigate]);

  const loadProfileData = async (opts?: { force?: boolean }) => {
    if (!user?.id) return;
    const now = Date.now();
    if (!opts?.force && profileLoadInFlightRef.current) return;
    if (!opts?.force && now - lastProfileLoadAtRef.current < 2500) return;
    profileLoadInFlightRef.current = true;
    lastProfileLoadAtRef.current = now;

    const cacheKey = `profile-data:${user.id}`;

    try {
      if (opts?.force) {
        const hasVisibleData = Boolean(userProfile) || Boolean(readProfileSession(user.id));
        if (hasVisibleData) {
          await fetchFreshProfileData(true);
          return;
        }
      }

      const sessionCached = !opts?.force ? readProfileSession(user.id) : null;
      const persistCached =
        !opts?.force && !sessionCached
          ? await persistentCache.get<{
              userProfile: UserProfile;
              artistProfile: ArtistProfile | null;
              socialLinks: SocialLink[];
              followerCount: number;
              followingCount: number;
            }>(cacheKey)
          : null;
      const cached = sessionCached ?? persistCached;

      if (cached?.userProfile) {
        applyProfileBundle({
          userProfile: cached.userProfile as UserProfile,
          artistProfile: (cached.artistProfile as ArtistProfile | null) ?? null,
          socialLinks: (cached.socialLinks as SocialLink[]) || [],
          followerCount: cached.followerCount || 0,
          followingCount: cached.followingCount || 0,
        });

        setTimeout(async () => {
          try {
            const [userEarningsResult, artistDataResult, countsResult] = await Promise.allSettled([
              (async () => {
                const { data, error } = await supabase
                  .from('users')
                  .select('total_earnings')
                  .eq('id', user.id)
                  .single();
                if (error) throw error;
                return data as { total_earnings: number | null };
              })(),
              (async () => {
                const profile = await getArtistProfile();
                let links: SocialLink[] = [];
                if (profile) {
                  links = await getArtistSocialLinks(profile.id);
                }
                return { profile, links };
              })(),
              (async () => {
                const [followers, following] = await Promise.all([
                  getFollowerCount(user.id),
                  getFollowingCount(user.id),
                ]);
                return { followers, following };
              })()
            ]);

            if (userEarningsResult.status === 'fulfilled') {
              const freshTotal = userEarningsResult.value.total_earnings ?? 0;
              setUserProfile((prev) => {
                if (!prev) return prev;
                if ((prev.total_earnings ?? 0) === freshTotal) return prev;
                return { ...prev, total_earnings: freshTotal };
              });
            }

            if (artistDataResult.status === 'fulfilled') {
              const { profile, links } = artistDataResult.value;
              if (profile && JSON.stringify(profile) !== JSON.stringify(cached.artistProfile)) {
                setArtistProfile(profile);
              }
              if (JSON.stringify(links) !== JSON.stringify(cached.socialLinks)) {
                setSocialLinks(links || []);
              }
            }

            if (countsResult.status === 'fulfilled') {
              const { followers, following } = countsResult.value;
              const cachedUserProfile = cached.userProfile as UserProfile;
              if (followers !== cached.followerCount) setFollowerCount(followers);
              if (following !== cached.followingCount) setFollowingCount(following);

              const refreshedBundle = {
                userProfile: {
                  ...cachedUserProfile,
                  total_earnings:
                    userEarningsResult.status === 'fulfilled'
                      ? (userEarningsResult.value.total_earnings ?? 0)
                      : (cachedUserProfile.total_earnings ?? 0),
                },
                artistProfile: artistDataResult.status === 'fulfilled' ? artistDataResult.value.profile : cached.artistProfile,
                socialLinks: artistDataResult.status === 'fulfilled' ? artistDataResult.value.links : cached.socialLinks,
                followerCount: followers,
                followingCount: following,
              };

              await persistentCache.set(cacheKey, refreshedBundle, 10 * 60 * 1000);
              writeProfileSession(user.id, refreshedBundle);
            }
          } catch (error) {
            console.error('Background refresh failed:', error);
          }
        }, 100);

        return;
      }

      setIsLoading(true);
      setIsLoadingUserProfile(true);
      setIsLoadingArtistData(false);
      setIsLoadingCounts(false);
      await fetchFreshProfileData(false);
    } catch (error) {
      console.error('Error loading profile:', error);
      setIsLoading(false);
      setIsLoadingUserProfile(false);
    } finally {
      profileLoadInFlightRef.current = false;
    }
  };

  const loadAdmobRevenueStatus = async () => {
    try {
      const { data, error } = await supabase.rpc('get_admob_revenue_status');
      if (error) throw error;
      setAdmobRevenueStatus(data);
    } catch (error) {
      console.error('Error loading AdMob revenue status:', error);
      setAdmobRevenueStatus({ ready: false, message: 'Unable to check revenue status', has_successful_sync: false });
    }
  };

  const fetchFreshProfileData = async (backgroundRefresh: boolean = false) => {
    if (!user?.id) return;

    if (!backgroundRefresh) {
      await persistentCache.delete(`profile-data:${user.id}`);
    }

    // Step 1: Load user profile first (critical data)
    setProfileLoadError(null);
    const { data: userData, error: userError } = await fetchOwnUserProfile();

    if (userError) {
      console.error('Error fetching user profile:', userError);
      setProfileLoadError(userError.message || 'Failed to load profile');
      setIsLoadingUserProfile(false);
    } else {
      setUserProfile(userData as UserProfile);
      setIsLoadingUserProfile(false);
    }

    // Step 2 & 3: Load artist data and counts in parallel (non-critical)
    if (!backgroundRefresh) {
      setIsLoadingArtistData(true);
      setIsLoadingCounts(true);
    }

    const [artistDataResult, countsResult] = await Promise.allSettled([
      // Artist data loading
      (async () => {
        try {
          const profile = await getArtistProfile();
          let links: SocialLink[] = [];
          if (profile) {
            links = await getArtistSocialLinks(profile.id);
          }
          return { profile, links };
        } catch (error) {
          console.error('Error loading artist data:', error);
          return { profile: null, links: [] };
        }
      })(),
      // Counts loading
      (async () => {
        try {
          const [followers, following] = await Promise.all([
            getFollowerCount(user.id),
            getFollowingCount(user.id),
          ]);
          return { followers, following };
        } catch (error) {
          console.error('Error loading counts:', error);
          return { followers: 0, following: 0 };
        }
      })()
    ]);

    // Update artist data
    if (artistDataResult.status === 'fulfilled') {
      const { profile, links } = artistDataResult.value;
      if (profile) {
        setArtistProfile(profile);
        setSocialLinks(links || []);
      }
    }
    setIsLoadingArtistData(false);

    // Update counts
    if (countsResult.status === 'fulfilled') {
      const { followers, following } = countsResult.value;
      setFollowerCount(followers);
      setFollowingCount(following);
    }
    setIsLoadingCounts(false);

    // Cache the complete data (reuse already-fetched data)
    if (userData) {
      const profile = artistDataResult.status === 'fulfilled' ? artistDataResult.value.profile : null;
      const links = artistDataResult.status === 'fulfilled' ? artistDataResult.value.links : [];
      const followers = countsResult.status === 'fulfilled' ? countsResult.value.followers : 0;
      const following = countsResult.status === 'fulfilled' ? countsResult.value.following : 0;

      const bundle = {
        userProfile: userData,
        artistProfile: profile,
        socialLinks: links,
        followerCount: followers,
        followingCount: following,
      };

      await persistentCache.set(`profile-data:${user.id}`, bundle, 10 * 60 * 1000);
      writeProfileSession(user.id, bundle);
    }

    setIsLoading(false);
  };

  const loadWithdrawalHistory = async (opts?: { force?: boolean }) => {
    if (!user?.id) return;
    const now = Date.now();
    if (!opts?.force && withdrawalLoadInFlightRef.current) return;
    if (!opts?.force && now - lastWithdrawalLoadAtRef.current < 2500) return;
    withdrawalLoadInFlightRef.current = true;
    lastWithdrawalLoadAtRef.current = now;
    try {
      setIsLoadingWithdrawalHistory(true);
      const retentionCutoffMs = Date.now() - 45 * 24 * 60 * 60 * 1000;
      // Use a resilient fetch strategy:
      // - Prefer ordering by `request_date` (canonical in the base table)
      // - Fall back to `created_at` ordering if needed
      // - Keep select('*') to avoid schema-drift failures
      let data: any[] | null = null;
      let error: any = null;

      {
        const res = await supabase
          .from('withdrawal_requests')
          .select('*')
          .eq('user_id', user.id)
          .order('request_date', { ascending: false })
          .limit(50);
        data = res.data as any[] | null;
        error = res.error;
      }

      if (error) {
        const res = await supabase
          .from('withdrawal_requests')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50);
        data = res.data as any[] | null;
        error = res.error;
      }

      if (error) throw error;

      const normalized = ((data || []) as any[])
        .map((row) => {
          const effectiveDate =
            row.request_date ||
            row.requested_date ||
            row.created_at ||
            null;

          return {
            id: row.id,
            amount: row.net_amount ?? row.amount ?? null,
            net_amount: row.net_amount ?? null,
            currency_code: row.currency_code ?? null,
            currency_symbol: row.currency_symbol ?? null,
            status: row.status,
            requested_date: effectiveDate,
            processed_date: row.processed_date ?? null,
            payment_reference: row.payment_reference ?? null,
            method_type: row.method_type ?? null,
          } as WithdrawalHistoryItem;
        })
        .filter((row) => {
          if (!row.requested_date) return false;
          const ts = new Date(row.requested_date).getTime();
          return !Number.isNaN(ts) && ts >= retentionCutoffMs;
        })
        .sort((a, b) => {
          const aTs = new Date(a.requested_date || 0).getTime();
          const bTs = new Date(b.requested_date || 0).getTime();
          return bTs - aTs;
        })
        .slice(0, 10);

      if ((data || []).length > 0 && normalized.length === 0) {
        const sample = (data as any[])[0];
        console.warn('Withdrawal history: rows fetched but filtered out', {
          sampleStatus: sample?.status,
          sampleRequestDate: sample?.request_date ?? sample?.requested_date ?? null,
          sampleCreatedAt: sample?.created_at ?? null,
          retentionCutoffMs,
        });
      }

      setWithdrawalHistory(normalized);
    } catch (error) {
      console.error('Error loading withdrawal history:', error);
      setWithdrawalHistory([]);
    } finally {
      setIsLoadingWithdrawalHistory(false);
      withdrawalLoadInFlightRef.current = false;
    }
  };

  const formatWithdrawalAmount = (row: WithdrawalHistoryItem): string => {
    const amount = row.net_amount ?? row.amount ?? 0;
    // `net_amount`/`amount` are stored as USD in our withdrawal system.
    // Some rows also store the user's local currency symbol (e.g. â‚¦) for `amount_local`,
    // but this UI is currently rendering the USD amount, so force '$' here.
    const symbol = '$';
    return `${symbol}${Number(amount).toFixed(2)}`;
  };

  const formatWithdrawalDate = (value: string | null): string => {
    if (!value) return 'â€”';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return 'â€”';
    return dt.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const handleSignOut = async () => {
    try {
      setIsSigningOut(true);
      hideMiniPlayer();
      hideFullPlayer();
      clearProfileSession();

      // Navigate immediately to prevent showing "Anonymous User"
      navigate('/', { replace: true });

      // Clear state after navigation to prevent flash
      setUserProfile(null);
      setArtistProfile(null);
      setSocialLinks([]);
      setFollowerCount(0);
      setFollowingCount(0);

      await authSignOut();
    } catch (error) {
      console.error('Error during sign out:', error);
      setUserProfile(null);
      setArtistProfile(null);
      setSocialLinks([]);
      setFollowerCount(0);
      setFollowingCount(0);
    } finally {
      setIsSigningOut(false);
    }
  };


  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    void loadProfileData({ force: true });
  };

  const handleNotificationSettingsPatch = (
    patch: Partial<UserProfile>,
  ) => {
    setUserProfile((prev) => (prev ? { ...prev, ...patch } : prev));
    if (!user?.id) return;
    void persistentCache.get<any>(`profile-data:${user.id}`).then((cached) => {
      if (!cached?.userProfile) return;
      return persistentCache.set(
        `profile-data:${user.id}`,
        {
          ...cached,
          userProfile: { ...cached.userProfile, ...patch },
        },
        10 * 60 * 1000,
      );
    });
  };

  const handleNotificationSettingsSuccess = () => {
    setShowNotificationSettingsModal(false);
    void loadProfileData({ force: true });
  };

  const handlePrivacySettingsSuccess = () => {
    setShowPrivacySettingsModal(false);
    void loadProfileData({ force: true });
  };

  const handleTreatModalSuccess = () => {
    void loadProfileData({ force: true });
  };

  const handleViewPublicProfile = () => {
    if (userProfile?.id) {
      navigate(`/user/${userProfile.id}`);
    }
  };

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  const countryLabel = userProfile?.country
    ? countries.find((c) => c.code === userProfile.country)?.name ?? userProfile.country
    : null;

  const displayName =
    userProfile?.display_name ||
    userProfile?.username ||
    user?.email?.split('@')[0] ||
    '';
  const displayInitial = (displayName.charAt(0) || user?.email?.charAt(0) || 'U').toUpperCase();
  const isCreator = userProfile?.role === 'creator' || userProfile?.role === 'admin';
  const isListener = userProfile?.role === 'listener';
  const earningsStatusMessage = getEarningsStatusMessage();
  const showEarningsPendingNote =
    !!admobRevenueStatus &&
    !admobRevenueStatus.ready &&
    (userProfile?.total_earnings ?? 0) > 0;

  // Show UI immediately, don't block on loading
  if (!userProfile && isLoading) {
    // Still loading initial data, show minimal UI
  }

  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0a0a0a] content-with-nav">
        {null}
      </div>
    );
  }

  if (isLoading && !userProfile) {
    return <AccountProfileSkeleton />;
  }

  if (!userProfile && profileLoadError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen min-h-[100dvh] bg-[#0a0a0a] text-white content-with-nav px-6 text-center gap-4">
        <p className="text-sm text-white/70">{profileLoadError}</p>
        <button
          type="button"
          onClick={() => void loadProfileData({ force: true })}
          className="px-4 py-2 rounded-lg bg-[#00ad74] text-black text-sm font-semibold"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!authIsAuthenticated) {
    if (authModalDismissed) {
      return <div />;
    }

    return (
      <>
        <div className="flex items-center justify-center min-h-screen bg-[#0a0a0a] content-with-nav">
          {null}
        </div>
        {showAuthModal && (
          <AuthModal
            onClose={(reason) => {
              setShowAuthModal(false);
              if (reason !== 'terms') {
                setAuthModalDismissed(true);
              }
              onFormVisibilityChange?.(false);
              if (reason !== 'terms') {
                navigate('/');
              }
            }}
            onSuccess={handleAuthSuccess}
          />
        )}
      </>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col min-h-screen min-h-[100dvh] bg-[#0a0a0a] text-white overflow-y-auto content-with-nav font-['Inter',sans-serif]"
    >
      <AccountProfileHero
        displayName={displayName}
        displayInitial={displayInitial}
        username={userProfile?.username}
        avatarUrl={avatarUrl}
        heroUrl={heroUrl ?? undefined}
        bio={userProfile?.bio}
        countryLabel={countryLabel}
        role={userProfile?.role}
        isCreator={isCreator}
        isVerified={!!artistProfile?.is_verified}
        verifiedBadgeUrl={verifiedBadgeUrl}
        followerCount={followerCount}
        followingCount={followingCount}
        socialLinks={socialLinks}
        isLoadingUserProfile={isLoadingUserProfile}
        isLoadingCounts={isLoadingCounts}
        isLoadingArtistData={isLoadingArtistData}
        isSigningOut={isSigningOut}
        headerProgress={headerProgress}
        bioExpanded={bioExpanded}
        onBioExpandedChange={setBioExpanded}
        onBack={handleBack}
        onSignOut={handleSignOut}
        onEditProfile={() => navigate('/edit-profile')}
        onEditAvatar={triggerAvatarUpload}
        isAvatarUploading={isAvatarUploading}
        onViewPublicProfile={handleViewPublicProfile}
        onHeroError={() => setUseCoverGradient(true)}
        canEditHero
        onEditHero={triggerHeroUpload}
        isHeroUploading={isHeroUploading}
        tabsSlot={
          <AccountSettingsTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            isCreator={userProfile?.role === 'creator'}
          />
        }
      />

      <div className="profile-safe-x px-5 pb-10 max-w-lg mx-auto w-full">
        <AccountTabContent
          activeTab={activeTab}
          isCreator={isCreator}
          isListener={isListener}
          userId={userProfile?.id}
          userRole={userProfile?.role}
          artistProfileId={artistProfile?.id}
          onNavigate={navigate}
          onShowNotificationSettings={() => setShowNotificationSettingsModal(true)}
          onShowPrivacySettings={() => setShowPrivacySettingsModal(true)}
          onShowHelpSupport={() => setShowHelpSupportModal(true)}
          onShowAccountDeletion={() => setShowAccountDeletionModal(true)}
          onShowArtistForm={() => setShowArtistForm(true)}
          onSignOut={handleSignOut}
          topFansSlot={
            <Top1PercentClub
              userId={userProfile?.id}
              userRole={userProfile?.role}
              artistProfileId={artistProfile?.id}
              initialView={userProfile?.role === 'creator' ? 'fans' : 'artists'}
            />
          }
          analyticsSlot={
            userProfile?.role === 'creator' ? <AnalyticsTab /> : null
          }
          earningsSlot={
            <EarningsTabPanel
              totalEarnings={userProfile?.total_earnings ?? 0}
              earningsWithdrawalMin={earningsWithdrawalMin}
              earningsStatusMessage={
                admobRevenueStatus &&
                !admobRevenueStatus.ready &&
                (userProfile?.total_earnings ?? 0) === 0
                  ? earningsStatusMessage
                  : null
              }
              showEarningsPendingNote={showEarningsPendingNote}
              userId={user?.id}
              withdrawalHistory={withdrawalHistory}
              isLoadingWithdrawalHistory={isLoadingWithdrawalHistory}
              onWithdraw={() => navigate('/withdraw-earnings')}
              onEarningsConverted={(payoutUsd) => {
                setUserProfile((prev) =>
                  prev
                    ? { ...prev, total_earnings: (prev.total_earnings ?? 0) + payoutUsd }
                    : prev
                );
              }}
              formatWithdrawalAmount={formatWithdrawalAmount}
              formatWithdrawalDate={formatWithdrawalDate}
            />
          }
        />
      </div>

      {/* Modals */}
      {showHelpSupportModal && (
        <HelpSupportModal onClose={() => setShowHelpSupportModal(false)} />
      )}
      {showNotificationSettingsModal && userProfile && (
        <NotificationSettingsModal
          onClose={() => setShowNotificationSettingsModal(false)}
          onSuccess={handleNotificationSettingsSuccess}
          onSettingsUpdated={handleNotificationSettingsPatch}
          userProfile={userProfile}
        />
      )}
      {showPrivacySettingsModal && (
        <PrivacySettingsModal
          onClose={() => setShowPrivacySettingsModal(false)}
          onSuccess={handlePrivacySettingsSuccess}
          userProfile={userProfile}
        />
      )}
      {showAccountDeletionModal && (
        <AccountDeletionModal onClose={() => setShowAccountDeletionModal(false)} />
      )}
      {showPurchaseTreatsModal && (
        <PurchaseTreatsModal
          onClose={() => setShowPurchaseTreatsModal(false)}
          onSuccess={() => {
            setShowPurchaseTreatsModal(false);
            handleTreatModalSuccess();
          }}
        />
      )}
      {showTippingModal && (
        <TippingModal
          onClose={() => setShowTippingModal(false)}
          onSuccess={() => {
            setShowTippingModal(false);
            handleTreatModalSuccess();
          }}
        />
      )}
      {showTreatPromotionModal && (
        <TreatPromotionModal
          onClose={() => setShowTreatPromotionModal(false)}
          onSuccess={() => {
            setShowTreatPromotionModal(false);
            handleTreatModalSuccess();
          }}
        />
      )}
      {showTreatWithdrawalModal && (
        <TreatWithdrawalModal
          onClose={() => setShowTreatWithdrawalModal(false)}
          onSuccess={() => {
            setShowTreatWithdrawalModal(false);
            handleTreatModalSuccess();
          }}
        />
      )}
      <input
        ref={heroInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        className="hidden"
        onChange={handleHeroFileChange}
      />
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        className="hidden"
        onChange={handleAvatarFileChange}
      />
    </div>
  );
};
