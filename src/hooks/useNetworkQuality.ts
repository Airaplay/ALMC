import { useState, useEffect } from 'react';
import { getNetworkInfo, NetworkInfo } from '../lib/imageOptimization';

export const useNetworkQuality = () => {
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo>(getNetworkInfo());
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const updateNetworkInfo = () => {
      setNetworkInfo(getNetworkInfo());
    };

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    if ('connection' in navigator) {
      const connection = (navigator as any).connection;
      connection?.addEventListener('change', updateNetworkInfo);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const interval = setInterval(updateNetworkInfo, 30000);

    return () => {
      if ('connection' in navigator) {
        const connection = (navigator as any).connection;
        connection?.removeEventListener('change', updateNetworkInfo);
      }
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  const isSlowNetwork = networkInfo.effectiveType === '2g' || networkInfo.effectiveType === 'slow-2g';
  const isMediumNetwork = networkInfo.effectiveType === '3g';
  const isFastNetwork = networkInfo.effectiveType === '4g';

  return {
    networkInfo,
    isOnline,
    isSlowNetwork,
    isMediumNetwork,
    isFastNetwork,
    saveData: networkInfo.saveData,
    effectiveType: networkInfo.effectiveType
  };
};
