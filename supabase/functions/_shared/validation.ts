export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validateUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

export function validateAmount(amount: number, min: number = 0, max: number = Number.MAX_SAFE_INTEGER): boolean {
  return typeof amount === 'number' &&
         !isNaN(amount) &&
         isFinite(amount) &&
         amount >= min &&
         amount <= max;
}

export function validateString(value: string, minLength: number = 1, maxLength: number = 1000): boolean {
  return typeof value === 'string' &&
         value.length >= minLength &&
         value.length <= maxLength;
}

export function validatePaymentRequest(data: any): ValidationResult {
  const errors: ValidationError[] = [];

  if (!data.channel_id || !validateUUID(data.channel_id)) {
    errors.push({ field: 'channel_id', message: 'Valid channel_id (UUID) is required' });
  }

  if (!data.channel_type || !validateString(data.channel_type, 1, 50)) {
    errors.push({ field: 'channel_type', message: 'Valid channel_type is required' });
  }

  const allowedChannels = ['paystack', 'flutterwave', 'usdt', 'usdt_trc20', 'usdt_erc20'];
  if (data.channel_type && !allowedChannels.includes(data.channel_type)) {
    errors.push({ field: 'channel_type', message: 'Invalid payment channel type' });
  }

  // Validate amount with special handling for premium currencies
  if (!validateAmount(data.amount, 0.01, 1000000)) {
    errors.push({ field: 'amount', message: 'Valid amount between 0.01 and 1000000 is required' });
  }

  // Special validation for USD equivalent with GBP/EUR exception
  if (data.amount && data.exchange_rate && data.currency) {
    const amountUSD = data.exchange_rate > 0 ? data.amount / data.exchange_rate : data.amount;
    const premiumCurrencies = ['GBP', 'EUR'];
    const isPremiumCurrency = premiumCurrencies.includes(data.currency.toUpperCase());

    // For GBP and EUR, allow amounts less than $1 USD (minimum $0.10 USD equivalent)
    // For other currencies, maintain $1 USD minimum
    const minimumUSD = isPremiumCurrency ? 0.10 : 1.00;

    if (amountUSD < minimumUSD) {
      const currencyNote = isPremiumCurrency ? ' (Premium currency exception: minimum $0.10 USD equivalent)' : '';
      errors.push({
        field: 'amount',
        message: `Amount must be at least $${minimumUSD} USD equivalent${currencyNote}`
      });
    }
  }

  if (!data.package_id || !validateUUID(data.package_id)) {
    errors.push({ field: 'package_id', message: 'Valid package_id (UUID) is required' });
  }

  if (!data.user_email || !validateEmail(data.user_email)) {
    errors.push({ field: 'user_email', message: 'Valid email address is required' });
  }

  if (data.currency && !validateString(data.currency, 3, 3)) {
    errors.push({ field: 'currency', message: 'Currency must be a 3-character code' });
  }

  if (data.exchange_rate !== undefined && !validateAmount(data.exchange_rate, 0.0001, 1000000)) {
    errors.push({ field: 'exchange_rate', message: 'Valid exchange_rate is required' });
  }

  if (data.detected_country && !validateString(data.detected_country, 1, 100)) {
    errors.push({ field: 'detected_country', message: 'Invalid country name' });
  }

  if (data.detected_country_code && !validateString(data.detected_country_code, 2, 3)) {
    errors.push({ field: 'detected_country_code', message: 'Invalid country code' });
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

export async function validateWebhookSignature(signature: string, body: string, secret: string): Promise<boolean> {
  try {
    if (!signature || !body || !secret) {
      console.error('Missing required parameters for webhook signature validation');
      return false;
    }

    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(body);

    // Import the crypto key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // Generate the signature
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    const generatedSignature = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Compare signatures (constant-time comparison to prevent timing attacks)
    const providedSig = signature.toLowerCase();
    const generatedSig = generatedSignature.toLowerCase();

    if (providedSig.length !== generatedSig.length) {
      return false;
    }

    let mismatch = 0;
    for (let i = 0; i < providedSig.length; i++) {
      mismatch |= providedSig.charCodeAt(i) ^ generatedSig.charCodeAt(i);
    }

    return mismatch === 0;
  } catch (error) {
    console.error('Signature validation error:', error);
    return false;
  }
}

export function sanitizeInput(input: string, maxLength: number = 1000): string {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .trim()
    .substring(0, maxLength)
    .replace(/[<>]/g, '');
}

export function validateContentType(contentType: string | null): boolean {
  const allowedTypes = ['application/json', 'application/x-www-form-urlencoded'];
  if (!contentType) return false;

  return allowedTypes.some(type => contentType.includes(type));
}

/**
 * Rate limiting is implemented at the database level via rate_limit_config table.
 * This function is deprecated and should not be used.
 * Use the database functions: is_ip_blocked(), record_rate_limit_violation()
 *
 * @deprecated Use database-level rate limiting instead
 * @throws Error to prevent misuse of fake rate limiter
 */
export function rateLimit(userId: string, requestsPerMinute: number = 60): never {
  throw new Error(
    'SECURITY ERROR: Fake rate limiter called. ' +
    'Use database-level rate limiting: is_ip_blocked() and record_rate_limit_violation(). ' +
    'See migration 20251028124238_implement_rate_limiting_system.sql'
  );
}
