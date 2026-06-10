import {
  Browsers,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env";
import { logger } from "../config/logger";

export interface BotSocket {
  socket: WASocket;
  saveCreds: () => Promise<void>;
}

export async function createBotSocket(): Promise<BotSocket> {
  const sessionDir = path.resolve(env.SESSION_DIR);
  await mkdir(sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version, isLatest } = await fetchLatestBaileysVersion();

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
    getMessage: () => Promise.resolve(undefined),
  });

  return {
    socket,
    saveCreds,
  };
}
