// utils/retry.js


const pRetry = require('p-retry');


/**
* Retry utility with exponential backoff.
* Wrapper around p-retry to maintain the same API shape.
*
* @param {Function} fn - async function to retry, receives attempt number
* @param {Object} options
* @param {number} [options.max=5] - max attempts
* @param {number} [options.baseMs=1000] - base delay in ms (minTimeout)
* @param {number} [options.factor=2] - multiplier per attempt
* @param {boolean} [options.jitter=true] - add random jitter
* @param {AbortSignal} [options.signal] - optional abort signal to cancel retries
*
*/
async function retry(fn, { max = 5, baseMs = 1000, factor = 2, jitter = true, signal } = {}) {
return pRetry(
async (attempt) => {
if (signal && signal.aborted) {
throw new pRetry.AbortError(new Error('Retry aborted'));
}
return fn(attempt);
},
{
retries: max - 1,
minTimeout: baseMs,
factor,
randomize: jitter,
signal,
}
);
}


module.exports = { retry };