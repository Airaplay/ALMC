import { getRequestTimeoutMs } from './networkAwareConfig';

export interface LocationData {
  ip: string;
  city: string;
  region: string;
  regionCode: string;
  country: string;
  countryCode: string;
  continent: string;
  continentCode: string;
  latitude: number;
  longitude: number;
  timezone: string;
  utcOffset: string;
  currency: string;
  isp?: string;
  org?: string;
  asn?: string;
  mobile?: boolean;
  proxy?: boolean;
  hosting?: boolean;
}

export interface LocationDetectionResult {
  location: LocationData;
  detected: boolean;
  source: 'api' | 'cache' | 'fallback';
  detectedAt: string;
}

const CACHE_KEY = 'userLocation';
const CACHE_DURATION_HOURS = 24;

/**
 * Parse ipapi.co response
 */
const parseIpapiCo = (data: any): LocationData => ({
  ip: data.ip || '',
  city: data.city || 'Unknown',
  region: data.region || 'Unknown',
  regionCode: data.region_code || '',
  country: data.country_name || 'Unknown',
  countryCode: data.country_code || 'US',
  continent: data.continent_code || 'Unknown',
  continentCode: data.continent_code || '',
  latitude: data.latitude || 0,
  longitude: data.longitude || 0,
  timezone: data.timezone || 'UTC',
  utcOffset: data.utc_offset || '+00:00',
  currency: data.currency || 'USD',
  isp: data.org || undefined,
  asn: data.asn || undefined,
});

/**
 * Parse ipwho.is response
 */
const parseIpwhoIs = (data: any): LocationData => ({
  ip: data.ip || '',
  city: data.city || 'Unknown',
  region: data.region || 'Unknown',
  regionCode: data.region_code || '',
  country: data.country || 'Unknown',
  countryCode: data.country_code || 'US',
  continent: data.continent || 'Unknown',
  continentCode: data.continent_code || '',
  latitude: data.latitude || 0,
  longitude: data.longitude || 0,
  timezone: data.timezone?.id || 'UTC',
  utcOffset: data.timezone?.utc || '+00:00',
  currency: data.currency?.code || 'USD',
  isp: data.connection?.isp || undefined,
  org: data.connection?.org || undefined,
  asn: data.connection?.asn ? String(data.connection.asn) : undefined,
});

/**
 * Parse ipinfo.io response
 */
const parseIpinfoIo = (data: any): LocationData => {
  const [lat, lon] = (data.loc || '0,0').split(',');
  return {
    ip: data.ip || '',
    city: data.city || 'Unknown',
    region: data.region || 'Unknown',
    regionCode: '',
    country: data.country || 'Unknown',
    countryCode: data.country || 'US',
    continent: 'Unknown',
    continentCode: '',
    latitude: parseFloat(lat) || 0,
    longitude: parseFloat(lon) || 0,
    timezone: data.timezone || 'UTC',
    utcOffset: '+00:00',
    currency: 'USD',
    isp: data.org || undefined,
  };
};

/**
 * Parse ip-api.com response
 */
const parseIpApiCom = (data: any): LocationData => ({
  ip: data.query || '',
  city: data.city || 'Unknown',
  region: data.regionName || 'Unknown',
  regionCode: data.region || '',
  country: data.country || 'Unknown',
  countryCode: data.countryCode || 'US',
  continent: data.continent || 'Unknown',
  continentCode: data.continentCode || '',
  latitude: data.lat || 0,
  longitude: data.lon || 0,
  timezone: data.timezone || 'UTC',
  utcOffset: '+00:00',
  currency: data.currency || 'USD',
  isp: data.isp || undefined,
  org: data.org || undefined,
  asn: data.as || undefined,
  mobile: data.mobile || false,
  proxy: data.proxy || false,
  hosting: data.hosting || false,
});

/**
 * Get cached location if available and not expired
 */
const getCachedLocation = (): LocationDetectionResult | null => {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const cachedData: LocationDetectionResult = JSON.parse(cached);
    const cachedTime = new Date(cachedData.detectedAt).getTime();
    const now = new Date().getTime();
    const cacheExpiry = CACHE_DURATION_HOURS * 60 * 60 * 1000;

    if (now - cachedTime < cacheExpiry) {
      return { ...cachedData, source: 'cache' };
    }

    localStorage.removeItem(CACHE_KEY);
  } catch (error) {
    console.warn('Failed to get cached location:', error);
    localStorage.removeItem(CACHE_KEY);
  }

  return null;
};

