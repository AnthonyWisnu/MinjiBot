import { DisconnectReason, type ConnectionState, type WASocket } from "@whiskeysockets/baileys";
import { mkdir, readdir, rename } from "node:fs/promises";
import path from "node:path";
import qrcode from "qrcode-terminal";

import { env } from "../config/env";
import { logger } from "../config/logger";
import { disconnectPrisma } from "../repositories/prismaClient";
import { activityBufferService } from "../services/stats/activityBuffer.service";
import { reminderScheduler } from "../services/reminder/reminderScheduler";
import { levelUpNotifierService } from "../services/member/levelUpNotifier.service";
import { createBotSocket, groupMetadataCacheManager } from "./connection";
import { QrWebServer } from "./qrWebServer";
import { flushCredsQueue, registerEventSubscribers } from "./subscribers";

const LOGGED_OUT_EXIT_DELAY_MS = 60_000;

export class BotLifecycle {
  private socket: WASocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private loggedOutExitTimer: NodeJS.Timeout | null = null;
  private qrWebServer: QrWebServer | null = null;
  private reconnectAttempt = 0;
  private isStopping = false;
  private isResettingSession = false;

  async start(): Promise<void> {
    this.isStopping = false;
    await this.startQrWebServerIfEnabled();
    await this.connect();
  }

  async stop(reason: string): Promise<void> {
    this.isStopping = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.loggedOutExitTimer) {
      clearTimeout(this.loggedOutExitTimer);
      this.loggedOutExitTimer = null;
    }

    if (this.socket) {
      try {
        await this.socket.end(undefined);
      } catch (error: unknown) {
        logger.debug({ err: error }, "Error saat menutup soket WhatsApp");
      }
      this.socket = null;
    }

    if (this.qrWebServer) {
      try {
        await this.qrWebServer.stop();
      } catch (error: unknown) {
        logger.debug({ err: error }, "Error saat menutup Web QR Server");
      }
      this.qrWebServer = null;
    }

    reminderScheduler.stop();
    levelUpNotifierService.setSocket(null);

    try {
      await activityBufferService.flush();
      activityBufferService.stopFlushTimer();
    } catch (error: unknown) {
      logger.error({ err: error }, "Gagal flush activity buffer saat shutdown");
    }

    try {
      await flushCredsQueue();
    } catch (error: unknown) {
      logger.error({ err: error }, "Gagal flush creds queue saat shutdown");
    }

