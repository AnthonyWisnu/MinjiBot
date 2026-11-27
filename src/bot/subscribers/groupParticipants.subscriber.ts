import type { BaileysEventMap, WASocket } from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import { antiRaidService } from "../../services/moderation/antiRaid.service";
import { welcomeService } from "../../services/welcome/welcome.service";

type GroupParticipantsUpdateEvent = BaileysEventMap["group-participants.update"];

export async function handleGroupParticipantsUpdate(
  socket: WASocket,
  update: GroupParticipantsUpdateEvent,
): Promise<void> {
  // 1. Anti-Raid / Surge Protection
  try {
    const triggered = await antiRaidService.handleParticipantsJoin(socket, update);
    if (triggered) {
      // When anti-raid locks down the group, stop further processing (skip individual welcome spam)
      return;
    }
  } catch (error: unknown) {
    logger.error(
      {
        error,
        groupJid: update.id,
      },
      "Event anti-raid gagal diproses",
    );
  }

  // 2. Welcome & Goodbye Member Notification
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
}
