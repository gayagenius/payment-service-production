// types/circuitBreaker.d.ts
declare module '../utils/circuitBreaker.js' {
  export type CircuitBreakerOptions = {
    timeout?: number;
    errorThresholdPercentage?: number;
    resetTimeout?: number;
    [key: string]: any;
  };

  export type CircuitBreaker = {
    fire: (...args: any[]) => Promise<any>;
    opened: boolean;
    closed: boolean;
    halfOpen: boolean;
    [key: string]: any;
  };

  export function createCircuitBreaker(
    fn: (...args: any[]) => Promise<any>,
    options?: CircuitBreakerOptions
  ): CircuitBreaker;
}
