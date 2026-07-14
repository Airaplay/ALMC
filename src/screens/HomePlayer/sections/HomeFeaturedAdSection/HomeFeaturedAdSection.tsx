import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  getNativeAdsForPlacement,
  hasNativeAdClickUrl,
  recordNativeAdClick,
  recordNativeAdImpression,
  type NativeAdCard,
} from "../../../../lib/nativeAdService";

interface HomeFeaturedAdSectionProps {
  placement: string;
}

export const HomeFeaturedAdSection = ({ placement }: HomeFeaturedAdSectionProps): JSX.Element | null => {
  const [ad, setAd] = useState<NativeAdCard | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const ads = await getNativeAdsForPlacement(placement, null, null, undefined, 1, "visual");
      if (!mounted) return;
      const firstAd = ads[0] ?? null;
      setAd(firstAd);
      if (firstAd) {
        void recordNativeAdImpression(firstAd.id);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [placement]);

  if (!ad) return null;

  const clickEnabled = hasNativeAdClickUrl(ad.click_url);

  const handleVisit = async () => {
    if (!clickEnabled) return;
    await recordNativeAdClick(ad.id);
    window.open(ad.click_url, "_blank", "noopener,noreferrer");
  };

  const cardClass =
    "w-full text-left rounded-2xl overflow-hidden border border-white/10 bg-white/[0.03]";

  const inner = (
    <>
      <img src={ad.image_url} alt={ad.title} className="w-full h-40 object-cover" />
      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] text-white/55 uppercase tracking-wide">Sponsored</p>
            <h3 className="text-white font-semibold text-sm truncate">{ad.title}</h3>
            {ad.advertiser_name?.trim() ? (
              <p className="text-white/65 text-xs truncate mt-0.5">by {ad.advertiser_name}</p>
            ) : null}
          </div>
          {clickEnabled ? <ExternalLink className="w-4 h-4 text-white/70 shrink-0" /> : null}
        </div>
      </div>
    </>
  );

  return (
    <section className="w-full px-6 py-2">
      {clickEnabled ? (
        <button type="button" onClick={handleVisit} className={`${cardClass} active:scale-[0.995] transition-transform`}>
          {inner}
        </button>
      ) : (
        <div className={cardClass}>{inner}</div>
      )}
    </section>
  );
};
