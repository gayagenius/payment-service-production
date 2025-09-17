import CircuitBreaker from 'opossum';

export function createCircuitBreaker(fn, options = {}) {
  const breaker = new CircuitBreaker(fn, {
    timeout: 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    ...options,
  });

  breaker.on('open', () => console.log('[CircuitBreaker] OPEN'));
  breaker.on('halfOpen', () => console.log('[CircuitBreaker] HALF_OPEN'));
  breaker.on('close', () => console.log('[CircuitBreaker] CLOSED'));
  breaker.on('failure', (err) => console.error(`[CircuitBreaker] failure: ${err.message}`));

  return breaker;
}
