import http from "node:http";
import express, { type Express } from "express";
import type { WASocket } from "@whiskeysockets/baileys";

import { env } from "../config/env";
import { logger } from "../config/logger";
import { playerRouter } from "./routes/player.route";
import { streamRouter } from "./routes/stream.route";
import { arcadeRouter } from "./routes/arcade.route";
import { playerSessionService } from "./services/player-session.service";

export class WebServer {
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

    // Security & In-App WebView headers
    this.app.use((_req, res, next) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      // Allow embedding in WhatsApp In-App WebView
      res.setHeader("X-Frame-Options", "ALLOWALL");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Range");
      next();
    });
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get("/health", (_req, res) => {
      res.json({
        status: "ok",
        uptimeSeconds: Math.floor(process.uptime()),
        activeSessions: playerSessionService.getActiveSessionsCount(),
        timestamp: new Date().toISOString(),
      });
    });

    // Mount modular routes
    this.app.use(playerRouter);
    this.app.use(streamRouter);
    this.app.use(arcadeRouter);
  }

  start(port?: number): Promise<number> {
    const listenPort = port ?? env.WEB_SERVER_PORT;
    return new Promise((resolve, reject) => {
      if (this.server) {
        resolve(listenPort);
        return;
      }

      this.server = this.app.listen(listenPort, () => {
        logger.info({ port: listenPort }, "Modular Web Server listening for WhatsApp WebView");
        resolve(listenPort);
      });

      this.server.on("error", (err) => {
        logger.error({ err }, "Web Server error saat listening");
        reject(err);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(() => {
        this.server = null;
        logger.info("Web Server stopped");
        resolve();
      });
    });
  }
}

export const webServer = new WebServer();