/**
 * Save location to cache
 */
const cacheLocation = (result: LocationDetectionResult): void => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(result));
  } catch (error) {
    console.warn('Failed to cache location:', error);
  }
};

/**
 * Fallback location data
 */
const getFallbackLocation = (): LocationData => ({
  ip: '',
  city: 'Unknown',
  region: 'Unknown',
  regionCode: '',
  country: 'United States',
  countryCode: 'US',
  continent: 'North America',
  continentCode: 'NA',
  latitude: 37.7749,
  longitude: -122.4194,
  timezone: 'America/Los_Angeles',
  utcOffset: '-08:00',
  currency: 'USD',
});

/**
 * Detect user's location based on IP address
 */
export const detectLocation = async (forceRefresh: boolean = false): Promise<LocationDetectionResult> => {
  // Check cache first unless force refresh is requested
  if (!forceRefresh) {
    const cached = getCachedLocation();
    if (cached) {
      return cached;
    }
  }

  const apis = [
    {
      name: 'ipapi.co',
      url: 'https://ipapi.co/json/',
      parser: parseIpapiCo,
    },
    {
      name: 'ipwho.is',
      url: 'https://ipwho.is/',
      parser: parseIpwhoIs,
    },
    {
      name: 'ip-api.com',
      url: 'http://ip-api.com/json/?fields=status,message,continent,continentCode,country,countryCode,region,regionName,city,zip,lat,lon,timezone,currency,isp,org,as,mobile,proxy,hosting,query',
      parser: parseIpApiCom,
    },
    {
      name: 'ipinfo.io',
      url: 'https://ipinfo.io/json',
      parser: parseIpinfoIo,
    },
  ];

  for (const api of apis) {
    try {
      const controller = new AbortController();
      const timeoutMs = getRequestTimeoutMs(8000); // longer on 2G so geo request can complete
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(api.url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();

        if (data.success === false || data.status === 'fail') {
          console.warn(`${api.name} returned error:`, data.message);
          continue;
        }

        const location = api.parser(data);

        if (location.countryCode) {
          const result: LocationDetectionResult = {
            location,
            detected: true,
            source: 'api',
            detectedAt: new Date().toISOString(),
          };

          cacheLocation(result);
          return result;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn(`${api.name} request timed out`);
      } else {
        console.warn(`Failed to fetch from ${api.name}:`, error);
      }
      continue;
    }
  }

  const fallbackResult: LocationDetectionResult = {
    location: getFallbackLocation(),
    detected: false,
    source: 'fallback',
    detectedAt: new Date().toISOString(),
  };

  return fallbackResult;
};

/**
 * Get user's location (cached or fresh)
 */
export const getUserLocation = async (): Promise<LocationDetectionResult> => {
  return await detectLocation(false);
};

/**
 * Refresh user's location (bypass cache)
 */
export const refreshLocation = async (): Promise<LocationDetectionResult> => {
  return await detectLocation(true);
};

/**
 * Clear cached location
 */
export const clearLocationCache = (): void => {
  localStorage.removeItem(CACHE_KEY);
};

/**
 * Get distance between two coordinates (in kilometers)
 */
export const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Check if user is in a specific country
 */
export const isUserInCountry = async (countryCode: string): Promise<boolean> => {
  const result = await getUserLocation();
  return result.location.countryCode === countryCode;
};

/**
 * Check if user is in a specific region/continent
 */
export const isUserInRegion = async (continentCode: string): Promise<boolean> => {
  const result = await getUserLocation();
  return result.location.continentCode === continentCode;
};

/**
 * Get formatted location string
 */
export const getLocationString = (location: LocationData, format: 'short' | 'medium' | 'full' = 'medium'): string => {
  switch (format) {
    case 'short':
      return `${location.city}, ${location.countryCode}`;
    case 'medium':
      return `${location.city}, ${location.region}, ${location.country}`;
    case 'full':
      return `${location.city}, ${location.region}, ${location.country} (${location.timezone})`;
    default:
      return `${location.city}, ${location.country}`;
  }
};
