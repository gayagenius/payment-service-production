// tests/circuitBreaker.test.js
await expect(cb.call(succeeding)).rejects.toThrow(CircuitOpenError);


// advance time to after timeout -> transition to HALF_OPEN when next call occurs
jest.advanceTimersByTime(5000);


// Next call should be allowed as probe
const res = await cb.call(succeeding, { correlationId: 'probe-1' });
expect(res).toBe('ok');
// auto-closed on success
expect(cb.state).toBe(STATES.CLOSED);


test('failed probe returns to OPEN and resets timeout', async () => {
const cb = new CircuitBreaker({ failureThreshold: 2, timeout: 5000, onEvent: () => {}, onStateChange: () => {} });
const failing = () => Promise.reject(new Error('boom'));


await expect(cb.call(failing)).rejects.toThrow();
await expect(cb.call(failing)).rejects.toThrow();
expect(cb.state).toBe(STATES.OPEN);


// move to half-open
jest.advanceTimersByTime(5000);


// probe fails
await expect(cb.call(failing)).rejects.toThrow();
expect(cb.state).toBe(STATES.OPEN);


// ensure that openUntil was reset (i.e. another timeout period must pass before half-open again)
jest.advanceTimersByTime(4999);
// still open
await expect(cb.call(() => Promise.resolve('x'))).rejects.toThrow(CircuitOpenError);


jest.advanceTimersByTime(1);
// now allow probe
// make it succeed to close
await expect(cb.call(() => Promise.resolve('y'))).resolves.toBe('y');
expect(cb.state).toBe(STATES.CLOSED);


test('half-open concurrent probe limit enforced', async () => {
const cb = new CircuitBreaker({ failureThreshold: 1, timeout: 1000, halfOpenMaxRequests: 1 });
const failing = () => Promise.reject(new Error('boom'));


await expect(cb.call(failing)).rejects.toThrow();
expect(cb.state).toBe(STATES.OPEN);


jest.advanceTimersByTime(1000);


// Create a probe that waits a bit
let resolveProbe;
const longProbe = () => new Promise((res) => { resolveProbe = res; });


const p1 = cb.call(longProbe);
// second concurrent probe should be rejected
await expect(cb.call(longProbe)).rejects.toThrow(CircuitOpenError);


// finish first probe successfully -> should close circuit
resolveProbe('done');
await expect(p1).resolves.toBe('done');
expect(cb.state).toBe(STATES.CLOSED);
});
});