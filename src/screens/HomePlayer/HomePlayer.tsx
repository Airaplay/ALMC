import { memo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { WifiOff } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { HeroSection } from "./sections/HeroSection";
import { TrendingSection } from "./sections/TrendingSection";
import { useTabPersistence } from "../../hooks/useTabPersistence";
import { useNetworkQuality } from "../../hooks/useNetworkQuality";
import { useAdPlacement } from "../../hooks/useAdPlacement";
// Direct imports so returning to Home does not trigger Suspense skeletons (no "reload" flash)
import { TrendingNearYouSection } from "./sections/TrendingNearYouSection";
import { NewReleasesSection } from "./sections/NewReleasesSection";
import { MustWatchSection } from "./sections/MustWatchSection";
import { AIRecommendedSection } from "./sections/AIRecommendedSection";
import { BlogSection } from "./sections/BlogSection";
import { TrendingAlbumsSection } from "./sections/TrendingAlbumsSection";
import { TopArtisteSection } from "./sections/TopArtisteSection";
import { InspiredByYouSection } from "./sections/InspiredByYouSection";
import { MixForYouSection } from "./sections/MixForYouSection";
import { ListenerCurationsSection } from "./sections/ListenerCurationsSection";
import { OnYourRadarSection } from "./sections/OnYourRadarSection";
import { TracksBlowingUpSection } from "./sections/TracksBlowingUpSection";
import { DailyMixSection } from "./sections/DailyMixSection";
import { HomeFeaturedAdSection } from "./sections/HomeFeaturedAdSection";
import { TopSongTodaySection } from "./sections/TopSongTodaySection";
import { MoodsSection } from "./sections/MoodsSection/MoodsSection";
import { PlayerPopupAdModal } from "../../components/PlayerPopupAdModal";
import { isWebTarget } from "../../lib/buildTarget";
import { WebAdBanner } from "../../components/web/WebAdBanner";
import { WEB_AD_PLACEMENT_KEYS } from "../../lib/webAdPlacementKeys";

interface HomePlayerProps {
  onOpenMusicPlayer: (song: Song, playlist?: Song[], context?: string) => void;
  onFormVisibilityChange?: (isVisible: boolean) => void;
}

interface Song {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  coverImageUrl?: string | null;
  audioUrl?: string | null;
  videoUrl?: string | null;
  duration?: number;
  playCount?: number;
}

function HomeOfflineBanner() {
  return (
    <div
      className="flex items-center justify-center gap-2 px-4 py-3 mx-4 rounded-xl bg-white/[0.06] border border-white/15 text-white/90 text-sm font-medium text-center"
      role="status"
      aria-live="polite"
    >
      <WifiOff className="w-4 h-4 shrink-0 text-amber-400/90" aria-hidden />
      <span>You&apos;re offline</span>
    </div>
  );
}

// Memoize sections for stable identity when navigating back to Home
const MemoizedHeroSection = memo(HeroSection);
const MemoizedMoodsSection = memo(MoodsSection);
const MemoizedTrendingSection = memo(TrendingSection);
const MemoizedDailyMixSection = memo(DailyMixSection);

const HomePlayerContent = memo(({ onOpenMusicPlayer }: HomePlayerProps): JSX.Element => {
  const navigate = useNavigate();
  const { containerRef } = useTabPersistence('home-player');
  const { isInitialized } = useAuth();
  const { isOnline } = useNetworkQuality();
  const { showRewarded } = useAdPlacement('HomePlayer');
  const hasTriggeredFirstAdRef = useRef(false);

  // Home: one rewarded ad at a time. Ref ensures we only trigger once per mount (avoids double fire in React Strict Mode).
  // App-open ad is skipped when route is Home (see index.tsx), so only rewarded ads run on home.
  useEffect(() => {
    if (isWebTarget()) return;
    if (hasTriggeredFirstAdRef.current) return;
    hasTriggeredFirstAdRef.current = true;
    showRewarded('home_screen_rewarded', {
      contentType: 'home',
    }).catch(() => {});
    const intervalId = setInterval(() => {
      showRewarded('home_screen_rewarded', {
        contentType: 'home',
      }).catch(() => {});
    }, 5 * 60 * 1000); // 5 minutes
    return () => clearInterval(intervalId);
  }, [showRewarded]);

  // Show skeleton while auth initializes
  if (!isInitialized) {
    return (
      <div
        className="flex flex-col h-full min-h-0 content-with-nav overflow-y-auto relative z-0 bg-gradient-to-b from-[#0a0a0a] via-[#0d0d0d] to-[#000000] font-sans"
        style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
      >
        {!isOnline && <HomeOfflineBanner />}
        <div className="px-5 py-6 animate-pulse">
          <div className="h-8 w-48 bg-white/10 rounded-lg mb-6"></div>
          <div className="h-48 bg-white/10 rounded-2xl mb-6"></div>
          <div className="h-6 w-32 bg-white/10 rounded-lg mb-4"></div>
          <div className="flex gap-3 overflow-hidden">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="w-40 h-40 bg-white/10 rounded-2xl flex-shrink-0"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full min-h-0 content-with-nav overflow-y-auto overflow-x-hidden relative z-0 animate-in fade-in duration-300 bg-gradient-to-b from-[#0a0a0a] via-[#0d0d0d] to-[#000000] font-sans overscroll-y-none"
      style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
    >
      {/* Uniform vertical rhythm: one gap between every block (sections use horizontal padding only). */}
      <div className="flex flex-col gap-8">
        {!isOnline && <HomeOfflineBanner />}
        {/* Critical above-the-fold content - loads immediately */}
        <MemoizedHeroSection
          onShowNotificationsModal={() => navigate('/notifications')}
        />
        {isWebTarget() && (
          <div className="px-4">
            <WebAdBanner
              placement="banner_top"
              placementKey={WEB_AD_PLACEMENT_KEYS.HOME_TOP}
              className="rounded-xl border border-white/10 bg-white/[0.04]"
            />
          </div>
        )}
        <MemoizedMoodsSection />
        <MemoizedTrendingSection onOpenMusicPlayer={onOpenMusicPlayer} />

        <MemoizedDailyMixSection />
        <HomeFeaturedAdSection placement="home_featured_banner" />
        <TopSongTodaySection onOpenMusicPlayer={onOpenMusicPlayer} />
        <TrendingNearYouSection onOpenMusicPlayer={onOpenMusicPlayer} />
        <MixForYouSection />
        <ListenerCurationsSection />
        <HomeFeaturedAdSection placement="home_featured_banner_secondary" />
        <OnYourRadarSection onOpenMusicPlayer={onOpenMusicPlayer} />
        <TracksBlowingUpSection onOpenMusicPlayer={onOpenMusicPlayer} />
        <InspiredByYouSection onOpenMusicPlayer={onOpenMusicPlayer} />
        <MustWatchSection />
        <NewReleasesSection onOpenMusicPlayer={onOpenMusicPlayer} />
        <TopArtisteSection />
        <TrendingAlbumsSection />
        <AIRecommendedSection onOpenMusicPlayer={onOpenMusicPlayer} />
        <BlogSection />
      </div>
      {!isWebTarget() && (
        <PlayerPopupAdModal
          placementType="home_popup"
          triggerKey="home-screen"
        />
      )}
    </div>
  );
});

HomePlayerContent.displayName = 'HomePlayerContent';

export const HomePlayer = memo(({ onOpenMusicPlayer }: HomePlayerProps): JSX.Element => {
  return <HomePlayerContent onOpenMusicPlayer={onOpenMusicPlayer} />;
});

HomePlayer.displayName = 'HomePlayer';