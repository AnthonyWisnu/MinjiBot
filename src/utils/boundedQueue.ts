import { AppUserError } from "../errors/appUserError";

export interface BoundedQueueOptions {
  concurrency: number;
  maxQueue?: number;
  queueFullMessage?: string;
}

export class BoundedQueue {
  public readonly concurrency: number;
  public readonly maxQueue: number;
  private readonly queueFullMessage: string;

  private activeJobs = 0;
  private readonly waitingQueue: {
    resolve: () => void;
    reject: (err: Error) => void;
  }[] = [];

  constructor(options: BoundedQueueOptions) {
    this.concurrency = Math.max(1, options.concurrency);
    this.maxQueue = options.maxQueue ?? 20;
    this.queueFullMessage =
      options.queueFullMessage ??
      "Server sedang memproses banyak media. Silakan coba beberapa saat lagi.";
  }

  get activeCount(): number {
    return this.activeJobs;
  }

  get pendingCount(): number {
    return this.waitingQueue.length;
  }

  async run<T>(job: () => Promise<T>): Promise<T> {
    await this.acquireSlot();

    try {
      return await job();
    } finally {
      this.releaseSlot();
    }
  }

  private acquireSlot(): Promise<void> {
    if (this.activeJobs < this.concurrency) {
      this.activeJobs += 1;
      return Promise.resolve();
    }

    if (this.waitingQueue.length >= this.maxQueue) {
      throw new AppUserError(this.queueFullMessage);
    }

    return new Promise<void>((resolve, reject) => {
      this.waitingQueue.push({ resolve, reject });
    });
  }

  private releaseSlot(): void {
    this.activeJobs -= 1;
    const next = this.waitingQueue.shift();
    if (next) {
      this.activeJobs += 1;
      next.resolve();
    }
  }
}

/**
 * Service pengatur konkurensi media global bot:
 * - heavySubprocessQueue (concurrency: 2, maxQueue: 15): untuk download TikTok/IG/YouTube, play audio, & normalisasi video
 * - imageComputeQueue (concurrency: 3, maxQueue: 20): untuk komputasi Sharp HD Photo & konversi animasi stiker
 */
export class MediaQueueService {
  public readonly heavySubprocessQueue: BoundedQueue;
  public readonly imageComputeQueue: BoundedQueue;

  constructor() {
    this.heavySubprocessQueue = new BoundedQueue({
      concurrency: 2,
      maxQueue: 15,
      queueFullMessage:
        "Server sedang memproses banyak unduhan media. Silakan coba beberapa saat lagi.",
    });

    this.imageComputeQueue = new BoundedQueue({
      concurrency: 3,
      maxQueue: 20,
      queueFullMessage:
        "Server sedang memproses banyak peningkatan gambar/stiker. Silakan coba beberapa saat lagi.",
    });
  }
}

export const mediaQueueService = new MediaQueueService();
