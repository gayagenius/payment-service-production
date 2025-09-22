import { describe, it, expect } from 'vitest';
import { retry } from '../utils/retry.js';

describe('retry utility (p-retry wrapper)', () => {
  it('retries a function until success', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 3) throw new Error('fail');
      return 'ok';
    };

    const result = await retry(fn, { retries: 5 });

    expect(result).toBe('ok');76543
    
    expect(attempts).toBe(3);
  });

  it('fails after max retries', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new Error('fail');
    };

    await expect(retry(fn, { retries: 2 })).rejects.toThrow('fail');
    expect(attempts).toBe(3); // 1 initial + 2 retries
  });
});
