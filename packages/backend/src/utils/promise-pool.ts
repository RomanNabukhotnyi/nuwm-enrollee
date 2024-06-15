export class PromisePool {
  private concurrency: number;
  private limitPerMinute: number;
  private memoryLimit: number;
  private activeCount: number;
  private queue: (() => Promise<void>)[];
  private interval: Timer | null;
  private completedInCurrentMinute: number;

  constructor(concurrency: number, limitPerMinute: number, memoryLimit: number) {
    this.concurrency = concurrency;
    this.limitPerMinute = limitPerMinute;
    this.memoryLimit = memoryLimit;
    this.activeCount = 0;
    this.queue = [];
    this.interval = null;
    this.completedInCurrentMinute = 0;
    this.startMinuteCounter();
  }

  private startMinuteCounter() {
    this.interval = setInterval(() => {
      this.completedInCurrentMinute = 0;
      this.logStatus();
    }, 60000);
  }

  private async runTask(task: () => Promise<void>) {
    this.activeCount++;
    this.logStatus();
    try {
      await task();
    } finally {
      this.activeCount--;
      this.completedInCurrentMinute++;
      this.logStatus();
      this.dequeue();
    }
  }

  private dequeue() {
    if (
      this.activeCount < this.concurrency &&
      this.queue.length > 0 &&
      this.completedInCurrentMinute < this.limitPerMinute
    ) {
      if (this.isMemoryUsageWithinLimit()) {
        // biome-ignore lint/style/noNonNullAssertion: <explanation>
        const task = this.queue.shift()!;
        this.runTask(task);
      } else {
        console.log('Memory usage exceeded limit, waiting to dequeue more tasks.');
      }
    }
  }

  public add(task: () => Promise<void>) {
    this.queue.push(task);
    this.logStatus();
    this.dequeue();
  }

  public async addAndWait(task: () => Promise<void>) {
    return new Promise<void>((resolve, reject) => {
      const wrappedTask = async () => {
        try {
          await task();
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      this.add(wrappedTask);
    });
  }

  public stop() {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  private logStatus() {
    const memoryUsage = process.memoryUsage();
    console.log(`Total in queue: ${this.queue.length}`);
    console.log(`Currently running: ${this.activeCount}`);
    console.log(`Completed in current minute: ${this.completedInCurrentMinute}`);
    console.log(`Memory usage: ${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  }

  private isMemoryUsageWithinLimit(): boolean {
    const memoryUsage = process.memoryUsage();
    const usedMemoryMB = memoryUsage.heapUsed / 1024 / 1024;
    return usedMemoryMB < this.memoryLimit;
  }
}
