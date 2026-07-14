import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import {
  AdMob,
  BannerAdSize,
  BannerAdPosition,
  BannerAdPluginEvents,
  AdMobRewardItem,
  AdMobRewardInterstitialItem,
  RewardAdPluginEvents,
  RewardInterstitialAdPluginEvents,
  InterstitialAdPluginEvents
} from '@capacitor-community/admob';
import { supabase } from './supabase';
import { logAdReward, logAdImpression, logAdRevenue } from './adLoggingService';
import { getActivePlacement } from './adPlacementService';
import { getUserLocation } from './locationDetection';
import {
  MAIN_APP_BOTTOM_BANNER_PLACEMENT,
  isFullScreenPlayerBottomBannerKey,
  isOverlayModalBannerPlacementKey,
  resolveRewardedInterstitialAdUnitId,
} from './adPlacementConstants';
import { BANNER_PRELOAD_PARAMS_MAX_AGE_MS } from './bannerRefreshConstants';

const isNative = Capacitor.isNativePlatform();
const SONG_BONUS_PLACEMENT_KEY = 'song_bonus_rewarded';
const SONG_BONUS_LISTENER_SCORE_REWARD = 4;

/** Fully resolved banner request so native `showBanner` can run without awaiting Supabase (used for preload + scheduled swap). */
type ResolvedBannerParams = {
  position: BannerAdPosition;
  contentId?: string;
  contentType: string;
  placementKey?: string;
  adUnitId?: string;
  margin?: number;
  validAdId: string;
  resolvedPlacementKey: string;
  /** DB-resolved placement key for impression logging (may differ from `placementKey`). */
  recordPlacementKey?: string;
};

export interface AdMobConfig {
  appId?: string; // AdMob App ID from database
  bannerAdId?: string; // Fallback for main tab / general banners (e.g. main_app_bottom_banner)
  /** Distinct unit for full-screen player bottom banners when DB maps the same unit as main — set via VITE_ADMOB_PLAYER_BANNER_ID */
  playerBannerAdId?: string;
  interstitialAdId?: string; // Fallback/test ad ID
  rewardedAdId?: string; // Fallback/test ad ID
  rewardedInterstitialAdId?: string; // Fallback/test ad ID for rewarded interstitial
  testMode?: boolean;
}

type FullscreenFrequencyOptions = {
  /** Internal callers that already acquired the service-level fullscreen slot set this to avoid double-locking. */
  bypassFrequencyGate?: boolean;
};

type MutingFullscreenOptions = FullscreenFrequencyOptions & {
  muteAppAudio?: boolean;
};

class AdMobService {
  /** App-open ad safety gate: never show any ad before 1 minute from app launch. */
  private readonly appLaunchAtMs = Date.now();
  private static readonly STARTUP_AD_GUARD_MS = 60_000; // 1 minute after launch
  private config: AdMobConfig | null = null;
  private isInitialized = false;
  private bannerVisible = false; // Only call native hide/remove when we actually showed a banner (avoids native crash)
  /** Tracks which placement last "owns" the banner surface (prevents cross-screen hide races). */
  private activeBannerOwnerKey: string | null = null;
  private pendingBannerRequest: {
    position: BannerAdPosition;
    contentId?: string;
    contentType?: string;
    placementKey?: string;
    adUnitId?: string;
    margin?: number;
  } | null = null;
  /** Last show params so FailedToLoad can retry without re-querying screens (useAdPlacement swallows errors). */
  private lastBannerForRetry: {
    position: BannerAdPosition;
    contentId?: string;
    contentType: string;
    placementKey?: string;
    adUnitId?: string;
    margin?: number;
  } | null = null;
  /** Next banner request prepared shortly before refresh (placement/ad unit/context/margin). */
  /** Result of `resolveBannerForShow` + timestamp; consumed by `refreshBannerAd` for a fast native swap. */
  private preloadedBannerForRefresh: (ResolvedBannerParams & { preparedAt: number }) | null = null;
  private bannerFailRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private bannerFailRetryCount = 0;
  /** Whether current route/screen expects banner to stay visible. */
  private bannerShouldBeVisible = false;
  private bannerKeepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly BANNER_KEEP_ALIVE_CHECK_MS = 20_000;
  /** After a failed load, AdMob rate-limits rapid re-requests — honor a cooldown before calling showBanner again. */
  private lastBannerFailureAt = 0;
  private static readonly BANNER_FAILURE_COOLDOWN_MS = 25_000;
  /** Dedupe overlapping calls (hook + screens) for the same ad unit. */
  private lastBannerRequestAtByAdUnit = new Map<string, number>();
  private static readonly MIN_MS_BETWEEN_BANNER_REQUESTS_SAME_UNIT = 4000;
  /** Last requested placement key (even if banner didn't successfully show). */
  private lastRequestedBannerPlacementKey: string | undefined;
  /**
   * Last placement that successfully showed a banner. Used to allow an immediate request when
   * switching e.g. main_app_bottom_banner (Home) → music_player_bottom_banner (same ad unit ID in DB),
   * otherwise the 4s throttle blocks the player right after the tab banner.
   */
  private lastSuccessfulBannerPlacementKey: string | undefined;
  /** Last time native banner fired `bannerAdLoaded` — helps reason about refresh cadence. */
  private lastBannerNativeLoadedAt = 0;
  /** Resolved unit_id for main_app_bottom_banner — used to avoid player banners reusing the same native ad unit. */
  private mainAppBannerAdUnitIdCache: string | null | undefined = undefined;
  private appResumeListenerRegistered = false;
  private bannerHandoffTimers: ReturnType<typeof setTimeout>[] = [];
  /** When a modal banner takes over from a full-screen player, stash params so dismiss can re-show the player (modal unmount must not call hideBanner). */
  private bannerOverlayRestoreStack: Array<{
    position: BannerAdPosition;
    contentId?: string;
    contentType: string;
    placementKey?: string;
    adUnitId?: string;
    margin?: number;
  }> = [];
  private userCountryCache: { country: string | null; timestamp: number } | null = null;
  private readonly COUNTRY_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  /** Only one fullscreen ad (interstitial or rewarded) at a time; cooldown to avoid clash/crash */
  private fullscreenAdLock = false;
  private lastFullscreenAdTime = 0;
  // Global cooldown so fullscreen ads can never stack on top of each other.
  private static readonly FULLSCREEN_AD_COOLDOWN_MS = 3.5 * 60 * 1000; // 3 minutes 30 seconds
  private pendingFullscreenAd: {
    contentId?: string;
    contentType?: string;
    interstitialPlacementKey?: string;
    rewardedPlacementKey?: string;
    rewardedInterstitialPlacementKey?: string;
    preferRewardedInterstitial?: boolean;
  } | null = null;

