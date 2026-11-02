import type { ConnectionState, WASocket } from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import { reminderScheduler } from "../../services/reminder/reminderScheduler";
import { levelUpNotifierService } from "../../services/member/levelUpNotifier.service";
import { groupMetadataCache } from "../connection";
import { handleMessagesUpsert } from "../messageHandler";
import { cacheMessageForRetry } from "../messageRetryStore";
import { handleGroupParticipantsUpdate } from "./groupParticipants.subscriber";
import { handleMessagesUpdate } from "./messageRevoke.subscriber";

export * from "./groupParticipants.subscriber";
export * from "./messageRevoke.subscriber";

export interface EventSubscriberOptions {
  saveCreds: () => Promise<void>;
  onConnectionUpdate: (update: Partial<ConnectionState>) => void;
}

// Coalescing mutex queue untuk serialisasi pemanggilan saveCreds
let isWritingCreds = false;
let hasPendingCredsWrite = false;
let pendingCredsResolves: (() => void)[] = [];
let pendingCredsRejects: ((err: unknown) => void)[] = [];

export async function queueSaveCreds(saveCredsFn: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    pendingCredsResolves.push(resolve);
    pendingCredsRejects.push(reject);

    if (isWritingCreds) {
      hasPendingCredsWrite = true;
      return;
    }

    void processCredsQueue(saveCredsFn);
  });
}

async function processCredsQueue(saveCredsFn: () => Promise<void>): Promise<void> {
  isWritingCreds = true;
  while (pendingCredsResolves.length > 0 || hasPendingCredsWrite) {
    hasPendingCredsWrite = false;
    const currentResolves = pendingCredsResolves;
    const currentRejects = pendingCredsRejects;
    pendingCredsResolves = [];
    pendingCredsRejects = [];

    try {
      await saveCredsFn();
      for (const resolve of currentResolves) resolve();
    } catch (err: unknown) {
      for (const reject of currentRejects) reject(err);
    }
  }
  isWritingCreds = false;
}

/**
 * Tunggu hingga seluruh antrean saveCreds selesai ditulis ke disk.
 * Dipanggil saat graceful shutdown.
 */
export async function flushCredsQueue(): Promise<void> {
  while (isWritingCreds || hasPendingCredsWrite || pendingCredsResolves.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export function registerEventSubscribers(socket: WASocket, options: EventSubscriberOptions): void {
  socket.ev.on("creds.update", () => {
    queueSaveCreds(options.saveCreds).catch((error: unknown) => {
      logger.error({ error }, "Gagal menyimpan auth state WhatsApp");
    });
  });

  socket.ev.on("connection.update", (update) => {
    options.onConnectionUpdate(update);
  });

  socket.ev.on("messages.upsert", (event) => {
    logger.debug(
      {
        messageCount: event.messages.length,
        type: event.type,
      },
      "Pesan WhatsApp diterima",
    );

    // Simpan pesan masuk & keluar ke retry store untuk Baileys decryption retry
    for (const msg of event.messages) {
      if (msg.key.id && msg.message) {
        cacheMessageForRetry(msg.key.id, msg.message);
      }
    }

    handleMessagesUpsert(socket, event).catch((error: unknown) => {
      logger.error({ error }, "Batch pesan WhatsApp gagal diproses");
    });
  });

  socket.ev.on("groups.update", (updates) => {
    for (const update of updates) {
      if (update.id) {
        groupMetadataCache.delete(update.id);
      }
    }
  });

  socket.ev.on("group-participants.update", (event) => {
    if (event.id) {
      groupMetadataCache.delete(event.id);
    }
    handleGroupParticipantsUpdate(socket, event).catch((error: unknown) => {
      logger.error({ error }, "Update peserta grup gagal diproses");
    });
  });

  socket.ev.on("messages.update", (updates) => {
    handleMessagesUpdate(socket, updates).catch((error: unknown) => {
      logger.error({ error }, "Update pesan WhatsApp gagal diproses");
    });
  });

  reminderScheduler.start(socket);
  levelUpNotifierService.setSocket(socket);
}
