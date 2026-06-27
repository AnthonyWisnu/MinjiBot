import type { BaileysEventMap, WASocket } from "@whiskeysockets/baileys";

import { commandRouter } from "../commands";
import { logger } from "../config/logger";
import { featureGuard } from "../guards/featureGuard";
import { roleGuard } from "../guards/roleGuard";
import { tenantGuard } from "../guards/tenantGuard";
import { afkService } from "../services/afk/afk.service";
import { antiLinkService } from "../services/moderation/antiLink.service";
import { antiSpamService } from "../services/moderation/antiSpam.service";
import { pendingTenantRegistrationService } from "../services/tenant/pendingTenantRegistration.service";
import { getMessageSenderJid, isGroupJid, isStatusBroadcastJid } from "../utils/jid";
import { parseCommandMessage } from "./messageParser";

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
  await registerPendingTenantIfNeeded(socket, message);
  await afkService.handleIncomingMessage(socket, message);
  await antiLinkService.handleIncomingMessage(socket, message);
  await antiSpamService.handleIncomingMessage(socket, message);

  const context = parseCommandMessage(socket, message);

  if (!context) {
    return;
  }

  try {
    context.role = await roleGuard.resolveRole({
      chatJid: context.chatJid,
      senderJid: context.senderJid,
      senderAltJids: context.senderAltJids,
      isGroup: context.isGroup,
    });

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
  } catch (error: unknown) {
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

async function registerPendingTenantIfNeeded(
  socket: WASocket,
  message: MessagesUpsertEvent["messages"][number],
): Promise<void> {
  const chatJid = message.key.remoteJid;

  if (!chatJid || !isGroupJid(chatJid) || isStatusBroadcastJid(chatJid)) {
    return;
  }

  try {
    await pendingTenantRegistrationService.registerIfNeeded({
      socket,
      groupJid: chatJid,
      actorJid: getMessageSenderJid(chatJid, message.key.participant),
    });
  } catch (error: unknown) {
    logger.error(
      {
        error,
        groupJid: chatJid,
      },
      "Registrasi tenant pending gagal",
    );
  }
}
