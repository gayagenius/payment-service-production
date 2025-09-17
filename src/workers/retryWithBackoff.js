/**
 * Retries an asynchronous function with exponential backoff.
 * @param {Function} fn - The async function to retry.
 * @param {number} maxAttempts - Maximum number of retry attempts.
 * @param {number} baseDelayMs - The base delay in milliseconds.
 * @param {number} factor - The multiplication factor for each delay.
 * @param {boolean} jitter - Whether to add random jitter to the delay.
 */
export const retryWithBackoff = async (fn, maxAttempts = 5, baseDelayMs = 1000, factor = 2, jitter = true) => {
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      return await fn();
    } catch (err) {
      console.error(`Attempt ${attempt + 1} failed: ${err.message}`);
      attempt++;
      if (attempt >= maxAttempts) {
        throw err;
      }
      let delay = baseDelayMs * Math.pow(factor, attempt - 1);
      if (jitter) {
        delay = Math.random() * delay; // random jitter for delay
      }
      console.log(`Retrying in ${delay.toFixed(2)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};