import http from "node:http";
import path from "node:path";
import { existsSync } from "node:fs";
import express, { type Express } from "express";
import type { WASocket } from "@whiskeysockets/baileys";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { playerSessionService } from "./playerSession.service";
import { youtubeSearchService } from "../media/youtubeSearch.service";
import { youtubeStreamService } from "../media/youtubeStream.service";
import { lyricsService } from "../media/lyrics.service";

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
    const staticDir = this.resolveStaticDir();

    // Health Check Endpoint
    this.app.get("/health", (_req, res) => {
      res.json({
        status: "ok",
        uptimeSeconds: Math.floor(process.uptime()),
        activeSessions: playerSessionService.getActiveSessionsCount(),
        timestamp: new Date().toISOString(),
      });
    });

    // ─── API: Player & Streaming Endpoints ─────────────────────────────────

    // 1. Search YouTube Tracks (Spotify Style Catalog)
    this.app.get("/api/player/search", async (req, res) => {
      try {
        const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
        if (!query) {
          res.status(400).json({ error: "Query parameter 'q' is required" });
          return;
        }
        const limit = Math.min(parseInt(String(req.query.limit || "10"), 10) || 10, 20);
        const results = await youtubeSearchService.searchVideos(query, limit);
        res.json({ success: true, count: results.length, results });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Search failed";
        res.status(500).json({ error: message });
      }
    });

    // 2. Create Player Session
    this.app.post("/api/player/session", (req, res) => {
      try {
        const { videoId, videoUrl, title, channelTitle, durationSeconds, thumbnail, chatJid, userJid } = req.body;
        if (!videoId || !videoUrl || !title) {
          res.status(400).json({ error: "Missing required video properties" });
          return;
        }

        const session = playerSessionService.createSession({
          videoId,
          videoUrl,
          title,
          channelTitle: channelTitle || "YouTube",
          durationSeconds: Number(durationSeconds) || 0,
          thumbnail: thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          chatJid,
          userJid,
        });

        res.json({ success: true, sessionId: session.sessionId, session });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to create session";
        res.status(500).json({ error: message });
      }
    });

    // 3. Get Player Session Info
    this.app.get("/api/player/info/:sessionId", (req, res) => {
      const { sessionId } = req.params;
      const session = playerSessionService.getSession(sessionId);
      if (!session) {
        res.status(404).json({ error: "Player session tidak ditemukan atau sudah kadaluwarsa." });
        return;
      }
      res.json({ success: true, session });
    });

    // 4. Get Song Lyrics from LRCLIB
    this.app.get("/api/player/lyrics", async (req, res) => {
      try {
        const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
        if (!query) {
          res.status(400).json({ error: "Query is required" });
          return;
        }
        const lyricsResult = await lyricsService.searchLyrics(query);
        res.json({ success: true, lyrics: lyricsResult?.plainLyrics || null });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Lyrics search failed";
        res.status(500).json({ error: message });
      }
    });

    // 5. Direct Media Stream Pipe
    this.app.get("/api/stream/:sessionId", async (req, res) => {
      const { sessionId } = req.params;
      const session = playerSessionService.getSession(sessionId);
      if (!session) {
        res.status(404).json({ error: "Stream session tidak valid atau telah kadaluwarsa." });
        return;
      }
      await youtubeStreamService.streamToResponse(session.videoUrl, req, res);
    });

    // ─── Web Views / Pages ──────────────────────────────────────────────────

    // Spotify Search Catalog Page (Screenshot 1)
    this.app.get("/player/search", (_req, res) => {
      const filePath = path.join(staticDir, "player", "search.html");
      if (existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).send("Search catalog page not found");
      }
    });

    // Player Deck Page (Screenshot 2)
    this.app.get("/player/:sessionId", (req, res) => {
      const { sessionId } = req.params;
      const session = playerSessionService.getSession(sessionId);
      if (!session) {
        res.status(404).send(`
          <!DOCTYPE html>
          <html><body style="background:#0c0e12;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
            <div style="background:#14171f;padding:24px;border-radius:12px;text-align:center;border:1px solid #242936;">
              <h2 style="color:#f87171;margin-bottom:8px;">SESI TIDAK DITEMUKAN</h2>
              <p style="color:#94a3b8;font-size:13px;">Sesi pemutar ini telah kadaluwarsa (maks. 30 menit). Silakan minta link baru melalui WhatsApp.</p>
            </div>
          </body></html>
        `);
        return;
      }

      const filePath = path.join(staticDir, "player", "index.html");
      if (existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).send("Player page not found");
      }
    });

    // Root Deck Dashboard
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
            .card { background: #181b24; padding: 2rem; border-radius: 1rem; border: 1px solid #262b36; box-shadow: 0 10px 30px rgba(0,0,0,0.8); max-width: 380px; width: 90%; }
            h1 { color: #1DB954; font-size: 1.5rem; margin-bottom: 0.5rem; }
            p { color: #8892b0; font-size: 0.9rem; margin: 0.25rem 0; font-family: monospace; }
            .links { margin-top: 1.5rem; display: flex; flex-direction: column; gap: 0.5rem; }
            a { color: #00F0FF; text-decoration: none; font-size: 0.85rem; font-family: monospace; padding: 0.5rem; background: #0e1015; border-radius: 0.5rem; border: 1px solid #262b36; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>MINJIBOT WEB DECK</h1>
            <p>STATUS: ACTIVE // PORT: ${env.WEB_SERVER_PORT}</p>
            <p>DAEMON: ONLINE // UPTIME: ${Math.floor(process.uptime())}s</p>
            <div class="links">
              <a href="/player/search?q=kessoku+band">&rarr; SPOTIFY SEARCH CATALOG</a>
            </div>
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
