import CircuitBreaker from 'opossum';

export function createCircuitBreaker(fn, options = {}) {
  const defaultOpts = {
    timeout: 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
  };
  const opts = { ...defaultOpts, ...options };
  const breaker = new CircuitBreaker(fn, opts);

  breaker.on('open', () => console.warn('[CircuitBreaker] OPEN'));
  breaker.on('halfOpen', () => console.warn('[CircuitBreaker] HALF_OPEN'));
  breaker.on('close', () => console.warn('[CircuitBreaker] CLOSED'));
  breaker.on('failure', (err) => console.error('[CircuitBreaker] failure', err && err.message));

  return breaker;
}
