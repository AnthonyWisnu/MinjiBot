import type { WAMessage, WASocket } from "@whiskeysockets/baileys";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { featureGuard } from "../../guards/featureGuard";
import { roleGuard } from "../../guards/roleGuard";
import { tenantGuard } from "../../guards/tenantGuard";
import { gameService } from "../game/game.service";
import { getPreferredUserJid, isGroupJid, isStatusBroadcastJid } from "../../utils/jid";
import type { CommandContext } from "../../types/command";
import { parseRawMessageContext } from "../../bot/messageParser";

export class InteractiveReplyService {
  constructor(
    private readonly game = gameService,
    private readonly role = roleGuard,
    private readonly tenant = tenantGuard,
    private readonly feature = featureGuard,
  ) {}

  /**
   * Evaluates whether an incoming message is a direct reply (quote) to an active game or session.
   * Returns true if the message was handled and should not proceed to command routing.
   */
  async handleIncomingReply(socket: WASocket, message: WAMessage): Promise<boolean> {
    if (message.key.fromMe) return false;
    const chatJid = message.key.remoteJid;
    if (!chatJid || !isGroupJid(chatJid) || isStatusBroadcastJid(chatJid)) return false;

    const rawContext = parseRawMessageContext(socket, message);
    if (!rawContext?.text || rawContext.text.startsWith(env.COMMAND_PREFIX)) {
      return false;
    }

    const quoted = rawContext.quoted;
    if (!quoted) return false;

    // 1. Cek apakah membalas kuis aktif
    const handledQuiz = await this.handleQuizReply(socket, message, rawContext, quoted);
    if (handledQuiz) return true;

    // 2. Cek apakah membalas TicTacToe aktif (accept tantangan atau melangkah 1-9)
    const handledTicTacToe = await this.handleTicTacToeReply(socket, message, rawContext, quoted);
    if (handledTicTacToe) return true;

    return false;
  }

  private async handleQuizReply(
    socket: WASocket,
    message: WAMessage,
    rawContext: CommandContext,
    quoted: NonNullable<CommandContext["quoted"]>,
  ): Promise<boolean> {
    const session = this.game.getActiveQuiz(rawContext.chatJid);
    if (!session) return false;

    const botUserJid = socket.user?.id ? getPreferredUserJid([socket.user.id]) : undefined;
    const isQuotingQuiz =
      (session.messageId !== undefined && quoted.id === session.messageId) ||
      Boolean(quoted.text?.includes(session.question.prompt)) ||
      Boolean(
        botUserJid &&
          quoted.participantJid &&
          quoted.participantJid.split("@")[0] === botUserJid.split("@")[0],
      );

    if (!isQuotingQuiz) return false;

    try {
      rawContext.commandName = session.type;
      rawContext.role = await this.role.resolveRole({
        chatJid: rawContext.chatJid,
        senderJid: rawContext.senderJid,
        senderAltJids: rawContext.senderAltJids,
        isGroup: rawContext.isGroup,
      });

      const tenantAccess = await this.tenant.checkGroupCommandAccess(rawContext);
      if (!tenantAccess.allowed) return false;
      if (tenantAccess.tenantGroup) {
        rawContext.tenantGroup = tenantAccess.tenantGroup;
      }

      const featureAccess = await this.feature.checkCommandFeature(rawContext);
      if (!featureAccess.allowed) return false;

      const replyText = await this.game.answerQuizFromDirectText(rawContext, rawContext.text);
      if (replyText) {
        const sent = await socket.sendMessage(
          rawContext.chatJid,
          { text: replyText },
          { quoted: message },
        );
        if (sent?.key.id) {
          this.game.setQuizMessageId(rawContext.chatJid, sent.key.id);
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

  private async handleTicTacToeReply(
    socket: WASocket,
    message: WAMessage,
    rawContext: CommandContext,
    quoted: NonNullable<CommandContext["quoted"]>,
  ): Promise<boolean> {
    const session = this.game.getActiveTicTacToe(rawContext.chatJid);
    if (!session) return false;

    const botUserJid = socket.user?.id ? getPreferredUserJid([socket.user.id]) : undefined;
    const isBotMessage =
      (session.messageId !== undefined && quoted.id === session.messageId) ||
      Boolean(
        botUserJid &&
          quoted.participantJid &&
          quoted.participantJid.split("@")[0] === botUserJid.split("@")[0],
      );

    // Skenario 1: Sesi menunggu konfirmasi tantangan (state: "waiting")
    if (session.state === "waiting") {
      const isQuotingChallenge =
        (session.messageId !== undefined && quoted.id === session.messageId) ||
        Boolean(quoted.text?.includes("Tantangan dikirim")) ||
        Boolean(isBotMessage && quoted.text?.includes("tictactoe"));

      if (!isQuotingChallenge) return false;

      try {
        rawContext.commandName = "tictactoe";
        rawContext.args = [];
        rawContext.argsText = "";
        rawContext.role = await this.role.resolveRole({
          chatJid: rawContext.chatJid,
          senderJid: rawContext.senderJid,
          senderAltJids: rawContext.senderAltJids,
          isGroup: rawContext.isGroup,
        });

        const tenantAccess = await this.tenant.checkGroupCommandAccess(rawContext);
        if (!tenantAccess.allowed) return false;
        if (tenantAccess.tenantGroup) {
          rawContext.tenantGroup = tenantAccess.tenantGroup;
        }

        const featureAccess = await this.feature.checkCommandFeature(rawContext);
        if (!featureAccess.allowed) return false;

        const replyText = await this.game.playTicTacToe(rawContext);
        if (replyText) {
          const sent = await socket.sendMessage(
            rawContext.chatJid,
            { text: replyText },
            { quoted: message },
          );
          if (sent?.key.id) {
            this.game.setTicTacToeMessageId(rawContext.chatJid, sent.key.id);
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
    const trimmedText = rawContext.text.trim();
    if (!/^\d+$/.test(trimmedText)) {
      return false;
    }

    const isQuotingBoard =
      (session.messageId !== undefined && quoted.id === session.messageId) ||
      Boolean(
        quoted.text &&
          (quoted.text.includes("Giliran:") ||
            quoted.text.includes("Game dimulai") ||
            quoted.text.includes("Langkah diterima") ||
            quoted.text.includes("Tic tac toe")),
      );

    if (!isQuotingBoard) return false;

    try {
      rawContext.commandName = "tictactoe";
      rawContext.args = [trimmedText];
      rawContext.argsText = trimmedText;
      rawContext.role = await this.role.resolveRole({
        chatJid: rawContext.chatJid,
        senderJid: rawContext.senderJid,
        senderAltJids: rawContext.senderAltJids,
        isGroup: rawContext.isGroup,
      });

      const tenantAccess = await this.tenant.checkGroupCommandAccess(rawContext);
      if (!tenantAccess.allowed) return false;
      if (tenantAccess.tenantGroup) {
        rawContext.tenantGroup = tenantAccess.tenantGroup;
      }

      const featureAccess = await this.feature.checkCommandFeature(rawContext);
      if (!featureAccess.allowed) return false;

      const replyText = await this.game.playTicTacToe(rawContext);
      if (replyText) {
        const sent = await socket.sendMessage(
          rawContext.chatJid,
          { text: replyText },
          { quoted: message },
        );
        if (sent?.key.id) {
          this.game.setTicTacToeMessageId(rawContext.chatJid, sent.key.id);
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
}

export const interactiveReplyService = new InteractiveReplyService();
