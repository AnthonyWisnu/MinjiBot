import assert from "node:assert/strict";
import test from "node:test";
import type { GroupMetadata, WASocket } from "@whiskeysockets/baileys";

import { GroupMetadataCacheManager, isRateLimitMetadataError } from "../src/bot/groupMetadataCache";
import { QrWebServer, isQrTokenValid, renderQrSvg } from "../src/bot/qrWebServer";
import { envSchema } from "../src/config/env";

function makeMetadata(id: string, subject = "Grup Uji"): GroupMetadata {
  return {
    id,
    subject,
    participants: [{ id: "6281111111111@s.whatsapp.net", admin: "admin" }],
  } as unknown as GroupMetadata;
}

void test("GroupMetadataCacheManager caches metadata and deduplicates concurrent fetches", async () => {
  const manager = new GroupMetadataCacheManager();
  let calls = 0;

  const mockSocket = {
    groupMetadata: async (jid: string) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return makeMetadata(jid);
    },
  } as unknown as WASocket;

  manager.installOnSocket(mockSocket);

  const parallelResults = await Promise.all(
    Array.from({ length: 8 }, () => mockSocket.groupMetadata("120363297786956380@g.us")),
  );
  assert.equal(calls, 1);
  assert.equal(parallelResults[0]?.id, "120363297786956380@g.us");

  // Subsequent sequential call should hit fresh cache
  const cachedResult = await mockSocket.groupMetadata("120363297786956380@g.us");
  assert.equal(calls, 1);
  assert.equal(cachedResult.subject, "Grup Uji");
});

void test("GroupMetadataCacheManager falls back to stale metadata on 429 rate-overlimit after invalidation", async () => {
  const manager = new GroupMetadataCacheManager();
  let shouldRateLimit = false;
  let calls = 0;

  const mockSocket = {
    groupMetadata: async (jid: string) => {
      calls += 1;
      if (shouldRateLimit) {
        throw Object.assign(new Error("rate-overlimit"), { data: 429 });
      }
      return makeMetadata(jid, "Grup Stabil");
    },
  } as unknown as WASocket;

  manager.installOnSocket(mockSocket);

  const initial = await mockSocket.groupMetadata("120363297786956380@g.us");
  assert.equal(initial.subject, "Grup Stabil");
  assert.equal(calls, 1);

  manager.invalidate("120363297786956380@g.us");
  shouldRateLimit = true;

  const fallback = await mockSocket.groupMetadata("120363297786956380@g.us");
  assert.equal(fallback.subject, "Grup Stabil");
  assert.equal(calls, 2);

  // Backoff window avoids hammering fetcher immediately on next request
  const backoffHit = await mockSocket.groupMetadata("120363297786956380@g.us");
  assert.equal(backoffHit.subject, "Grup Stabil");
  assert.equal(calls, 2);

  assert.equal(isRateLimitMetadataError({ data: 429 }), true);
  assert.equal(isRateLimitMetadataError(new Error("rate-overlimit")), true);
  assert.equal(isRateLimitMetadataError(new Error("not found")), false);
});

void test("QrWebServer renders valid SVG, enforces token auth, hides QR on open, and resets session", async () => {
  const svg = renderQrSvg("2@test-qr-payload-minjibot");
  assert.match(svg, /^<svg /);
  assert.match(svg, /#ffffff/);
  assert.match(svg, /<rect /);

  assert.equal(isQrTokenValid("secret-123", "secret-123"), true);
  assert.equal(isQrTokenValid("wrong", "secret-123"), false);
  assert.equal(isQrTokenValid(null, "secret-123"), false);

  let resetTriggered = 0;
  const server = new QrWebServer({
    host: "127.0.0.1",
    port: 0,
    token: "test-token-abc",
    onResetSession: async () => {
      resetTriggered += 1;
      server.setQr("2@after-reset-qr");
    },
  });

  const info = await server.start();
  try {
    const baseUrl = `http://${info.host}:${String(info.port)}`;

    // Health endpoint does not leak token or QR
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);

    // Rejects missing or wrong token
    const unauthRes = await fetch(`${baseUrl}/api/qr`);
    assert.equal(unauthRes.status, 401);
    const badTokenRes = await fetch(`${baseUrl}/api/qr?token=wrong`);
    assert.equal(badTokenRes.status, 401);

    // Authorized HTML portal
    const pageRes = await fetch(`${baseUrl}/?token=test-token-abc`);
    assert.equal(pageRes.status, 200);
    const html = await pageRes.text();
    assert.match(html, /MinjiBot WhatsApp Pairing/);

    // Exposes SVG QR when waiting_qr
    server.setQr("2@initial-qr-payload");
    const qrRes = await fetch(`${baseUrl}/api/qr`, {
      headers: { "x-qr-token": "test-token-abc" },
    });
    assert.equal(qrRes.status, 200);
    const qrJson = (await qrRes.json()) as { state: string; qrSvg: string | null };
    assert.equal(qrJson.state, "waiting_qr");
    assert.ok(qrJson.qrSvg?.includes("<svg "));

    // Logged out + reset session triggers callback & rotates QR
    server.setLoggedOut();
    const resetRes = await fetch(`${baseUrl}/api/reset-session?token=test-token-abc`, {
      method: "POST",
    });
    assert.equal(resetRes.status, 202);
    assert.equal(resetTriggered, 1);

    // Open state clears QR payload immediately
    server.setOpen("6281228142960@s.whatsapp.net");
    const openRes = await fetch(`${baseUrl}/api/qr?token=test-token-abc`);
    const openJson = (await openRes.json()) as {
      state: string;
      qrSvg: string | null;
      connectedJid: string | null;
    };
    assert.equal(openJson.state, "open");
    assert.equal(openJson.qrSvg, null);
    assert.equal(openJson.connectedJid, "6281228142960@s.whatsapp.net");
  } finally {
    await server.stop();
  }
});

void test("envSchema parses QR_WEB boolean strings accurately", () => {
  const baseEnv = {
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/minjibot",
    COMMAND_PREFIX: ".",
    SUPER_OWNER_JIDS: "6281234567890@s.whatsapp.net",
    SESSION_DIR: "./sessions",
    TEMP_DIR: "./tmp",
    LOG_LEVEL: "info",
    BOT_BROWSER_NAME: "MinjiBot",
    RECONNECT_INITIAL_MS: "3000",
    RECONNECT_MAX_MS: "60000",
    DOWNLOADER_BIN: "yt-dlp",
    DOWNLOADER_TIMEOUT_MS: "600000",
    HD_MAX_INPUT_MB: "10",
    HD_AI_MAX_CONCURRENT_JOBS: "2",
    TENANT_SESSION_TTL_DAYS: "7",
    REMINDER_POLL_MS: "30000",
  };

  const disabled = envSchema.parse({ ...baseEnv, QR_WEB_ENABLED: "false" });
  assert.equal(disabled.QR_WEB_ENABLED, false);
  assert.equal(disabled.QR_WEB_HOST, "127.0.0.1");
  assert.equal(disabled.QR_WEB_PORT, 3004);

  const enabled = envSchema.parse({ ...baseEnv, QR_WEB_ENABLED: "true", QR_WEB_PORT: "3100" });
  assert.equal(enabled.QR_WEB_ENABLED, true);
  assert.equal(enabled.QR_WEB_PORT, 3100);
});
