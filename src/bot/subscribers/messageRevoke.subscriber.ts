import {
  proto,
  WAMessageStubType,
  type BaileysEventMap,
  type WASocket,
} from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import { antiDeleteService } from "../../services/moderation/antiDelete.service";

type MessagesUpdateEvent = BaileysEventMap["messages.update"];

export async function handleMessagesUpdate(
  socket: WASocket,
  updates: MessagesUpdateEvent,
): Promise<void> {
  for (const item of updates) {
    // 1. Cek jika protokol pesan revoke ada di message.protocolMessage
    const protocolKey = item.update.message?.protocolMessage?.key;
    if (
      item.update.message?.protocolMessage?.type === proto.Message.ProtocolMessage.Type.REVOKE &&
      protocolKey
    ) {
      try {
        const revokerJid =
          item.key.participant ??
          item.key.remoteJid ??
          extractFirstStubParam(item.update.messageStubParameters) ??
          extractParticipantFromUpdate(item.update);
        await antiDeleteService.handleMessageRevoke(socket, protocolKey, revokerJid);
      } catch (error: unknown) {
        logger.error({ error }, "Gagal memproses deteksi pesan ditarik via protocolMessage");
      }
      continue;
    }

    // 2. Di Baileys standar, pesan ditarik di-emit dengan update.message = null
    // dan update.messageStubType = WAMessageStubType.REVOKE (1),
    // sedangkan item.key adalah key pesan yang ditarik.
    const isRevokeStub =
      item.update.messageStubType === WAMessageStubType.REVOKE ||
      (item.update as { messageStubType?: number }).messageStubType === 1;

    if (isRevokeStub) {
      try {
        const revokerJid =
          extractFirstStubParam(item.update.messageStubParameters) ??
          extractParticipantFromUpdate(item.update) ??
          item.key.participant ??
          undefined;
        await antiDeleteService.handleMessageRevoke(socket, item.key, revokerJid);
      } catch (error: unknown) {
        logger.error({ error }, "Gagal memproses deteksi pesan ditarik via stubType");
      }
    }
  }
}

function extractFirstStubParam(params: unknown): string | undefined {
  if (!Array.isArray(params) || params.length === 0) {
    return undefined;
  }

  const first: unknown = params[0];
  return typeof first === "string" && first.length > 0 ? first : undefined;
}

function extractParticipantFromUpdate(update: unknown): string | undefined {
  if (!update || typeof update !== "object" || !("participant" in update)) {
    return undefined;
  }

  const participant = (update as { participant?: unknown }).participant;
  return typeof participant === "string" && participant.length > 0 ? participant : undefined;
}
