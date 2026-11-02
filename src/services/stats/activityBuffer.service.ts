import { logger } from "../../config/logger";
import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";

interface BufferedActivity {
  groupJid: string;
  userJid: string;
  count: number;
  lastActiveAt: Date;
}

export class ActivityBufferService {
  private readonly buffer = new Map<string, BufferedActivity>();
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private readonly FLUSH_INTERVAL_MS = 15_000; // 15 detik

  constructor(
    private readonly profileRepo = new GroupMemberProfileRepository(),
    autoStart = true,
  ) {
    if (autoStart) {
      this.startFlushTimer();
    }
  }

  startFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      void this.flush().catch((err: unknown) => {
        logger.warn({ err }, "Periodic activity buffer flush failed");
      });
    }, this.FLUSH_INTERVAL_MS);

    // Jangan tahan event loop Node.js agar proses bisa shutdown secara normal
    this.flushTimer.unref();
  }

  stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Menambahkan akumulasi pesan member di memori (0 database I/O).
   */
  recordMessage(groupJid: string, userJid: string): void {
    const key = `${groupJid}::${userJid}`;
    const existing = this.buffer.get(key);

    if (existing) {
      existing.count += 1;
      existing.lastActiveAt = new Date();
    } else {
      this.buffer.set(key, {
        groupJid,
        userJid,
        count: 1,
        lastActiveAt: new Date(),
      });
    }
  }

  /**
   * Menuliskan seluruh akumulasi aktivitas grup tertentu ke basis data secara instan.
   * Dipanggil sebelum .stats, .topaktif, dan .silent agar angka selalu 100% real-time akurat!
   */
  async flushGroup(groupJid: string): Promise<void> {
    const targets: BufferedActivity[] = [];
    for (const [key, item] of this.buffer.entries()) {
      if (item.groupJid === groupJid) {
        targets.push(item);
        this.buffer.delete(key);
      }
    }

    if (targets.length === 0) return;

    for (const item of targets) {
      try {
        await this.profileRepo.recordActivityBatch(
          item.groupJid,
          item.userJid,
          item.count,
          item.lastActiveAt,
        );
      } catch (err: unknown) {
        logger.warn(
          { err, groupJid: item.groupJid, userJid: item.userJid },
          "Failed to write flushed group activity",
        );
      }
    }
  }

  /**
   * Mengosongkan dan menuliskan seluruh buffer yang tersisa ke database.
   * Dipanggil saat shutdown aplikasi atau timer 15 detik.
   */
  async flush(): Promise<void> {
    if (this.isFlushing || this.buffer.size === 0) {
      return;
    }

    this.isFlushing = true;
    const snapshot = Array.from(this.buffer.values());
    this.buffer.clear();

    try {
      for (const item of snapshot) {
        try {
          await this.profileRepo.recordActivityBatch(
            item.groupJid,
            item.userJid,
            item.count,
            item.lastActiveAt,
          );
        } catch (err: unknown) {
          logger.warn(
            { err, groupJid: item.groupJid, userJid: item.userJid },
            "Failed to write periodic activity batch",
          );
        }
      }
    } finally {
      this.isFlushing = false;
    }
  }

  getPendingCount(): number {
    let total = 0;
    for (const item of this.buffer.values()) {
      total += item.count;
    }
    return total;
  }
}

export const activityBufferService = new ActivityBufferService();
