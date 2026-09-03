import { DisconnectReason, type ConnectionState, type WASocket } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";

import { env } from "../config/env";
import { logger } from "../config/logger";
import { prisma, disconnectPrisma } from "../repositories/prismaClient";
import { createBotSocket } from "./connection";
import { handleGroupParticipantsUpdate } from "./groupParticipantsHandler";
import { handleMessagesUpsert } from "./messageHandler";
import { reminderScheduler } from "../services/reminder/reminderScheduler";

export class BotLifecycle {
  private socket: WASocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private isStopping = false;

  async start(): Promise<void> {
    this.isStopping = false;
    try {
      await prisma.tenantFeatureSetting.updateMany({
        data: {
          downloaderEnabled: true,
          hdEnabled: true,
          gameEnabled: true,
          welcomeEnabled: true,
          antiLinkEnabled: true,
          antiSpamEnabled: true,
          reminderEnabled: true,
          tagAllEnabled: true,
        },
      });
    } catch (error: unknown) {
      logger.warn({ error }, "Default tenant features auto-sync skipped");
    }
    await this.connect();
  }

  async stop(reason: string): Promise<void> {
    this.isStopping = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }

    reminderScheduler.stop();
    await disconnectPrisma();
    logger.info({ reason }, "Lifecycle MinjiBot dihentikan");
  }

  private async connect(): Promise<void> {
    try {
      const botSocket = await createBotSocket();
      this.socket = botSocket.socket;
      this.bindSocketEvents(botSocket.socket, botSocket.saveCreds);
    } catch (error: unknown) {
      logger.error({ error }, "Gagal membuat koneksi WhatsApp");
      this.scheduleReconnect("connect-failed");
    }
  }

  private bindSocketEvents(socket: WASocket, saveCreds: () => Promise<void>): void {
    socket.ev.on("creds.update", () => {
      saveCreds().catch((error: unknown) => {
        logger.error({ error }, "Gagal menyimpan auth state WhatsApp");
      });
    });

    socket.ev.on("connection.update", (update) => {
      this.handleConnectionUpdate(update);
    });

    socket.ev.on("messages.upsert", (event) => {
      logger.debug(
        {
          messageCount: event.messages.length,
          type: event.type,
        },
        "Pesan WhatsApp diterima",
      );

      handleMessagesUpsert(socket, event).catch((error: unknown) => {
        logger.error({ error }, "Batch pesan WhatsApp gagal diproses");
      });
    });

    socket.ev.on("group-participants.update", (event) => {
      handleGroupParticipantsUpdate(socket, event).catch((error: unknown) => {
        logger.error({ error }, "Update peserta grup gagal diproses");
      });
    });

    reminderScheduler.start(socket);
  }

  private handleConnectionUpdate(update: Partial<ConnectionState>): void {
    if (update.qr) {
      logger.info("QR login WhatsApp tersedia. Scan QR yang tampil di terminal.");
      qrcode.generate(update.qr, { small: true });
    }

    if (update.connection === "open") {
      this.reconnectAttempt = 0;
      logger.info("Koneksi WhatsApp terbuka");
      return;
    }

    if (update.connection !== "close") {
      return;
    }

    const statusCode = getDisconnectStatusCode(update.lastDisconnect?.error);
    const shouldReconnect =
      !this.isStopping &&
      statusCode !== DisconnectReason.loggedOut &&
      statusCode !== DisconnectReason.badSession;

    logger.warn(
      {
        statusCode,
        shouldReconnect,
      },
      "Koneksi WhatsApp tertutup",
    );

    this.socket = null;

    if (shouldReconnect) {
      this.scheduleReconnect("connection-closed");
      return;
    }

    logger.error("Koneksi WhatsApp tidak direconnect. Login ulang diperlukan.");
  }

  private scheduleReconnect(reason: string): void {
    if (this.isStopping || this.reconnectTimer) {
      return;
    }

    this.reconnectAttempt += 1;
    const delayMs = Math.min(
      env.RECONNECT_INITIAL_MS * 2 ** (this.reconnectAttempt - 1),
      env.RECONNECT_MAX_MS,
    );

    logger.info(
      {
        reason,
        attempt: this.reconnectAttempt,
        delayMs,
      },
      "Menjadwalkan reconnect WhatsApp",
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delayMs);
  }
}

function getDisconnectStatusCode(error: Error | undefined): number | undefined {
  const maybeBoomError = error as Error & {
    output?: {
      statusCode?: unknown;
    };
  };
  const statusCode = maybeBoomError.output?.statusCode;

  return typeof statusCode === "number" ? statusCode : undefined;
}
