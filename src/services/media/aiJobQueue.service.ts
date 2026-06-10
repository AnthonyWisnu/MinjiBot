export class AiJobQueueService {
  private activeJobs = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly maxConcurrentJobs: number) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    await this.waitForSlot();

    try {
      return await job();
    } finally {
      this.activeJobs -= 1;
      this.releaseNext();
    }
  }

  private waitForSlot(): Promise<void> {
    if (this.activeJobs < this.maxConcurrentJobs) {
      this.activeJobs += 1;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        this.activeJobs += 1;
        resolve();
      });
    });
  }

  private releaseNext(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }
}
