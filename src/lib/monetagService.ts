import { supabase } from './supabase';
import { logAdImpression, logAdRevenue } from './adLoggingService';
import { getActivePlacement } from './adPlacementService';

export interface MonetagConfig {
  zoneId: string;
  isActive: boolean;
}

// Declare Monetag SDK types
declare global {
  interface Window {
    [key: string]: any; // For dynamic function names like show_XXX
  }
}

interface MonetagAdOptions {
  ymid?: string; // User ID for tracking
  requestVar?: string; // Custom variable for analytics
}

class MonetagService {
  private config: MonetagConfig | null = null;
  private isInitialized = false;
  private scriptLoaded = false;
  private scriptElement: HTMLScriptElement | null = null;

  /**
   * Initialize Monetag from database configuration
   * Loads Monetag zone ID from ad_networks table
   */
  async initialize(config?: MonetagConfig) {
    try {
      // Load Monetag configuration from database
      const { data: adNetwork, error } = await supabase
        .from('ad_networks')
        .select('app_id, is_active, api_key')
        .eq('network', 'monetag')
        .eq('is_active', true)
        .single();

      if (error || !adNetwork) {
        console.warn('Monetag network not found in database, using fallback config:', error);
        if (config?.zoneId) {
          this.config = config;
        } else {
          console.error('Cannot initialize Monetag: No configuration found');
          return;
        }
      } else {
        // Use zone ID from database (stored in app_id field, or api_key as fallback)
        this.config = {
          zoneId: adNetwork.app_id || adNetwork.api_key || '',
          isActive: adNetwork.is_active
        };
      }

      if (!this.config.zoneId) {
        console.error('Cannot initialize Monetag: No zone ID found');
        return;
      }

      // Load Monetag SDK script
      await this.loadScript(this.config.zoneId);

      this.isInitialized = true;
      console.log('Monetag initialized successfully with Zone ID:', this.config.zoneId);
    } catch (error) {
      console.error('Failed to initialize Monetag:', error);
      this.isInitialized = false;
    }
  }

  /**
   * Load Monetag SDK script dynamically
   */
  private async loadScript(zoneId: string): Promise<void> {
    if (this.scriptLoaded) {
      return;
    }

    return new Promise((resolve, reject) => {
      const existingScript = document.querySelector(`script[data-zone="${zoneId}"]`);
      if (existingScript) {
        this.scriptLoaded = true;
        resolve();
        return;
      }

      this.scriptElement = document.createElement('script');
      this.scriptElement.src = 'https://monetag.com/show.js';
      this.scriptElement.setAttribute('data-zone', zoneId);
      this.scriptElement.async = true;

      this.scriptElement.onload = () => {
        this.scriptLoaded = true;
        console.log('Monetag SDK loaded successfully');
        resolve();
      };

      this.scriptElement.onerror = () => {
        console.error('Failed to load Monetag SDK');
        reject(new Error('Failed to load Monetag SDK'));
      };

      document.head.appendChild(this.scriptElement);
    });
  }

  /**
   * Check if Monetag is active and initialized
   */
  isActive(): boolean {
    return this.isInitialized && this.config?.isActive === true && this.scriptLoaded;
  }

  /**
   * Show an interstitial ad
   */
  async showInterstitial(placementKey?: string, adUnitId?: string, userId?: string): Promise<boolean> {
    if (!this.isActive()) {
      console.log('Monetag: Interstitial skipped (not active or not initialized)');
      return false;
    }

    if (!this.config?.zoneId) {
      console.error('Monetag: No zone ID configured');
      return false;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const ymid = userId || user?.id || undefined;

      let requestVar = placementKey;
      if (placementKey) {
        const placement = await getActivePlacement(placementKey);
        if (placement) {
          requestVar = placement.placement_key;
        }
      }

      const showFunctionName = `show_${this.config.zoneId}`;
      const showFunction = (window as any)[showFunctionName];

      if (!showFunction || typeof showFunction !== 'function') {
        console.error(`Monetag: Function ${showFunctionName} not found. SDK may not be loaded.`);
        return false;
      }

      await showFunction({
        ymid,
        requestVar
      });

      await this.recordImpression('interstitial', undefined, 'general', 0, true, placementKey, adUnitId);
      return true;
    } catch (error) {
      console.error('Monetag: Failed to show interstitial:', error);
      await this.recordImpression('interstitial', undefined, 'general', 0, false, placementKey, adUnitId);
      return false;
    }
  }

  /**
   * Show a rewarded ad
   */
  async showRewarded(placementKey?: string, adUnitId?: string, userId?: string): Promise<boolean> {
    return await this.showInterstitial(placementKey, adUnitId, userId);
  }

  async hideBanner(): Promise<void> {
    // Monetag doesn't have persistent banners
  }

  async removeBanner(): Promise<void> {
    // Monetag doesn't have persistent banners
  }

  private async recordImpression(
    adType: string,
    contentId?: string,
    contentType: string = 'general',
    duration: number = 0,
    completed: boolean = false,
    placementKey?: string,
    adUnitId?: string
  ) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

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

      await logAdImpression({
        adImpressionId: impressionData?.id || undefined,
        userId: user.id,
        adUnitId: adUnitId,
        placementKey: placementKey,
        network: 'monetag',
        adType: adType,
        viewDuration: duration,
        completed: completed,
        failed: !completed && duration === 0
      });

      const estimatedCPM = adType === 'rewarded' ? 3.0 : adType === 'interstitial' ? 2.0 : 1.0;
      const estimatedRevenue = (estimatedCPM / 1000) * (completed ? 1 : 0.5);

      await logAdRevenue({
        adImpressionId: impressionData?.id || undefined,
        adUnitId: adUnitId,
        networkId: undefined,
        placementKey: placementKey,
        estimatedCPM: estimatedCPM,
        estimatedRevenue: estimatedRevenue,
        network: 'monetag'
      });
    } catch (error) {
      console.error('Failed to record Monetag impression:', error);
    }
  }

  cleanup() {
    if (this.scriptElement?.parentNode) {
      this.scriptElement.parentNode.removeChild(this.scriptElement);
      this.scriptElement = null;
    }
    this.scriptLoaded = false;
    this.isInitialized = false;
    this.config = null;
  }
}

export const monetagService = new MonetagService();