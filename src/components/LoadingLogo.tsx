import { useEffect, useState } from 'react';

interface LoadingLogoProps {
  variant?: 'pulse' | 'wave' | 'spin' | 'breathe' | 'premium';
  size?: number;
  className?: string;
}

export const LoadingLogo = ({
  variant = 'premium',
  size = 80,
  className = ''
}: LoadingLogoProps): JSX.Element => {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const getAnimationClass = () => {
    if (reducedMotion) return '';

    switch (variant) {
      case 'pulse':
        return 'animate-loading-pulse';
      case 'wave':
        return 'animate-loading-wave';
      case 'spin':
        return 'animate-loading-spin';
      case 'breathe':
        return 'animate-loading-breathe';
      case 'premium':
        return 'animate-loading-premium';
      default:
        return 'animate-loading-premium';
    }
  };

  return (
    <div
      className={`flex items-center justify-center ${className}`}
      role="status"
      aria-label="Loading"
    >
      <div
        className="relative"
        style={{
          width: size,
          height: size,
          willChange: 'transform, opacity'
        }}
      >
        {/* Outer glow rings - Premium effect */}
        {!reducedMotion && (
          <>
            {/* Rotating outer ring */}
            <div className="absolute inset-0 animate-loading-rotate">
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#309605] border-r-[#309605] opacity-60" />
            </div>

            {/* Counter-rotating middle ring */}
            <div className="absolute inset-0 animate-loading-rotate-reverse">
              <div className="absolute inset-[8%] rounded-full border-2 border-transparent border-b-[#3ba208] border-l-[#3ba208] opacity-40" />
            </div>

            {/* Pulsing glow layers */}
            <div className="absolute inset-[-20%] rounded-full bg-[#309605] opacity-10 blur-2xl animate-loading-glow-1" />
            <div className="absolute inset-[-10%] rounded-full bg-[#3ba208] opacity-20 blur-xl animate-loading-glow-2" />

            {/* Expanding wave rings */}
            <div className="absolute inset-0 rounded-full border-2 border-[#309605] opacity-60 animate-loading-wave-ring-1" />
            <div className="absolute inset-0 rounded-full border-2 border-[#309605] opacity-40 animate-loading-wave-ring-2" />
            <div className="absolute inset-0 rounded-full border-2 border-[#309605] opacity-20 animate-loading-wave-ring-3" />

            {/* Floating particles */}
            <div className="absolute top-0 left-1/2 w-1 h-1 bg-[#309605] rounded-full animate-loading-particle-1" />
            <div className="absolute top-1/4 right-0 w-1.5 h-1.5 bg-[#3ba208] rounded-full animate-loading-particle-2" />
            <div className="absolute bottom-1/4 left-0 w-1 h-1 bg-[#309605] rounded-full animate-loading-particle-3" />
            <div className="absolute bottom-0 right-1/3 w-1.5 h-1.5 bg-[#3ba208] rounded-full animate-loading-particle-4" />
          </>
        )}

        {/* Main logo with enhanced animation */}
        <div className={`absolute inset-0 ${getAnimationClass()}`}>
          <img
            src="/official_airaplay_logo.png"
            alt="Loading"
            className="w-full h-full object-contain"
            style={{
              filter: 'drop-shadow(0 0 20px rgba(48, 150, 5, 0.6)) drop-shadow(0 0 40px rgba(48, 150, 5, 0.3))',
              imageRendering: 'crisp-edges'
            }}
          />
        </div>

        {/* Inner glow burst */}
        {!reducedMotion && (
          <div className="absolute inset-[20%] rounded-full bg-gradient-radial from-[#309605]/30 via-[#309605]/10 to-transparent animate-loading-burst" />
        )}
      </div>
    </div>
  );
};

export const LoadingScreen = ({
  variant = 'premium',
  message = ''
}: {
  variant?: 'pulse' | 'wave' | 'spin' | 'breathe' | 'premium';
  message?: string;
}): JSX.Element => {
  return (
    <div className="fixed inset-0 bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] flex flex-col items-center justify-center z-[110]">
      <LoadingLogo variant={variant} size={80} />
      {message && (
        <p className="mt-8 text-white/60 text-sm font-['Inter',sans-serif] animate-pulse">
          {message}
        </p>
      )}
    </div>
  );
};

export const InlineLoader = ({
  size = 40,
  variant = 'premium'
}: {
  size?: number;
  variant?: 'pulse' | 'wave' | 'spin' | 'breathe' | 'premium';
}): JSX.Element => {
  return (
    <div className="flex items-center justify-center py-8">
      <LoadingLogo variant={variant} size={size} />
    </div>
  );
};
