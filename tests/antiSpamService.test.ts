import { test } from "node:test";
import assert from "node:assert/strict";

import { AntiSpamMode, TenantStatus, type TenantGroup } from "@prisma/client";
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

void test("AntiSpamService soft mode deletes spam and does not kick", async () => {
  const { service, socket } = await createAntiSpamService({
    mode: AntiSpamMode.SOFT,
    botIsAdmin: true,
  });

  await sendRepeatedSpam(service, socket, "6281@s.whatsapp.net");

  assert.equal(socket.deletedMessages, 1);
  assert.equal(socket.kickedUsers.length, 0);
  assert.match(socket.sentMessages.at(-1)?.content.text ?? "", /sudah dihapus/);
});

void test("AntiSpamService strict mode does not kick super owner", async () => {
  const { service, socket } = await createAntiSpamService({
    mode: AntiSpamMode.STRICT,
    botIsAdmin: true,
  });

  await sendRepeatedSpam(service, socket, "62895366009208@s.whatsapp.net");

  assert.equal(socket.kickedUsers.length, 0);
  assert.match(socket.sentMessages.at(-1)?.content.text ?? "", /dilindungi dari kick/);
});

void test("AntiSpamService strict mode does not kick super owner resolved from LID participant", async () => {
  const { service, socket } = await createAntiSpamService({
    mode: AntiSpamMode.STRICT,
    botIsAdmin: true,
    extraParticipants: [
      {
        id: "111111@lid",
        jid: "62895366009208@s.whatsapp.net",
        lid: "111111@lid",
        admin: null,
      },
    ],
  });

  await sendRepeatedSpam(service, socket, "111111@lid");

  assert.equal(socket.kickedUsers.length, 0);
  assert.match(socket.sentMessages.at(-1)?.content.text ?? "", /dilindungi dari kick/);
});

void test("AntiSpamService strict mode does not kick tenant owner", async () => {
  const { service, socket } = await createAntiSpamService({
    mode: AntiSpamMode.STRICT,
    botIsAdmin: true,
    ownerJid: "6281@s.whatsapp.net",
  });

  await sendRepeatedSpam(service, socket, "6281@s.whatsapp.net");

  assert.equal(socket.kickedUsers.length, 0);
  assert.match(socket.sentMessages.at(-1)?.content.text ?? "", /dilindungi dari kick/);
});

void test("AntiSpamService strict mode does not kick tenant owner resolved from LID participant", async () => {
  const { service, socket } = await createAntiSpamService({
    mode: AntiSpamMode.STRICT,
    botIsAdmin: true,
    ownerJid: "6282@s.whatsapp.net",
    extraParticipants: [
      {
        id: "222222@lid",
        jid: "6282@s.whatsapp.net",
        lid: "222222@lid",
        admin: null,
      },
    ],
  });

  await sendRepeatedSpam(service, socket, "222222@lid");

  assert.equal(socket.kickedUsers.length, 0);
  assert.match(socket.sentMessages.at(-1)?.content.text ?? "", /dilindungi dari kick/);
});

void test("AntiSpamService strict mode does not kick group admin", async () => {
  const { service, socket } = await createAntiSpamService({
    mode: AntiSpamMode.STRICT,
    botIsAdmin: true,
    adminJids: ["6281@s.whatsapp.net"],
  });

  await sendRepeatedSpam(service, socket, "6281@s.whatsapp.net");

  assert.equal(socket.kickedUsers.length, 0);
  assert.match(socket.sentMessages.at(-1)?.content.text ?? "", /dilindungi dari kick/);
});

void test("AntiSpamService soft mode falls back to warning when bot is not admin", async () => {
  const { service, socket } = await createAntiSpamService({
    mode: AntiSpamMode.SOFT,
    botIsAdmin: false,
  });

  await sendRepeatedSpam(service, socket, "6281@s.whatsapp.net");

  assert.equal(socket.deletedMessages, 0);
  assert.equal(socket.kickedUsers.length, 0);
  assert.match(socket.sentMessages.at(-1)?.content.text ?? "", /tidak dapat dijalankan/);
});

