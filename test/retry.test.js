// tests/retry.test.js


const { retry } = require('../utils/retry');


jest.useFakeTimers();


describe('retry (p-retry wrapper)', () => {
test('succeeds immediately if fn resolves first try', async () => {
const fn = jest.fn().mockResolvedValue('ok');
const p = retry(fn, { max: 3, baseMs: 100 });
await expect(p).resolves.toBe('ok');
expect(fn).toHaveBeenCalledTimes(1);
});


test('retries with exponential backoff until success', async () => {
let calls = 0;
const fn = jest.fn().mockImplementation(() => {
calls += 1;
if (calls < 3) return Promise.reject(new Error('fail'));
return Promise.resolve('done');
});


const p = retry(fn, { max: 5, baseMs: 100, factor: 2, jitter: false });


// run all timers
jest.runAllTimers();


await expect(p).resolves.toBe('done');
expect(fn).toHaveBeenCalledTimes(3);
});


test('throws after max attempts', async () => {
const fn = jest.fn().mockRejectedValue(new Error('fail'));
const p = retry(fn, { max: 3, baseMs: 100, jitter: false });


jest.runAllTimers();


await expect(p).rejects.toThrow('fail');
expect(fn).toHaveBeenCalledTimes(3);
});


test('supports cancellation via AbortController', async () => {
const fn = jest.fn().mockRejectedValue(new Error('fail'));
const ac = new AbortController();


const p = retry(fn, { max: 5, baseMs: 100, factor: 2, jitter: false, signal: ac.signal });


ac.abort();


await expect(p).rejects.toThrow('Retry aborted');
});
});