import { describe, it, expect, vi, beforeEach } from 'vitest';
import CircuitBreaker from 'opossum';

describe('integration: opossum circuit breaker', () => {
  let breaker;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('closes on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    breaker = new CircuitBreaker(fn, { timeout: 1000 });

    const result = await breaker.fire();

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(breaker.status.stats.successes).toBe(1);
    expect(breaker.opened).toBe(false);
  });

  it('opens after failures', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    breaker = new CircuitBreaker(fn, {
      timeout: 500,
      errorThresholdPercentage: 1,
      resetTimeout: 2000,
    });

    const openSpy = vi.fn();
    breaker.on('open', openSpy);

    await expect(breaker.fire()).rejects.toThrow('fail');

    expect(openSpy).toHaveBeenCalled();
    expect(breaker.opened).toBe(true);
  });

  it('half-opens after reset timeout', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    breaker = new CircuitBreaker(fn, {
      timeout: 500,
      errorThresholdPercentage: 1,
      resetTimeout: 1000,
    });

    const halfOpenSpy = vi.fn();
    breaker.on('halfOpen', halfOpenSpy);

    await expect(breaker.fire()).rejects.toThrow('fail');
    expect(breaker.opened).toBe(true);

    // advance timers to trigger resetTimeout
    vi.advanceTimersByTime(1000);

    // Let opossum emit events
    await vi.waitFor(() => {
      expect(halfOpenSpy).toHaveBeenCalled();
    });
  });
});
