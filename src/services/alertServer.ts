import http from "http";
import type { WASocket } from "@whiskeysockets/baileys";
import { env } from "../config/env";
import { logger } from "../config/logger";

interface AlertPayload {
  title?: string;
  message?: string;
  level?: string;
}

class AlertServer {
  private socket: WASocket | null = null;
  private server: http.Server | null = null;
  private readonly port: number = 3005;
  private recentAlertTimes: number[] = [];
  private readonly maxAlertsPerMinute = 10;

  setSocket(socket: WASocket | null): void {
    this.socket = socket;
  }

  start(): void {
    if (this.server) {
      return;
    }

    this.server = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/internal/alert") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      let body = "";
      req.on("data", (chunk: Buffer | string) => {
        body += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (body.length > 64 * 1024) {
          req.destroy();
        }
      });

      req.on("end", () => {
        void (async () => {
          try {
            const authHeader = req.headers["x-alert-secret"] ?? req.headers.authorization;
            const providedSecret = typeof authHeader === "string"
              ? authHeader.replace(/^Bearer\s+/i, "").trim()
              : null;

            if (!providedSecret || providedSecret !== env.INTERNAL_ALERT_SECRET) {
              logger.warn("Unauthorized internal alert attempt rejected");
              res.writeHead(401, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Unauthorized" }));
              return;
            }

            const now = Date.now();
            this.recentAlertTimes = this.recentAlertTimes.filter((time) => now - time < 60_000);
            if (this.recentAlertTimes.length >= this.maxAlertsPerMinute) {
              logger.warn("Internal alert rate limit exceeded");
              res.writeHead(429, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Rate limit exceeded" }));
              return;
            }
            this.recentAlertTimes.push(now);

            let payload: AlertPayload;
            try {
              payload = (body.length > 0 ? (JSON.parse(body) as unknown) : {}) as AlertPayload;
            } catch {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Invalid JSON format" }));
              return;
            }

            const { title, message, level } = payload;

            if (!message || typeof message !== "string") {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Missing message field" }));
              return;
            }

            if (!this.socket) {
              logger.warn("Alert received but WhatsApp socket is not connected");
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "WhatsApp socket offline" }));
              return;
            }

            const recipientJid = env.SUPER_OWNER_JIDS[0];
            if (!recipientJid) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "No super owner configured" }));
              return;
            }

            const timeStr = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
            const levelText = typeof level === "string" && level.length > 0 ? level : "WARNING";
            const titleText = typeof title === "string" && title.length > 0 ? title : "System Incident";

            const alertText = [
              "*[PULSE SENTINEL ALERT]*",
              `*STATUS:* ${levelText}`,
              `*TITLE:* ${titleText}`,
              `*TIME:* ${timeStr} WIB`,
              "--------------------------------",
              message,
              "--------------------------------",
              "_Notifikasi otomatis dari Pulse Analytics Hub_",
            ].join("\n");

            await this.socket.sendMessage(recipientJid, { text: alertText });
            logger.info({ title: titleText, recipientJid }, "WhatsApp incident alert dispatched to owner");

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "sent", to: recipientJid }));
          } catch (error: unknown) {
            const errorMsg = error instanceof Error ? error.message : "Internal error";
            logger.error({ error: errorMsg }, "Failed to process internal alert");
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        })();
      });
    });

    this.server.listen(this.port, "127.0.0.1", () => {
      logger.info({ port: this.port }, "Internal Alert Server listening on 127.0.0.1");
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      logger.info("Internal Alert Server stopped");
    }
  }
}

export const alertServer = new AlertServer();
