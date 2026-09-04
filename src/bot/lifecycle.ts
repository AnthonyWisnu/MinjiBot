import { DisconnectReason, type ConnectionState, type WASocket } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";

import { env } from "../config/env";
import { logger } from "../config/logger";
import { disconnectPrisma } from "../repositories/prismaClient";
import { reminderScheduler } from "../services/reminder/reminderScheduler";
import { levelUpNotifierService } from "../services/member/levelUpNotifier.service";
import { createBotSocket } from "./connection";
import { registerEventSubscribers } from "./subscribers";

export class BotLifecycle {
  private socket: WASocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private isStopping = false;

  async start(): Promise<void> {
    this.isStopping = false;
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
    levelUpNotifierService.setSocket(null);
    await disconnectPrisma();
    logger.info({ reason }, "Lifecycle MinjiBot dihentikan");
  }

  private async connect(): Promise<void> {
    try {
      const botSocket = await createBotSocket();
      this.socket = botSocket.socket;
      registerEventSubscribers(botSocket.socket, {
        saveCreds: botSocket.saveCreds,
        onConnectionUpdate: (update) => {
          this.handleConnectionUpdate(update);
        },
      });
    } catch (error: unknown) {
      logger.error({ error }, "Gagal membuat koneksi WhatsApp");
      this.scheduleReconnect("connect-failed");
    }
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

    if (this.isStopping) {
      this.socket = null;
      return;
    }

    const statusCode = getDisconnectStatusCode(update.lastDisconnect?.error);
    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

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

    logger.error("Koneksi WhatsApp di-logout (401). Keluar dari proses agar ditangani PM2.");
    process.exit(1);
  }

  private scheduleReconnect(reason: string): void {
    if (this.isStopping || this.reconnectTimer) {
      return;
    }

    this.reconnectAttempt += 1;
    if (this.reconnectAttempt > 10) {
      logger.error("Reconnect WhatsApp gagal 10 kali berturut-turut. Keluar agar PM2 me-restart proses.");
      process.exit(1);
    }
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