  /** Ensures ad rendering cannot happen before startup guard duration elapses. */
  private async waitForStartupAdGuard(): Promise<void> {
    const elapsedMs = Date.now() - this.appLaunchAtMs;
    const remainingMs = AdMobService.STARTUP_AD_GUARD_MS - elapsedMs;
    if (remainingMs <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
  }

  private tryAcquireFullscreenAdSlot(): boolean {
    const now = Date.now();
    if (this.fullscreenAdLock || (now - this.lastFullscreenAdTime) < AdMobService.FULLSCREEN_AD_COOLDOWN_MS) {
      console.log('AdMob: Fullscreen ad skipped by service cooldown');
      return false;
    }
    this.fullscreenAdLock = true;
    return true;
  }

  private releaseFullscreenAdSlot(): void {
    this.fullscreenAdLock = false;
    this.lastFullscreenAdTime = Date.now();
  }

  /**
   * Initialize AdMob from database configuration
   * Loads AdMob App ID from ad_networks table
   */
  async initialize(config?: AdMobConfig) {
    if (!isNative) {
      console.log('AdMob: Skipping initialization (not native platform)');
      return;
    }

    try {
      // Load AdMob configuration from database
      const { data: adNetwork, error } = await supabase
        .from('ad_networks')
        .select('app_id, is_active')
        .eq('network', 'admob')
        .eq('is_active', true)
        .single();

      if (error || !adNetwork) {
        console.warn('AdMob network not found in database, using fallback config:', error);
        const hasConfig =
          config &&
          (config.appId ||
            config.bannerAdId ||
            config.interstitialAdId ||
            config.rewardedAdId ||
            config.rewardedInterstitialAdId);
        if (hasConfig) {
          this.config = { ...config };
        } else {
          console.error('Cannot initialize AdMob: No configuration found');
          return;
        }
      } else {
        this.config = {
          appId: adNetwork.app_id,
          ...config
        };
      }

      const appId = this.config.appId || this.config.bannerAdId?.split('/')[0]?.split('~')[0] || 'ca-app-pub-473942199229846~4630726757';

      await AdMob.initialize({
        testingDevices: config?.testMode ? ['YOUR_TEST_DEVICE_ID'] : undefined,
        initializeForTesting: config?.testMode || false,
      });

      this.setupBannerListeners();
      this.registerAppResumeBannerRefresh();
      this.isInitialized = true;
      console.log('AdMob initialized successfully with App ID:', appId);

      // If the app tried to show a fullscreen ad before init completed, run it once now.
      const pendingFull = this.pendingFullscreenAd;
      this.pendingFullscreenAd = null;
      if (pendingFull) {
        this.showInterstitialOrRewarded(pendingFull).catch(() => {});
      }

      // If the app tried to show a banner before init completed, retry once now.
      const pending = this.pendingBannerRequest;
      this.pendingBannerRequest = null;
      if (pending) {
        this.showBanner(
          pending.position,
          pending.contentId,
          pending.contentType ?? 'general',
          pending.placementKey,
          pending.adUnitId,
          pending.margin
        ).catch(() => {});
      }

      // Warm the default interstitial in the background so the first show() is faster.
      // After each dismiss we prepare again (see showInterstitial) so the next slot stays loaded.
      void this.prepareInterstitial().catch(() => {});
      void this.prepareRewardedInterstitialAd().catch(() => {});
    } catch (error) {
      console.error('Failed to initialize AdMob:', error);
      this.isInitialized = false;
    }
  }

  async showAppOpenAd(adUnitId: string): Promise<void> {
    if (!isNative || !this.isInitialized) return;
    await this.waitForStartupAdGuard();

    const validAdId = adUnitId.trim();
    if (!validAdId) return;

    const appOpenApi = AdMob as unknown as {
      prepareAppOpenAd?: (options: { adId: string }) => Promise<void>;
      showAppOpenAd?: () => Promise<void>;
    };

    if (typeof appOpenApi.prepareAppOpenAd !== 'function' || typeof appOpenApi.showAppOpenAd !== 'function') {
      console.warn('AdMob: App Open API not available in current plugin build');
      return;
    }

    if (!this.tryAcquireFullscreenAdSlot()) return;

    try {
      await appOpenApi.prepareAppOpenAd({ adId: validAdId });
      await appOpenApi.showAppOpenAd();
    } catch (error) {
      console.warn('AdMob: App open ad skipped', error);
    } finally {
      this.releaseFullscreenAdSlot();
    }
  }

  private bannerEventsRegistered = false;
  private bannerFailedListenerHandle: { remove: () => Promise<void> } | null = null;
  private bannerLoadedListenerHandle: { remove: () => Promise<void> } | null = null;

  private clearBannerRetryTimer(): void {
    if (this.bannerFailRetryTimer) {
      clearTimeout(this.bannerFailRetryTimer);
      this.bannerFailRetryTimer = null;
    }
  }

  private clearBannerKeepAliveTimer(): void {
    if (this.bannerKeepAliveTimer) {
      clearInterval(this.bannerKeepAliveTimer);
      this.bannerKeepAliveTimer = null;
    }
  }

  private clearBannerHandoffTimers(): void {
    if (this.bannerHandoffTimers.length === 0) return;
    for (const t of this.bannerHandoffTimers) {
      clearTimeout(t);
    }
    this.bannerHandoffTimers = [];
  }

  /** Loads main app banner unit id once (for comparing player vs main placements). */
  private async ensureMainAppBannerUnitIdCache(): Promise<string | null> {
    if (this.mainAppBannerAdUnitIdCache !== undefined) {
      return this.mainAppBannerAdUnitIdCache;
    }
    try {
      const mp = await getActivePlacement(MAIN_APP_BOTTOM_BANNER_PLACEMENT);
      const id = mp?.ad_unit?.unit_id?.trim() ?? null;
      this.mainAppBannerAdUnitIdCache = id;
      return id;
    } catch {
      this.mainAppBannerAdUnitIdCache = null;
      return null;
    }
  }

  /** Keep the requested banner present while a screen expects it to be visible. */
  private ensureBannerKeepAlive(): void {
    if (!isNative || !this.isInitialized) return;
    if (!this.bannerShouldBeVisible) return;
    if (this.bannerKeepAliveTimer) return;

    this.bannerKeepAliveTimer = setInterval(() => {
      if (!this.bannerShouldBeVisible || this.bannerVisible) return;
      const p = this.lastBannerForRetry;
      if (!p) return;
      this.showBanner(
        p.position,
        p.contentId,
        p.contentType,
        p.placementKey,
        p.adUnitId,
        p.margin
      ).catch(() => {});
    }, AdMobService.BANNER_KEEP_ALIVE_CHECK_MS);
  }

  /**
   * One slow retry after native FailedToLoad. Fast retries cause:
   * "Too many recently failed requests for ad unit ID ... You must wait a few seconds"
   */
  private scheduleBannerRetryAfterFailure(): void {
    if (!isNative || !this.isInitialized) return;
    const params = this.lastBannerForRetry;
    if (!params?.placementKey) return;
    if (this.bannerFailRetryCount >= 1) return;

    this.clearBannerRetryTimer();
    this.bannerFailRetryCount += 1;
    const delay = 60_000;
    this.bannerFailRetryTimer = setTimeout(() => {
      this.bannerFailRetryTimer = null;
      this.showBanner(
        params.position,
        params.contentId,
        params.contentType,
        params.placementKey,
        params.adUnitId,
        params.margin
      ).catch(() => {});
    }, delay);
  }

  /** Re-show bottom player banner after returning from background (SDK often drops the view). */
  private registerAppResumeBannerRefresh(): void {
    if (!isNative || this.appResumeListenerRegistered) return;
    this.appResumeListenerRegistered = true;
    App.addListener('resume', () => {
      const p = this.lastBannerForRetry;
      if (!p?.placementKey || !/_bottom_banner$/.test(p.placementKey)) return;
      if (Date.now() - this.lastBannerFailureAt < AdMobService.BANNER_FAILURE_COOLDOWN_MS) return;
      this.bannerFailRetryCount = 0;
      this.showBanner(
        p.position,
        p.contentId,
        p.contentType,
        p.placementKey,
        p.adUnitId,
        p.margin
      ).catch(() => {});
    }).catch(() => {
      this.appResumeListenerRegistered = false;
    });
  }

  private setupBannerListeners(): void {
    if (!isNative || this.bannerEventsRegistered) return;
    this.bannerEventsRegistered = true;

    void AdMob.addListener(
      BannerAdPluginEvents.FailedToLoad,
      (error: unknown) => {
        try {
          // If we intentionally hid/removed the banner, the SDK may still emit FailedToLoad.
          // Don't poison our "failure cooldown" in that case.
          const wasBannerVisible = this.bannerVisible;
          this.bannerVisible = false; // Native reported failure; keep state in sync
          if (!wasBannerVisible) return;

          this.lastBannerFailureAt = Date.now();
          const err = error as { code?: number; message?: string } | null | undefined;
          console.warn('AdMob: Banner failed to load', { code: err?.code, message: err?.message ?? 'unknown' });
          this.scheduleBannerRetryAfterFailure();
        } catch (e) {
          console.warn('AdMob: Banner failed to load (callback error)', e);
        }
      }
    )
      .then((handle) => {
        this.bannerFailedListenerHandle = handle;
      })
      .catch((err) => {
        console.warn('AdMob: Could not add banner FailedToLoad listener', err);
      });

    void AdMob.addListener(BannerAdPluginEvents.Loaded, () => {
      this.lastBannerNativeLoadedAt = Date.now();
      // Eagerly resolve the next refresh’s placement/ad unit while the current creative is showing so the
      // scheduled swap only triggers native loadAd (see preloadNextBannerRefresh + BANNER_PRELOAD_PARAMS_MAX_AGE_MS).
      void this.preloadNextBannerRefresh().catch(() => {});
    })
      .then((handle) => {
        this.bannerLoadedListenerHandle = handle;
      })
      .catch((err) => {
        console.warn('AdMob: Could not add banner Loaded listener', err);
      });
  }

  /**
   * Get user's country with caching to prevent repeated lookups
   * Uses timeout to prevent blocking ad display
   */
  private async getUserCountryWithCache(userId?: string): Promise<string | null> {
    // Check cache first
    const now = Date.now();
    if (this.userCountryCache && (now - this.userCountryCache.timestamp) < this.COUNTRY_CACHE_DURATION) {
      return this.userCountryCache.country;
    }

    let userCountry: string | null = null;

    // Try to get country from user profile first (fastest)
    if (userId) {
      try {
        const { data: userProfile } = await supabase
          .from('users')
          .select('country')
          .eq('id', userId)
          .single();

        userCountry = userProfile?.country || null;
      } catch (error) {
        console.warn('Could not fetch user country from profile:', error);
      }
    }

    // If no country in profile, try location detection with timeout
    if (!userCountry) {
      try {
        const locationPromise = getUserLocation();
        const timeoutPromise = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), 2000)
        );

        const result = await Promise.race([locationPromise, timeoutPromise]);

        if (result && result.location) {
          userCountry = result.location.countryCode;
        }
      } catch (error) {
        console.warn('Location detection timed out or failed:', error);
      }
    }

    // Cache the result (even if null)
    this.userCountryCache = {
      country: userCountry,
      timestamp: now
    };

    return userCountry;
  }

  /**
   * Check if ads should be displayed based on admin-configured display rules
   * Checks user role, content type, and country restrictions
   * Returns true if ads should show, false if blocked
   */
  private async checkDisplayRules(contentType?: string): Promise<boolean> {
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();

      // Get user's country with caching and timeout
      const userCountry = await this.getUserCountryWithCache(user?.id);

      // Call database function to check if ads should be shown
      const { data, error } = await supabase.rpc('should_show_ads', {
        user_uuid: user?.id || null,
        content_type_param: contentType || null,
        country_param: userCountry
      });

      if (error) {
        console.error('Error checking ad display rules:', error);
        // Default to showing ads on error to avoid revenue loss
        return true;
      }

      if (data === false) {
        console.log('Ad blocked by display rules', {
          userId: user?.id,
          contentType,
          country: userCountry,
          reason: 'Matched blocking rule'
        });
      }

      // Treat only explicit false as blocked; null/undefined from RPC should not hide ads (strict `=== true` was blocking mobile when DB returned null).
      return data !== false;
    } catch (error) {
      console.error('Failed to check ad display rules:', error);
      // Default to showing ads on error to avoid revenue loss
      return true;
    }
  }

  /**
   * Async resolution: display rules + placement/ad unit (Supabase). Used by showBanner and preload so
   * scheduled refresh can call native show immediately without awaiting this work at swap time.
   */
  private async resolveBannerForShow(
    position: BannerAdPosition,
    contentId: string | undefined,
    contentType: string,
    placementKey: string | undefined,
    adUnitId: string | undefined,
    margin: number | undefined
  ): Promise<ResolvedBannerParams | null> {
    const skipDisplayRulesForBanner =
      contentType === 'general' || (placementKey != null && /_bottom_banner$/.test(placementKey));

    if (!skipDisplayRulesForBanner) {
      const shouldShowAd = await this.checkDisplayRules(contentType);
      if (!shouldShowAd) {
        console.log('AdMob: Banner blocked by display rules');
        return null;
      }
    }

    let adUnitIdToUse: string | undefined = adUnitId;
    let placementKeyToUse: string | undefined = placementKey;

    if (placementKey) {
      const placement = await getActivePlacement(placementKey);
      if (placement && placement.ad_unit && placement.ad_type === 'banner') {
        adUnitIdToUse = placement.ad_unit.unit_id;
        placementKeyToUse = placement.placement_key;
        if (placementKey === MAIN_APP_BOTTOM_BANNER_PLACEMENT && adUnitIdToUse) {
          this.mainAppBannerAdUnitIdCache = adUnitIdToUse.trim();
        }
      } else {
        console.warn(`Placement '${placementKey}' not found or not a banner ad`);
        if (isFullScreenPlayerBottomBannerKey(placementKey)) {
          const pid = this.config?.playerBannerAdId ?? import.meta.env.VITE_ADMOB_PLAYER_BANNER_ID?.trim();
          if (pid) {
            adUnitIdToUse = pid;
          } else if (this.config?.bannerAdId) {
            adUnitIdToUse = this.config.bannerAdId;
            console.warn(
              'AdMob: Player banner has no DB placement; using main banner fallback. Add a banner row for this placement or set VITE_ADMOB_PLAYER_BANNER_ID.'
            );
          } else {
            console.error('No banner ad unit available');
            return null;
          }
        } else {
          if (!adUnitIdToUse) {
            if (!this.config?.bannerAdId) {
              console.error('No banner ad unit available');
              return null;
            }
            adUnitIdToUse = this.config.bannerAdId;
          }
        }
      }
    } else if (this.config?.bannerAdId) {
      adUnitIdToUse = this.config.bannerAdId;
    } else {
      console.error('No banner ad unit ID available');
      return null;
    }

    if (placementKey && isFullScreenPlayerBottomBannerKey(placementKey) && adUnitIdToUse) {
      const mainUnit =
        this.mainAppBannerAdUnitIdCache !== undefined
          ? this.mainAppBannerAdUnitIdCache
          : await this.ensureMainAppBannerUnitIdCache();
      const trimmed = adUnitIdToUse.trim();
      const playerDedicated = (this.config?.playerBannerAdId ?? import.meta.env.VITE_ADMOB_PLAYER_BANNER_ID ?? '').trim();
      if (mainUnit != null && trimmed === mainUnit) {
        if (playerDedicated && playerDedicated !== trimmed) {
          adUnitIdToUse = playerDedicated;
        } else {
          console.warn(
            'AdMob: Full-screen player banner is mapped to the same ad unit as main_app_bottom_banner. Point player placements to a separate banner unit in ad_placements, or set VITE_ADMOB_PLAYER_BANNER_ID.'
          );
        }
      }
    }

    const validAdId = typeof adUnitIdToUse === 'string' && adUnitIdToUse.trim().length > 0 ? adUnitIdToUse.trim() : null;
    if (!validAdId) {
      console.warn('AdMob: Skipping banner — no valid ad unit ID (prevents native NPE)');
      return null;
    }

    const resolvedPlacementKey = (placementKeyToUse ?? placementKey ?? '').trim();

    return {
      position,
      contentId,
      contentType,
      placementKey,
      adUnitId: adUnitIdToUse,
      margin,
      validAdId,
      resolvedPlacementKey,
      recordPlacementKey: placementKeyToUse ?? placementKey,
    };
  }

  /**
   * Native show + bookkeeping. `scheduled_refresh` skips the 4s same-unit throttle — the 30–45s timer
   * enforces policy spacing; the plugin reuses the same AdView and calls loadAd (no extra container teardown).
   */
  private async applyResolvedBannerNative(
    r: ResolvedBannerParams,
    opts: {
      requestSource: 'user_initiated' | 'scheduled_refresh' | 'placement_handoff';
      stashPlayerBannerForOverlayRestore?: {
        position: BannerAdPosition;
        contentId?: string;
        contentType: string;
        placementKey?: string;
        adUnitId?: string;
        margin?: number;
      };
    }
  ): Promise<void> {
    const { position, contentId, contentType, margin, validAdId, resolvedPlacementKey } = r;
    const recordPlacementKey = r.recordPlacementKey;

    this.lastRequestedBannerPlacementKey = r.placementKey;

    const isPlacementHandoff =
      resolvedPlacementKey.length > 0 &&
      ((this.lastSuccessfulBannerPlacementKey != null &&
        resolvedPlacementKey !== this.lastSuccessfulBannerPlacementKey) ||
        (this.lastRequestedBannerPlacementKey != null &&
          resolvedPlacementKey !== this.lastRequestedBannerPlacementKey));

    const now = Date.now();
    if (now - this.lastBannerFailureAt < AdMobService.BANNER_FAILURE_COOLDOWN_MS) {
      if (!isPlacementHandoff) {
        console.log('AdMob: Banner request skipped (cooldown after failed load — avoids rate limit)');
        return;
      }
    }

    if (opts.requestSource === 'user_initiated') {
      if (!isPlacementHandoff) {
        const lastReq = this.lastBannerRequestAtByAdUnit.get(validAdId) ?? 0;
        if (now - lastReq < AdMobService.MIN_MS_BETWEEN_BANNER_REQUESTS_SAME_UNIT) {
          console.log('AdMob: Banner request skipped (min spacing for same ad unit)');
          return;
        }
      }
    }

    this.lastBannerRequestAtByAdUnit.set(validAdId, now);

    try {
      await AdMob.showBanner({
        adId: validAdId,
        adSize: BannerAdSize.ADAPTIVE_BANNER,
        position,
        ...(margin !== undefined && margin >= 0 && { margin }),
      });
      this.bannerVisible = true;
      this.lastBannerFailureAt = 0;
      this.bannerFailRetryCount = 0;
      this.clearBannerRetryTimer();
      this.ensureBannerKeepAlive();
      if (resolvedPlacementKey.length > 0) {
        this.lastSuccessfulBannerPlacementKey = resolvedPlacementKey;
        this.activeBannerOwnerKey = resolvedPlacementKey;
      }

      if (opts.stashPlayerBannerForOverlayRestore && r.placementKey && isOverlayModalBannerPlacementKey(r.placementKey)) {
        this.bannerOverlayRestoreStack.push(opts.stashPlayerBannerForOverlayRestore);
      }

      this.recordImpression('banner', contentId, contentType, 0, true, recordPlacementKey ?? r.placementKey, validAdId).catch((err) => {
        console.warn('Failed to record banner impression:', err);
      });
    } catch (error) {
      this.bannerVisible = false;
      this.lastBannerFailureAt = Date.now();
      console.error('Failed to show banner:', error);
    }
  }

  private async showBannerWithSource(
    position: BannerAdPosition,
    contentId: string | undefined,
    contentType: string,
    placementKey: string | undefined,
    adUnitId: string | undefined,
    margin: number | undefined,
    requestSource: 'user_initiated' | 'scheduled_refresh' | 'placement_handoff'
  ): Promise<void> {
    if (!isNative) return;
    this.bannerShouldBeVisible = true;
    if (!this.isInitialized) {
      // Queue the most recent banner request and retry after initialize() completes.
      this.pendingBannerRequest = { position, contentId, contentType, placementKey, adUnitId, margin };
      this.lastBannerForRetry = {
        position,
        contentId,
        contentType: contentType || 'general',
        placementKey,
        adUnitId,
        margin,
      };
      console.log('AdMob: Banner queued (not initialized yet)');
      return;
    }

    const overlayPlayerRestoreSnapshot =
      placementKey &&
      isOverlayModalBannerPlacementKey(placementKey) &&
      this.activeBannerOwnerKey &&
      isFullScreenPlayerBottomBannerKey(this.activeBannerOwnerKey) &&
      this.lastBannerForRetry?.placementKey &&
      isFullScreenPlayerBottomBannerKey(this.lastBannerForRetry.placementKey)
        ? { ...this.lastBannerForRetry }
        : undefined;

    this.lastBannerForRetry = {
      position,
      contentId,
      contentType: contentType || 'general',
      placementKey,
      adUnitId,
      margin,
    };
    this.preloadedBannerForRefresh = null;

    const resolved = await this.resolveBannerForShow(
      position,
      contentId,
      contentType || 'general',
      placementKey,
      adUnitId,
      margin
    );
    if (!resolved) return;

    await this.applyResolvedBannerNative(resolved, {
      requestSource,
      ...(overlayPlayerRestoreSnapshot
        ? { stashPlayerBannerForOverlayRestore: overlayPlayerRestoreSnapshot }
        : {}),
    });
  }

  /** Show banner. Pass contentId (song id) and contentType 'song' so revenue is attributed to that song. margin in dp: for BOTTOM_CENTER = margin from bottom (e.g. 64 = just above nav+mini). */
  async showBanner(position: BannerAdPosition = BannerAdPosition.BOTTOM_CENTER, contentId?: string, contentType: string = 'general', placementKey?: string, adUnitId?: string, margin?: number) {
    await this.showBannerWithSource(
      position,
      contentId,
      contentType,
      placementKey,
      adUnitId,
      margin,
      'user_initiated'
    );
  }

  /**
   * Transition helper: when exiting full-screen players to tab screens, re-assert the main bottom banner
   * above nav/mini with throttle-safe retries so player cleanup timing cannot leave the surface blank.
   */
  async handoffToMainBottomBanner(margin?: number): Promise<void> {
    if (!isNative) return;
    this.clearBannerHandoffTimers();

    const run = () =>
      this.showBannerWithSource(
        BannerAdPosition.BOTTOM_CENTER,
        undefined,
        'general',
        MAIN_APP_BOTTOM_BANNER_PLACEMENT,
        undefined,
        margin,
        'placement_handoff'
      ).catch(() => {});

    run();
    this.bannerHandoffTimers.push(setTimeout(run, 350));
    this.bannerHandoffTimers.push(setTimeout(run, 1200));
  }

  /**
   * Reposition whichever bottom banner is currently active (player or main) without forcing
   * a placement switch. Useful during full-player -> Home transitions where we want the same
   * visible ad surface to continue and only move above nav/mini.
   */
  async repositionActiveBottomBanner(margin?: number): Promise<void> {
    if (!isNative) return;
    this.clearBannerHandoffTimers();

    const current = this.lastBannerForRetry;
    if (!current) {
      await this.handoffToMainBottomBanner(margin);
      return;
    }

    const run = () =>
      this.showBannerWithSource(
        BannerAdPosition.BOTTOM_CENTER,
        current.contentId,
        current.contentType,
        // Transfer ownership to main app banner on tab surfaces while reusing the currently
        // active unit/context; this prevents outgoing player cleanup from hiding the banner.
        MAIN_APP_BOTTOM_BANNER_PLACEMENT,
        current.adUnitId,
        margin,
        'placement_handoff'
      ).catch(() => {});

    run();
    this.bannerHandoffTimers.push(setTimeout(run, 350));
    this.bannerHandoffTimers.push(setTimeout(run, 1200));
  }

  /**
   * Preload (5–10s before scheduled refresh, see bannerRefreshConstants): run the same async resolution
   * as showBanner so the swap only triggers native `AdMob.showBanner` → `loadAd` on the persistent AdView.
   */
  async preloadNextBannerRefresh(): Promise<void> {
    if (!isNative || !this.isInitialized) return;
    if (!this.bannerShouldBeVisible || !this.lastBannerForRetry) return;

    const b = this.lastBannerForRetry;
    try {
      const resolved = await this.resolveBannerForShow(
        b.position,
        b.contentId,
        b.contentType,
        b.placementKey,
        b.adUnitId,
        b.margin
      );
      if (resolved) {
        this.preloadedBannerForRefresh = { ...resolved, preparedAt: Date.now() };
      }
    } catch {
      // Preload must never surface errors; refresh will fall back to full show path.
    }
  }

  /**
   * Policy: refresh only on 30–45s timers from `usePlayerBottomBanner` / main tab effect (no faster rotation).
   * Prefers preloaded resolution so swap is not blocked on Supabase; native layer keeps one banner container.
   */
  async refreshBannerAd(): Promise<void> {
    if (!isNative || !this.isInitialized) return;
    if (!this.bannerShouldBeVisible || !this.lastBannerForRetry?.placementKey) return;

    const pre = this.preloadedBannerForRefresh;
    const preloadedFresh =
      pre && Date.now() - pre.preparedAt <= BANNER_PRELOAD_PARAMS_MAX_AGE_MS ? pre : null;
    this.preloadedBannerForRefresh = null;

    if (preloadedFresh) {
      const { preparedAt: _preparedAt, ...resolved } = preloadedFresh;
      void _preparedAt;
      await this.applyResolvedBannerNative(resolved, { requestSource: 'scheduled_refresh' });
      return;
    }

    const b = this.lastBannerForRetry;
    await this.showBanner(b.position, b.contentId, b.contentType, b.placementKey, b.adUnitId, b.margin).catch(() => {});
  }

  /**
   * Record every ad impression with content context. Revenue is attributed per song:
   * always pass contentId (song id) and contentType ('song') when the ad is shown during playback.
   */
  private async recordImpression(adType: string, contentId?: string, contentType: string = 'general', duration: number = 0, completed: boolean = false, placementKey?: string, adUnitId?: string) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return; // Skip if not authenticated

      // Record impression in ad_impressions table (content_uuid = song id for revenue attribution)
      const { data: impressionData, error: impressionError } = await supabase.rpc('record_ad_impression', {
        content_uuid: contentId || null,
        content_type_param: contentType,
        ad_type_param: adType,
        duration_viewed_param: duration,
        completed_param: completed
      });

      if (impressionError) {
        console.error('Failed to record ad impression:', impressionError);
        return;
      }

      // Enhanced logging
      await logAdImpression({
        adImpressionId: impressionData?.id || undefined,
        userId: user.id,
        adUnitId: adUnitId,
        placementKey: placementKey,
        network: 'admob',
        adType: adType,
        viewDuration: duration,
        completed: completed,
        failed: !completed && duration === 0
      });

      // Estimate revenue (simplified - in production, get actual CPM from ad network)
      const estimatedCPM =
        adType === 'rewarded'
          ? 3.0
          : adType === 'rewarded_interstitial'
            ? 2.8
            : adType === 'interstitial'
              ? 2.0
              : 1.0;
      const estimatedRevenue = (estimatedCPM / 1000) * (completed ? 1 : 0.5); // Partial credit if not completed

      await logAdRevenue({
        adImpressionId: impressionData?.id || undefined,
        adUnitId: adUnitId,
        networkId: undefined, // Will be populated from ad_units
        placementKey: placementKey,
        estimatedCPM: estimatedCPM,
        estimatedRevenue: estimatedRevenue,
        currency: 'USD',
        winningNetwork: 'admob'
      });
    } catch (error) {
      console.error('Failed to record ad impression:', error);
      // Don't throw - ad impression tracking failure shouldn't break ad display
    }
  }

  async hideBanner() {
    if (!isNative || !this.isInitialized) return;
    this.bannerShouldBeVisible = false;
    this.clearBannerKeepAliveTimer();

    this.clearBannerRetryTimer();
    this.bannerFailRetryCount = 0;

    if (!this.bannerVisible) return;

    try {
      await AdMob.hideBanner();
      // Treat hidden as not-visible so future showBanner calls can re-show without needing removeBanner()
      this.bannerVisible = false;
    } catch (error) {
      console.error('Failed to hide banner:', error);
      // Keep state conservative so we can recover with a future showBanner
      this.bannerVisible = false;
    }
  }

  async hideBannerOwnedBy(ownerKey?: string) {
    if (!isNative || !this.isInitialized) return;
    // If a specific ownerKey is provided, only hide when it matches the current owner.
    if (ownerKey && this.activeBannerOwnerKey && ownerKey !== this.activeBannerOwnerKey) return;

    // If no ownerKey is provided (generic hide from app shell / mini player),
    // never hide full-screen player bottom banners which explicitly own the surface.
    if (
      !ownerKey &&
      this.activeBannerOwnerKey &&
      isFullScreenPlayerBottomBannerKey(this.activeBannerOwnerKey)
    ) {
      return;
    }

    // Modal took the native banner from a full-screen player: put the player banner back instead of hiding.
    if (
      ownerKey &&
      isOverlayModalBannerPlacementKey(ownerKey) &&
      this.bannerOverlayRestoreStack.length > 0
    ) {
      const prev = this.bannerOverlayRestoreStack.pop()!;
      await this.showBannerWithSource(
        prev.position,
        prev.contentId,
        prev.contentType,
        prev.placementKey,
        prev.adUnitId,
        prev.margin,
        'placement_handoff'
      ).catch(() => {});
      return;
    }

    await this.hideBanner();
  }

  async removeBannerOwnedBy(ownerKey?: string) {
    if (!isNative || !this.isInitialized) return;
    // If a specific ownerKey is provided, only remove when it matches the current owner.
    if (ownerKey && this.activeBannerOwnerKey && ownerKey !== this.activeBannerOwnerKey) return;

    // If no ownerKey is provided (generic remove from app shell / mini player),
    // never remove full-screen player bottom banners which explicitly own the surface.
    if (
      !ownerKey &&
      this.activeBannerOwnerKey &&
      isFullScreenPlayerBottomBannerKey(this.activeBannerOwnerKey)
    ) {
      return;
    }

    await this.removeBanner();
  }

  async removeBanner() {
    if (!isNative || !this.isInitialized) return;
    this.bannerShouldBeVisible = false;
    this.clearBannerKeepAliveTimer();

    this.clearBannerRetryTimer();
    this.bannerFailRetryCount = 0;

    if (!this.bannerVisible) return;

    try {
      await AdMob.removeBanner();
      this.bannerVisible = false;
      this.activeBannerOwnerKey = null;
    } catch (error) {
      console.error('Failed to remove banner:', error);
      this.bannerVisible = false;
      this.activeBannerOwnerKey = null;
    }
  }

  async prepareInterstitial(placementKey?: string) {
    if (!isNative || !this.isInitialized) return;

    try {
      let adUnitIdToUse: string | undefined;

      // If placementKey is provided, fetch the placement configuration
      if (placementKey) {
        const placement = await getActivePlacement(placementKey);
        if (placement && placement.ad_unit && placement.ad_type === 'interstitial') {
          adUnitIdToUse = placement.ad_unit.unit_id;
        } else {
          console.warn(`Placement '${placementKey}' not found or not an interstitial ad`);
          // Fallback to config if available
          if (!this.config?.interstitialAdId) {
            console.error('No interstitial ad unit available');
            return;
          }
          adUnitIdToUse = this.config.interstitialAdId;
        }
      } else if (this.config?.interstitialAdId) {
        // Fallback to config interstitial ID
        adUnitIdToUse = this.config.interstitialAdId;
      } else {
        console.error('No interstitial ad unit ID available');
        return;
      }

      await AdMob.prepareInterstitial({
        adId: adUnitIdToUse,
      });
    } catch (error) {
      console.error('Failed to prepare interstitial:', error);
    }
  }

  async showInterstitial(
    contentId?: string,
    contentType: string = 'general',
    placementKey?: string,
    adUnitId?: string,
    options?: MutingFullscreenOptions
  ): Promise<void> {
    if (!isNative || !this.isInitialized) {
      console.log('AdMob: Interstitial skipped (not native or not initialized)');
      return;
    }
    await this.waitForStartupAdGuard();

    const acquiredFullscreenSlot = options?.bypassFrequencyGate === true ? false : this.tryAcquireFullscreenAdSlot();
    if (options?.bypassFrequencyGate !== true && !acquiredFullscreenSlot) return;
    const shouldMute = options?.muteAppAudio ?? true;

    try {
      // Check display rules before showing ad
      const shouldShowAd = await this.checkDisplayRules(contentType);
      if (!shouldShowAd) {
        console.log('AdMob: Interstitial blocked by display rules');
        return;
      }

      let adUnitIdToUse: string | undefined = adUnitId;
      let placementKeyToUse: string | undefined = placementKey;

      // If placementKey is provided, fetch the placement configuration
      if (placementKey) {
        const placement = await getActivePlacement(placementKey);
        if (placement && placement.ad_unit && placement.ad_type === 'interstitial') {
          adUnitIdToUse = placement.ad_unit.unit_id;
          if (!adUnitId) {
            adUnitId = placement.ad_unit.id;
          }
          placementKeyToUse = placement.placement_key;
        } else {
          console.warn(`Placement '${placementKey}' not found or not an interstitial ad`);
          // Fallback to config if available
          if (!this.config?.interstitialAdId) {
            console.error('No interstitial ad unit available');
            return;
          }
          adUnitIdToUse = this.config.interstitialAdId;
        }
      } else if (this.config?.interstitialAdId) {
        // Fallback to config interstitial ID
        adUnitIdToUse = this.config.interstitialAdId;
      } else {
        console.error('No interstitial ad unit ID available');
        return;
      }

      // Prepare the ad first
      await this.prepareInterstitial(placementKeyToUse);

      // Optionally mute app audio while interstitial is visible (default: true).
      const restoreUnmute = () => {
        if (shouldMute && typeof AdMob.setApplicationMuted === 'function') {
          AdMob.setApplicationMuted({ muted: false }).catch(() => {});
        }
      };
      if (shouldMute && typeof AdMob.setApplicationMuted === 'function') {
        await AdMob.setApplicationMuted({ muted: true });
      }
      let resolveDismissed!: () => void;
      const dismissedPromise = new Promise<void>((r) => { resolveDismissed = r; });
      const dismissListener = await AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => {
        restoreUnmute();
        dismissListener.remove();
        resolveDismissed();
        void this.prepareInterstitial(placementKeyToUse);
      });

      await AdMob.showInterstitial();

      // Record ad impression (interstitial ads are typically completed when shown)
      await this.recordImpression('interstitial', contentId, contentType, 0, true, placementKeyToUse, adUnitIdToUse || adUnitId);

      await dismissedPromise;
    } catch (error) {
      console.error('Failed to show interstitial:', error);
      if (shouldMute && typeof AdMob.setApplicationMuted === 'function') {
        AdMob.setApplicationMuted({ muted: false }).catch(() => {});
      }
      throw error;
    } finally {
      if (acquiredFullscreenSlot) {
        this.releaseFullscreenAdSlot();
      }
    }
  }

  async prepareRewardedAd(placementKey?: string) {
    if (!isNative || !this.isInitialized) return;

    try {
      let adUnitIdToUse: string | undefined;

      // If placementKey is provided, fetch the placement configuration
      if (placementKey) {
        const placement = await getActivePlacement(placementKey);
        if (placement && placement.ad_unit && placement.ad_type === 'rewarded') {
          adUnitIdToUse = placement.ad_unit.unit_id;
        } else {
          console.warn(`Placement '${placementKey}' not found or not a rewarded ad`);
          // Fallback to config if available
          if (!this.config?.rewardedAdId) {
            console.error('No rewarded ad unit available');
            return;
          }
          adUnitIdToUse = this.config.rewardedAdId;
        }
      } else if (this.config?.rewardedAdId) {
        // Fallback to config rewarded ID
        adUnitIdToUse = this.config.rewardedAdId;
      } else {
        console.error('No rewarded ad unit ID available');
        return;
      }

      await AdMob.prepareRewardVideoAd({
        adId: adUnitIdToUse,
      });
    } catch (error) {
      console.error('Failed to prepare rewarded ad:', error);
    }
  }

  /**
   * Preload rewarded interstitial — env / init config only (no Supabase).
   * Pass `explicitAdUnitId` after a show to reload the same unit without any placement lookup.
   */
  async prepareRewardedInterstitialAd(explicitAdUnitId?: string) {
    if (!isNative || !this.isInitialized) return;

    try {
      const trimmedExplicit = explicitAdUnitId?.trim();
      const adUnitIdToUse =
        trimmedExplicit && trimmedExplicit.startsWith('ca-app-pub')
          ? trimmedExplicit
          : this.config?.rewardedInterstitialAdId?.trim() || resolveRewardedInterstitialAdUnitId();

      if (!adUnitIdToUse) return;

      await AdMob.prepareRewardInterstitialAd({
        adId: adUnitIdToUse,
      });
    } catch (error) {
      console.error('Failed to prepare rewarded interstitial:', error);
    }
  }

  async showRewardedAd(
    contentId?: string,
    contentType: string = 'general',
    placementKey?: string,
    adUnitId?: string,
    options?: FullscreenFrequencyOptions
  ): Promise<AdMobRewardItem | null> {
    if (!isNative || !this.isInitialized) {
      console.log('AdMob: Rewarded ad skipped (not native or not initialized)');
      return null;
    }
    await this.waitForStartupAdGuard();

    const acquiredFullscreenSlot = options?.bypassFrequencyGate === true ? false : this.tryAcquireFullscreenAdSlot();
    if (options?.bypassFrequencyGate !== true && !acquiredFullscreenSlot) return null;
    const releaseFullscreenSlotIfAcquired = () => {
      if (acquiredFullscreenSlot) {
        this.releaseFullscreenAdSlot();
      }
    };

    let resolvedAdUnitId: string | undefined;
    let resolvedPlacementKey: string | undefined;

    try {
      // Check display rules before showing ad
      const shouldShowAd = await this.checkDisplayRules(contentType);
      if (!shouldShowAd) {
        console.log('AdMob: Rewarded ad blocked by display rules');
        releaseFullscreenSlotIfAcquired();
        return null;
      }

      const directPubId =
        typeof adUnitId === 'string' && adUnitId.trim().startsWith('ca-app-pub');
      // Caller passed an explicit AdMob unit id (e.g. `VITE_ADMOB_REWARDED_ID`) — use it for prepare/show, not DB placement unit.
      if (directPubId) {
        resolvedAdUnitId = adUnitId.trim();
        resolvedPlacementKey = placementKey;
        await AdMob.prepareRewardVideoAd({
          adId: resolvedAdUnitId,
        });
      } else {
        let adUnitIdToUse: string | undefined = adUnitId;
        let placementKeyToUse: string | undefined = placementKey;

        // If placementKey is provided, fetch the placement configuration
        if (placementKey) {
          const placement = await getActivePlacement(placementKey);
          if (placement && placement.ad_unit && placement.ad_type === 'rewarded') {
            adUnitIdToUse = placement.ad_unit.unit_id;
            if (!adUnitId) {
              adUnitId = placement.ad_unit.id;
            }
            placementKeyToUse = placement.placement_key;
          } else {
            console.warn(`Placement '${placementKey}' not found or not a rewarded ad`);
            // Fallback to config if available
            if (!this.config?.rewardedAdId) {
              console.error('No rewarded ad unit available');
              releaseFullscreenSlotIfAcquired();
              return null;
            }
            adUnitIdToUse = this.config.rewardedAdId;
          }
        } else if (this.config?.rewardedAdId) {
          // Fallback to config rewarded ID
          adUnitIdToUse = this.config.rewardedAdId;
        } else {
          console.error('No rewarded ad unit ID available');
          releaseFullscreenSlotIfAcquired();
          return null;
        }

        resolvedAdUnitId = adUnitIdToUse;
        resolvedPlacementKey = placementKeyToUse;
        // Prepare the ad first
        await this.prepareRewardedAd(placementKeyToUse);
      }
    } catch (error) {
      console.error('Failed to prepare rewarded ad:', error);
      releaseFullscreenSlotIfAcquired();
      return null;
    }

    const rewardedPromise = new Promise<AdMobRewardItem | null>(async (resolve, reject) => {
      let rewardItem: AdMobRewardItem | null = null;
      let adStartTime = Date.now();
      let finalAdUnitId = resolvedAdUnitId;
      let finalPlacementKey = resolvedPlacementKey;

      const rewardListener = await AdMob.addListener(
        RewardAdPluginEvents.Rewarded,
        async (reward: AdMobRewardItem) => {
          rewardItem = reward;
          const duration = Math.floor((Date.now() - adStartTime) / 1000);
          
          // Record completed rewarded ad impression
          await this.recordImpression('rewarded', contentId, contentType, duration, true, finalPlacementKey, finalAdUnitId);
          
          // Log reward completion
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const isSongBonusReward = finalPlacementKey === SONG_BONUS_PLACEMENT_KEY;
            await logAdReward({
              userId: user.id,
              adUnitId: finalAdUnitId,
              placementKey: finalPlacementKey,
              rewardType: isSongBonusReward ? 'listener_score' : 'treats',
              rewardAmount: isSongBonusReward ? SONG_BONUS_LISTENER_SCORE_REWARD : reward.amount,
              completed: true,
              completionDuration: duration,
              metadata: { rewardType: reward.type }
            });
          }
        }
      );

      const dismissListener = await AdMob.addListener(
        RewardAdPluginEvents.Dismissed,
        async () => {
          // If ad was dismissed without reward, still record impression
          if (!rewardItem) {
            const duration = Math.floor((Date.now() - adStartTime) / 1000);
            await this.recordImpression('rewarded', contentId, contentType, duration, false, finalPlacementKey, finalAdUnitId);
            
            // Log skipped reward
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              await logAdReward({
                userId: user.id,
                adUnitId: finalAdUnitId,
                placementKey: finalPlacementKey,
                rewardType: 'treats',
                skipped: true,
                skipReason: 'Ad dismissed without completion',
                completionDuration: duration,
                metadata: { reason: 'user_dismissed' }
              });
            }
          }
          
          rewardListener.remove();
          dismissListener.remove();
          resolve(rewardItem);
        }
      );

      AdMob.showRewardVideoAd().catch((error) => {
        rewardListener.remove();
        dismissListener.remove();
        reject(error);
      });
    });

    try {
      return await rewardedPromise;
    } finally {
      releaseFullscreenSlotIfAcquired();
    }
  }

  /**
   * Rewarded interstitial (fullscreen) via native `RewardedInterstitialAd`.
   * Ad unit comes from init config, {@link resolveRewardedInterstitialAdUnitId}, or a `ca-app-pub` `adUnitId` — not Supabase.
   * `placementKey` is optional metadata for logging only.
   * If no RI unit exists but {@link AdMobConfig.rewardedAdId} is set, falls back to {@link showRewardedAd}.
   */
  async showRewardedInterstitial(
    contentId?: string,
    contentType: string = 'general',
    placementKey?: string,
    adUnitId?: string,
    options?: MutingFullscreenOptions
  ): Promise<AdMobRewardInterstitialItem | null> {
    if (!isNative || !this.isInitialized) {
      console.log('AdMob: Rewarded interstitial skipped (not native or not initialized)');
      return null;
    }
    await this.waitForStartupAdGuard();

    const acquiredFullscreenSlot = options?.bypassFrequencyGate === true ? false : this.tryAcquireFullscreenAdSlot();
    if (options?.bypassFrequencyGate !== true && !acquiredFullscreenSlot) return null;
    const shouldMute = options?.muteAppAudio ?? true;

    const directPubId =
      typeof adUnitId === 'string' && adUnitId.trim().startsWith('ca-app-pub');

    try {
      const shouldShowAd = await this.checkDisplayRules(contentType);
      if (!shouldShowAd) {
        console.log('AdMob: Rewarded interstitial blocked by display rules');
        return null;
      }

      let adUnitIdToUse: string | undefined;
      const placementKeyToUse = placementKey;

      if (directPubId) {
        adUnitIdToUse = adUnitId!.trim();
      } else {
        adUnitIdToUse =
          this.config?.rewardedInterstitialAdId?.trim() || resolveRewardedInterstitialAdUnitId();
        if (!adUnitIdToUse && this.config?.rewardedAdId) {
          const r = await this.showRewardedAd(contentId, contentType, placementKey, this.config.rewardedAdId, {
            bypassFrequencyGate: true,
          });
          if (!r) return null;
          return { type: r.type, amount: r.amount };
        }
        if (!adUnitIdToUse) {
          throw new Error('No rewarded interstitial ad unit ID available');
        }
      }

      await AdMob.prepareRewardInterstitialAd({
        adId: adUnitIdToUse!,
      });

      const restoreUnmute = () => {
        if (shouldMute && typeof AdMob.setApplicationMuted === 'function') {
          AdMob.setApplicationMuted({ muted: false }).catch(() => {});
        }
      };
      if (shouldMute && typeof AdMob.setApplicationMuted === 'function') {
        await AdMob.setApplicationMuted({ muted: true });
      }

      return await new Promise<AdMobRewardInterstitialItem | null>(async (resolve, reject) => {
        let rewardItem: AdMobRewardInterstitialItem | null = null;
        const adStartTime = Date.now();
        const finalAdUnitId = adUnitIdToUse!;
        const finalPlacementKey = placementKeyToUse;

        const rewardListener = await AdMob.addListener(
          RewardInterstitialAdPluginEvents.Rewarded,
          async (reward: AdMobRewardInterstitialItem) => {
            rewardItem = reward;
            const duration = Math.floor((Date.now() - adStartTime) / 1000);

            await this.recordImpression(
              'rewarded_interstitial',
              contentId,
              contentType,
              duration,
              true,
              finalPlacementKey,
              finalAdUnitId
            );

            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              const isSongBonusReward = finalPlacementKey === SONG_BONUS_PLACEMENT_KEY;
              await logAdReward({
                userId: user.id,
                adUnitId: finalAdUnitId,
                placementKey: finalPlacementKey,
                rewardType: isSongBonusReward ? 'listener_score' : 'treats',
                rewardAmount: isSongBonusReward ? SONG_BONUS_LISTENER_SCORE_REWARD : reward.amount,
                completed: true,
                completionDuration: duration,
                metadata: { rewardType: reward.type, adFormat: 'rewarded_interstitial' }
              });
            }
          }
        );

        const dismissListener = await AdMob.addListener(
          RewardInterstitialAdPluginEvents.Dismissed,
          async () => {
            restoreUnmute();
            void this.prepareRewardedInterstitialAd(finalAdUnitId);

            if (!rewardItem) {
              const duration = Math.floor((Date.now() - adStartTime) / 1000);
              await this.recordImpression(
                'rewarded_interstitial',
                contentId,
                contentType,
                duration,
                false,
                finalPlacementKey,
                finalAdUnitId
              );

              const { data: { user } } = await supabase.auth.getUser();
              if (user) {
                await logAdReward({
                  userId: user.id,
                  adUnitId: finalAdUnitId,
                  placementKey: finalPlacementKey,
                  rewardType: 'treats',
                  skipped: true,
                  skipReason: 'Ad dismissed without completion',
                  completionDuration: duration,
                  metadata: { reason: 'user_dismissed', adFormat: 'rewarded_interstitial' }
                });
              }
            }

            rewardListener.remove();
            dismissListener.remove();
            resolve(rewardItem);
          }
        );

        AdMob.showRewardInterstitialAd().catch((error) => {
          restoreUnmute();
          rewardListener.remove();
          dismissListener.remove();
          reject(error);
        });
      });
    } catch (error) {
      console.error('Failed to show rewarded interstitial:', error);
      const mute = options?.muteAppAudio ?? true;
      if (mute && typeof AdMob.setApplicationMuted === 'function') {
        AdMob.setApplicationMuted({ muted: false }).catch(() => {});
      }
      throw error;
    } finally {
      if (acquiredFullscreenSlot) {
        this.releaseFullscreenAdSlot();
      }
    }
  }

  /**
   * Show either an interstitial or a rewarded ad at random, with a single lock and cooldown
   * so they never run at once and cannot clash or crash the app.
   */
  /**
   * Show either an interstitial, rewarded, or rewarded interstitial ad with smart rotation.
   * Uses a single lock and cooldown so they never run at once and cannot clash or crash the app.
   */
  async showInterstitialOrRewarded(options: {
    contentId?: string;
    contentType?: string;
    interstitialPlacementKey?: string;
    rewardedPlacementKey?: string;
    rewardedInterstitialPlacementKey?: string;
    preferRewardedInterstitial?: boolean;
  } = {}): Promise<void> {
    if (!isNative) return;
    await this.waitForStartupAdGuard();
    if (!this.isInitialized) {
      this.pendingFullscreenAd = { ...options };
      return;
    }

    if (!this.tryAcquireFullscreenAdSlot()) return;

    const contentType = options.contentType ?? 'general';

    // If preferRewardedInterstitial is true, try it first
    const preferRewardedInterstitial = options.preferRewardedInterstitial ?? false;
    const rewardedInterstitialKey = options.rewardedInterstitialPlacementKey ?? 'between_songs_rewarded_interstitial';
    const interstitialKey = options.interstitialPlacementKey ?? 'after_song_play_interstitial';
    const rewardedKey = options.rewardedPlacementKey ?? 'after_video_play_rewarded';

    try {
      const shouldShow = await this.checkDisplayRules(contentType);
      if (!shouldShow) return;

      if (preferRewardedInterstitial) {
        // Try rewarded interstitial first
        try {
          await this.showRewardedInterstitial(options.contentId, contentType, rewardedInterstitialKey, undefined, {
            muteAppAudio: true,
            bypassFrequencyGate: true,
          });
        } catch (e) {
          // Fallback to regular interstitial or rewarded
          const useInterstitial = Math.random() < 0.5;
          if (useInterstitial) {
            await this.showInterstitial(options.contentId, contentType, interstitialKey, undefined, {
              bypassFrequencyGate: true,
            }).catch(() => {});
          } else {
            await this.showRewardedAd(options.contentId, contentType, rewardedKey, undefined, {
              bypassFrequencyGate: true,
            }).catch(() => {});
          }
        }
      } else {
        // Original logic: random between interstitial and rewarded
        const useInterstitial = Math.random() < 0.5;
        if (useInterstitial) {
          try {
            await this.showInterstitial(options.contentId, contentType, interstitialKey, undefined, {
              bypassFrequencyGate: true,
            });
          } catch (e) {
            await this.showRewardedAd(options.contentId, contentType, rewardedKey, undefined, {
              bypassFrequencyGate: true,
            }).catch(() => {});
          }
        } else {
          try {
            await this.showRewardedAd(options.contentId, contentType, rewardedKey, undefined, {
              bypassFrequencyGate: true,
            });
          } catch (e) {
            await this.showInterstitial(options.contentId, contentType, interstitialKey, undefined, {
              bypassFrequencyGate: true,
            }).catch(() => {});
          }
        }
      }
    } catch (e) {
      console.warn('AdMob: showInterstitialOrRewarded failed', e);
    } finally {
      this.releaseFullscreenAdSlot();
    }
  }

  isNativePlatform() {
    return isNative;
  }

  getInitializationStatus() {
    return this.isInitialized;
  }
}

export const admobService = new AdMobService();
