import { supabase } from './supabase';
import { fetchWithCache, configCache, CACHE_KEYS, CACHE_TTL } from './configCache';

export interface ExchangeRate {
  id: string;
  country_code: string;
  country_name: string;
  currency_code: string;
  currency_symbol: string;
  currency_name: string;
  exchange_rate: number;
  is_active: boolean;
  last_updated_at: string;
  rate_source: string;
  notes?: string;
}

export interface CurrencyConversion {
  usd_amount: number;
  local_amount: number;
  currency_code: string;
  currency_symbol: string;
  currency_name: string;
  exchange_rate: number;
  formatted: string;
}

class WithdrawalCurrencyService {
  async getExchangeRate(countryCode: string): Promise<ExchangeRate | null> {
    // Get all rates from cache
    const allRates = await this.getAllExchangeRates();
    return allRates.find(rate => rate.country_code === countryCode) || null;
  }

  async getAllExchangeRates(): Promise<ExchangeRate[]> {
    return fetchWithCache(
      CACHE_KEYS.EXCHANGE_RATES,
      CACHE_TTL.ONE_HOUR,
      async () => {
        const { data, error } = await supabase
          .from('withdrawal_exchange_rates')
          .select('id, country_code, country_name, currency_code, currency_symbol, currency_name, exchange_rate, is_active, last_updated_at, rate_source, notes')
          .eq('is_active', true)
          .order('country_name');

        if (error) {
          console.error('Error fetching all exchange rates:', error);
          return [];
        }

        return data || [];
      }
    );
  }

  async convertUSDToLocal(
    usdAmount: number,
    countryCode: string
  ): Promise<CurrencyConversion> {
    const rate = await this.getExchangeRate(countryCode);

    if (!rate) {
      // Default to USD
      return {
        usd_amount: usdAmount,
        local_amount: usdAmount,
        currency_code: 'USD',
        currency_symbol: '$',
        currency_name: 'US Dollar',
        exchange_rate: 1.0,
        formatted: `$${usdAmount.toFixed(2)}`,
      };
    }

    const localAmount = usdAmount * rate.exchange_rate;

    return {
      usd_amount: usdAmount,
      local_amount: localAmount,
      currency_code: rate.currency_code,
      currency_symbol: rate.currency_symbol,
      currency_name: rate.currency_name,
      exchange_rate: rate.exchange_rate,
      formatted: this.formatCurrency(localAmount, rate.currency_symbol, rate.currency_code),
    };
  }

  formatCurrency(amount: number, symbol: string, currencyCode: string): string {
    // Format based on currency
    const decimals = this.getDecimalPlaces(currencyCode);
    const formattedAmount = amount.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

    // Some currencies have symbol after amount
    if (currencyCode === 'EUR') {
      return `${formattedAmount}${symbol}`;
    }

    return `${symbol}${formattedAmount}`;
  }

  getDecimalPlaces(currencyCode: string): number {
    // Currencies with no decimals
    const noDecimals = ['JPY', 'KRW', 'VND', 'CLP', 'PYG', 'UGX', 'TZS'];
    if (noDecimals.includes(currencyCode)) {
      return 0;
    }

    // Most currencies use 2 decimals
    return 2;
  }

  async getUserCurrency(userId: string): Promise<ExchangeRate | null> {
    // Get user's country
    const { data: user, error } = await supabase
      .from('users')
      .select('country')
      .eq('id', userId)
      .maybeSingle();

    if (error || !user || !user.country) {
      return null;
    }

    return this.getExchangeRate(user.country);
  }

  async updateExchangeRate(
    countryCode: string,
    newRate: number,
    notes?: string
  ): Promise<{ success: boolean; error?: string }> {
    const { data, error } = await supabase.rpc('update_withdrawal_exchange_rate', {
      p_country_code: countryCode,
      p_new_rate: newRate,
      p_notes: notes || null,
    });

    if (error) {
      console.error('Error updating exchange rate:', error);
      return { success: false, error: error.message };
    }

    // Clear cache
    this.exchangeRatesCache.delete(countryCode);

    return { success: data.success, error: data.error };
  }

  clearCache(): void {
    this.exchangeRatesCache.clear();
    this.cacheTimestamp = 0;
  }

  // Get formatted dual currency display
  async formatDualCurrency(
    usdAmount: number,
    countryCode: string
  ): Promise<string> {
    const conversion = await this.convertUSDToLocal(usdAmount, countryCode);

    // If same currency (USD), show only once
    if (conversion.currency_code === 'USD') {
      return conversion.formatted;
    }

    // Show both currencies
    return `$${usdAmount.toFixed(2)} ≈ ${conversion.formatted}`;
  }
}

export const withdrawalCurrencyService = new WithdrawalCurrencyService();
