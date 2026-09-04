import { proto, type BaileysEventMap, type WASocket } from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import { antiDeleteService } from "../../services/moderation/antiDelete.service";

type MessagesUpdateEvent = BaileysEventMap["messages.update"];

export async function handleMessagesUpdate(
  socket: WASocket,
  updates: MessagesUpdateEvent,
): Promise<void> {
  for (const item of updates) {
    const protocolMsg = item.update.message?.protocolMessage;
    if (
      protocolMsg?.type === proto.Message.ProtocolMessage.Type.REVOKE &&
      protocolMsg.key
    ) {
      try {
        await antiDeleteService.handleMessageRevoke(socket, protocolMsg.key);
      } catch (error: unknown) {
        logger.error({ error }, "Gagal memproses deteksi pesan ditarik");
      }
    }
  }
}
