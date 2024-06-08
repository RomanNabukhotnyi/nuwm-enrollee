export class PromisePipeline<T> {
  private queue: (() => Promise<T>)[] = [];
  private interval: number;
  private isRunning = false;

  constructor(maxPerMinute: number) {
    this.interval = 60000 / maxPerMinute;
  }

  public add(promiseFactory: () => Promise<T>): void {
    this.queue.push(promiseFactory);
    this.run();
  }

  private async run(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    while (this.queue.length > 0) {
      const promiseFactory = this.queue.shift();
      if (promiseFactory) {
        try {
          await promiseFactory();
        } catch (error) {
          console.error('Promise failed:', error);
        }
      }
      await this.delay(this.interval);
    }

    this.isRunning = false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
