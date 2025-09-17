declare module "../utils/circuitBreaker.js" {
  export interface CircuitBreakerOptions {
    timeout?: number;
    errorThresholdPercentage?: number;
    resetTimeout?: number;
  }

  export interface CircuitBreaker {
    fire: (...args: any[]) => Promise<any>;
    closed: boolean;
    opened: boolean;
    halfOpen: boolean;
  }

  export function createCircuitBreaker(
    fn: (...args: any[]) => Promise<any>,
    options?: CircuitBreakerOptions
  ): CircuitBreaker;
}
