import { useEffect, useState } from 'react';
import './LoadingAnimation.css';

interface LoadingAnimationProps {
  size?: 'small' | 'medium' | 'large';
  showText?: boolean;
  text?: string;
  className?: string;
}

export const LoadingAnimation = ({
  size = 'medium',
  showText = false,
  text = 'Loading...',
  className = ''
}: LoadingAnimationProps): JSX.Element => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const sizeClasses = {
    small: 'w-12 h-12',
    medium: 'w-20 h-20',
    large: 'w-32 h-32'
  };

  return (
    <div className={`loading-animation-container ${className}`}>
      <div className={`loading-animation ${sizeClasses[size]} ${prefersReducedMotion ? 'reduced-motion' : ''}`}>
        {/* Logo Image with Animations */}
        <div className="logo-wrapper">
          <img
            src="/official_airaplay_logo.png"
            alt="Loading"
            className="logo-image"
          />
        </div>

        {/* Animated Ring Effect */}
        <div className="ring-effect ring-1"></div>
        <div className="ring-effect ring-2"></div>
        <div className="ring-effect ring-3"></div>

        {/* Pulse Backdrop */}
        <div className="pulse-backdrop"></div>
      </div>

      {showText && (
        <p className="loading-text">{text}</p>
      )}
    </div>
  );
};

export default LoadingAnimation;
