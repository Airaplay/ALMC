import { useState, useEffect, useCallback } from 'react';
import {
  LocationDetectionResult,
  getUserLocation,
  refreshLocation,
  clearLocationCache,
} from '../lib/locationDetection';

interface UseLocationReturn {
  location: LocationDetectionResult | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  clearCache: () => void;
}

export const useLocation = (autoDetect: boolean = true): UseLocationReturn => {
  const [location, setLocation] = useState<LocationDetectionResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(autoDetect);
  const [error, setError] = useState<Error | null>(null);

  const detectUserLocation = useCallback(async (forceRefresh: boolean = false) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = forceRefresh
        ? await refreshLocation()
        : await getUserLocation();

      setLocation(result);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to detect location');
      setError(error);
      console.error('Location detection failed:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await detectUserLocation(true);
  }, [detectUserLocation]);

  const clearCache = useCallback(() => {
    clearLocationCache();
    setLocation(null);
  }, []);

  useEffect(() => {
    if (autoDetect) {
      detectUserLocation(false);
    }
  }, [autoDetect, detectUserLocation]);

  return {
    location,
    isLoading,
    error,
    refresh,
    clearCache,
  };
};

export default useLocation;
