// tests/retry.test.js


const { retry } = require('../utils/retry');


jest.useFakeTimers();


function flushAllTimers() {
return jest.advanceTimersByTime(1000000);
}


describe('retry', () => {
test('succeeds immediately if fn resolves first try', async () => {
const fn = jest.fn().mockResolvedValue('ok');
const p = retry(fn, { max: 3, baseMs: 100 });
await expect(p).resolves.toBe('ok');
expect(fn).toHaveBeenCalledTimes(1);
});
});

test('retries with exponential backoff until success', async () => {
let calls = 0;
const fn = jest.fn().mockImplementation(() => {
calls += 1;
if (calls < 3) return Promise.reject(new Error('fail'));
return Promise.resolve('done');
});


const p = retry(fn, { max: 5, baseMs: 1000, factor: 2, jitter: false });


// fast-forward through timers
for (let i = 0; i < 2; i++) {
await Promise.resolve();
jest.advanceTimersByTime(1000 * Math.pow(2, i));
}


await expect(p).resolves.toBe('done');
expect(fn).toHaveBeenCalledTimes(3);
});


test('throws after max attempts', async () => {
const fn = jest.fn().mockRejectedValue(new Error('fail'));
const p = retry(fn, { max: 3, baseMs: 100, jitter: false });


for (let i = 0; i < 2; i++) {
await Promise.resolve();
jest.advanceTimersByTime(100 * Math.pow(2, i));
}


await expect(p).rejects.toThrow('fail');
expect(fn).toHaveBeenCalledTimes(3);
});


test('supports cancellation via AbortController', async () => {
let calls = 0;
const fn = jest.fn().mockImplementation(() => {
calls += 1;
return Promise.reject(new Error('fail'));
});


const ac = new AbortController();
const p = retry(fn, { max: 5, baseMs: 1000, factor: 2, jitter: false, signal: ac.signal });

// Start the retry, then abort after the first attempt
await Promise.resolve();
jest.advanceTimersByTime(1000);
ac.abort();

await expect(p).rejects.toThrow(/aborted|AbortError/i);
expect(fn).toHaveBeenCalledTimes(1);
});