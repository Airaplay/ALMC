/**
 * Network-aware configuration for low-bandwidth (e.g. 2G) resilience.
 * Uses getNetworkInfo() to adapt timeouts, retries, and prefetch behavior.
 */

import { getNetworkInfo } from './imageOptimization';

/** Default timeout for critical requests on fast networks (ms). */
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
/** Timeout for 2G/slow-2g so requests have time to complete. */
const SLOW_NETWORK_TIMEOUT_MS = 30000;
/** Timeout for 3g. */
const MEDIUM_NETWORK_TIMEOUT_MS = 20000;

/**
 * Returns a request timeout in ms based on current network.
 * Use for Promise.race with data fetches so 2G users aren't cut off too early.
 */
export function getRequestTimeoutMs(baseTimeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS): number {
  if (typeof window === 'undefined') return baseTimeoutMs;
  const network = getNetworkInfo();
  if (network.saveData || network.effectiveType === 'slow-2g') return SLOW_NETWORK_TIMEOUT_MS;
  if (network.effectiveType === '2g') return SLOW_NETWORK_TIMEOUT_MS;
  if (network.effectiveType === '3g') return MEDIUM_NETWORK_TIMEOUT_MS;
  return baseTimeoutMs;
}

/**
 * Returns retry configuration for fetches. More attempts and longer delays on slow networks.
 */
export function getRetryConfig(): { attempts: number; delayMs: number; backoff: 'exponential' | 'linear' } {
  const network = getNetworkInfo();
  if (network.effectiveType === '2g' || network.effectiveType === 'slow-2g' || network.saveData) {
    return { attempts: 3, delayMs: 2000, backoff: 'exponential' };
  }
  if (network.effectiveType === '3g') {
    return { attempts: 2, delayMs: 1500, backoff: 'linear' };
  }
  return { attempts: 1, delayMs: 1000, backoff: 'linear' };
}

/**
 * When true, avoid non-essential background prefetch (e.g. home screen prefetch on app load)
 * to avoid blocking and wasting bandwidth on 2G.
 */
export function shouldSkipBackgroundPrefetch(): boolean {
  if (typeof window === 'undefined') return false;
  const network = getNetworkInfo();
  return network.saveData === true || network.effectiveType === '2g' || network.effectiveType === 'slow-2g';
}

/**
 * Whether the current network is considered slow (2G / slow-2g / save-data).
 */
export function isSlowNetwork(): boolean {
  if (typeof window === 'undefined') return false;
  const network = getNetworkInfo();
  return (
    network.saveData === true ||
    network.effectiveType === '2g' ||
    network.effectiveType === 'slow-2g'
  );
}

/**
 * Wraps a promise with a network-aware timeout. Rejects with a TimeoutError after the appropriate delay.
 */
export function withNetworkTimeout<T>(
  promise: Promise<T>,
  baseTimeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<T> {
  const timeoutMs = getRequestTimeoutMs(baseTimeoutMs);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Request timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Executes an async fetcher with network-aware timeout and optional retries.
 * On slow networks uses longer timeout and retries with backoff.
 */
export async function fetchWithNetworkResilience<T>(
  fetcher: () => Promise<T>,
  options: { baseTimeoutMs?: number; retry?: boolean } = {}
): Promise<T> {
  const { baseTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, retry: enableRetry = true } = options;
  const timeoutMs = getRequestTimeoutMs(baseTimeoutMs);
  const { attempts, delayMs, backoff } = getRetryConfig();
  const maxAttempts = enableRetry ? Math.max(attempts, 1) : 1;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await Promise.race([
        fetcher(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Request timeout after ${timeoutMs}ms`)), timeoutMs)
        )
      ]);
      return result;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delay = backoff === 'exponential' ? delayMs * Math.pow(2, attempt - 1) : delayMs;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}
