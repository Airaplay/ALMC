import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { recordNativeAdClick } from '../lib/nativeAdService';
import { normalizeExternalHref, openExternalUrl } from '../lib/openExternalUrl';

type CompanionAd = {
  id: string;
  title?: string;
  advertiserName?: string;
  imageUrl?: string | null;
  clickUrl?: string | null;
  ctaText?: string | null;
};

type CompanionPayload =
  | {
      action: 'show';
      ad: CompanionAd;
    }
  | {
      action: 'hide';
      adId?: string;
    };

export function AudioAdCompanionOverlay(): JSX.Element | null {
  const [visible, setVisible] = useState(false);
  const [ad, setAd] = useState<CompanionAd | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<CompanionPayload>).detail;
      if (!detail) return;

      if (detail.action === 'show') {
        setAd(detail.ad);
        setVisible(true);
        return;
      }
      if (detail.action === 'hide') {
        setVisible(false);
        return;
      }
    };

    window.addEventListener('airaplay:audioAdCompanion', handler as EventListener);
    return () => {
      window.removeEventListener('airaplay:audioAdCompanion', handler as EventListener);
    };
  }, []);

  const imageUrl = useMemo(() => {
    const url = (ad?.imageUrl ?? '').toString().trim();
    return url.length > 0 ? url : null;
  }, [ad?.imageUrl]);

  const ctaText = useMemo(() => {
    const raw = (ad?.ctaText ?? '').toString().trim();
    return raw.length > 0 ? raw : 'Learn More';
  }, [ad?.ctaText]);

  const clickUrl = useMemo(() => {
    const url = (ad?.clickUrl ?? '').toString().trim();
    return url.length > 0 ? url : null;
  }, [ad?.clickUrl]);

  if (!visible || !ad) return null;

  const handleCtaClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!clickUrl) return;
    void recordNativeAdClick(ad.id);
    try {
      await openExternalUrl(clickUrl);
    } catch {
      const href = normalizeExternalHref(clickUrl);
      if (href) window.open(href, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-6">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl overflow-hidden bg-white/5 border border-white/10 shadow-2xl">
          <div className="relative w-full aspect-square bg-black/30 flex items-center justify-center">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt=""
                className="w-full h-full object-cover"
                draggable={false}
                loading="eager"
                decoding="async"
                fetchPriority="high"
              />
            ) : (
              <div className="text-white/60 text-sm">Sponsored</div>
            )}
            <button
              type="button"
              className="absolute top-3 right-3 z-10 p-2 rounded-full bg-black/50 border border-white/20 text-white hover:bg-black/70 hover:border-white/30 transition-colors shadow-lg"
              onClick={() => setVisible(false)}
              aria-label="Hide ad"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3">
            <button
              type="button"
              onClick={handleCtaClick}
              disabled={!clickUrl}
              className={cn(
                'w-full touch-manipulation inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all',
                clickUrl
                  ? 'bg-white text-black hover:opacity-90 active:scale-[0.99]'
                  : 'bg-white/20 text-white/60 cursor-not-allowed'
              )}
            >
              <ExternalLink className="w-4 h-4" />
              {ctaText}
            </button>
          </div>
        </div>

        <p className="mt-3 text-center text-white/60 text-[11px]">
          Audio ad is playing…
        </p>
      </div>
    </div>
  );
}

