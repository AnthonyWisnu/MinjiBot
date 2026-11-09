import {
  Browsers,
  DEFAULT_CONNECTION_CONFIG,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  type GroupMetadata,
  type WASocket,
  type WAVersion,
} from "@whiskeysockets/baileys";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env";
import { logger } from "../config/logger";
import { LruCache } from "../utils/lruCache";
import { messageRetryStore } from "./messageRetryStore";

export interface BotSocket {
  socket: WASocket;
  saveCreds: () => Promise<void>;
}

/**
 * LRU cache untuk GroupMetadata (500 grup, TTL 5 menit).
 * Mencegah query metadata berulang ke server WhatsApp.
 */
export const groupMetadataCache = new LruCache<string, GroupMetadata>(500, 5 * 60 * 1000);

export async function createBotSocket(): Promise<BotSocket> {
  const sessionDir = path.resolve(env.SESSION_DIR);
  await mkdir(sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  let version: WAVersion = DEFAULT_CONNECTION_CONFIG.version;
  let isLatest = false;

  try {
    const versionResult = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          reject(new Error("Timeout fetching latest Baileys version (5000ms)"));
        }, 5000),
      ),
    ]);
    version = versionResult.version;
    isLatest = versionResult.isLatest;
  } catch (error: unknown) {
    logger.warn(
      { err: error, fallbackVersion: version.join(".") },
      "Gagal mengambil versi Baileys terbaru, menggunakan fallback default",
    );
  }

  logger.info(
    {
      version: version.join("."),
      isLatest,
      sessionDir,
    },
    "Menyiapkan koneksi Baileys",
  );

  const socket = makeWASocket({
    auth: state,
    version,
    browser: Browsers.ubuntu(env.BOT_BROWSER_NAME),
    logger: logger.child({ module: "baileys" }),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    keepAliveIntervalMs: 25_000,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    retryRequestDelayMs: 500,
    cachedGroupMetadata: (jid) => Promise.resolve(groupMetadataCache.get(jid)),
    getMessage: (key) => {
      if (!key.id) return Promise.resolve(undefined);
      return Promise.resolve(messageRetryStore.get(key.id));
    },
  });

  return {
    socket,
    saveCreds,
  };
}
