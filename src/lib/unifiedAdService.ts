import { Capacitor } from '@capacitor/core';
import { admobService } from './admobService';
import { monetagService } from './monetagService';
import { BannerAdPosition } from '@capacitor-community/admob';
import { supabase } from './supabase';

const isNative = Capacitor.isNativePlatform();

export type AdNetwork = 'admob' | 'monetag' | 'auto';

class UnifiedAdService {
  private preferredNetwork: AdNetwork = 'auto';
  private monetagEnabled = false;
  private admobEnabled = false;

  /**
   * Initialize both ad networks and determine which to use
   */
  async initialize() {
    // Check which networks are active in database
    const { data: networks } = await supabase
      .from('ad_networks')
      .select('network, is_active')
      .in('network', ['admob', 'monetag']);

    this.admobEnabled = networks?.some(n => n.network === 'admob' && n.is_active) || false;
    this.monetagEnabled = networks?.some(n => n.network === 'monetag' && n.is_active) || false;

    // Initialize AdMob (native only)
    if (isNative && this.admobEnabled) {
      try {
        await admobService.initialize();
      } catch (error) {
        console.error('Failed to initialize AdMob:', error);
        this.admobEnabled = false;
      }
    }

    // Initialize Monetag (web and native)
    if (this.monetagEnabled) {
      try {
        await monetagService.initialize();
      } catch (error) {
        console.error('Failed to initialize Monetag:', error);
        this.monetagEnabled = false;
      }
    }

    // Determine preferred network
    this.determinePreferredNetwork();
  }

  /**
   * Determine which ad network to use based on availability
   */
  private determinePreferredNetwork() {
    if (this.preferredNetwork === 'auto') {
      // Prefer AdMob on native, Monetag on web
      if (isNative && this.admobEnabled) {
        this.preferredNetwork = 'admob';
      } else if (this.monetagEnabled) {
        this.preferredNetwork = 'monetag';
      } else if (this.admobEnabled) {
        this.preferredNetwork = 'admob';
      }
    }
  }

  /**
   * Set preferred ad network
   */
  setPreferredNetwork(network: AdNetwork) {
    this.preferredNetwork = network;
  }

  /**
   * Show banner ad using the appropriate network
   */
  async showBanner(
    position: BannerAdPosition = BannerAdPosition.BOTTOM_CENTER,
    contentId?: string,
    contentType: string = 'general',
    placementKey?: string,
    adUnitId?: string
  ) {
    const network = this.getNetworkToUse();

    if (network === 'monetag' && this.monetagEnabled) {
      // Monetag doesn't have traditional banners, skip or use interstitial
      console.log('Monetag: Banner ads not supported, skipping');
      return;
    } else if (network === 'admob' && this.admobEnabled && isNative) {
      await admobService.showBanner(position, contentId, contentType, placementKey, adUnitId);
    }
  }

  /**
   * Show interstitial ad
   */
  async showInterstitial(placementKey?: string, adUnitId?: string, userId?: string): Promise<boolean> {
    const network = this.getNetworkToUse();

    if (network === 'monetag' && this.monetagEnabled) {
      return await monetagService.showInterstitial(placementKey, adUnitId, userId);
    } else if (network === 'admob' && this.admobEnabled && isNative) {
      await admobService.showInterstitial(placementKey, adUnitId, userId);
      return true;
    }

    return false;
  }

  /**
   * Show rewarded ad
   */
  async showRewarded(placementKey?: string, adUnitId?: string, userId?: string): Promise<boolean> {
    const network = this.getNetworkToUse();

    if (network === 'monetag' && this.monetagEnabled) {
      return await monetagService.showRewarded(placementKey, adUnitId, userId);
    } else if (network === 'admob' && this.admobEnabled && isNative) {
      await admobService.showRewarded(placementKey, adUnitId, userId);
      return true;
    }

    return false;
  }

  /**
   * Get which network to use
   */
  private getNetworkToUse(): 'admob' | 'monetag' {
    if (this.preferredNetwork === 'auto') {
      this.determinePreferredNetwork();
    }

    if (this.preferredNetwork === 'monetag' && this.monetagEnabled) {
      return 'monetag';
    } else if (this.preferredNetwork === 'admob' && this.admobEnabled && isNative) {
      return 'admob';
    } else if (this.monetagEnabled) {
      return 'monetag';
    } else if (this.admobEnabled && isNative) {
      return 'admob';
    }

    return 'admob'; // Fallback
  }

  /**
   * Hide banner
   */
  async hideBanner() {
    if (this.admobEnabled && isNative) {
      await admobService.hideBanner();
    }
    // Monetag doesn't have persistent banners
  }

  /**
   * Remove banner
   */
  async removeBanner() {
    if (this.admobEnabled && isNative) {
      await admobService.removeBanner();
    }
  }

  /**
   * Check if Monetag is enabled
   */
  isMonetagEnabled(): boolean {
    return this.monetagEnabled;
  }

  /**
   * Check if AdMob is enabled
   */
  isAdMobEnabled(): boolean {
    return this.admobEnabled && isNative;
  }
}

export const unifiedAdService = new UnifiedAdService();