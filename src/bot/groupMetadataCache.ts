import type { GroupMetadata, WASocket } from "@whiskeysockets/baileys";

import { logger } from "../config/logger";
import { normalizeJid } from "../utils/jid";
import { LruCache } from "../utils/lruCache";

const DEFAULT_CACHE_MAX_GROUPS = 500;
const DEFAULT_FRESH_TTL_MS = 5 * 60 * 1000;
const DEFAULT_STALE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 20_000;

export function isRateLimitMetadataError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    data?: unknown;
    message?: unknown;
    output?: { statusCode?: unknown };
  };

  if (candidate.data === 429 || candidate.output?.statusCode === 429) {
    return true;
  }

  if (typeof candidate.message === "string") {
    return candidate.message.toLowerCase().includes("rate-overlimit");
  }

  return false;
}

export class GroupMetadataCacheManager {
  private readonly staleFallbackCache = new LruCache<string, GroupMetadata>(
    DEFAULT_CACHE_MAX_GROUPS,
    DEFAULT_STALE_TTL_MS,
  );
  private readonly backoffUntilCache = new LruCache<string, number>(
    DEFAULT_CACHE_MAX_GROUPS,
    DEFAULT_RATE_LIMIT_BACKOFF_MS * 2,
  );
  private readonly inFlightFetches = new Map<string, Promise<GroupMetadata>>();

  constructor(
    readonly freshCache = new LruCache<string, GroupMetadata>(
      DEFAULT_CACHE_MAX_GROUPS,
      DEFAULT_FRESH_TTL_MS,
    ),
  ) {}

  async getOrFetch(
    groupJid: string,
    fetcher: (jid: string) => Promise<GroupMetadata>,
  ): Promise<GroupMetadata> {
    const normalizedJid = normalizeJid(groupJid);
    const freshHit = this.freshCache.get(normalizedJid);
    if (freshHit) {
      return freshHit;
    }

    const backoffUntil = this.backoffUntilCache.get(normalizedJid);
    if (backoffUntil !== undefined && Date.now() < backoffUntil) {
      const staleHit = this.staleFallbackCache.get(normalizedJid);
      if (staleHit) {
        return staleHit;
      }
    }

    const existingPromise = this.inFlightFetches.get(normalizedJid);
    if (existingPromise) {
      return existingPromise;
    }

    const fetchPromise = this.executeFetch(normalizedJid, fetcher).finally(() => {
      this.inFlightFetches.delete(normalizedJid);
    });
    this.inFlightFetches.set(normalizedJid, fetchPromise);

    return fetchPromise;
  }

  private async executeFetch(
    normalizedJid: string,
    fetcher: (jid: string) => Promise<GroupMetadata>,
  ): Promise<GroupMetadata> {
    try {
      const metadata = await fetcher(normalizedJid);
      this.freshCache.set(normalizedJid, metadata);
      this.staleFallbackCache.set(normalizedJid, metadata);
      this.backoffUntilCache.delete(normalizedJid);
      return metadata;
    } catch (error: unknown) {
      const staleHit = this.staleFallbackCache.get(normalizedJid);
      if (isRateLimitMetadataError(error)) {
        this.backoffUntilCache.set(
          normalizedJid,
          Date.now() + DEFAULT_RATE_LIMIT_BACKOFF_MS,
          DEFAULT_RATE_LIMIT_BACKOFF_MS,
        );
      }

      if (staleHit) {
        logger.warn(
          { err: error, groupJid: normalizedJid },
          "Menggunakan fallback cache metadata grup karena fetch WA gagal",
        );
        return staleHit;
      }

      throw error;
    }
  }

  invalidate(groupJid: string): void {
    const normalizedJid = normalizeJid(groupJid);
    // Hapus freshCache agar panggilan berikutnya mengambil data baru,
    // tetap simpan staleFallbackCache sebagai pengaman bila terkena 429 rate-overlimit.
    this.freshCache.delete(normalizedJid);
  }

  clear(): void {
    this.freshCache.clear();
    this.staleFallbackCache.clear();
    this.backoffUntilCache.clear();
    this.inFlightFetches.clear();
  }

  installOnSocket(socket: WASocket): (jid: string) => Promise<GroupMetadata> {
    const rawGroupMetadata = socket.groupMetadata.bind(socket);
    const cachedFetch = (jid: string): Promise<GroupMetadata> =>
      this.getOrFetch(jid, rawGroupMetadata);

    socket.groupMetadata = cachedFetch;
    return cachedFetch;
  }
}
