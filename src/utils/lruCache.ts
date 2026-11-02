export interface LruCacheOptions<V> {
  maxSize: number;
  ttlMs?: number;
  onEvict?: (key: string, value: V) => void;
}

export class LruCache<K extends string | number | symbol = string, V = unknown> {
  private readonly map = new Map<K, { value: V; expiresAt: number }>();
  public readonly maxSize: number;
  public readonly ttlMs: number;
  private readonly onEvict?: (key: string, value: V) => void;

  constructor(maxSizeOrOptions: number | LruCacheOptions<V>, ttlMs = 0) {
    if (typeof maxSizeOrOptions === "number") {
      this.maxSize = Math.max(1, maxSizeOrOptions);
      this.ttlMs = ttlMs > 0 ? ttlMs : 0;
    } else {
      this.maxSize = Math.max(1, maxSizeOrOptions.maxSize);
      this.ttlMs =
        maxSizeOrOptions.ttlMs && maxSizeOrOptions.ttlMs > 0 ? maxSizeOrOptions.ttlMs : 0;
      this.onEvict = maxSizeOrOptions.onEvict;
    }
  }

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    if (this.ttlMs > 0 && Date.now() > entry.expiresAt) {
      this.delete(key);
      return undefined;
    }

    // Refresh LRU order: delete & re-insert
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  set(key: K, value: V, customTtlMs?: number): this {
    if (this.map.has(key)) {
      const old = this.map.get(key);
      if (old && this.onEvict) {
        this.onEvict(String(key), old.value);
      }
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Evict oldest entry
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        const oldestEntry = this.map.get(oldestKey);
        this.map.delete(oldestKey);
        if (oldestEntry && this.onEvict) {
          this.onEvict(String(oldestKey), oldestEntry.value);
        }
      }
    }

    const effectiveTtl = customTtlMs ?? this.ttlMs;
    const expiresAt = effectiveTtl > 0 ? Date.now() + effectiveTtl : Number.POSITIVE_INFINITY;

    this.map.set(key, { value, expiresAt });
    return this;
  }

  delete(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;

    this.map.delete(key);
    if (this.onEvict) {
      this.onEvict(String(key), entry.value);
    }
    return true;
  }

  clear(): void {
    if (this.onEvict) {
      for (const [key, entry] of this.map.entries()) {
        this.onEvict(String(key), entry.value);
      }
    }
    this.map.clear();
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }

  values(): V[] {
    const now = Date.now();
    const result: V[] = [];
    for (const [key, entry] of this.map.entries()) {
      if (this.ttlMs > 0 && now > entry.expiresAt) {
        this.delete(key);
      } else {
        result.push(entry.value);
      }
    }
    return result;
  }
}
