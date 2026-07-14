/** Consumer app only — admin / web dashboard does not use Pexels placeholders on first paint. */
function shouldPreloadConsumerPlaceholders(): boolean {
  if (import.meta.env.VITE_APP_TARGET === 'web') return false;
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
    return false;
  }
  return true;
}

// Preload common music-app placeholder images (not used on admin dashboard).
const preloadCriticalResources = () => {
  if (!shouldPreloadConsumerPlaceholders()) return;

  const criticalImages = [
    'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400',
    'https://images.pexels.com/photos/167636/pexels-photo-167636.jpeg?auto=compress&cs=tinysrgb&w=400',
    'https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=400',
  ];

  criticalImages.forEach((src) => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = src;
    document.head.appendChild(link);
  });
};

// Remove initial loading screen
export const removeInitialLoader = () => {
  const loader = document.getElementById('initial-loader');
  if (loader) {
    loader.style.opacity = '0';
    loader.style.transition = 'opacity 0.3s ease-out';
    setTimeout(() => {
      loader.remove();
    }, 300);
  }
};

// Initialize preloader
if (typeof window !== 'undefined') {
  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', preloadCriticalResources);
  } else {
    preloadCriticalResources();
  }
}