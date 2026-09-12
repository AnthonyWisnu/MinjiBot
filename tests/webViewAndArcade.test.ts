import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { WASocket } from "@whiskeysockets/baileys";

import { playerSessionService } from "../src/web/services/player-session.service";
import { streamingService } from "../src/web/services/streaming.service";
import { webViewService } from "../src/web/services/webview.service";
import { whatsAppWebViewService } from "../src/services/whatsapp/whatsAppWebView.service";
import { renderDinoGameHtml } from "../src/games/dino/dinoGame";
import { renderBlockBlastGameHtml } from "../src/games/block-blast/blockBlastGame";
import { renderChessGameHtml, ChessGameEngine } from "../src/games/chess/chessGame";

describe("WebView & Arcade Suite", () => {
  beforeEach(() => {
    playerSessionService.destroy();
  });

  describe("PlayerSessionService", () => {
    it("membuat sesi player yang valid dengan UUID dan TTL", () => {
      const session = playerSessionService.createSession({
        videoId: "gxEPV4kolz0",
        videoUrl: "https://www.youtube.com/watch?v=gxEPV4kolz0",
        title: "Billy Joel - Piano Man",
        channelTitle: "Billy Joel",
        durationSeconds: 342,
        thumbnail: "https://i.ytimg.com/vi/gxEPV4kolz0/hqdefault.jpg",
      });

      assert.ok(session.sessionId);
      assert.equal(session.sessionId.length, 36); // UUID v4 format
      assert.equal(session.videoId, "gxEPV4kolz0");
      assert.equal(session.durationSeconds, 342);
      assert.ok(session.expiresAt > Date.now());

      const fetched = playerSessionService.getSession(session.sessionId);
      assert.ok(fetched);
      assert.equal(fetched.sessionId, session.sessionId);
    });

    it("menghasilkan null untuk sessionId tidak valid atau kadaluwarsa", () => {
      assert.equal(playerSessionService.getSession(""), null);
      assert.equal(playerSessionService.getSession("non-existent-uuid"), null);

      // Kadaluwarsa
      const expiredSession = playerSessionService.createSession({
        videoId: "gxEPV4kolz0",
        videoUrl: "https://www.youtube.com/watch?v=gxEPV4kolz0",
        title: "Expired",
        channelTitle: "Artist",
        durationSeconds: 100,
        thumbnail: "https://thumb.jpg",
        ttlMs: -1000, // Sudah lewat
      });

      assert.equal(playerSessionService.getSession(expiredSession.sessionId), null);
    });

    it("menghapus sesi secara manual", () => {
      const session = playerSessionService.createSession({
        videoId: "12345678901",
        videoUrl: "https://youtube.com/watch?v=12345678901",
        title: "Title",
        channelTitle: "Channel",
        durationSeconds: 60,
        thumbnail: "https://thumb.jpg",
      });

      assert.equal(playerSessionService.deleteSession(session.sessionId), true);
      assert.equal(playerSessionService.getSession(session.sessionId), null);
    });
  });

  describe("StreamingService Validation", () => {
    it("memvalidasi URL YouTube resmi dan videoId 11 karakter", () => {
      assert.equal(streamingService.isValidYoutubeUrl("gxEPV4kolz0"), true);
      assert.equal(streamingService.isValidYoutubeUrl("https://www.youtube.com/watch?v=gxEPV4kolz0"), true);
      assert.equal(streamingService.isValidYoutubeUrl("https://youtu.be/gxEPV4kolz0"), true);

      // Malformed / SSRF injection
      assert.equal(streamingService.isValidYoutubeUrl("http://evil.com/fake?v=gxEPV4kolz0"), false);
      assert.equal(streamingService.isValidYoutubeUrl("file:///etc/passwd"), false);
      assert.equal(streamingService.isValidYoutubeUrl(""), false);
    });

    it("menormalisasi input videoId menjadi URL YouTube resmi", () => {
      assert.equal(
        streamingService.normalizeYoutubeUrl("gxEPV4kolz0"),
        "https://www.youtube.com/watch?v=gxEPV4kolz0",
      );
    });
  });

  describe("WebViewService", () => {
    it("menghasilkan URL player dan arcade yang benar", () => {
      const playerUrl = webViewService.getPlayerUrl("test-session-id");
      assert.ok(playerUrl.includes("/player/test-session-id"));

      const arcadeHubUrl = webViewService.getArcadeUrl();
      assert.ok(arcadeHubUrl.endsWith("/arcade"));

      const dinoUrl = webViewService.getArcadeUrl("dino");
      assert.ok(dinoUrl.endsWith("/arcade/dino"));
    });
  });

  describe("WhatsAppWebViewService", () => {
    it("mengirim pesan WebView player dengan sesi aman dan relayMessage", async () => {
      let relayCalled = false;
      let relayPayload: any = null;

      const mockSocket = {
        user: { id: "bot@s.whatsapp.net" },
        relayMessage: async (_jid: string, message: any, _options?: any) => {
          relayCalled = true;
          relayPayload = message;
          return "msg-id";
        },
        sendMessage: async () => undefined,
      } as unknown as WASocket;

      const result = await whatsAppWebViewService.openPlayer(mockSocket, "120363001@g.us", {
        video: {
          videoId: "gxEPV4kolz0",
          url: "https://www.youtube.com/watch?v=gxEPV4kolz0",
          title: "Piano Man",
          channelTitle: "Billy Joel",
          durationSeconds: 342,
          thumbnail: "https://i.ytimg.com/vi/gxEPV4kolz0/hqdefault.jpg",
        },
        sendInChatAudio: false, // Don't download audio during unit test
      });

      assert.ok(result.sessionId);
      assert.ok(result.playerUrl.includes(result.sessionId));
      assert.equal(relayCalled, true);
      assert.ok(relayPayload?.viewOnceMessage?.message?.interactiveMessage);
    });

    it("mengirim pesan Arcade launcher via relayMessage", async () => {
      let relayCalled = false;

      const mockSocket = {
        user: { id: "bot@s.whatsapp.net" },
        relayMessage: async () => {
          relayCalled = true;
          return "msg-id";
        },
        sendMessage: async () => undefined,
      } as unknown as WASocket;

      const result = await whatsAppWebViewService.openArcade(mockSocket, "120363001@g.us", {
        game: "dino",
      });

      assert.ok(result.arcadeUrl.includes("/arcade/dino"));
      assert.equal(relayCalled, true);
    });
  });

  describe("Arcade Games HTML Rendering", () => {
    it("renderDinoGameHtml menghasilkan HTML Canvas game", () => {
      const html = renderDinoGameHtml();
      assert.ok(html.includes("DINO RUNNER"));
      assert.ok(html.includes("<canvas id=\"gameCanvas\""));
      assert.ok(html.includes("spawnObstacle"));
    });

    it("renderBlockBlastGameHtml menghasilkan HTML 8x8 grid puzzle", () => {
      const html = renderBlockBlastGameHtml();
      assert.ok(html.includes("BLOCK BLAST"));
      assert.ok(html.includes("board-container"));
      assert.ok(html.includes("GRID_SIZE = 8"));
    });

    it("renderChessGameHtml menghasilkan HTML Chess board", () => {
      const html = renderChessGameHtml();
      assert.ok(html.includes("ROYAL CHESS"));
      assert.ok(html.includes("board-wrapper"));
      assert.ok(html.includes("getLegalMovesForSquare"));
    });

    it("ChessGameEngine memvalidasi aturan catur menggunakan chess.js", () => {
      const engine = new ChessGameEngine();
      assert.equal(engine.turn(), "w");
      assert.equal(engine.isGameOver(), false);
      assert.equal(engine.isCheck(), false);

      // Langkah legal e2 -> e4
      const moved = engine.makeMove("e2", "e4");
      assert.equal(moved, true);
      assert.equal(engine.turn(), "b");

      // Langkah ilegal e2 -> e5 (sudah kosong)
      const illegalMoved = engine.makeMove("e2", "e5");
      assert.equal(illegalMoved, false);
    });
  });
});
