import http from "http";
import type { WASocket } from "@whiskeysockets/baileys";
import { env } from "../config/env";
import { logger } from "../config/logger";

class AlertServer {
  private socket: WASocket | null = null;
  private server: http.Server | null = null;
  private readonly port: number = 3005;

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
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 64 * 1024) {
          req.destroy();
        }
      });

      req.on("end", async () => {
        try {
          const payload = JSON.parse(body || "{}");
          const { title, message, level } = payload;

          if (!message) {
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
          const alertText = [
            "*[PULSE SENTINEL ALERT]*",
            `*STATUS:* ${level || "WARNING"}`,
            `*TITLE:* ${title || "System Incident"}`,
            `*TIME:* ${timeStr} WIB`,
            "--------------------------------",
            message,
            "--------------------------------",
            "_Notifikasi otomatis dari Pulse Analytics Hub_"
          ].join("\n");

          await this.socket.sendMessage(recipientJid, { text: alertText });
          logger.info({ title, recipientJid }, "WhatsApp incident alert dispatched to owner");

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "sent", to: recipientJid }));
        } catch (error: any) {
          logger.error({ error: error?.message }, "Failed to process internal alert");
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error?.message || "Internal error" }));
        }
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