    await disconnectPrisma();
    logger.info({ reason }, "Lifecycle MinjiBot dihentikan");
  }

  async resetSessionAndReconnect(): Promise<void> {
    if (this.isStopping || this.isResettingSession) {
      return;
    }

    this.isResettingSession = true;
    try {
      this.qrWebServer?.setConnecting("Mencadangkan sesi lama dan menyiapkan QR baru...");

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      if (this.loggedOutExitTimer) {
        clearTimeout(this.loggedOutExitTimer);
        this.loggedOutExitTimer = null;
      }

      const oldSocket = this.socket;
      this.socket = null;
      if (oldSocket) {
        await oldSocket.end(undefined).catch(() => undefined);
      }

      await flushCredsQueue().catch(() => undefined);
      groupMetadataCacheManager.clear();

      await this.archiveCurrentSessionFiles();
      this.reconnectAttempt = 0;
      await this.connect();
    } finally {
      this.isResettingSession = false;
    }
  }

  private async startQrWebServerIfEnabled(): Promise<void> {
    if (!env.QR_WEB_ENABLED || this.qrWebServer) {
      return;
    }

    const server = new QrWebServer({
      host: env.QR_WEB_HOST,
      port: env.QR_WEB_PORT,
      token: env.QR_WEB_TOKEN,
      onResetSession: () => this.resetSessionAndReconnect(),
    });

    try {
      const info = await server.start();
      this.qrWebServer = server;
      logger.info(
        { host: info.host, port: info.port, pairingUrl: info.pairingUrl },
        "Portal Web QR Pairing aktif",
      );
    } catch (error: unknown) {
      logger.error({ err: error }, "Gagal menjalankan Portal Web QR Pairing");
    }
  }

  private async archiveCurrentSessionFiles(): Promise<void> {
    const sessionDir = path.resolve(env.SESSION_DIR);
    await mkdir(sessionDir, { recursive: true });
    const entries = await readdir(sessionDir);
    if (entries.length === 0) {
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const archiveDir = path.resolve(path.dirname(sessionDir), "backups", `sessions-reset-${timestamp}`);
    await mkdir(archiveDir, { recursive: true });

    for (const entry of entries) {
      await rename(path.join(sessionDir, entry), path.join(archiveDir, entry));
    }

    logger.info({ archiveDir, movedFiles: entries.length }, "Sesi WhatsApp lama diarsipkan");
  }

  private async connect(): Promise<void> {
    try {
      this.qrWebServer?.setConnecting();
      const botSocket = await createBotSocket();
      if (this.isStopping) {
        await botSocket.socket.end(undefined).catch(() => undefined);
        return;
      }

      this.socket = botSocket.socket;
      const currentSocket = botSocket.socket;

      registerEventSubscribers(botSocket.socket, {
        saveCreds: botSocket.saveCreds,
        onConnectionUpdate: (update) => {
          if (this.socket !== currentSocket) {
            logger.debug("Mengabaikan connection.update dari soket usang");
            return;
          }
          this.handleConnectionUpdate(update);
        },
      });
    } catch (error: unknown) {
      logger.error({ err: error }, "Gagal membuat koneksi WhatsApp");
      this.scheduleReconnect("connect-failed");
    }
  }

  private handleConnectionUpdate(update: Partial<ConnectionState>): void {
    if (update.qr) {
      logger.info("QR login WhatsApp tersedia. Scan QR yang tampil di terminal atau Web QR.");
      qrcode.generate(update.qr, { small: true });
      this.qrWebServer?.setQr(update.qr);
    }

    if (update.connection === "open") {
      this.reconnectAttempt = 0;
      this.qrWebServer?.setOpen(this.socket?.user?.id);
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

    const disconnectError = update.lastDisconnect?.error;
    const statusCode = getDisconnectStatusCode(disconnectError);
    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

    logger.warn(
      {
        err: disconnectError,
        statusCode,
        shouldReconnect,
      },
      "Koneksi WhatsApp tertutup",
    );

    this.socket = null;

    if (statusCode === DisconnectReason.restartRequired) {
      this.reconnectAttempt = 0;
      this.qrWebServer?.setConnecting("WhatsApp meminta restart koneksi, menghubungkan ulang...");
      this.scheduleReconnect("restart-required", 500);
      return;
    }

    if (shouldReconnect) {
      this.qrWebServer?.setClosed();
      this.scheduleReconnect("connection-closed");
      return;
    }

    this.qrWebServer?.setLoggedOut();

    if (this.qrWebServer) {
      logger.error(
        "Koneksi WhatsApp di-logout (401). Proses ditahan tetap hidup agar user dapat reset sesi lewat Portal Web QR.",
      );
      return;
    }

    logger.error(
      { exitDelayMs: LOGGED_OUT_EXIT_DELAY_MS },
      "Koneksi WhatsApp di-logout (401). Menunggu sebelum keluar agar tidak memicu PM2 spam-restart.",
    );
    this.loggedOutExitTimer ??= setTimeout(() => {
      this.loggedOutExitTimer = null;
      process.exit(1);
    }, LOGGED_OUT_EXIT_DELAY_MS);
  }

  private scheduleReconnect(reason: string, customDelayMs?: number): void {
    if (this.isStopping || this.reconnectTimer) {
      return;
    }

    this.reconnectAttempt += 1;
    if (this.reconnectAttempt > 10) {
      logger.error(
        "Reconnect WhatsApp gagal 10 kali berturut-turut. Keluar agar PM2 me-restart proses.",
      );
      process.exit(1);
    }
    const delayMs =
      customDelayMs ??
      Math.min(env.RECONNECT_INITIAL_MS * 2 ** (this.reconnectAttempt - 1), env.RECONNECT_MAX_MS);

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
