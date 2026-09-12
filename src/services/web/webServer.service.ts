import http from "node:http";
import path from "node:path";
import { existsSync } from "node:fs";
import express, { type Express } from "express";
import type { WASocket } from "@whiskeysockets/baileys";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { playerSessionService } from "./playerSession.service";

export class WebServerService {
  private app: Express;
  private server: http.Server | null = null;
  private socket: WASocket | null = null;

  constructor() {
    this.app = express();
    this.setupMiddlewares();
    this.setupRoutes();
  }

  setSocket(socket: WASocket | null): void {
    this.socket = socket;
  }

  getSocket(): WASocket | null {
    return this.socket;
  }

  getApp(): Express {
    return this.app;
  }

  private setupMiddlewares(): void {
    this.app.use(express.json({ limit: "2mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "2mb" }));

    // CORS & Basic Security Headers
    this.app.use((_req, res, next) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "ALLOWALL"); // Diperlukan agar dapat dibuka di In-App WebView
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Range");
      next();
    });

    // Static Assets serving
    const staticDir = this.resolveStaticDir();
    this.app.use(express.static(staticDir, { maxAge: "1d", dotfiles: "ignore" }));
  }

  private setupRoutes(): void {
    // Health Check Endpoint
    this.app.get("/health", (_req, res) => {
      res.json({
        status: "ok",
        uptimeSeconds: Math.floor(process.uptime()),
        activeSessions: playerSessionService.getActiveSessionsCount(),
        timestamp: new Date().toISOString(),
      });
    });

    // Root endpoint
    this.app.get("/", (_req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html lang="id">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>MinjiBot Web Deck</title>
          <style>
            body { background: #0e1015; color: #fff; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
            .card { background: #181b24; padding: 2rem; border-radius: 1rem; border: 1px solid #262b36; box-shadow: 0 10px 30px rgba(0,0,0,0.8); }
            h1 { color: #1DB954; font-size: 1.5rem; margin-bottom: 0.5rem; }
            p { color: #8892b0; font-size: 0.9rem; margin: 0.25rem 0; font-family: monospace; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>MINJIBOT WEB DECK</h1>
            <p>STATUS: ACTIVE // PORT: ${env.WEB_SERVER_PORT}</p>
            <p>DAEMON: ONLINE // UPTIME: ${Math.floor(process.uptime())}s</p>
          </div>
        </body>
        </html>
      `);
    });
  }

  private resolveStaticDir(): string {
    const candidates = [
      path.resolve(process.cwd(), "public"),
      path.resolve(process.cwd(), "src/web"),
      path.resolve(__dirname, "../../web"),
    ];

    for (const dir of candidates) {
      if (existsSync(dir)) {
        return dir;
      }
    }

    return path.resolve(process.cwd(), "public");
  }

  start(): void {
    if (this.server) {
      return;
    }

    const port = env.WEB_SERVER_PORT;
    const host = "0.0.0.0";

    this.server = this.app.listen(port, host, () => {
      logger.info({ port, host, baseUrl: env.WEB_BASE_URL }, "MinjiBot Web Server listening");
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      logger.info("MinjiBot Web Server stopped");
    }
  }
}

export const webServerService = new WebServerService();
