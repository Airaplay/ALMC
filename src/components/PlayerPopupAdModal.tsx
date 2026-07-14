import { useEffect, useMemo, useState } from 'react';
import { X, ExternalLink } from 'lucide-react';
import {
  getNativeAdsForPlacement,
  hasNativeAdClickUrl,
  NativeAdCard,
  recordNativeAdClick,
  recordNativeAdImpression,
} from '../lib/nativeAdService';

interface PlayerPopupAdModalProps {
  placementType: string;
  triggerKey: string;
  userCountry?: string;
}

export const PlayerPopupAdModal = ({ placementType, triggerKey, userCountry }: PlayerPopupAdModalProps): JSX.Element | null => {
  const [ad, setAd] = useState<NativeAdCard | null>(null);
  const [visible, setVisible] = useState(false);

  const safeCountry = useMemo(() => userCountry ?? null, [userCountry]);

  useEffect(() => {
    let mounted = true;
    const timers: number[] = [];

    setVisible(false);
    setAd(null);

    (async () => {
      try {
        const ads = await getNativeAdsForPlacement(placementType, safeCountry, null, undefined, 1, 'visual');
        if (!mounted) return;
        const nextAd = ads[0] ?? null;
        if (!nextAd) return;

        setAd(nextAd);
        const delayMs = 12_000 + Math.floor(Math.random() * 13_000); // 12-25s
        timers.push(window.setTimeout(() => {
          if (!mounted) return;
          setVisible(true);
          void recordNativeAdImpression(nextAd.id);

          // Auto-dismiss popup after 15s to avoid blocking player UX.
          timers.push(window.setTimeout(() => {
            if (!mounted) return;
            setVisible(false);
          }, 15_000));
        }, delayMs));
      } catch {
        if (!mounted) return;
        setAd(null);
      }
    })();

    return () => {
      mounted = false;
      for (const timerId of timers) {
        window.clearTimeout(timerId);
      }
    };
  }, [placementType, triggerKey, safeCountry]);

  if (!ad || !visible) return null;

  const clickEnabled = hasNativeAdClickUrl(ad.click_url);

  const handleClose = () => {
    setVisible(false);
  };

  const handleVisit = async () => {
    if (!clickEnabled) return;
    await recordNativeAdClick(ad.id);
    window.open(ad.click_url, '_blank', 'noopener,noreferrer');
    setVisible(false);
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-[1px] flex items-center justify-center px-5">
      <div className="w-full max-w-sm rounded-2xl bg-[#111] border border-white/15 shadow-2xl overflow-hidden">
        <div className="relative">
          <button
            type="button"
            onClick={handleClose}
            className="absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center text-white"
            aria-label="Close popup ad"
          >
            <X className="w-4 h-4" />
          </button>
          <img
            src={ad.image_url}
            alt={ad.title}
            className="w-full h-44 object-cover"
          />
          <div className="absolute top-2 left-2 px-2 py-1 rounded bg-blue-600/90 text-[10px] font-semibold text-white">
            Sponsored
          </div>
        </div>
        <div className="p-4">
          <h3 className="text-white text-sm font-semibold truncate">{ad.title}</h3>
          {ad.description ? (
            <p className="text-white/70 text-xs mt-1 line-clamp-2">{ad.description}</p>
          ) : null}
          {ad.advertiser_name?.trim() ? (
            <p className="text-white/50 text-[11px] mt-1">by {ad.advertiser_name}</p>
          ) : null}
          <button
            type="button"
            onClick={handleVisit}
            disabled={!clickEnabled}
            className={`mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              clickEnabled
                ? 'bg-[#00ad74] hover:bg-[#009c68] text-white'
                : 'bg-white/10 text-white/50 cursor-not-allowed'
            }`}
          >
            {clickEnabled ? (
              <>
                Learn More
                <ExternalLink className="w-4 h-4" />
              </>
            ) : (
              'No destination link'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
