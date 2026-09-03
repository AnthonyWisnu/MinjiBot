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

void test("AntiLinkService auto kick does not kick super owner resolved from LID participant", async () => {
  const { service, socket } = await createAntiLinkService({
    extraParticipants: [
      {
        id: "111111@lid",
        jid: "62895366009208@s.whatsapp.net",
        lid: "111111@lid",
        admin: null,
      },
    ],
  });

  await service.handleIncomingMessage(socket, createLinkMessage("1", "111111@lid"));

  assert.equal(socket.deletedMessages, 1);
  assert.equal(socket.kickedUsers.length, 0);
  assert.match(socket.sentMessages.at(-1)?.content.text ?? "", /user dilindungi dari kick/);
});

void test("AntiLinkService auto kick does not kick tenant owner resolved from LID participant", async () => {
  const { service, socket } = await createAntiLinkService({
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

  await service.handleIncomingMessage(socket, createLinkMessage("1", "222222@lid"));

  assert.equal(socket.deletedMessages, 1);
  assert.equal(socket.kickedUsers.length, 0);
  assert.match(socket.sentMessages.at(-1)?.content.text ?? "", /user dilindungi dari kick/);
});

void test("AntiLinkService auto kick does not kick tenant admin", async () => {
  const { service, socket } = await createAntiLinkService({
    tenantAdminJids: ["6284@s.whatsapp.net"],
    extraParticipants: [
      {
        id: "444444@lid",
        jid: "6284@s.whatsapp.net",
        lid: "444444@lid",
        admin: null,
      },
    ],
  });

  await service.handleIncomingMessage(socket, createLinkMessage("1", "444444@lid"));

  assert.equal(socket.deletedMessages, 1);
  assert.equal(socket.kickedUsers.length, 0);
  assert.match(socket.sentMessages.at(-1)?.content.text ?? "", /user dilindungi dari kick/);
});

void test("AntiLinkService auto kick does not kick group admin", async () => {
  const { service, socket } = await createAntiLinkService({
    extraParticipants: [
      {
        id: "333333@lid",
        jid: "6283@s.whatsapp.net",
        lid: "333333@lid",
        admin: "admin",
      },
    ],
  });

  await service.handleIncomingMessage(socket, createLinkMessage("1", "333333@lid"));

  assert.equal(socket.deletedMessages, 1);
  assert.equal(socket.kickedUsers.length, 0);
  assert.match(socket.sentMessages.at(-1)?.content.text ?? "", /user dilindungi dari kick/);
});

void test("AntiLinkService auto kick does not kick bot", async () => {
  const { service, socket } = await createAntiLinkService({
    extraParticipants: [
      {
        id: "999@s.whatsapp.net",
        admin: "admin",
      },
    ],
  });

  await service.handleIncomingMessage(socket, createLinkMessage("1", "999@s.whatsapp.net"));

  assert.equal(socket.deletedMessages, 1);
  assert.equal(socket.kickedUsers.length, 0);
  assert.match(socket.sentMessages.at(-1)?.content.text ?? "", /user dilindungi dari kick/);
});

void test("AntiLinkService auto kick removes regular member when bot is admin", async () => {
  const { service, socket } = await createAntiLinkService({
    extraParticipants: [
      {
        id: "6285@s.whatsapp.net",
        admin: null,
      },
    ],
  });

  await service.handleIncomingMessage(socket, createLinkMessage("1", "6285@s.whatsapp.net"));

  assert.equal(socket.deletedMessages, 1);
  assert.deepEqual(socket.kickedUsers, ["6285@s.whatsapp.net"]);
});

async function createAntiLinkService(options: {
  ownerJid?: string;
  tenantAdminJids?: string[];
  extraParticipants?: TestParticipant[];
}): Promise<{
  service: { handleIncomingMessage(socket: WASocket, message: WAMessage): Promise<void> };
  socket: TestSocket;
}> {
  const { AntiLinkService } = await import("../src/services/moderation/antiLink.service");
  const { ModerationGuard } = await import("../src/guards/moderationGuard");
  const tenantGroup = createTenantGroup(options.ownerJid ?? "6282@s.whatsapp.net");
  const tenantAdminJids = options.tenantAdminJids ?? [];
  const guard = new ModerationGuard({
    exists: (_groupJid: string, userJid: string) =>
      Promise.resolve(tenantAdminJids.includes(userJid)),
  } as never);
  const service = new AntiLinkService(
    {
      findByGroupJid: () => Promise.resolve(tenantGroup),
    } as never,
    {
      findByGroupJid: () => Promise.resolve(createFeatureSetting()),
    } as never,
    {
      ensureForGroup: () => Promise.resolve(createGroupSetting()),
    } as never,
    guard,
  );

  return {
    service,
    socket: createSocket(options.extraParticipants ?? []),
  };
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

function createSocket(extraParticipants: TestParticipant[]): TestSocket {
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
            admin: "admin",
          },
          ...extraParticipants,
        ],
      }),
  } as unknown as TestSocket;

  return socket;
}

function createLinkMessage(id: string, participant: string): WAMessage {
  return {
    key: {
      id,
      remoteJid: "120@g.us",
      participant,
      fromMe: false,
    },
    message: {
      conversation: "join https://chat.whatsapp.com/AbCdEf123456",
    },
  };
}

function createFeatureSetting() {
  const now = new Date();

  return {
    id: "feature-1",
    groupJid: "120@g.us",
    downloaderEnabled: true,
    hdEnabled: true,
    gameEnabled: false,
    welcomeEnabled: false,
    antiLinkEnabled: true,
    antiSpamEnabled: false,
    reminderEnabled: true,
    tagAllEnabled: false,
    createdAt: now,
    updatedAt: now,
  };
}

function createGroupSetting() {
  const now = new Date();

  return {
    id: "setting-1",
    groupJid: "120@g.us",
    welcomeMessage: null,
    antiLinkAutoKick: true,
    antiSpamMode: AntiSpamMode.NORMAL,
    tagAllCooldownSec: 600,
    remindAllCooldownSec: 600,
    createdAt: now,
    updatedAt: now,
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
