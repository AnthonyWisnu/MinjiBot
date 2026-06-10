import type { BaileysEventMap, WASocket } from "@whiskeysockets/baileys";

import { logger } from "../config/logger";
import { welcomeService } from "../services/welcome/welcome.service";

type GroupParticipantsUpdateEvent = BaileysEventMap["group-participants.update"];

export async function handleGroupParticipantsUpdate(
  socket: WASocket,
  update: GroupParticipantsUpdateEvent,
): Promise<void> {
  try {
    await welcomeService.handleParticipantsUpdate(socket, update);
  } catch (error: unknown) {
    logger.error(
      {
        error,
        groupJid: update.id,
        action: update.action,
      },
      "Event peserta grup gagal diproses",
    );
  }
}
