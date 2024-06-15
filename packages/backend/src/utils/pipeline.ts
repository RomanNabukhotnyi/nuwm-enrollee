export class PromisePipeline<T> {
  private name: string;
  private queue: { promiseFactory: () => Promise<T>; id: number | string }[] = [];
  private interval: number | null;
  private isRunning = false;
  private completionTrackers = new Map<number | string, { count: number; resolver: () => void }>();
  private queryCount = 0; // Counter for executed queries
  private activePromises = 0; // Counter for active promises
  private readonly maxQueriesPerMinute: number | null; // Maximum allowed queries per minute
  private readonly maxConcurrentQueries: number; // Maximum allowed concurrent queries

  constructor(name: string, maxConcurrent: number, maxPerMinute?: number) {
    this.name = name;
    this.maxConcurrentQueries = maxConcurrent;
    this.maxQueriesPerMinute = maxPerMinute ?? null; // Use the provided value or null if undefined
    this.interval = maxPerMinute ? 60000 / maxPerMinute : null; // Calculate interval if maxPerMinute is provided
    if (this.maxQueriesPerMinute !== null) {
      setInterval(() => {
        this.queryCount = 0;
      }, 60000); // Reset the counter every minute if maxPerMinute is provided
    }
  }

  public add(id: number | string, promiseFactory: () => Promise<T>): Promise<void> {
    let tracker = this.completionTrackers.get(id);
    if (!tracker) {
      tracker = { count: 1, resolver: () => {} };
      const completionPromise = new Promise<void>((resolve) => {
        // biome-ignore lint/style/noNonNullAssertion: <explanation>
        tracker!.resolver = resolve;
      });
      this.queue.push({ promiseFactory, id });
      this.completionTrackers.set(id, tracker);
      this.run();
      return completionPromise;
    }

    tracker.count++;
    this.queue.push({ promiseFactory, id });
    this.run();
    return new Promise<void>((resolve) => {
      tracker.resolver = resolve;
    });
  }

  private async run(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    while (this.queue.length > 0) {
      if (this.maxQueriesPerMinute !== null && this.queryCount >= this.maxQueriesPerMinute) {
        // Wait until the counter resets if the limit is reached
        await new Promise((resolve) => setTimeout(resolve, 60000 - (Date.now() % 60000)));
        this.queryCount = 0; // Reset the counter for the new minute
      }

      if (this.activePromises >= this.maxConcurrentQueries) {
        // Wait for an active promise slot to be available
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      // biome-ignore lint/style/noNonNullAssertion: <explanation>
      const { promiseFactory, id } = this.queue.shift()!;
      this.activePromises++; // Increment the active promises counter
      promiseFactory()
        .then(() => {
          this.queryCount++; // Increment the counter for each executed query
          this.activePromises--; // Decrement the active promises counter
          console.log(`Promises remaining in ${this.name} pipeline:`, this.queue.length);

          const tracker = this.completionTrackers.get(id);
          if (tracker) {
            tracker.count--;
            if (tracker.count === 0) {
              tracker.resolver();
              this.completionTrackers.delete(id);
            }
          }

          // Ensure the interval between executions does not exceed the rate limit
          if (
            this.queue.length > 0 &&
            (this.maxQueriesPerMinute === null || this.queryCount < this.maxQueriesPerMinute) &&
            this.activePromises < this.maxConcurrentQueries
          ) {
            if (this.interval !== null) {
              this.delay(this.interval).then(() => this.run());
            } else {
              this.run();
            }
          } else {
            this.run();
          }
        })
        .catch((error) => {
          this.activePromises--; // Decrement the active promises counter on error
          console.error(`Promise failed in ${this.name} pipeline:`, error);
          this.run();
        });

      // Break the loop to avoid concurrent run() calls causing race conditions
      break;
    }

    this.isRunning = false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
