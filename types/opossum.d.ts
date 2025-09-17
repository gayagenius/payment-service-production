declare module 'opossum' {
  interface CircuitBreakerOptions {
    timeout?: number;
    errorThresholdPercentage?: number;
    resetTimeout?: number;
    rollingCountBuckets?: number;
    rollingCountTimeout?: number;
    [key: string]: any;
  }

  class CircuitBreaker<T = any> {
    constructor(action: (...args: any[]) => Promise<T>, options?: CircuitBreakerOptions);
    fire(...args: any[]): Promise<T>;
    open(): void;
    close(): void;
    status: {
      stats: {
        successes: number;
        failures: number;
        [key: string]: number;
      };
    };
    opened: boolean;
    halfOpen: boolean;
    on(event: 'open' | 'halfOpen' | 'close' | string, listener: (...args: any[]) => void): this;
    [key: string]: any;
  }

  export default CircuitBreaker;
}
