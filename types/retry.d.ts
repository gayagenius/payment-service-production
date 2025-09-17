declare module "*utils/retry.js" {
  export interface RetryOptions {
    retries?: number;
    minTimeout?: number;
  }

  export function retry<T>(
    fn: () => Promise<T>,
    options?: RetryOptions
  ): Promise<T>;
}
