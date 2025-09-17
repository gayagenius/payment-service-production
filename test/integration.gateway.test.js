// tests/integration.gateway.test.js


const { createCircuitBreaker } = require('../utils/circuitBreaker');
const { retry } = require('../utils/retry');


jest.useFakeTimers();


const sleep = (ms) => new Promise((res) => setTimeout(res, ms));


describe('integration: circuitBreaker + retry', () => {
test('retries within circuit breaker until success', async () => {
let calls = 0;
const fakeGateway = jest.fn().mockImplementation(async () => {
calls += 1;
if (calls < 3) throw new Error('temporary fail');
return { status: 'ok', attempt: calls };
});


const breaker = createCircuitBreaker(fakeGateway, {
timeout: 1000,
errorThresholdPercentage: 50,
resetTimeout: 5000,
});


const resultPromise = retry(
(attempt) => breaker.fire({ attempt }),
{ max: 5, baseMs: 100, factor: 2, jitter: false }
);


// advance timers to simulate retries
jest.runAllTimers();


const result = await resultPromise;
expect(result.status).toBe('ok');
expect(calls).toBe(3);
});


test('circuit opens after repeated failures despite retries', async () => {
const fakeGateway = jest.fn().mockRejectedValue(new Error('permanent fail'));


const breaker = createCircuitBreaker(fakeGateway, {
timeout: 500,
errorThresholdPercentage: 1, // fail immediately
resetTimeout: 2000,
});


const p = retry(
(attempt) => breaker.fire({ attempt }),
{ max: 3, baseMs: 100, factor: 2, jitter: false }
);


jest.runAllTimers();


await expect(p).rejects.toThrow();
expect(breaker.opened).toBe(true);
});
});