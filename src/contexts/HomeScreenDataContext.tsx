import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { fetchHomeScreenData } from '../lib/dataFetching';
import { getRequestTimeoutMs } from '../lib/networkAwareConfig';

interface HomeScreenData {
  trendingSongs: any[];
  newReleases: any[];
  mustWatchVideos: any[];
  loops: any[];
  trendingAlbums: any[];
  topArtists: any[];
  mixes: any[];
  trendingNearYou: any[];
  aiRecommended: any[];
  timestamp: number;
}

interface HomeScreenDataContextType {
  data: HomeScreenData | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

const HomeScreenDataContext = createContext<HomeScreenDataContextType | undefined>(undefined);

export const HomeScreenDataProvider = ({ children }: { children: ReactNode }) => {
  const [data, setData] = useState<HomeScreenData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = async (forceRefresh = false) => {
    try {
      setError(null);
      // Cache-first: only show loading when we have no cached data
      const shouldShowLoading = !data;
      if (shouldShowLoading) setIsLoading(true);

      // Network-aware timeout: longer on 2G so requests can complete
      const timeoutMs = getRequestTimeoutMs(10000);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Data fetch timeout')), timeoutMs)
      );

      const result = await Promise.race([
        fetchHomeScreenData(forceRefresh),
        timeoutPromise
      ]);

      setData(result as HomeScreenData);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch home screen data'));
      console.error('Error fetching home screen data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    let revalidateTimer: ReturnType<typeof setTimeout> | null = null;
    setIsLoading(true);
    (async () => {
      // Cache-first: get cached or fresh; show cached immediately to avoid loading flash on navigation
      const result = await fetchHomeScreenData(false);
      if (!mounted) return;
      setData(result);
      setIsLoading(false);
      
      // EGRESS OPTIMIZATION: Only revalidate if cache is old (>20min)
      // Previous: always revalidated after 10min, causing 16 queries per home visit
      // Now: only revalidate if cache is stale, reducing queries by 50%
      const cacheAge = result?.timestamp ? Date.now() - result.timestamp : Infinity;
      const REVALIDATE_THRESHOLD = 20 * 60 * 1000; // 20 minutes
      
      if (cacheAge > REVALIDATE_THRESHOLD) {
        // Cache is old, schedule background refresh
        revalidateTimer = setTimeout(() => {
          if (mounted) {
            fetchHomeScreenData(true).then((fresh) => mounted && setData(fresh)).catch(() => {});
          }
        }, 2000); // Small delay to not block initial render
      }
    })();
    return () => {
      mounted = false;
      if (revalidateTimer) clearTimeout(revalidateTimer);
    };
  }, []);

  const refetch = async () => {
    await fetchData(true);
  };

  return (
    <HomeScreenDataContext.Provider value={{ data, isLoading, error, refetch }}>
      {children}
    </HomeScreenDataContext.Provider>
  );
};

export const useHomeScreenData = () => {
  const context = useContext(HomeScreenDataContext);
  if (context === undefined) {
    throw new Error('useHomeScreenData must be used within a HomeScreenDataProvider');
  }
  return context;
};
