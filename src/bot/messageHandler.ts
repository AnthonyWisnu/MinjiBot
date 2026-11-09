import type { BaileysEventMap, WASocket } from "@whiskeysockets/baileys";

import { commandRouter } from "../commands";
import { logger } from "../config/logger";
import { featureGuard } from "../guards/featureGuard";
import { rateLimitGuard } from "../guards/rateLimitGuard";
import { roleGuard } from "../guards/roleGuard";
import { tenantGuard } from "../guards/tenantGuard";
import { isGroupJid } from "../utils/jid";
import { formatUserSafeError } from "../utils/userSafeError";
import { parseCommandMessage } from "./messageParser";
import { defaultMessagePipeline } from "./pipeline";

type MessagesUpsertEvent = BaileysEventMap["messages.upsert"];

const UPSERT_CONCURRENCY = 5;

export async function handleMessagesUpsert(
  socket: WASocket,
  event: MessagesUpsertEvent,
): Promise<void> {
  if (event.type !== "notify" || !event.messages.length) {
    return;
  }

  // Kelompokkan pesan per sender (chatJid + senderJid) agar urutan pesan dari pengirim yang sama tidak tertukar
  const senderQueues = new Map<string, MessagesUpsertEvent["messages"]>();
  for (const message of event.messages) {
    const chatJid = message.key.remoteJid ?? "";
    const senderJid = message.key.participant ?? (message.key.fromMe ? "me" : chatJid);
    const queueKey = `${chatJid}:${senderJid}`;

    let queue = senderQueues.get(queueKey);
    if (!queue) {
      queue = [];
      senderQueues.set(queueKey, queue);
    }
    queue.push(message);
  }

  const allQueues = Array.from(senderQueues.values());
  let nextQueueIndex = 0;

  const processSenderQueue = async (messages: MessagesUpsertEvent["messages"]): Promise<void> => {
    for (const message of messages) {
      await handleIncomingMessage(socket, message);
    }
  };

  const workerCount = Math.min(UPSERT_CONCURRENCY, allQueues.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextQueueIndex < allQueues.length) {
      const queueIndex = nextQueueIndex++;
      const queue = allQueues[queueIndex];
      if (queue) {
        await processSenderQueue(queue);
      }
    }
  });

  await Promise.all(workers);
}

async function handleIncomingMessage(
  socket: WASocket,
  message: MessagesUpsertEvent["messages"][number],
): Promise<void> {
  const remoteJid = message.key.remoteJid;
  const isGroup = Boolean(remoteJid && isGroupJid(remoteJid));

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

  // Check if command is registered before checking guards or replying
  if (!commandRouter.has(context.commandName)) {
    return;
  }

  // 3. Resolusi Guard dan Eksekusi Command
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
      if (tenantAccess.message) {
        await context.reply(tenantAccess.message);
      }
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
  } catch (error: unknown) {
    logger.error(
      {
        err: error,
        commandName: context.commandName,
        chatJid: context.chatJid,
        senderJid: context.senderJid,
      },
      "Command gagal diproses",
    );

    await context.reply(formatUserSafeError(error, "Command gagal diproses. Silakan coba lagi."));
  }
}
