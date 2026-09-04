import type { ConnectionState, WASocket } from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import { reminderScheduler } from "../../services/reminder/reminderScheduler";
import { levelUpNotifierService } from "../../services/member/levelUpNotifier.service";
import { handleMessagesUpsert } from "../messageHandler";
import { handleGroupParticipantsUpdate } from "./groupParticipants.subscriber";
import { handleMessagesUpdate } from "./messageRevoke.subscriber";

export * from "./groupParticipants.subscriber";
export * from "./messageRevoke.subscriber";

export interface EventSubscriberOptions {
  saveCreds: () => Promise<void>;
  onConnectionUpdate: (update: Partial<ConnectionState>) => void;
}

export function registerEventSubscribers(
  socket: WASocket,
  options: EventSubscriberOptions,
): void {
  socket.ev.on("creds.update", () => {
    options.saveCreds().catch((error: unknown) => {
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

    handleMessagesUpsert(socket, event).catch((error: unknown) => {
      logger.error({ error }, "Batch pesan WhatsApp gagal diproses");
    });
  });

  socket.ev.on("group-participants.update", (event) => {
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
