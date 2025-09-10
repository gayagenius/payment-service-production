// utils/retry.js 

function sleep(ms, signal) {
return new Promise((resolve, reject) => {
const id = setTimeout(resolve, ms);
if (signal) {
if (signal.aborted) {
clearTimeout(id);
return reject(new Error('Retry aborted'));
}
signal.addEventListener('abort', () => {
clearTimeout(id);
reject(new Error('Retry aborted'));
}, { once: true });
}
});
}


/**
* Retry utility with exponential backoff.
*
* @param {Function} fn - async function to retry
* @param {Object} options
* @param {number} [options.max=5] - max attempts
* @param {number} [options.baseMs=1000] - base delay in ms
* @param {number} [options.factor=2] - multiplier per attempt
* @param {boolean} [options.jitter=true] - add random jitter up to 50%
* @param {AbortSignal} [options.signal] - optional abort signal to cancel retries
*
*/
async function retry(fn, { max = 5, baseMs = 1000, factor = 2, jitter = true, signal } = {}) {
let attempt = 0;
let lastErr;


while (attempt < max) {
attempt += 1;
try {
return await fn(attempt);
} catch (err) {
lastErr = err;
if (attempt >= max) break;
// compute delay
let delay = baseMs * Math.pow(factor, attempt - 1);
if (jitter) {
const rand = Math.random() * 0.5 + 0.75; // random between 0.75–1.25x
delay = Math.floor(delay * rand);
}
await sleep(delay, signal);
}
}


throw lastErr;
}


module.exports = { retry };