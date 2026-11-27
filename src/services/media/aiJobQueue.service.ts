import { BoundedQueue, mediaQueueService } from "../../utils/boundedQueue";

export { BoundedQueue, mediaQueueService };

export class AiJobQueueService {
  private readonly queue: BoundedQueue;

  constructor(maxConcurrentJobs: number) {
    this.queue = new BoundedQueue({
      concurrency: maxConcurrentJobs,
      maxQueue: 20,
    });
  }

  async run<T>(job: () => Promise<T>): Promise<T> {
    return this.queue.run(job);
  }
}
