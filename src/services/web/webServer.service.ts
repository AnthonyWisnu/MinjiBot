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
import { soundboardService } from "../media/soundboard.service";
import { chessDuelService } from "../game/chessDuel.service";
import { leaderboardService } from "../member/leaderboard.service";
import { arcadeRewardService } from "../game/arcadeReward.service";

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

    // ─── API: Soundboard Endpoints ──────────────────────────────────────────

    // 6. Get Soundboard Catalog
    this.app.get("/api/soundboard/list", (_req, res) => {
      const catalog = soundboardService.getCatalog();
      res.json({ success: true, count: catalog.length, sounds: catalog });
    });

    // 7. Preview Sound Buffer (Direct stream to browser Web Audio)
    this.app.get("/api/soundboard/preview/:id", async (req, res) => {
      try {
        const soundId = req.params.id;
        const soundItem = soundboardService.getSoundItem(soundId);
        if (!soundItem) {
          res.status(404).json({ error: "Sound not found in catalog" });
          return;
        }

        const { buffer, mimetype } = await soundboardService.getSoundBuffer(soundId);
        res.setHeader("Content-Type", mimetype);
        res.setHeader("Content-Length", buffer.length);
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.end(buffer);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to generate audio";
        res.status(500).json({ error: message });
      }
    });

    // 8. Send Sound as WhatsApp Voice Note (PTT)
    this.app.post("/api/soundboard/send-wa", async (req, res) => {
      try {
        const { soundId, chatJid } = req.body;
        if (!soundId || !chatJid) {
          res.status(400).json({ error: "soundId and chatJid are required" });
          return;
        }

        if (!this.socket) {
          res.status(503).json({ error: "Bot WhatsApp socket is not connected" });
          return;
        }

        const success = await soundboardService.sendVoiceNote(chatJid, soundId, this.socket);
        res.json({ success, message: "Voice Note berhasil dikirim ke obrolan WhatsApp." });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Gagal mengirim Voice Note";
        res.status(500).json({ error: message });
      }
    });

    // ─── API: Arcade Endpoints ──────────────────────────────────────────────

    // 9. List Available Arcade Games
    this.app.get("/api/arcade/games", (_req, res) => {
      res.json({
        success: true,
        games: [
          { key: "dino", name: "Dino Runner", description: "Chrome style runner dengan lompat & merunduk" },
          { key: "snake", name: "Snake Retro", description: "Ular klasik neon dengan kontrol D-Pad" },
          { key: "block", name: "Block Blast", description: "Teka-teki susun blok 8x8 dan kombo garis" },
          { key: "2048", name: "2048 Puzzle", description: "Geser dan satukan angka hingga mencapai 2048" },
          { key: "flappy", name: "Flappy Minji", description: "Terbangkan avatar Minji melewati pilar rintangan" },
        ],
      });
    });

    // ─── API: Strategy & Chess Endpoints ────────────────────────────────────

    // 10. Start New Chess Game
    this.app.post("/api/chess/new", (req, res) => {
      try {
        const { mode, playerColor, difficulty } = req.body;
        const state = chessDuelService.createRoom({ mode, playerColor, difficulty });
        res.json({ success: true, state });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to create chess game";
        res.status(500).json({ error: message });
      }
    });

    // 11. Get Chess Game State
    this.app.get("/api/chess/state/:roomId", (req, res) => {
      const { roomId } = req.params;
      const state = chessDuelService.getRoomState(roomId);
      if (!state) {
        res.status(404).json({ error: "Chess room tidak ditemukan." });
        return;
      }
      res.json({ success: true, state });
    });

    // 12. Get Legal Moves for Square
    this.app.get("/api/chess/moves/:roomId", (req, res) => {
      const { roomId } = req.params;
      const sq = typeof req.query.sq === "string" ? req.query.sq : undefined;
      const moves = chessDuelService.getLegalMoves(roomId, sq);
      res.json({ success: true, moves });
    });

    // 13. Make Chess Move
    this.app.post("/api/chess/move", (req, res) => {
      try {
        const { roomId, from, to, promotion } = req.body;
        if (!roomId || !from || !to) {
          res.status(400).json({ error: "roomId, from, dan to wajib diisi." });
          return;
        }
        const result = chessDuelService.makeMove(roomId, from, to, promotion);
        if (!result.success) {
          res.status(400).json({ success: false, error: result.error, state: result.state });
          return;
        }
        res.json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Gagal memproses langkah catur";
        res.status(500).json({ error: message });
      }
    });

    // 14. Resign Chess Game
    this.app.post("/api/chess/resign", (req, res) => {
      const { roomId, color } = req.body;
      const state = chessDuelService.resign(roomId, color);
      if (!state) {
        res.status(404).json({ error: "Room tidak ditemukan" });
        return;
      }
      res.json({ success: true, state });
    });

    // ─── API: Community & Gamification Endpoints ────────────────────────────

    // 15. Get Community Leaderboard
    this.app.get("/api/community/leaderboard", async (req, res) => {
      try {
        const type = req.query.type === "points" ? "points" : "xp";
        const groupJid = typeof req.query.group === "string" && req.query.group.trim() ? req.query.group.trim() : "global@g.us";
        const callerJid = typeof req.query.user === "string" && req.query.user.trim() ? req.query.user.trim() : "caller@s.whatsapp.net";

        const result = type === "points"
          ? await leaderboardService.getTopPoint(groupJid, callerJid)
          : await leaderboardService.getTopRank(groupJid, callerJid);

        res.json({
          success: true,
          type,
          count: result.entries.length,
          entries: result.entries,
          callerPosition: result.callerPosition,
        });
      } catch (err: unknown) {
        logger.warn({ err }, "Leaderboard database query failed, returning fallback");
        res.json({
          success: true,
          type: req.query.type === "points" ? "points" : "xp",
          count: 0,
          entries: [],
          callerPosition: null,
          fallback: true,
        });
      }
    });

    // 16. Claim Game / Spin Reward Token
    this.app.post("/api/arcade/claim-reward", async (req, res) => {
      try {
        const { token, groupJid, userJid } = req.body;
        if (!token) {
          res.status(400).json({ error: "Token reward wajib disertakan." });
          return;
        }

        const targetGroup = groupJid || "global@g.us";
        const targetUser = userJid || "user@s.whatsapp.net";

        const result = await arcadeRewardService.claimToken(token, targetGroup, targetUser);
        if (!result.success) {
          res.status(400).json({ success: false, error: result.message });
          return;
        }

        res.json({
          success: true,
          message: result.message,
          game: result.game,
          pointsAwarded: result.pointsAwarded,
          xpAwarded: result.xpAwarded,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Gagal mengklaim reward";
        res.status(500).json({ error: message });
      }
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

    // Interactive Meme Soundboard Page
    this.app.get("/soundboard", (_req, res) => {
      const filePath = path.join(staticDir, "soundboard", "index.html");
      if (existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).send("Soundboard page not found");
      }
    });

    // Retro Arcade Hub Page (Screenshot 4)
    this.app.get("/arcade", (_req, res) => {
      const filePath = path.join(staticDir, "arcade", "index.html");
      if (existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).send("Arcade hub page not found");
      }
    });

    // Dans Catur Page (Screenshot 3)
    this.app.get("/catur", (_req, res) => {
      const filePath = path.join(staticDir, "catur", "index.html");
      if (existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).send("Catur page not found");
      }
    });

    // Strategy Arena Hub Page
    this.app.get("/duel", (_req, res) => {
      const filePath = path.join(staticDir, "duel", "index.html");
      if (existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).send("Strategy arena page not found");
      }
    });

    // Connect Four Duel Page
    this.app.get("/duel/connect4", (_req, res) => {
      const filePath = path.join(staticDir, "duel", "connect4.html");
      if (existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).send("Connect four page not found");
      }
    });

    // Tic-Tac-Toe Deluxe Page
    this.app.get("/duel/tictactoe", (_req, res) => {
      const filePath = path.join(staticDir, "duel", "tictactoe.html");
      if (existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).send("Tic-tac-toe page not found");
      }
    });

    // Community Leaderboard Page
    this.app.get("/community/leaderboard", (_req, res) => {
      const filePath = path.join(staticDir, "community", "leaderboard.html");
      if (existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).send("Leaderboard page not found");
      }
    });

    // Lucky Spin Wheel Page
    this.app.get("/community/spin", (_req, res) => {
      const filePath = path.join(staticDir, "community", "spin.html");
      if (existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).send("Spin the wheel page not found");
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
              <a href="/soundboard">&rarr; INTERACTIVE MEME SOUNDBOARD</a>
              <a href="/arcade">&rarr; RETRO ARCADE HUB</a>
              <a href="/catur">&rarr; DANS CATUR (FIDE CHESS)</a>
              <a href="/duel">&rarr; STRATEGY ARENA (DUEL ZONE)</a>
              <a href="/community/leaderboard">&rarr; LEADERBOARD HALL OF FAME</a>
              <a href="/community/spin">&rarr; SPIN THE WHEEL (LUCKY DRAW)</a>
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
