import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

export interface UserCountryResult {
  countryCode: string | null;
  countryName: string | null;
  isLoading: boolean;
  /** True when country came from IP geolocation (non-auth or DB had no country) */
  isFromIp: boolean;
  refresh: () => Promise<void>;
}

const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 min

type CacheEntry = {
  countryCode: string;
  countryName: string;
  isFromIp: boolean;
  timestamp: number;
};

let memoryCache: CacheEntry | null = null;

const COUNTRY_CODE_TO_NAME: Record<string, string> = {
  NG: 'Nigeria', GH: 'Ghana', KE: 'Kenya', ZA: 'South Africa', US: 'United States',
  GB: 'United Kingdom', CA: 'Canada', JM: 'Jamaica', TZ: 'Tanzania', UG: 'Uganda',
  RW: 'Rwanda', ET: 'Ethiopia', ZW: 'Zimbabwe', BW: 'Botswana', CM: 'Cameroon',
  SN: 'Senegal', CI: 'Ivory Coast', ML: 'Mali', BJ: 'Benin', TG: 'Togo', NE: 'Niger',
  BF: 'Burkina Faso', MR: 'Mauritania', GM: 'Gambia', GN: 'Guinea', SL: 'Sierra Leone',
  LR: 'Liberia', MZ: 'Mozambique', AO: 'Angola', NA: 'Namibia', LS: 'Lesotho',
  SZ: 'Eswatini', MW: 'Malawi', ZM: 'Zambia', CD: 'DR Congo', CG: 'Republic of the Congo',
  GA: 'Gabon', GQ: 'Equatorial Guinea', TD: 'Chad', CF: 'Central African Republic',
  SS: 'South Sudan', SD: 'Sudan', ER: 'Eritrea', DJ: 'Djibouti', SO: 'Somalia',
  MU: 'Mauritius', SC: 'Seychelles', MG: 'Madagascar', KM: 'Comoros', ST: 'São Tomé and Príncipe', CV: 'Cape Verde',
};

function getCountryNameFromCode(code: string): string {
  return COUNTRY_CODE_TO_NAME[code] ?? code;
}

/** Non-auth: fetch country via ipapi.co only */
async function fetchCountryFromIp(): Promise<{ countryCode: string; countryName: string }> {
  const res = await fetch('https://ipapi.co/json/', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('ipapi.co request failed');
  const data = await res.json();
  const countryCode = (data.country_code ?? 'US').toUpperCase().slice(0, 2);
  const countryName = data.country_name ?? getCountryNameFromCode(countryCode);
  return { countryCode, countryName };
}

function getCached(): CacheEntry | null {
  if (!memoryCache) return null;
  if (Date.now() - memoryCache.timestamp >= CACHE_DURATION_MS) {
    memoryCache = null;
    return null;
  }
  return memoryCache;
}

function setCached(entry: Omit<CacheEntry, 'timestamp'>): void {
  memoryCache = { ...entry, timestamp: Date.now() };
}

export function clearUserCountryCache(): void {
  memoryCache = null;
}

export const useUserCountry = (): UserCountryResult => {
  const { user, isAuthenticated, isInitialized } = useAuth();
  const [countryCode, setCountryCode] = useState<string | null>(() => getCached()?.countryCode ?? null);
  const [countryName, setCountryName] = useState<string | null>(() => getCached()?.countryName ?? null);
  const [isFromIp, setIsFromIp] = useState<boolean>(() => getCached()?.isFromIp ?? false);
  const [isLoading, setIsLoading] = useState<boolean>(() => !getCached());

  const resolve = useCallback(async (bypassCache: boolean = false) => {
    if (!bypassCache) {
      const cached = getCached();
      if (cached) {
        setCountryCode(cached.countryCode);
        setCountryName(cached.countryName);
        setIsFromIp(cached.isFromIp);
        setIsLoading(false);
        return;
      }
    } else {
      memoryCache = null;
    }

    setIsLoading(true);
    try {
      // Auth users → users.country from DB
      if (isAuthenticated && user?.id) {
        const { data } = await supabase
          .from('users')
          .select('country')
          .eq('id', user.id)
          .maybeSingle();

        if (data?.country) {
          const code = String(data.country).toUpperCase().slice(0, 2);
          const name = getCountryNameFromCode(code);
          setCached({ countryCode: code, countryName: name, isFromIp: false });
          setCountryCode(code);
          setCountryName(name);
          setIsFromIp(false);
          setIsLoading(false);
          return;
        }
      }

      // Non-auth (or no country in DB) → IP geolocation via ipapi.co
      const { countryCode: code, countryName: name } = await fetchCountryFromIp();
      setCached({ countryCode: code, countryName: name, isFromIp: true });
      setCountryCode(code);
      setCountryName(name);
      setIsFromIp(true);
    } catch (err) {
      console.error('[useUserCountry] Error resolving country:', err);
      // Fallback so section can still show
      const fallback = { countryCode: 'US', countryName: 'United States', isFromIp: true };
      setCached(fallback);
      setCountryCode(fallback.countryCode);
      setCountryName(fallback.countryName);
      setIsFromIp(true);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, user?.id]);

  const refresh = useCallback(async () => {
    await resolve(true);
  }, [resolve]);

  useEffect(() => {
    if (!isInitialized) return;
    resolve(false);
  }, [isInitialized, resolve]);

  return {
    countryCode,
    countryName,
    isLoading,
    isFromIp,
    refresh,
  };
};
