import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { playerSessionService } from "../src/services/web/playerSession.service";

describe("PlayerSessionService", () => {
  it("harus berhasil membuat session baru dengan token UUID dan metadata valid", () => {
    const session = playerSessionService.createSession({
      videoId: "dQw4w9WgXcQ",
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
      channelTitle: "Rick Astley",
      durationSeconds: 213,
      thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      chatJid: "123456@g.us",
      userJid: "987654@s.whatsapp.net",
    });

    assert.ok(session.sessionId);
    assert.strictEqual(session.sessionId.length, 36); // UUID v4 format
    assert.strictEqual(session.videoId, "dQw4w9WgXcQ");
    assert.strictEqual(session.title, "Never Gonna Give You Up");
    assert.ok(session.expiresAt > Date.now());

    const retrieved = playerSessionService.getSession(session.sessionId);
    assert.ok(retrieved);
    assert.strictEqual(retrieved.title, "Never Gonna Give You Up");
  });

  it("harus mengembalikan null jika session sudah expired", () => {
    // Buat session dengan ttl -1000ms (sudah expired saat dibuat)
    const expiredSession = playerSessionService.createSession({
      videoId: "expired123",
      videoUrl: "https://www.youtube.com/watch?v=expired123",
      title: "Expired Video",
      channelTitle: "Test",
      durationSeconds: 100,
      thumbnail: "https://example.com/thumb.jpg",
      ttlMs: -1000,
    });

    const retrieved = playerSessionService.getSession(expiredSession.sessionId);
    assert.strictEqual(retrieved, null);
  });

  it("harus dapat menghapus session secara manual", () => {
    const session = playerSessionService.createSession({
      videoId: "manualDel",
      videoUrl: "https://www.youtube.com/watch?v=manualDel",
      title: "Manual Delete Video",
      channelTitle: "Test",
      durationSeconds: 150,
      thumbnail: "https://example.com/thumb.jpg",
    });

    const deleted = playerSessionService.deleteSession(session.sessionId);
    assert.strictEqual(deleted, true);

    const retrieved = playerSessionService.getSession(session.sessionId);
    assert.strictEqual(retrieved, null);
  });

  it("harus dapat melakukan sweep pada session-session yang sudah kadaluwarsa", () => {
    playerSessionService.createSession({
      videoId: "sweep1",
      videoUrl: "https://www.youtube.com/watch?v=sweep1",
      title: "Sweep 1",
      channelTitle: "Test",
      durationSeconds: 100,
      thumbnail: "https://example.com/thumb.jpg",
      ttlMs: -5000,
    });

    playerSessionService.createSession({
      videoId: "sweep2",
      videoUrl: "https://www.youtube.com/watch?v=sweep2",
      title: "Sweep 2",
      channelTitle: "Test",
      durationSeconds: 100,
      thumbnail: "https://example.com/thumb.jpg",
      ttlMs: -2000,
    });

    const sweptCount = playerSessionService.sweepExpiredSessions();
    assert.ok(sweptCount >= 2);
  });
});
