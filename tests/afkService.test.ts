import { test } from "node:test";
import assert from "node:assert/strict";

import type { AfkStatus } from "@prisma/client";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/minjibot_test";
process.env.COMMAND_PREFIX = ".";
process.env.SUPER_OWNER_JIDS = "62895366009208@s.whatsapp.net";
process.env.SESSION_DIR = "./sessions-test";
process.env.TEMP_DIR = "./tmp-test";
process.env.LOG_LEVEL = "silent";
process.env.BOT_BROWSER_NAME = "MinjiBot Test";
process.env.RECONNECT_INITIAL_MS = "100";
process.env.RECONNECT_MAX_MS = "1000";
process.env.MAX_DOWNLOAD_FILE_MB = "50";
process.env.DOWNLOADER_BIN = "yt-dlp";
process.env.DOWNLOADER_TIMEOUT_MS = "300000";
process.env.HD_MAX_INPUT_MB = "7";
process.env.HD_AI_MAX_CONCURRENT_JOBS = "1";
process.env.TENANT_SESSION_TTL_DAYS = "7";
process.env.REMINDER_POLL_MS = "30000";

void test("AfkService stores AFK status with reason", async () => {
  const now = new Date("2026-06-27T01:00:00.000Z");
  const store = new MemoryAfkStore(now);
  const { AfkService } = await import("../src/services/afk/afk.service");
  const service = new AfkService(store, () => now);

  const status = await service.setAfkStatus("120@g.us", "6281@s.whatsapp.net", "kerja");

  assert.equal(status.reason, "kerja");
  assert.equal(store.items.size, 1);
});

void test("AfkService uses default reason for empty AFK reason", async () => {
  const now = new Date("2026-06-27T01:00:00.000Z");
  const store = new MemoryAfkStore(now);
  const { AfkService } = await import("../src/services/afk/afk.service");
  const service = new AfkService(store, () => now);

  const status = await service.setAfkStatus("120@g.us", "6281@s.whatsapp.net", "");

  assert.equal(status.reason, "Tidak ada alasan.");
});

void test("AfkService clears AFK status when user sends regular message", async () => {
  let now = new Date("2026-06-27T01:00:00.000Z");
  const store = new MemoryAfkStore(now);
  const { AfkService } = await import("../src/services/afk/afk.service");
  const service = new AfkService(store, () => now);
  await service.setAfkStatus("120@g.us", "6281@s.whatsapp.net", "tidur");
  now = new Date("2026-06-27T01:12:00.000Z");
  const socket = createSocket();

  await service.handleIncomingMessage(
    socket,
    createTextMessage("sudah balik", "120@g.us", "6281@s.whatsapp.net"),
  );

  assert.equal(store.items.size, 0);
  assert.match(
    socket.sentMessages[0]?.content.text,
    /STATUS UPDATE/,
  );
  assert.match(
    socket.sentMessages[0]?.content.text,
    /Waktu Rehat : 12 menit/,
  );
  assert.match(
    socket.sentMessages[0]?.content.text,
    /Tidak ada panggilan masuk/,
  );
});

void test("AfkService tracks callers and mentions them when AFK user returns", async () => {
  let now = new Date("2026-06-27T01:00:00.000Z");
  const store = new MemoryAfkStore(now);
  const { AfkService } = await import("../src/services/afk/afk.service");
  const service = new AfkService(store, () => now);
  await service.setAfkStatus("120@g.us", "6282@s.whatsapp.net", "makan siang");

  // User 6281 tags user 6282 while AFK
  now = new Date("2026-06-27T01:05:00.000Z");
  const socket = createSocket();
  await service.handleIncomingMessage(
    socket,
    createMentionMessage("halo @6282", "120@g.us", "6281@s.whatsapp.net", ["6282@s.whatsapp.net"]),
  );

  assert.equal(socket.sentMessages.length, 1);
  assert.match(socket.sentMessages[0]?.content.text, /PEMBERITAHUAN AFK/);
  assert.match(socket.sentMessages[0]?.content.text, /makan siang/i);

  // User 6282 returns
  now = new Date("2026-06-27T01:20:00.000Z");
  await service.handleIncomingMessage(
    socket,
    createTextMessage("halo saya kembali", "120@g.us", "6282@s.whatsapp.net"),
  );

  assert.equal(socket.sentMessages.length, 2);
  const returnMsg = socket.sentMessages[1];
  assert.match(returnMsg?.content.text, /STATUS UPDATE/);
  assert.match(returnMsg?.content.text, /Dicari oleh @6281 \(1 orang\)/);
  // Mentions must include both returning user and the caller
  assert.ok(returnMsg?.content.mentions?.includes("6282@s.whatsapp.net"));
  assert.ok(returnMsg?.content.mentions?.includes("6281@s.whatsapp.net"));
});

