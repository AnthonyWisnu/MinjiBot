import type { BaileysEventMap, WASocket } from "@whiskeysockets/baileys";

import { commandRouter } from "../commands";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { featureGuard } from "../guards/featureGuard";
import { roleGuard } from "../guards/roleGuard";
import { tenantGuard } from "../guards/tenantGuard";
import { afkService } from "../services/afk/afk.service";
import { gameService } from "../services/game/game.service";
import { antiLinkService } from "../services/moderation/antiLink.service";
import { antiSpamService } from "../services/moderation/antiSpam.service";
import { antiDeleteService } from "../services/moderation/antiDelete.service";
import { antiViewOnceService } from "../services/moderation/antiViewOnce.service";
import { pendingTenantRegistrationService } from "../services/tenant/pendingTenantRegistration.service";
import { getMessageSenderJid, getPreferredUserJid, isGroupJid, isStatusBroadcastJid } from "../utils/jid";
import type { CommandContext } from "../types/command";
import { parseCommandMessage, parseRawMessageContext } from "./messageParser";

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
  await antiDeleteService.cacheMessage(message);
  await antiViewOnceService.handleViewOnce(socket, message);
  await afkService.handleIncomingMessage(socket, message);
  await antiLinkService.handleIncomingMessage(socket, message);
  await antiSpamService.handleIncomingMessage(socket, message);

  // Cek apakah pesan ini adalah balasan (reply/quote) langsung ke game (kuis/tictactoe) yang sedang aktif
  const handledGame = await handleGameReplyIfNeeded(socket, message);
  if (handledGame) {
    return;
  }

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

async function handleGameReplyIfNeeded(
  socket: WASocket,
  message: MessagesUpsertEvent["messages"][number],
): Promise<boolean> {
  if (message.key.fromMe) return false;
  const chatJid = message.key.remoteJid;
  if (!chatJid || !isGroupJid(chatJid) || isStatusBroadcastJid(chatJid)) return false;

  const rawContext = parseRawMessageContext(socket, message);
  if (!rawContext || !rawContext.text || rawContext.text.startsWith(env.COMMAND_PREFIX)) {
    return false;
  }

  const quoted = rawContext.quoted;
  if (!quoted) return false;

  // 1. Cek apakah membalas kuis aktif
  const handledQuiz = await handleQuizReply(socket, message, rawContext, quoted);
  if (handledQuiz) return true;

  // 2. Cek apakah membalas TicTacToe aktif (accept tantangan atau melangkah 1-9)
  const handledTicTacToe = await handleTicTacToeReply(socket, message, rawContext, quoted);
  if (handledTicTacToe) return true;

  return false;
}

async function handleQuizReply(
  socket: WASocket,
  message: MessagesUpsertEvent["messages"][number],
  rawContext: CommandContext,
  quoted: NonNullable<CommandContext["quoted"]>,
): Promise<boolean> {
  const session = gameService.getActiveQuiz(rawContext.chatJid);
  if (!session) return false;

  const botUserJid = socket.user?.id ? getPreferredUserJid([socket.user.id]) : undefined;
  const isQuotingQuiz =
    (session.messageId && quoted.id === session.messageId) ||
    (quoted.text && quoted.text.includes(session.question.prompt)) ||
    (botUserJid && quoted.participantJid && quoted.participantJid.split("@")[0] === botUserJid.split("@")[0]);

  if (!isQuotingQuiz) return false;

  try {
    rawContext.commandName = session.type;
    rawContext.role = await roleGuard.resolveRole({
      chatJid: rawContext.chatJid,
      senderJid: rawContext.senderJid,
      senderAltJids: rawContext.senderAltJids,
      isGroup: rawContext.isGroup,
    });

    const tenantAccess = await tenantGuard.checkGroupCommandAccess(rawContext);
    if (!tenantAccess.allowed) return false;
    if (tenantAccess.tenantGroup) {
      rawContext.tenantGroup = tenantAccess.tenantGroup;
    }

    const featureAccess = await featureGuard.checkCommandFeature(rawContext);
    if (!featureAccess.allowed) return false;

    const replyText = await gameService.answerQuizFromDirectText(rawContext, rawContext.text);
    if (replyText) {
      const sent = await socket.sendMessage(
        rawContext.chatJid,
        { text: replyText },
        { quoted: message },
      );
      if (sent?.key?.id) {
        gameService.setQuizMessageId(rawContext.chatJid, sent.key.id);
      }
      return true;
    }
  } catch (error: unknown) {
    logger.error(
      {
        error,
        chatJid: rawContext.chatJid,
        senderJid: rawContext.senderJid,
        gameType: session.type,
      },
      "Evaluasi jawaban kuis via reply gagal",
    );
  }

  return false;
}

