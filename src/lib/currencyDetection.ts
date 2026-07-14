export interface Currency {
  code: string;
  symbol: string;
  name: string;
  exchangeRate: number; // Rate to USD (for display purposes)
}

export interface CurrencyDetectionResult {
  currency: Currency;
  country: string;
  countryCode: string;
  detected: boolean;
}

// Comprehensive currency map with black market rates (approximate)
export const CURRENCIES: Record<string, Currency> = {
  USD: { code: 'USD', symbol: '$', name: 'US Dollar', exchangeRate: 1 },
  NGN: { code: 'NGN', symbol: '₦', name: 'Nigerian Naira', exchangeRate: 1650 }, // Black market rate
  GBP: { code: 'GBP', symbol: '£', name: 'British Pound', exchangeRate: 0.79 },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', exchangeRate: 0.92 },
  GHS: { code: 'GHS', symbol: '₵', name: 'Ghanaian Cedi', exchangeRate: 15.5 },
  ZAR: { code: 'ZAR', symbol: 'R', name: 'South African Rand', exchangeRate: 18.5 },
  KES: { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling', exchangeRate: 129 },
  XOF: { code: 'XOF', symbol: 'CFA', name: 'West African CFA Franc', exchangeRate: 605 }, // Benin
  XAF: { code: 'XAF', symbol: 'FCFA', name: 'Central African CFA Franc', exchangeRate: 605 }, // Togo
  EGP: { code: 'EGP', symbol: 'E£', name: 'Egyptian Pound', exchangeRate: 49 },
  TZS: { code: 'TZS', symbol: 'TSh', name: 'Tanzanian Shilling', exchangeRate: 2540 },
  UGX: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', exchangeRate: 3700 },
  CAD: { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', exchangeRate: 1.36 },
  AUD: { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', exchangeRate: 1.52 },
  INR: { code: 'INR', symbol: '₹', name: 'Indian Rupee', exchangeRate: 83 },
  CNY: { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', exchangeRate: 7.24 },
  JPY: { code: 'JPY', symbol: '¥', name: 'Japanese Yen', exchangeRate: 149 },
  BRL: { code: 'BRL', symbol: 'R$', name: 'Brazilian Real', exchangeRate: 5.2 },
  MXN: { code: 'MXN', symbol: 'Mex$', name: 'Mexican Peso', exchangeRate: 17 },
  AED: { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', exchangeRate: 3.67 },
  SAR: { code: 'SAR', symbol: '﷼', name: 'Saudi Riyal', exchangeRate: 3.75 },
};

// Country to currency mapping
const COUNTRY_CURRENCY_MAP: Record<string, string> = {
  // Africa
  NG: 'NGN', // Nigeria
  GH: 'GHS', // Ghana
  ZA: 'ZAR', // South Africa
  KE: 'KES', // Kenya
  BJ: 'XOF', // Benin
  SN: 'XOF', // Senegal
  CI: 'XOF', // Ivory Coast
  ML: 'XOF', // Mali
  NE: 'XOF', // Niger
  BF: 'XOF', // Burkina Faso
  GW: 'XOF', // Guinea-Bissau
  TG: 'XAF', // Togo
  CM: 'XAF', // Cameroon
  GA: 'XAF', // Gabon
  CG: 'XAF', // Republic of Congo
  CF: 'XAF', // Central African Republic
  TD: 'XAF', // Chad
  GQ: 'XAF', // Equatorial Guinea
  EG: 'EGP', // Egypt
  TZ: 'TZS', // Tanzania
  UG: 'UGX', // Uganda

  // Europe
  GB: 'GBP', // United Kingdom
  DE: 'EUR', // Germany
  FR: 'EUR', // France
  IT: 'EUR', // Italy
  ES: 'EUR', // Spain
  NL: 'EUR', // Netherlands
  BE: 'EUR', // Belgium
  AT: 'EUR', // Austria
  PT: 'EUR', // Portugal
  IE: 'EUR', // Ireland
  GR: 'EUR', // Greece
  FI: 'EUR', // Finland

  // Americas
  US: 'USD', // United States
  CA: 'CAD', // Canada
  BR: 'BRL', // Brazil
  MX: 'MXN', // Mexico

  // Asia
  IN: 'INR', // India
  CN: 'CNY', // China
  JP: 'JPY', // Japan
  AE: 'AED', // UAE
  SA: 'SAR', // Saudi Arabia

  // Oceania
  AU: 'AUD', // Australia
  NZ: 'USD', // New Zealand (using USD as fallback)
};

/**
 * Detect user's currency based on IP geolocation
 * Now uses the centralized location detection service
 */
export const detectCurrency = async (): Promise<CurrencyDetectionResult> => {
  try {
    const { getUserLocation } = await import('./locationDetection');
    const locationResult = await getUserLocation();

    const { location, detected } = locationResult;
    const currencyCode = COUNTRY_CURRENCY_MAP[location.countryCode] || location.currency || 'USD';
    const currency = CURRENCIES[currencyCode] || CURRENCIES.USD;

    const result = {
      currency,
      country: location.country,
      countryCode: location.countryCode,
      detected,
    };

    localStorage.setItem('detectedCurrency', JSON.stringify({
      ...result,
      detectedAt: new Date().toISOString(),
    }));

    return result;
  } catch (error) {
    console.error('Currency detection error:', error);

    const cached = localStorage.getItem('detectedCurrency');
    if (cached) {
      try {
        const cachedData = JSON.parse(cached);
        const cachedTime = new Date(cachedData.detectedAt).getTime();
        const now = new Date().getTime();
        const dayInMs = 24 * 60 * 60 * 1000;

        if (now - cachedTime < 7 * dayInMs) {
          return {
            currency: cachedData.currency,
            country: cachedData.country,
            countryCode: cachedData.countryCode,
            detected: true,
          };
        }
      } catch (cacheError) {
        console.warn('Failed to parse cached currency:', cacheError);
      }
    }

    return {
      currency: CURRENCIES.USD,
      country: 'Unknown',
      countryCode: 'US',
      detected: false,
    };
  }
};

/**
 * Get stored currency preference or detect new one
 */
export const getUserCurrency = async (): Promise<CurrencyDetectionResult> => {
  // Check if user has manually set a currency preference
  const preference = localStorage.getItem('currencyPreference');
  if (preference) {
    const currencyCode = preference;
    const currency = CURRENCIES[currencyCode];
    if (currency) {
      return {
        currency,
        country: 'Manual Selection',
        countryCode: currencyCode,
        detected: true,
      };
    }
  }

  // Otherwise, detect currency
  return await detectCurrency();
};

/**
 * Set user's currency preference manually
 */
export const setCurrencyPreference = (currencyCode: string): void => {
  if (CURRENCIES[currencyCode]) {
    localStorage.setItem('currencyPreference', currencyCode);
  }
};

/**
 * Convert amount from USD to target currency (display and checkout use the same value).
 */
export const convertAmount = (amountUSD: number, targetCurrency: Currency): number => {
  if (!Number.isFinite(amountUSD) || amountUSD <= 0) return 0;
  if (targetCurrency.code === 'USD' || targetCurrency.exchangeRate <= 0) {
    return Math.round(amountUSD * 100) / 100;
  }
  return Math.round(amountUSD * targetCurrency.exchangeRate * 100) / 100;
};

/**
 * Convert a local-currency amount back to USD (inverse of {@link convertAmount}).
 * exchangeRate is units of local currency per 1 USD.
 */
export const convertToUsd = (amountLocal: number, sourceCurrency: Currency): number => {
  if (!Number.isFinite(amountLocal) || amountLocal <= 0) return 0;
  if (sourceCurrency.code === 'USD' || sourceCurrency.exchangeRate <= 0) {
    return Math.round(amountLocal * 100) / 100;
  }
  return Math.round((amountLocal / sourceCurrency.exchangeRate) * 100) / 100;
};

/**
 * Format amount with currency symbol (preserves sub-unit prices, e.g. $0.49, £0.79).
 */
export const formatCurrencyAmount = (amount: number, currency: Currency): string => {
  const zeroDecimalCurrencies = new Set(['JPY', 'KRW', 'VND']);
  const fractionDigits = zeroDecimalCurrencies.has(currency.code) ? 0 : 2;
  return `${currency.symbol}${amount.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
};

/**
 * Get all available currencies as array
 */
export const getAllCurrencies = (): Currency[] => {
  return Object.values(CURRENCIES).sort((a, b) => a.name.localeCompare(b.name));
};
