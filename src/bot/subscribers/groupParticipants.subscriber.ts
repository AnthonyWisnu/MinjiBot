import type { BaileysEventMap, WASocket } from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import { welcomeService } from "../../services/welcome/welcome.service";

type GroupParticipantsUpdateEvent = BaileysEventMap["group-participants.update"];

export async function handleGroupParticipantsUpdate(
  socket: WASocket,
  update: GroupParticipantsUpdateEvent,
): Promise<void> {
  // 1. Welcome & Goodbye Member Notification
  try {
    await welcomeService.handleParticipantsUpdate(socket, update);
  } catch (error: unknown) {
    logger.error(
      {
        error,
        groupJid: update.id,
        action: update.action,
      },
      "Event peserta grup (welcome/goodbye) gagal diproses",
    );
  }

  // 2. Anti-Raid / Surge Protection (dipersiapkan untuk modul P0)
}
