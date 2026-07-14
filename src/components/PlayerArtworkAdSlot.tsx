import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { NativeAdData } from '@brandonknudsen/admob-native-advanced';
import { getNativeAdsForPlacement, type NativeAdCard } from '../lib/nativeAdService';
import { loadNativeArtworkAd } from '../lib/admobNativeAdvancedService';
import { getOptimizedImageUrl } from '../lib/imageOptimization';
import { PlayerStaticAdBanner } from './PlayerStaticAdBanner';
import { PlayerAdmobNativeArtwork } from './PlayerAdmobNativeArtwork';

/** AdMob Native Advanced bursts in the artwork slot per song (native app only). */
const ADMOB_DISPLAYS_PER_SONG = 6;
const ADMOB_SHOW_DURATION_MS = 20_000;
const SUPABASE_SHOW_DURATION_MS = 20_000;
const MIN_FIRST_ADMOB_DELAY_MS = 8_000;
const FALLBACK_ADMOB_INTERVAL_MS = 45_000;

interface PlayerArtworkSong {
  id: string;
  title: string;
  coverImageUrl?: string | null;
  duration?: number;
}

interface PlayerArtworkAdSlotProps {
  song: PlayerArtworkSong;
  userCountry?: string;
  /** Supabase native_ad_cards placement (e.g. music_player). */
  supabasePlacement?: string;
  className?: string;
}

type ActiveArtworkAd = 'admob' | 'supabase' | null;

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

export const PlayerArtworkAdSlot = ({
  song,
  userCountry,
  supabasePlacement = 'music_player',
  className = '',
}: PlayerArtworkAdSlotProps): JSX.Element => {
  const [inlineAd, setInlineAd] = useState<NativeAdCard | null>(null);
  const [admobAd, setAdmobAd] = useState<NativeAdData | null>(null);
  const [admobBurstKey, setAdmobBurstKey] = useState<string | null>(null);
  const [showInlineAd, setShowInlineAd] = useState(false);
  const [activeAd, setActiveAd] = useState<ActiveArtworkAd>(null);
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

  // Load Supabase sponsored card once per song (non-blocking).
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

  // Schedule AdMob Native Advanced bursts per song (native only).
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

  // Optional Supabase burst (even songs) — separate so async card load does not reset AdMob schedule.
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

  return (
    <div className={`px-3 py-4 flex-1 min-h-0 ${className}`}>
      <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-white/5 shadow-lg">
        {!showSupabase && song.coverImageUrl ? (
          <img
            key={song.id}
            src={getOptimizedImageUrl(song.coverImageUrl, {
              width: 640,
              height: 640,
              quality: 78,
              format: 'webp',
            })}
            alt={song.title}
            className="w-full h-full object-cover"
            draggable={false}
            decoding="async"
            fetchPriority="high"
          />
        ) : !showSupabase ? (
          <div className="w-full h-full flex items-center justify-center bg-white/5">
            <span className="text-4xl font-bold text-white/30">♪</span>
          </div>
        ) : null}

        {showSupabase ? (
          <div className="absolute inset-0 z-10">
            <PlayerStaticAdBanner ad={inlineAd} variant="artwork" className="h-full w-full" />
          </div>
        ) : null}

        {showAdmob ? (
          <PlayerAdmobNativeArtwork
            key={admobBurstKey ?? admobAd.adId}
            ad={admobAd}
            visible
          />
        ) : null}
      </div>
    </div>
  );
};
