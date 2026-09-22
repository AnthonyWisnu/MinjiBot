import type { BaileysEventMap, WASocket } from "@whiskeysockets/baileys";

import { commandRouter } from "../commands";
import { logger } from "../config/logger";
import { featureGuard } from "../guards/featureGuard";
import { rateLimitGuard } from "../guards/rateLimitGuard";
import { roleGuard } from "../guards/roleGuard";
import { tenantGuard } from "../guards/tenantGuard";
import { isGroupJid } from "../utils/jid";
import { reportCommandExecution, reportIncomingMessage } from "../services/telemetry.service";
import { parseCommandMessage } from "./messageParser";
import { defaultMessagePipeline } from "./pipeline";

type MessagesUpsertEvent = BaileysEventMap["messages.upsert"];

export async function handleMessagesUpsert(
  socket: WASocket,
  event: MessagesUpsertEvent,
): Promise<void> {
  if (event.type !== "notify") {
    return;
  }

  for (const message of event.messages) {
    await handleIncomingMessage(socket, message);
  }
}

async function handleIncomingMessage(
  socket: WASocket,
  message: MessagesUpsertEvent["messages"][number],
): Promise<void> {
  const remoteJid = message.key.remoteJid;
  const isGroup = Boolean(remoteJid && isGroupJid(remoteJid));

  // Laporkan metrik pesan masuk ke Pulse Analytics secara asinkron (fire-and-forget)
  reportIncomingMessage({
    isGroup,
    hasMedia: Boolean(
      message.message?.imageMessage ??
        message.message?.videoMessage ??
        message.message?.documentMessage ??
        message.message?.audioMessage ??
        message.message?.stickerMessage,
    ),
  });

  // 1. Eksekusi interceptor pipeline terurut (PendingTenant, AntiDelete, AFK, AntiLink, AntiSpam, InteractiveReply)
  const halted = await defaultMessagePipeline.execute({
    socket,
    message,
    remoteJid,
    isGroup,
  });

  // Jika pesan telah di-handle oleh interceptor (misal balasan game/kuis), hentikan alur
  if (halted) {
    return;
  }

  // 2. Parse apakah pesan merupakan command
  const context = parseCommandMessage(socket, message);
  if (!context) {
    return;
  }

  // 3. Resolusi Guard dan Eksekusi Command
  const commandStartTime = Date.now();
  try {
    context.role = await roleGuard.resolveRole({
      chatJid: context.chatJid,
      senderJid: context.senderJid,
      senderAltJids: context.senderAltJids,
      isGroup: context.isGroup,
    });

    const rateLimit = rateLimitGuard.check(context);
    if (!rateLimit.allowed) {
      if (rateLimit.warnUser && rateLimit.message) {
        await context.reply(rateLimit.message);
      }
      return;
    }

    const tenantAccess = await tenantGuard.checkGroupCommandAccess(context);
    if (!tenantAccess.allowed) {
      await context.reply(tenantAccess.message);
      return;
    }

    if (tenantAccess.tenantGroup) {
      context.tenantGroup = tenantAccess.tenantGroup;
    }

    const featureAccess = await featureGuard.checkCommandFeature(context);
    if (!featureAccess.allowed) {
      await context.reply(featureAccess.message);
      return;
    }

    await commandRouter.handle(context);

    reportCommandExecution({
      command: context.commandName,
      role: context.role,
      isGroup: context.isGroup,
      status: "success",
      executionTimeMs: Date.now() - commandStartTime,
    });
  } catch (error: unknown) {
    reportCommandExecution({
      command: context.commandName,
      role: context.role,
      isGroup: context.isGroup,
      status: "error",
      executionTimeMs: Date.now() - commandStartTime,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    logger.error(
      {
        error,
        commandName: context.commandName,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
      },
      "Command gagal diproses",
    );

    await context.reply("Command gagal diproses. Silakan coba lagi.");
  }
}
