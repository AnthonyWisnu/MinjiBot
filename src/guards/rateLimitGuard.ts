import { roleGuard } from "./roleGuard";
import type { CommandContext } from "../types/command";
import { getIdentityCandidateJids } from "../utils/jid";

export interface RateLimitResult {
  allowed: boolean;
  warnUser: boolean;
  message?: string;
}

export interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  cooldownMs?: number;
  nowFn?: () => number;
}

interface UserBucket {
  timestamps: number[];
  blockedUntil: number;
  warned: boolean;
}

const DEFAULT_WINDOW_MS = 5_000;
const DEFAULT_MAX_REQUESTS = 5;
const DEFAULT_COOLDOWN_MS = 8_000;
const CLEANUP_THRESHOLD = 500;
const ENTRY_MAX_AGE_MS = 60_000;

export class RateLimitGuard {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, UserBucket>();

  constructor(options: RateLimitOptions = {}) {
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.now = options.nowFn ?? (() => Date.now());
  }

  check(context: CommandContext): RateLimitResult {
    const candidateJids = getIdentityCandidateJids(
      context.senderUserJid,
      context.senderAltJids,
    );

    if (
      context.role === "SUPER_OWNER" ||
      candidateJids.some((jid) => roleGuard.isSuperOwner(jid))
    ) {
      return { allowed: true, warnUser: false };
    }

    const key = context.senderUserJid;
    const now = this.now();

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        timestamps: [],
        blockedUntil: 0,
        warned: false,
      };
      this.buckets.set(key, bucket);
    }

    if (now < bucket.blockedUntil) {
      if (!bucket.warned) {
        bucket.warned = true;
        return {
          allowed: false,
          warnUser: true,
          message: "Kamu mengirim perintah terlalu cepat. Mohon tunggu beberapa detik.",
        };
      }

      return { allowed: false, warnUser: false };
    }

    bucket.timestamps = bucket.timestamps.filter(
      (time) => now - time < this.windowMs,
    );

    if (bucket.timestamps.length >= this.maxRequests) {
      bucket.blockedUntil = now + this.cooldownMs;
      bucket.warned = true;

      this.maybeCleanup(now);

      return {
        allowed: false,
        warnUser: true,
        message: "Kamu mengirim perintah terlalu cepat. Mohon tunggu beberapa detik.",
      };
    }

    bucket.timestamps.push(now);
    bucket.warned = false;

    this.maybeCleanup(now);

    return { allowed: true, warnUser: false };
  }

  reset(): void {
    this.buckets.clear();
  }

  private maybeCleanup(now: number): void {
    if (this.buckets.size < CLEANUP_THRESHOLD) {
      return;
    }

    for (const [key, bucket] of this.buckets.entries()) {
      const isBlocked = now < bucket.blockedUntil;
      const hasRecentTimestamps = bucket.timestamps.some(
        (time) => now - time < ENTRY_MAX_AGE_MS,
      );

      if (!isBlocked && !hasRecentTimestamps) {
        this.buckets.delete(key);
      }
    }
  }
}

export const rateLimitGuard = new RateLimitGuard();
