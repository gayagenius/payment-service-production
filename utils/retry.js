import pRetry from 'p-retry';

/**
 * Retry a function using p-retry
 * @param {Function} fn async function
 * @param {Object} options { retries: number, factor: number, minTimeout: number, maxTimeout: number }
 */
export async function retry(fn, options = { retries: 5, factor: 2, minTimeout: 1000, maxTimeout: 10000 }) {
  return pRetry(fn, options);
}
