import { useState, useEffect, useRef } from "react";
import useEmblaCarousel from 'embla-carousel-react';
import Autoplay from 'embla-carousel-autoplay';
import { BellIcon, UserCircle } from "lucide-react";
import { LazyImage } from "../../../../components/LazyImage";
import { TreatWalletWidget } from "../../../../components/TreatWalletWidget";
import { AuthModal } from "../../../../components/AuthModal";
import { supabase, getActiveBanners } from "../../../../lib/supabase";
import { useAuth } from "../../../../contexts/AuthContext";
import { persistentCache } from "../../../../lib/persistentCache";
import { useUserCountry } from "../../../../hooks/useUserCountry";

interface HeroSectionProps {
  onShowNotificationsModal: () => void;
}

const CACHE_KEY = 'hero_section_banners';

export const HeroSection = ({ onShowNotificationsModal }: HeroSectionProps): JSX.Element => {
  const { user, isAuthenticated, isInitialized, displayName } = useAuth();
  const { countryCode } = useUserCountry();
  const [greeting, setGreeting] = useState("Good day");
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  const [banners, setBanners] = useState<any[]>([]);
  const [isLoadingBanners, setIsLoadingBanners] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const isInitialMount = useRef(true);
  const [emblaRef] = useEmblaCarousel(
    { loop: true, align: 'center' },
    [Autoplay({ delay: 4000, stopOnInteraction: false })]
  );

  // Load cached banners on mount
  useEffect(() => {
    const loadCached = async () => {
      if (isInitialMount.current) {
        const cached = await persistentCache.get<any[]>(CACHE_KEY);
        if (cached && cached.length > 0) {
          setBanners(cached);
          setIsLoadingBanners(false);
        }
        isInitialMount.current = false;
      }
    };

    loadCached();
  }, []);

  useEffect(() => {
    updateGreeting();
    loadBannersOnly();
  }, [countryCode]);

  useEffect(() => {
    if (isInitialized && isAuthenticated && user) {
      checkUnreadNotifications();
    } else {
      setHasUnreadNotifications(false);
    }
  }, [isAuthenticated, user, isInitialized]);

  const loadBannersOnly = async () => {
    try {
      setIsLoadingBanners(true);
      const bannersResult = await getActiveBanners(countryCode || undefined).catch(() => []);
      if (bannersResult && bannersResult.length > 0) {
        setBanners(bannersResult);
        // Cache banners for 1 hour
        await persistentCache.set(CACHE_KEY, bannersResult, 60 * 60 * 1000);
        // Preload first banner image for immediate display
        if (bannersResult[0]?.image_url) {
          preloadBannerImage(bannersResult[0].image_url);
        }
      }
    } catch (error) {
      console.error('Error loading banners:', error);
    } finally {
      setIsLoadingBanners(false);
    }
  };

  const preloadBannerImage = (imageUrl: string) => {
    if (!imageUrl) return;
    const img = new Image();
    // Get optimized URL with proper dimensions for banners (h-40 = 160px height)
    // Calculate width based on typical mobile viewport (375px - padding)
    const optimizedUrl = imageUrl.includes('storage/v1/object/public/') 
      ? `${imageUrl}?width=800&height=320&quality=80&format=webp`
      : imageUrl;
    img.src = optimizedUrl;
  };

  const checkUnreadNotifications = async () => {
    if (!user?.id) return;

    try {
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false);

      setHasUnreadNotifications((count || 0) > 0);
    } catch (error) {
      console.error('[HeroSection] Error checking notifications:', error);
    }
  };

  const updateGreeting = () => {
    const hour = new Date().getHours();
    let newGreeting = "Good day";
    
    if (hour < 12) {
      newGreeting = "Good morning";
    } else if (hour < 18) {
      newGreeting = "Good afternoon";
    } else {
      newGreeting = "Good evening";
    }
    
    setGreeting(newGreeting);
  };



  return (
    <div className="w-full">
      {/* Header */}
      <header className="w-full min-h-[80px] py-4 px-4 sm:px-6 flex items-center justify-between backdrop-blur-sm">
        <div className="flex items-center gap-2 min-w-0 flex-shrink mr-2">
          <div className="flex flex-col space-y-0.5 min-w-0 flex-shrink">
            <p className="font-['Bricolage',sans-serif] font-medium text-white/70 text-xs sm:text-sm leading-tight tracking-wide truncate">
              {isAuthenticated && displayName ? `👋 Hi ${displayName},` : "Welcome"}
            </p>
            <p className="font-['Bricolage',sans-serif] font-bold text-white text-sm sm:text-l leading-tight">
              {greeting}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {isAuthenticated ? (
            <>
              <TreatWalletWidget />

              <button
                onClick={onShowNotificationsModal}
                className="relative p-2 hover:bg-white/10 rounded-full transition-colors duration-200 flex-shrink-0"
              >
                <BellIcon className="w-4 h-4 sm:w-5 sm:h-5 text-white/90" />
                {hasUnreadNotifications && (
                  <span className="absolute w-2 h-2 top-1.5 right-1.5 bg-white rounded-full animate-pulse"></span>
                )}
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowAuthModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-600 rounded-full font-medium text-xs hover:bg-gray-100 transition-all duration-200 flex-shrink-0"
            >
              <UserCircle className="w-3.5 h-3.5" />
              <span>Login</span>
            </button>
          )}
        </div>
      </header>

      {/* Feature Banners */}
      {(banners.length > 0 || isLoadingBanners) && (
        <section className="w-full px-0 py-2">
          <div className="overflow-hidden rounded-xl" ref={emblaRef}>
            <div className="flex">
              {isLoadingBanners ? (
                // Loading skeleton for banner
                <div className="flex-[0_0_100%] min-w-0 px-0.5">
                  <div className="relative w-full h-40 rounded-xl overflow-hidden shadow-xl bg-gradient-to-r from-gray-800 to-gray-900 animate-pulse">
                    <div className="absolute inset-0 flex flex-col justify-center px-8">
                      <div className="h-4 bg-white/20 rounded w-3/4 mb-2"></div>
                      <div className="h-8 bg-white/20 rounded w-full"></div>
                    </div>
                  </div>
                </div>
              ) : (
                banners.map((banner, index) => (
                  <div key={banner.id} className="flex-[0_0_100%] min-w-0 px-0.5">
                    <a
                      href={banner.url || '#'}
                      className="block relative w-full h-40 rounded-xl overflow-hidden shadow-xl group cursor-pointer"
                      onClick={(e) => {
                        if (!banner.url) {
                          e.preventDefault();
                        }
                      }}
                    >
                      <LazyImage
                        src={banner.image_url}
                        alt={banner.subtitle}
                        className="absolute inset-0"
                        width={800}
                        height={320}
                        loading={index === 0 ? "eager" : "lazy"}
                      />
                      <div className={`absolute inset-0 bg-gradient-to-r ${banner.gradient_from} ${banner.gradient_to} opacity-0 group-hover:opacity-0 transition-opacity duration-300`} />
                      <div className="absolute inset-0 flex flex-col justify-center px-8">
                        {banner.title && (
                          <p className="font-['Inter',sans-serif] font-semibold text-white/90 text-base tracking-wide leading-tight mb-2">
                            {banner.title}
                          </p>
                        )}
                        <p className="font-['Inter',sans-serif] font-bold text-white text-3xl leading-tight">
                          {banner.subtitle}
                        </p>
                      </div>
                    </a>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      )}

      {/* Auth Modal */}
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => {
            setShowAuthModal(false);
            // Refresh to show authenticated state
            window.location.reload();
          }}
        />
      )}
    </div>
  );
};