void test("AfkService replies when AFK user is mentioned", async () => {
  const now = new Date("2026-06-27T01:10:00.000Z");
  const store = new MemoryAfkStore(new Date("2026-06-27T01:00:00.000Z"));
  const { AfkService } = await import("../src/services/afk/afk.service");
  const service = new AfkService(store, () => now);
  await service.setAfkStatus("120@g.us", "6282@s.whatsapp.net", "belajar");
  const socket = createSocket();

  await service.handleIncomingMessage(
    socket,
    createMentionMessage("halo @6282", "120@g.us", "6281@s.whatsapp.net", ["6282@s.whatsapp.net"]),
  );

  assert.equal(socket.sentMessages.length, 1);
  assert.match(socket.sentMessages[0]?.content.text, /sedang AFK/);
});

void test("AfkService cooldown prevents repeated AFK replies", async () => {
  let now = new Date("2026-06-27T01:10:00.000Z");
  const store = new MemoryAfkStore(new Date("2026-06-27T01:00:00.000Z"));
  const { AfkService } = await import("../src/services/afk/afk.service");
  const service = new AfkService(store, () => now);
  await service.setAfkStatus("120@g.us", "6282@s.whatsapp.net", "belajar");
  const socket = createSocket();
  const message = createMentionMessage("halo @6282", "120@g.us", "6281@s.whatsapp.net", [
    "6282@s.whatsapp.net",
  ]);

  await service.handleIncomingMessage(socket, message);
  now = new Date("2026-06-27T01:10:30.000Z");
  await service.handleIncomingMessage(socket, message);

  assert.equal(socket.sentMessages.length, 1);
});

class MemoryAfkStore {
  readonly items = new Map<string, AfkStatus>();

  constructor(private readonly startedAt: Date) {}

  setAfkStatus(input: { groupJid: string; userJid: string; reason: string }): Promise<AfkStatus> {
    const status = createAfkStatus(input.groupJid, input.userJid, input.reason, this.startedAt);
    this.items.set(this.key(input.groupJid, input.userJid), status);

    return Promise.resolve(status);
  }

  getAfkStatus(groupJid: string, userJid: string): Promise<AfkStatus | null> {
    return Promise.resolve(this.items.get(this.key(groupJid, userJid)) ?? null);
  }

  getAfkStatusesByUsers(groupJid: string, userJids: string[]): Promise<AfkStatus[]> {
    return Promise.resolve(
      userJids
        .map((userJid) => this.items.get(this.key(groupJid, userJid)))
        .filter((status): status is AfkStatus => Boolean(status)),
    );
  }

  clearAfkStatus(groupJid: string, userJid: string): Promise<AfkStatus | null> {
    const key = this.key(groupJid, userJid);
    const status = this.items.get(key) ?? null;
    this.items.delete(key);

    return Promise.resolve(status);
  }

  private key(groupJid: string, userJid: string): string {
    return `${groupJid}:${userJid}`;
  }
}

function createAfkStatus(
  groupJid: string,
  userJid: string,
  reason: string,
  startedAt: Date,
): AfkStatus {
  return {
    id: `${groupJid}:${userJid}`,
    groupJid,
    userJid,
    reason,
    startedAt,
    updatedAt: startedAt,
  };
}

function createSocket(): WASocket & {
  sentMessages: { jid: string; content: { text?: string } }[];
} {
  const sentMessages: { jid: string; content: { text?: string } }[] = [];

  return {
    sentMessages,
    sendMessage: (jid: string, content: { text?: string }) => {
      sentMessages.push({ jid, content });
      return Promise.resolve(undefined);
    },
  } as unknown as WASocket & {
    sentMessages: { jid: string; content: { text?: string } }[];
  };
}

function createTextMessage(text: string, remoteJid: string, participant: string): WAMessage {
  return {
    key: {
      remoteJid,
      participant,
      fromMe: false,
    },
    message: {
      conversation: text,
    },
  };
}

function createMentionMessage(
  text: string,
  remoteJid: string,
  participant: string,
  mentionedJids: string[],
): WAMessage {
  return {
    key: {
      remoteJid,
      participant,
      fromMe: false,
    },
    message: {
      extendedTextMessage: {
        text,
        contextInfo: {
          mentionedJid: mentionedJids,
        },
      },
    },
  };
}
