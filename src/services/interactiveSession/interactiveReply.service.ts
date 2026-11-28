import type { WAMessage, WASocket } from "@whiskeysockets/baileys";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { featureGuard } from "../../guards/featureGuard";
import { roleGuard } from "../../guards/roleGuard";
import { tenantGuard } from "../../guards/tenantGuard";
import { casinoPackService } from "../game/casinoPack.service";
import { gameService } from "../game/game.service";
import { quickQuizService } from "../game/quickQuiz.service";
import { sambungKataService } from "../game/sambungKata.service";
import { identityResolverService } from "../identity/identityResolver.service";
import { isGroupJid, isStatusBroadcastJid } from "../../utils/jid";
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

    // 3. Cek apakah membalas Tebak-Tebakan Cepat (Tahap 7)
    const handledQuickQuiz = await this.handleQuickQuizReply(socket, message, rawContext, quoted);
    if (handledQuickQuiz) return true;

    // 4. Cek apakah membalas Sambung Kata (Tahap 7)
    const handledSambung = await this.handleSambungKataReply(socket, message, rawContext, quoted);
    if (handledSambung) return true;

    // 5. Cek apakah membalas Blackjack / Hi-Low (Tahap 7)
    const handledTable = await this.handleCasinoTableReply(socket, message, rawContext, quoted);
    if (handledTable) return true;

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

    const isQuotingQuiz =
      (session.messageId !== undefined && quoted.id === session.messageId) ||
      Boolean(quoted.text?.includes(session.question.prompt));

    if (!isQuotingQuiz) return false;

    const trimmedDirect = rawContext.text.trim();
    if (session.type === "katla" && !/^[a-zA-Z]+$/.test(trimmedDirect)) {
      return false;
    }
    if ((session.type === "bom" || session.type === "tebakangka") && !/^\d+$/.test(trimmedDirect)) {
      return false;
    }

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

      const replyPayload = await this.game.answerQuizFromDirectTextRich(rawContext, trimmedDirect);
      if (replyPayload) {
        const sent = await socket.sendMessage(
          rawContext.chatJid,
          {
            text: replyPayload.text,
            ...(replyPayload.mentions && replyPayload.mentions.length > 0
              ? { mentions: replyPayload.mentions }
              : {}),
          },
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

    // Skenario 1: Sesi menunggu konfirmasi tantangan (state: "waiting")
    if (session.state === "waiting") {
      const isQuotingChallenge =
        (session.messageId !== undefined && quoted.id === session.messageId) ||
        Boolean(quoted.text?.includes("Tantangan dikirim"));

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

        const replyPayload = await this.game.playTicTacToeRich(rawContext);
        if (replyPayload.text) {
          const sent = await socket.sendMessage(
            rawContext.chatJid,
            {
              text: replyPayload.text,
              ...(replyPayload.mentions && replyPayload.mentions.length > 0
                ? { mentions: replyPayload.mentions }
                : {}),
            },
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
          quoted.text.includes("Langkah diterima")),
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

      const replyPayload = await this.game.playTicTacToeRich(rawContext);
      if (replyPayload.text) {
        const sent = await socket.sendMessage(
          rawContext.chatJid,
          {
            text: replyPayload.text,
            ...(replyPayload.mentions && replyPayload.mentions.length > 0
              ? { mentions: replyPayload.mentions }
              : {}),
          },
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

  private async authorizeInteractiveGame(
    rawContext: CommandContext,
    commandName: string,
  ): Promise<boolean> {
    rawContext.commandName = commandName;
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
    return featureAccess.allowed;
  }

  private async handleQuickQuizReply(
    socket: WASocket,
    message: WAMessage,
    rawContext: CommandContext,
    quoted: NonNullable<CommandContext["quoted"]>,
  ): Promise<boolean> {
    const session = quickQuizService.getActiveSession(rawContext.chatJid);
    if (!session) return false;

    const isQuoting =
      (session.messageId !== undefined && quoted.id === session.messageId) ||
      Boolean(quoted.text?.includes(session.question.prompt));
    if (!isQuoting) return false;

    try {
      if (!(await this.authorizeInteractiveGame(rawContext, session.kind))) return false;
      const sender = await identityResolverService.resolveCanonicalUserJid(
        socket,
        rawContext.chatJid,
        rawContext.senderUserJid,
        rawContext.senderAltJids,
      );
      const res = await quickQuizService.submitAnswer(
        rawContext.chatJid,
        sender,
        rawContext.text.trim(),
      );
      if (res.matched && res.text) {
        await socket.sendMessage(
          rawContext.chatJid,
          { text: res.text, ...(res.mentions ? { mentions: res.mentions } : {}) },
          { quoted: message },
        );
        return true;
      }
    } catch (error: unknown) {
      logger.error({ error, chatJid: rawContext.chatJid }, "Reply tebak cepat gagal diproses");
    }
    return false;
  }

  private async handleSambungKataReply(
    socket: WASocket,
    message: WAMessage,
    rawContext: CommandContext,
    quoted: NonNullable<CommandContext["quoted"]>,
  ): Promise<boolean> {
    const session = sambungKataService.getSession(rawContext.chatJid);
    if (!session) return false;

    const isQuoting =
      (session.messageId !== undefined && quoted.id === session.messageId) ||
      Boolean(quoted.text?.includes("SAMBUNG KATA"));
    if (!isQuoting) return false;

    const word = rawContext.text.trim();
    if (!/^[a-zA-Z]{3,24}$/.test(word)) return false;

    try {
      if (!(await this.authorizeInteractiveGame(rawContext, "sambungkata"))) return false;
      const sender = await identityResolverService.resolveCanonicalUserJid(
        socket,
        rawContext.chatJid,
        rawContext.senderUserJid,
        rawContext.senderAltJids,
      );
      const res = await sambungKataService.submitWord(rawContext.chatJid, sender, word);
      if (res.text) {
        const sent = await socket.sendMessage(
          rawContext.chatJid,
          { text: res.text, ...(res.mentions ? { mentions: res.mentions } : {}) },
          { quoted: message },
        );
        if (sent?.key.id && !res.finished) {
          sambungKataService.setMessageId(rawContext.chatJid, sent.key.id);
        }
        return true;
      }
    } catch (error: unknown) {
      logger.error({ error, chatJid: rawContext.chatJid }, "Reply sambung kata gagal diproses");
    }
    return false;
  }

  private async handleCasinoTableReply(
    socket: WASocket,
    message: WAMessage,
    rawContext: CommandContext,
    quoted: NonNullable<CommandContext["quoted"]>,
  ): Promise<boolean> {
    const lower = rawContext.text.trim().toLowerCase();
    const isBjWord = lower === "hit" || lower === "stand" || lower === "double";
    const isHiLowWord =
      lower === "tinggi" || lower === "high" || lower === "rendah" || lower === "low";
    if (!isBjWord && !isHiLowWord) return false;

    const sender = await identityResolverService.resolveCanonicalUserJid(
      socket,
      rawContext.chatJid,
      rawContext.senderUserJid,
      rawContext.senderAltJids,
    );

    if (isBjWord) {
      const bj = casinoPackService.getBlackjackSession(rawContext.chatJid, sender);
      if (!bj) return false;
      const quoting =
        (bj.messageId !== undefined && quoted.id === bj.messageId) ||
        Boolean(quoted.text?.includes("BLACKJACK"));
      if (!quoting) return false;

      try {
        if (!(await this.authorizeInteractiveGame(rawContext, "blackjack"))) return false;
        const res = await casinoPackService.actionBlackjack(rawContext.chatJid, sender, lower);
        const sent = await socket.sendMessage(
          rawContext.chatJid,
          { text: res.text },
          { quoted: message },
        );
        if (sent?.key.id && !res.finished) {
          casinoPackService.setBlackjackMessageId(rawContext.chatJid, sender, sent.key.id);
        }
        return true;
      } catch (error: unknown) {
        logger.error({ error, chatJid: rawContext.chatJid }, "Reply Blackjack gagal diproses");
      }
      return false;
    }

    const hl = casinoPackService.getHiLowSession(rawContext.chatJid, sender);
    if (!hl) return false;
    const quoting =
      (hl.messageId !== undefined && quoted.id === hl.messageId) ||
      Boolean(quoted.text?.includes("HI-LOW"));
    if (!quoting) return false;

    try {
      if (!(await this.authorizeInteractiveGame(rawContext, "hilow"))) return false;
      const guess = lower === "tinggi" || lower === "high" ? "tinggi" : "rendah";
      const text = await casinoPackService.resolveHiLow(rawContext.chatJid, sender, guess);
      await socket.sendMessage(rawContext.chatJid, { text }, { quoted: message });
      return true;
    } catch (error: unknown) {
      logger.error({ error, chatJid: rawContext.chatJid }, "Reply Hi-Low gagal diproses");
    }
    return false;
  }
}

export const interactiveReplyService = new InteractiveReplyService();
