import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { SplashScreen as CapacitorSplashScreen } from '@capacitor/splash-screen';

const FADE_OUT_MS = 400;

interface SplashScreenProps {
  onFinished: () => void;
  minDisplayTime?: number;
  /** When true, splash dismisses as soon as minDisplayTime has passed (faster feel when app is ready). */
  appReady?: boolean;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  onFinished,
  minDisplayTime = 2000,
  appReady = false
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const startTimeRef = React.useRef<number>(Date.now());
  const dismissedRef = React.useRef(false);

  // Hide native splash on mobile
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      CapacitorSplashScreen.hide().catch(() => {});
    }
  }, []);

  // Dismiss after minDisplayTime when app is ready (or after minDisplayTime if appReady not passed)
  useEffect(() => {
    if (dismissedRef.current) return;
    // If caller doesn't pass appReady, we dismiss after minDisplayTime only
    const ready = appReady === undefined || appReady;
    if (appReady === false) return;

    const tryDismiss = () => {
      if (dismissedRef.current) return;
      dismissedRef.current = true;
      setIsLoading(false);
      setTimeout(() => {
        setIsVisible(false);
        onFinished();
      }, FADE_OUT_MS);
    };

    const elapsed = Date.now() - startTimeRef.current;
    const remaining = Math.max(0, minDisplayTime - elapsed);

    if (remaining === 0) {
      tryDismiss();
      return;
    }

    const id = setTimeout(tryDismiss, remaining);
    return () => clearTimeout(id);
  }, [minDisplayTime, onFinished, appReady]);

  if (!isVisible) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] bg-gradient-to-b from-[#0a0a0a] via-[#0d0d0d] to-[#111111] flex items-center justify-center transition-opacity duration-500 ${
        isLoading ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="flex flex-col items-center justify-center gap-0 px-8">
        {/* Logo with subtle animation */}
        <div className="relative animate-fade-in">
          <img
            src="/official_airaplay_logo.png"
            alt="Airaplay Logo"
            className="w-48 h-48 object-contain drop-shadow-2xl"
            style={{
              animation: 'breathe 3s ease-in-out infinite'
            }}
          />

          {/* Glow effect behind logo */}
          <div className="absolute inset-0 -z-10 blur-3xl opacity-30 bg-[#309605] scale-75 animate-pulse" />
        </div>
      </div>

      {/* Add custom keyframes via style tag */}
      <style>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        @keyframes breathe {
          0%, 100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.05);
            opacity: 0.9;
          }
        }

        .animate-fade-in {
          animation: fade-in 0.8s ease-out forwards;
        }
      `}</style>
    </div>
  );
};