async function handleTicTacToeReply(
  socket: WASocket,
  message: MessagesUpsertEvent["messages"][number],
  rawContext: CommandContext,
  quoted: NonNullable<CommandContext["quoted"]>,
): Promise<boolean> {
  const session = gameService.getActiveTicTacToe(rawContext.chatJid);
  if (!session) return false;

  const botUserJid = socket.user?.id ? getPreferredUserJid([socket.user.id]) : undefined;
  const isBotMessage =
    (session.messageId && quoted.id === session.messageId) ||
    (botUserJid && quoted.participantJid && quoted.participantJid.split("@")[0] === botUserJid.split("@")[0]);

  // Skenario 1: Sesi menunggu konfirmasi tantangan (state: "waiting")
  if (session.state === "waiting") {
    const isQuotingChallenge =
      (session.messageId && quoted.id === session.messageId) ||
      (quoted.text && quoted.text.includes("Tantangan dikirim")) ||
      (isBotMessage && quoted.text && quoted.text.includes("tictactoe"));

    if (!isQuotingChallenge) return false;

    try {
      rawContext.commandName = "tictactoe";
      rawContext.args = [];
      rawContext.argsText = "";
      rawContext.role = await roleGuard.resolveRole({
        chatJid: rawContext.chatJid,
        senderJid: rawContext.senderJid,
        senderAltJids: rawContext.senderAltJids,
        isGroup: rawContext.isGroup,
      });

      const tenantAccess = await tenantGuard.checkGroupCommandAccess(rawContext);
      if (!tenantAccess.allowed) return false;
      if (tenantAccess.tenantGroup) {
        rawContext.tenantGroup = tenantAccess.tenantGroup;
      }

      const featureAccess = await featureGuard.checkCommandFeature(rawContext);
      if (!featureAccess.allowed) return false;

      const replyText = await gameService.playTicTacToe(rawContext);
      if (replyText) {
        const sent = await socket.sendMessage(
          rawContext.chatJid,
          { text: replyText },
          { quoted: message },
        );
        if (sent?.key?.id) {
          gameService.setTicTacToeMessageId(rawContext.chatJid, sent.key.id);
        }
        return true;
      }
    } catch (error: unknown) {
      logger.error(
        {
          error,
          chatJid: rawContext.chatJid,
          senderJid: rawContext.senderJid,
        },
        "Accept TicTacToe via reply gagal",
      );
    }
    return false;
  }

  // Skenario 2: Permainan sedang berlangsung (state: "active")
  if (session.state === "active") {
    const trimmedText = rawContext.text.trim();
    if (!/^\d+$/.test(trimmedText)) {
      return false;
    }

    const isQuotingBoard =
      (session.messageId && quoted.id === session.messageId) ||
      (quoted.text &&
        (quoted.text.includes("Giliran:") ||
          quoted.text.includes("Game dimulai") ||
          quoted.text.includes("Langkah diterima") ||
          quoted.text.includes("Tic tac toe")));

    if (!isQuotingBoard) return false;

    try {
      rawContext.commandName = "tictactoe";
      rawContext.args = [trimmedText];
      rawContext.argsText = trimmedText;
      rawContext.role = await roleGuard.resolveRole({
        chatJid: rawContext.chatJid,
        senderJid: rawContext.senderJid,
        senderAltJids: rawContext.senderAltJids,
        isGroup: rawContext.isGroup,
      });

      const tenantAccess = await tenantGuard.checkGroupCommandAccess(rawContext);
      if (!tenantAccess.allowed) return false;
      if (tenantAccess.tenantGroup) {
        rawContext.tenantGroup = tenantAccess.tenantGroup;
      }

      const featureAccess = await featureGuard.checkCommandFeature(rawContext);
      if (!featureAccess.allowed) return false;

      const replyText = await gameService.playTicTacToe(rawContext);
      if (replyText) {
        const sent = await socket.sendMessage(
          rawContext.chatJid,
          { text: replyText },
          { quoted: message },
        );
        if (sent?.key?.id) {
          gameService.setTicTacToeMessageId(rawContext.chatJid, sent.key.id);
        }
        return true;
      }
    } catch (error: unknown) {
      logger.error(
        {
          error,
          chatJid: rawContext.chatJid,
          senderJid: rawContext.senderJid,
          move: trimmedText,
        },
        "Move TicTacToe via reply gagal",
      );
    }
    return false;
  }

  return false;
}
