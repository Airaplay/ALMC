import { useEffect, useState } from 'react';
import { admobService } from '../lib/admobService';
import { AdMobRewardItem } from '@capacitor-community/admob';

export function useAdMob() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    setIsNative(admobService.isNativePlatform());
    setIsInitialized(admobService.getInitializationStatus());
  }, []);

  const showInterstitialAd = async (contentId?: string, contentType: string = 'general', placementKey?: string, adUnitId?: string) => {
    try {
      await admobService.prepareInterstitial();
      await admobService.showInterstitial(contentId, contentType, placementKey, adUnitId);
      return true;
    } catch (error) {
      console.error('Failed to show interstitial ad:', error);
      return false;
    }
  };

  const showRewardedAd = async (contentId?: string, contentType: string = 'general', placementKey?: string, adUnitId?: string): Promise<AdMobRewardItem | null> => {
    try {
      await admobService.prepareRewardedAd();
      const reward = await admobService.showRewardedAd(contentId, contentType, placementKey, adUnitId);
      return reward;
    } catch (error) {
      console.error('Failed to show rewarded ad:', error);
      return null;
    }
  };

  return {
    isInitialized,
    isNative,
    showInterstitialAd,
    showRewardedAd,
  };
}
