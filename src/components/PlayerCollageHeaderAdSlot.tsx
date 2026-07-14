import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import type { NativeAdData } from '@brandonknudsen/admob-native-advanced';
import { getNativeAdsForPlacement, type NativeAdCard } from '../lib/nativeAdService';
import { loadNativeArtworkAd } from '../lib/admobNativeAdvancedService';
import { PlayerStaticAdBanner } from './PlayerStaticAdBanner';
import { PlayerAdmobNativeArtwork } from './PlayerAdmobNativeArtwork';
import { cn } from '../lib/utils';

/** AdMob Native Advanced bursts in player header collage per song (native app only). */
const ADMOB_DISPLAYS_PER_SONG = 6;
const ADMOB_SHOW_DURATION_MS = 20_000;
const SUPABASE_SHOW_DURATION_MS = 20_000;
const MIN_FIRST_ADMOB_DELAY_MS = 8_000;
const FALLBACK_ADMOB_INTERVAL_MS = 45_000;

interface PlayerCollageHeaderAdSong {
  id: string;
  title: string;
  duration?: number;
}

interface PlayerCollageHeaderAdSlotProps {
  song: PlayerCollageHeaderAdSong;
  userCountry?: string;
  supabasePlacement?: string;
  className?: string;
  background: ReactNode;
  children: ReactNode;
}

type ActiveHeaderAd = 'admob' | 'supabase' | null;

function getAdmobShowAtMs(displayIndex: number, durationSeconds?: number): number {
  if (displayIndex <= 0) return MIN_FIRST_ADMOB_DELAY_MS;

  if (durationSeconds && durationSeconds >= 75) {
    const totalMs = durationSeconds * 1000;
    const endPadMs = 12_000;
    const usableMs =
      totalMs - MIN_FIRST_ADMOB_DELAY_MS - endPadMs - ADMOB_SHOW_DURATION_MS;
    if (usableMs > 0 && ADMOB_DISPLAYS_PER_SONG > 1) {
      const stepMs = usableMs / (ADMOB_DISPLAYS_PER_SONG - 1);
      return Math.floor(MIN_FIRST_ADMOB_DELAY_MS + displayIndex * stepMs);
    }
  }

  return MIN_FIRST_ADMOB_DELAY_MS + displayIndex * FALLBACK_ADMOB_INTERVAL_MS;
}

function getSupabaseShowAtMs(durationSeconds?: number): number {
  if (durationSeconds && durationSeconds >= 60) {
    return Math.floor(durationSeconds * 1000 * 0.42);
  }
  return 35_000;
}

export const PlayerCollageHeaderAdSlot = ({
  song,
  userCountry,
  supabasePlacement = 'music_player',
  className = '',
  background,
  children,
}: PlayerCollageHeaderAdSlotProps): JSX.Element => {
  const [inlineAd, setInlineAd] = useState<NativeAdCard | null>(null);
  const [admobAd, setAdmobAd] = useState<NativeAdData | null>(null);
  const [admobBurstKey, setAdmobBurstKey] = useState<string | null>(null);
  const [showInlineAd, setShowInlineAd] = useState(false);
  const [activeAd, setActiveAd] = useState<ActiveHeaderAd>(null);
  const timersRef = useRef<number[]>([]);
  const slotBusyRef = useRef(false);
  const songRotationRef = useRef(0);
  const isNative = Capacitor.isNativePlatform();

  const clearTimers = () => {
    for (const id of timersRef.current) {
      window.clearTimeout(id);
    }
    timersRef.current = [];
  };

  const hideActiveAd = () => {
    slotBusyRef.current = false;
    setShowInlineAd(false);
    setActiveAd(null);
  };

  const showSupabaseBurst = () => {
    if (!inlineAd || slotBusyRef.current) return;
    slotBusyRef.current = true;
    setActiveAd('supabase');
    setShowInlineAd(true);

    const hideId = window.setTimeout(() => {
      hideActiveAd();
    }, SUPABASE_SHOW_DURATION_MS);
    timersRef.current.push(hideId);
  };

  const showAdmobBurst = (burstIndex: number) => {
    if (!isNative || slotBusyRef.current) return;

    void loadNativeArtworkAd().then((ad) => {
      if (!ad || slotBusyRef.current) return;

      slotBusyRef.current = true;
      setAdmobAd(ad);
      setAdmobBurstKey(`${song.id}-${burstIndex}`);
      setActiveAd('admob');
      setShowInlineAd(true);

      const hideId = window.setTimeout(() => {
        hideActiveAd();
      }, ADMOB_SHOW_DURATION_MS);
      timersRef.current.push(hideId);
    });
  };

  useEffect(() => {
    songRotationRef.current += 1;
  }, [song.id]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const ads = await getNativeAdsForPlacement(supabasePlacement, userCountry ?? null, null, 1);
        if (!mounted) return;
        const visualOnlyAd =
          ads.find((ad) => !ad.audio_url || ad.audio_url.trim().length === 0) ?? null;
        setInlineAd(visualOnlyAd);
      } catch {
        if (!mounted) return;
        setInlineAd(null);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [supabasePlacement, userCountry, song.id]);

  useEffect(() => {
    if (!isNative) return;

    clearTimers();
    hideActiveAd();
    setAdmobAd(null);
    setAdmobBurstKey(null);

    for (let i = 0; i < ADMOB_DISPLAYS_PER_SONG; i += 1) {
      const showAtMs = getAdmobShowAtMs(i, song.duration);
      const showId = window.setTimeout(() => {
        showAdmobBurst(i);
      }, showAtMs);
      timersRef.current.push(showId);
    }

    return () => {
      clearTimers();
      hideActiveAd();
    };
  }, [isNative, song.duration, song.id]);

  useEffect(() => {
    if (!inlineAd || songRotationRef.current % 2 !== 0) return;

    const showAtMs = getSupabaseShowAtMs(song.duration);
    const showId = window.setTimeout(() => {
      showSupabaseBurst();
    }, showAtMs);

    return () => {
      window.clearTimeout(showId);
    };
  }, [inlineAd, song.duration, song.id]);

  const showAdmob = showInlineAd && activeAd === 'admob' && admobAd;
  const showSupabase = showInlineAd && activeAd === 'supabase' && inlineAd;
  const adVisible = Boolean(showAdmob || showSupabase);

  return (
    <div className={cn('relative overflow-hidden rounded-2xl min-h-[200px]', className)}>
      <div
        className={cn(
          'absolute inset-0 z-0 transition-opacity duration-300',
          adVisible && 'opacity-0 pointer-events-none'
        )}
      >
        {background}
      </div>

      <div
        className={cn(
          'relative z-10 min-h-[200px] transition-opacity duration-300',
          adVisible && 'opacity-0 pointer-events-none'
        )}
      >
        {children}
      </div>

      {showSupabase ? (
        <div className="absolute inset-0 z-20">
          <PlayerStaticAdBanner ad={inlineAd} variant="fill" className="h-full w-full rounded-2xl" />
        </div>
      ) : null}

      {showAdmob ? (
        <PlayerAdmobNativeArtwork
          key={admobBurstKey ?? admobAd.adId}
          ad={admobAd}
          visible
          className="z-20"
        />
      ) : null}
    </div>
  );
};
