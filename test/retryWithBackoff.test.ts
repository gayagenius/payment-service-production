import { describe, it, expect, vi, afterEach } from 'vitest';
import { retryWithBackoff } from '../workers/retryWithBackoff.js';

// Clean up timers and spies after each test
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('retryWithBackoff', () => {
  it('retries and eventually succeeds', async () => {
    vi.useFakeTimers();

    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error('fail');
      return 'ok';
    });

    // Start the retrying operation
    const promise = retryWithBackoff(
      fn,
      /* maxAttempts */ 5,
      /* baseDelayMs */ 100,
      /* factor */ 2,
      /* jitter */ false
    );

    // Advance and flush all timers + microtasks so the promise can settle
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after maxAttempts', async () => {
    vi.useFakeTimers();

    // (Optional) silence backoff logs during the test
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const fn = vi.fn(async () => {
      throw new Error('always');
    });

    // Attach .catch immediately so the rejection is never "unhandled"
    const promise = retryWithBackoff(
      fn,
      /* maxAttempts */ 3,
      /* baseDelayMs */ 50,
      /* factor */ 2,
      /* jitter */ false
    ).catch((e) => e);

    // Flush all timers and microtasks
    await vi.runAllTimersAsync();

    // The promise resolves to the Error we caught above
    const err = await promise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/always/);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
