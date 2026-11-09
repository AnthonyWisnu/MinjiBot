import { AppUserError } from "../errors/appUserError";

export interface BoundedQueueOptions {
  concurrency: number;
  maxQueue?: number;
  queueFullMessage?: string;
}

export interface QueueRunOptions {
  onQueued?: (position: number) => void | Promise<void>;
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

  async run<T>(job: () => Promise<T>, options?: QueueRunOptions): Promise<T> {
    await this.acquireSlot(options?.onQueued);

    try {
      return await job();
    } finally {
      this.releaseSlot();
    }
  }

  private async acquireSlot(onQueued?: (position: number) => void | Promise<void>): Promise<void> {
    if (this.activeJobs < this.concurrency) {
      this.activeJobs += 1;
      return;
    }

    if (this.waitingQueue.length >= this.maxQueue) {
      throw new AppUserError(this.queueFullMessage);
    }

    const position = this.waitingQueue.length + 1;
    const waitPromise = new Promise<void>((resolve, reject) => {
      this.waitingQueue.push({ resolve, reject });
    });

    if (onQueued) {
      try {
        await onQueued(position);
      } catch {
        // Abaikan error pengiriman notifikasi antrean agar job tetap menunggu slot
      }
    }

    await waitPromise;
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
 * - heavySubprocessQueue (concurrency: 2, maxQueue: 15): untuk download TikTok/IG/YouTube/X/Pin, play audio, dan normalisasi video
 * - imageComputeQueue (concurrency: 3, maxQueue: 20): untuk komputasi Sharp HD Photo dan konversi animasi stiker
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
