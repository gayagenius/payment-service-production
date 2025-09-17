// tests/circuitBreaker.test.js


const { createCircuitBreaker } = require('../utils/circuitBreaker');


jest.useFakeTimers();


const sleep = (ms) => new Promise((res) => setTimeout(res, ms));


describe('circuit breaker (opossum wrapper)', () => {
test('closes on success', async () => {
const fn = jest.fn().mockResolvedValue('ok');
const breaker = createCircuitBreaker(fn, { timeout: 1000 });


const res = await breaker.fire();
expect(res).toBe('ok');
expect(fn).toHaveBeenCalledTimes(1);
expect(breaker.closed).toBe(true);
});


test('opens after failures', async () => {
const fn = jest.fn().mockRejectedValue(new Error('fail'));
const breaker = createCircuitBreaker(fn, {
timeout: 500,
errorThresholdPercentage: 1, // fail immediately
resetTimeout: 2000,
});


await expect(breaker.fire()).rejects.toThrow('fail');
expect(breaker.opened).toBe(true);
});


test('half-opens after reset timeout', async () => {
const fn = jest.fn().mockRejectedValue(new Error('fail'));
const breaker = createCircuitBreaker(fn, {
timeout: 500,
errorThresholdPercentage: 1,
resetTimeout: 1000,
});


await expect(breaker.fire()).rejects.toThrow('fail');
expect(breaker.opened).toBe(true);


// advance timers for resetTimeout
jest.advanceTimersByTime(1000);


expect(breaker.halfOpen).toBe(true);
});
});