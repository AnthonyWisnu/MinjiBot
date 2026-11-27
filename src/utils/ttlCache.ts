interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * In-memory LRU/FIFO bounded cache dengan TTL untuk melindungi RAM VPS 2 GB
 * saat menyimpan hasil respons API eksternal (BMKG, Open-Meteo, MyQuran, EQuran, dll).
 */
export class BoundedTtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly maxEntries: number,
    private readonly defaultTtlMs: number,
  ) {}

  get(key: string, nowMs = Date.now()): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= nowMs) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency (LRU)
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs = this.defaultTtlMs, nowMs = Date.now()): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    }
    this.store.set(key, { value, expiresAt: nowMs + ttlMs });

    if (this.store.size > this.maxEntries) {
      for (const [k, v] of this.store.entries()) {
        if (v.expiresAt <= nowMs) {
          this.store.delete(k);
        }
      }
      while (this.store.size > this.maxEntries) {
        const oldest = this.store.keys().next().value;
        if (oldest === undefined) break;
        this.store.delete(oldest);
      }
    }
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}
