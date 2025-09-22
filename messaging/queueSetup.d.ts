// queueSetup.d.ts
export {};

declare module "../messaging/queueSetup.js" {
  /**
   * Connect to RabbitMQ and assert exchange.
   * @param retries Number of retries if connection fails (default 5)
   * @returns Promise that resolves to the connection object
   */
  export function connect(retries?: number): Promise<any>;

  /**
   * Publish a message to a topic exchange.
   * @param topic The topic/routing key
   * @param payload JSON-serializable payload
   */
  export function publish(topic: string, payload: any): void;
}
