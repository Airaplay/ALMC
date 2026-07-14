import { useEffect } from 'react';
import { admobService } from '../lib/admobService';
import { BannerAdPosition } from '@capacitor-community/admob';

interface AdMobBannerProps {
  position?: BannerAdPosition;
  show?: boolean;
}

export function AdMobBanner({ position = BannerAdPosition.BOTTOM_CENTER, show = true }: AdMobBannerProps) {
  useEffect(() => {
    const service = admobService;
    if (!service?.isNativePlatform?.()) {
      return;
    }

    if (show) {
      service.showBanner(position).catch(() => {});
    } else {
      service.hideBanner().catch(() => {});
    }

    return () => {
      service.removeBanner().catch(() => {});
    };
  }, [show, position]);

  if (!admobService?.isNativePlatform?.()) {
    return (
      <div className="bg-gray-200 p-4 text-center text-sm text-gray-600">
        Ad Banner (Preview - Shows on mobile)
      </div>
    );
  }

  return null;
}