void test("AntiSpamService strict mode falls back to warning when bot is not admin", async () => {
  const { service, socket } = await createAntiSpamService({
    mode: AntiSpamMode.STRICT,
    botIsAdmin: false,
  });

  await sendRepeatedSpam(service, socket, "6281@s.whatsapp.net");

  assert.equal(socket.deletedMessages, 0);
  assert.equal(socket.kickedUsers.length, 0);
  assert.match(socket.sentMessages.at(-1)?.content.text ?? "", /tidak dapat dijalankan/);
});

async function createAntiSpamService(options: {
  mode: AntiSpamMode;
  botIsAdmin: boolean;
  ownerJid?: string;
  adminJids?: string[];
  extraParticipants?: TestParticipant[];
}): Promise<{
  service: { handleIncomingMessage(socket: WASocket, message: WAMessage): Promise<void> };
  socket: TestSocket;
}> {
  const { AntiSpamService } = await import("../src/services/moderation/antiSpam.service");
  const { ModerationGuard } = await import("../src/guards/moderationGuard");
  const tenantGroup = createTenantGroup(options.ownerJid ?? "6282@s.whatsapp.net");
  const socket = createSocket(
    options.botIsAdmin,
    options.adminJids ?? [],
    options.extraParticipants ?? [],
  );
  const guard = new ModerationGuard({
    exists: () => Promise.resolve(false),
  } as never);
  const service = new AntiSpamService(
    {
      findByGroupJid: () => Promise.resolve(tenantGroup),
    } as never,
    {
      findByGroupJid: () => Promise.resolve({ antiSpamEnabled: true }),
    } as never,
    {
      ensureForGroup: () => Promise.resolve({ antiSpamMode: options.mode }),
    } as never,
    guard,
  );

  return { service, socket };
}

async function sendRepeatedSpam(
  service: { handleIncomingMessage(socket: WASocket, message: WAMessage): Promise<void> },
  socket: WASocket,
  senderJid: string,
): Promise<void> {
  await service.handleIncomingMessage(socket, createTextMessage("spam", "1", senderJid));
  await service.handleIncomingMessage(socket, createTextMessage("spam", "2", senderJid));
  await service.handleIncomingMessage(socket, createTextMessage("spam", "3", senderJid));
}

interface TestSocket extends WASocket {
  deletedMessages: number;
  kickedUsers: string[];
  sentMessages: { jid: string; content: { text?: string; delete?: unknown } }[];
}

interface TestParticipant {
  id: string;
  jid?: string;
  lid?: string;
  admin: "admin" | "superadmin" | null;
}

function createSocket(
  botIsAdmin: boolean,
  adminJids: string[],
  extraParticipants: TestParticipant[],
): TestSocket {
  const sentMessages: { jid: string; content: { text?: string; delete?: unknown } }[] = [];
  const kickedUsers: string[] = [];
  const socket = {
    user: {
      id: "999@s.whatsapp.net",
    },
    deletedMessages: 0,
    kickedUsers,
    sentMessages,
    sendMessage: (jid: string, content: { text?: string; delete?: unknown }) => {
      if (content.delete) {
        socket.deletedMessages += 1;
      }
      sentMessages.push({ jid, content });
      return Promise.resolve(undefined);
    },
    groupParticipantsUpdate: (_jid: string, participants: string[]) => {
      kickedUsers.push(...participants);
      return Promise.resolve([]);
    },
    groupMetadata: () =>
      Promise.resolve({
        id: "120@g.us",
        subject: "Grup Test",
        participants: [
          {
            id: "999@s.whatsapp.net",
            admin: botIsAdmin ? "admin" : null,
          },
          ...adminJids.map((jid) => ({
            id: jid,
            admin: "admin",
          })),
          ...extraParticipants,
        ],
      }),
  } as unknown as TestSocket;

  return socket;
}

function createTextMessage(text: string, id: string, participant: string): WAMessage {
  return {
    key: {
      id,
      remoteJid: "120@g.us",
      participant,
      fromMe: false,
    },
    message: {
      conversation: text,
    },
  };
}

function createTenantGroup(ownerJid: string): TenantGroup {
  const now = new Date();

  return {
    id: "tenant-1",
    groupJid: "120@g.us",
    tenantCode: "MNJ001",
    name: "Grup Test",
    status: TenantStatus.ACTIVE,
    ownerJid,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    isBlocked: false,
    approvedAt: now,
    activatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}
