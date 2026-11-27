import type { proto } from "@whiskeysockets/baileys";
import { LruCache } from "../utils/lruCache";

/**
 * In-memory LRU store untuk pesan (outgoing & incoming).
 * Digunakan oleh handler getMessage pada makeWASocket untuk Baileys decryption retry.
 * Kapasitas 1.000 pesan dengan TTL 30 menit.
 */
export const messageRetryStore = new LruCache<string, proto.IMessage>(1000, 30 * 60 * 1000);

export function cacheMessageForRetry(
  id: string | null | undefined,
  message: proto.IMessage | null | undefined,
): void {
  if (id && message) {
    messageRetryStore.set(id, message);
  }
}
