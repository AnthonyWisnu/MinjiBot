import { test } from "node:test";
import assert from "node:assert/strict";

import { TenantStatus, type TenantGroup } from "@prisma/client";
import type { WASocket } from "@whiskeysockets/baileys";

import type { CommandContext } from "../src/types/command";

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

void test("ManualModerationService kick rejects super owner target", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "6281@s.whatsapp.net",
    targetJid: "62895366009208@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: false,
  });

  await assert.rejects(
    () => service.kick(createMentionContext(socket, "kick", "62895366009208@s.whatsapp.net")),
    /Target adalah user yang dilindungi/,
  );
  assert.equal(socket.actions.length, 0);
});

void test("ManualModerationService kick rejects super owner target resolved from LID participant", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "6281@s.whatsapp.net",
    targetJid: "111111@lid",
    targetPhoneJid: "62895366009208@s.whatsapp.net",
    targetLid: "111111@lid",
    senderIsAdmin: true,
    targetIsAdmin: false,
  });

  await assert.rejects(
    () => service.kick(createMentionContext(socket, "kick", "111111@lid")),
    /Target adalah user yang dilindungi/,
  );
  assert.equal(socket.actions.length, 0);
});

void test("ManualModerationService kick rejects tenant owner target from regular admin", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "6281@s.whatsapp.net",
    targetJid: "6282@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: false,
    tenantOwnerJid: "6282@s.whatsapp.net",
  });

  await assert.rejects(
    () => service.kick(createMentionContext(socket, "kick", "6282@s.whatsapp.net")),
    /Target adalah user yang dilindungi/,
  );
  assert.equal(socket.actions.length, 0);
});

void test("ManualModerationService kick rejects tenant owner target from super owner", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "62895366009208@s.whatsapp.net",
    targetJid: "6282@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: false,
    tenantOwnerJid: "6282@s.whatsapp.net",
  });

  await assert.rejects(
    () => service.kick(createMentionContext(socket, "kick", "6282@s.whatsapp.net")),
    /Target adalah user yang dilindungi/,
  );
  assert.equal(socket.actions.length, 0);
});

void test("ManualModerationService kick rejects tenant owner target resolved from LID participant", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "6281@s.whatsapp.net",
    targetJid: "222222@lid",
    targetPhoneJid: "6282@s.whatsapp.net",
    targetLid: "222222@lid",
    senderIsAdmin: true,
    targetIsAdmin: false,
    tenantOwnerJid: "6282@s.whatsapp.net",
  });

  await assert.rejects(
    () => service.kick(createMentionContext(socket, "kick", "222222@lid")),
    /Target adalah user yang dilindungi/,
  );
  assert.equal(socket.actions.length, 0);
});

void test("ManualModerationService kick rejects bot target", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "6281@s.whatsapp.net",
    targetJid: "999@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: true,
  });

  await assert.rejects(
    () => service.kick(createMentionContext(socket, "kick", "999@s.whatsapp.net")),
    /Target adalah user yang dilindungi/,
  );
  assert.equal(socket.actions.length, 0);
});

void test("ManualModerationService kick removes regular user when allowed", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "6281@s.whatsapp.net",
    targetJid: "6283@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: false,
  });

  const result = await service.kick(createMentionContext(socket, "kick", "6283@s.whatsapp.net"));

  assert.equal(result, "[ADMIN] User berhasil dikeluarkan dari grup.");
  assert.deepEqual(socket.actions, [{ action: "remove", participant: "6283@s.whatsapp.net" }]);
});

void test("ManualModerationService kick removes regular user when sender is super owner", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "62895366009208@s.whatsapp.net",
    targetJid: "6283@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: false,
    tenantOwnerJid: "6282@s.whatsapp.net",
  });

  const result = await service.kick(createMentionContext(socket, "kick", "6283@s.whatsapp.net"));

  assert.equal(result, "[ADMIN] User berhasil dikeluarkan dari grup.");
  assert.deepEqual(socket.actions, [{ action: "remove", participant: "6283@s.whatsapp.net" }]);
});

void test("ManualModerationService kick removes regular user when sender is tenant owner", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "6282@s.whatsapp.net",
    targetJid: "6283@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: false,
    tenantOwnerJid: "6282@s.whatsapp.net",
  });

  const result = await service.kick(createMentionContext(socket, "kick", "6283@s.whatsapp.net"));

  assert.equal(result, "[ADMIN] User berhasil dikeluarkan dari grup.");
  assert.deepEqual(socket.actions, [{ action: "remove", participant: "6283@s.whatsapp.net" }]);
});

void test("ManualModerationService kick removes regular admin when sender is super owner", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "62895366009208@s.whatsapp.net",
    targetJid: "6283@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: true,
    tenantOwnerJid: "6282@s.whatsapp.net",
  });

  const result = await service.kick(createMentionContext(socket, "kick", "6283@s.whatsapp.net"));

  assert.equal(result, "[ADMIN] User berhasil dikeluarkan dari grup.");
  assert.deepEqual(socket.actions, [{ action: "remove", participant: "6283@s.whatsapp.net" }]);
});

void test("ManualModerationService kick removes regular admin when sender is tenant owner", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "6282@s.whatsapp.net",
    targetJid: "6283@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: true,
    tenantOwnerJid: "6282@s.whatsapp.net",
  });

  const result = await service.kick(createMentionContext(socket, "kick", "6283@s.whatsapp.net"));

  assert.equal(result, "[ADMIN] User berhasil dikeluarkan dari grup.");
  assert.deepEqual(socket.actions, [{ action: "remove", participant: "6283@s.whatsapp.net" }]);
});

void test("ManualModerationService add normalizes local Indonesian phone number", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "6281@s.whatsapp.net",
    targetJid: "6283@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: false,
  });

  const result = await service.add(createArgsContext(socket, "add", ["081234567890"]));

  assert.equal(result, "[ADMIN] Nomor berhasil ditambahkan ke grup.");
  assert.deepEqual(socket.actions, [
    { action: "add", participant: "6281234567890@s.whatsapp.net" },
  ]);
});

void test("ManualModerationService add rejects empty number", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "6281@s.whatsapp.net",
    targetJid: "6283@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: false,
  });

  await assert.rejects(() => service.add(createArgsContext(socket, "add", [])), /Nomor wajib/);
});

void test("ManualModerationService add rejects invalid number", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "6281@s.whatsapp.net",
    targetJid: "6283@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: false,
  });

  await assert.rejects(
    () => service.add(createArgsContext(socket, "add", ["123"])),
    /Nomor tidak valid/,
  );
});

void test("ManualModerationService promote succeeds for regular user when allowed", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "6281@s.whatsapp.net",
    targetJid: "6283@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: false,
  });

  const result = await service.promote(
    createMentionContext(socket, "promote", "6283@s.whatsapp.net"),
  );

  assert.equal(result, "[ADMIN] User berhasil dipromosikan menjadi admin.");
  assert.deepEqual(socket.actions, [{ action: "promote", participant: "6283@s.whatsapp.net" }]);
});

void test("ManualModerationService promote succeeds for tenant owner when target is not admin", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "6281@s.whatsapp.net",
    targetJid: "6282@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: false,
    tenantOwnerJid: "6282@s.whatsapp.net",
  });

  const result = await service.promote(
    createMentionContext(socket, "promote", "6282@s.whatsapp.net"),
  );

  assert.equal(result, "[ADMIN] User berhasil dipromosikan menjadi admin.");
  assert.deepEqual(socket.actions, [{ action: "promote", participant: "6282@s.whatsapp.net" }]);
});

void test("ManualModerationService promote succeeds for super owner when target is not admin", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "6281@s.whatsapp.net",
    targetJid: "62895366009208@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: false,
    tenantOwnerJid: "6282@s.whatsapp.net",
  });

  const result = await service.promote(
    createMentionContext(socket, "promote", "62895366009208@s.whatsapp.net"),
  );

  assert.equal(result, "[ADMIN] User berhasil dipromosikan menjadi admin.");
  assert.deepEqual(socket.actions, [
    { action: "promote", participant: "62895366009208@s.whatsapp.net" },
  ]);
});

void test("ManualModerationService promote rejects bot target", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "6281@s.whatsapp.net",
    targetJid: "999@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: false,
  });

  await assert.rejects(
    () => service.promote(createMentionContext(socket, "promote", "999@s.whatsapp.net")),
    /Target adalah user yang dilindungi/,
  );
  assert.equal(socket.actions.length, 0);
});

void test("ManualModerationService promote rejects when bot is not admin", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "6281@s.whatsapp.net",
    targetJid: "6283@s.whatsapp.net",
    botIsAdmin: false,
    senderIsAdmin: true,
    targetIsAdmin: false,
  });

  await assert.rejects(
    () => service.promote(createMentionContext(socket, "promote", "6283@s.whatsapp.net")),
    /Bot harus menjadi admin/,
  );
});

void test("ManualModerationService demote rejects super owner target", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "6281@s.whatsapp.net",
    targetJid: "62895366009208@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: true,
  });

  await assert.rejects(
    () => service.demote(createMentionContext(socket, "demote", "62895366009208@s.whatsapp.net")),
    /Target adalah user yang dilindungi/,
  );
});

void test("ManualModerationService demote rejects tenant owner from regular admin", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "6281@s.whatsapp.net",
    targetJid: "6282@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: true,
    tenantOwnerJid: "6282@s.whatsapp.net",
  });

  await assert.rejects(
    () => service.demote(createMentionContext(socket, "demote", "6282@s.whatsapp.net")),
    /Target adalah user yang dilindungi/,
  );
});

void test("ManualModerationService demote rejects tenant owner from super owner", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "62895366009208@s.whatsapp.net",
    targetJid: "6282@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: true,
    tenantOwnerJid: "6282@s.whatsapp.net",
  });

  await assert.rejects(
    () => service.demote(createMentionContext(socket, "demote", "6282@s.whatsapp.net")),
    /Target adalah user yang dilindungi/,
  );
});

void test("ManualModerationService demote succeeds for regular admin when allowed", async () => {
  const { service, socket } = await createManualModerationService({
    senderJid: "6282@s.whatsapp.net",
    targetJid: "6283@s.whatsapp.net",
    senderIsAdmin: true,
    targetIsAdmin: true,
    tenantOwnerJid: "6282@s.whatsapp.net",
  });

  const result = await service.demote(
    createMentionContext(socket, "demote", "6283@s.whatsapp.net"),
  );

  assert.equal(result, "[ADMIN] User berhasil diturunkan dari admin.");
  assert.deepEqual(socket.actions, [{ action: "demote", participant: "6283@s.whatsapp.net" }]);
});

async function createManualModerationService(options: {
  senderJid: string;
  targetJid: string;
  targetPhoneJid?: string;
  targetLid?: string;
  botIsAdmin?: boolean;
  senderIsAdmin: boolean;
  targetIsAdmin: boolean;
  tenantOwnerJid?: string;
}): Promise<{ service: ManualModerationTestService; socket: TestSocket }> {
  const { ManualModerationService } =
    await import("../src/services/moderation/manualModeration.service");
  const { ModerationGuard } = await import("../src/guards/moderationGuard");
  const guard = new ModerationGuard({
    exists: () => Promise.resolve(false),
  } as never);
  const socket = createSocket(options);

  return {
    service: new ManualModerationService(guard),
    socket,
  };
}

interface ManualModerationTestService {
  kick(context: CommandContext): Promise<string>;
  add(context: CommandContext): Promise<string>;
  promote(context: CommandContext): Promise<string>;
  demote(context: CommandContext): Promise<string>;
}

interface TestSocket extends WASocket {
  actions: { action: string; participant: string }[];
  actorJid: string;
  tenantOwnerJid: string;
}

function createSocket(options: {
  senderJid: string;
  targetJid: string;
  targetPhoneJid?: string;
  targetLid?: string;
  botIsAdmin?: boolean;
  senderIsAdmin: boolean;
  targetIsAdmin: boolean;
  tenantOwnerJid?: string;
}): TestSocket {
  const actions: { action: string; participant: string }[] = [];

  return {
    user: {
      id: "999@s.whatsapp.net",
    },
    actions,
    actorJid: options.senderJid,
    tenantOwnerJid: options.tenantOwnerJid ?? "6282@s.whatsapp.net",
    groupMetadata: () =>
      Promise.resolve({
        id: "120@g.us",
        subject: "Grup Test",
        participants: [
          {
            id: "999@s.whatsapp.net",
            admin: options.botIsAdmin === false ? null : "admin",
          },
          {
            id: options.senderJid,
            admin: options.senderIsAdmin ? "admin" : null,
          },
          {
            id: options.targetJid,
            jid: options.targetPhoneJid,
            lid: options.targetLid,
            admin: options.targetIsAdmin ? "admin" : null,
          },
        ],
      }),
    groupParticipantsUpdate: (_jid: string, participants: string[], action: string) => {
      actions.push(...participants.map((participant) => ({ action, participant })));
      return Promise.resolve([]);
    },
  } as unknown as TestSocket;
}

function createMentionContext(
  socket: WASocket,
  commandName: string,
  targetJid: string,
): CommandContext {
  return createContext(socket, commandName, {
    args: [],
    mentionedJids: [targetJid],
  });
}

function createArgsContext(socket: WASocket, commandName: string, args: string[]): CommandContext {
  return createContext(socket, commandName, {
    args,
    mentionedJids: [],
  });
}

function createContext(
  socket: WASocket,
  commandName: string,
  overrides: {
    args: string[];
    mentionedJids: string[];
  },
): CommandContext {
  const testSocket = socket as TestSocket;

  return {
    socket,
    message: {
      key: {
        remoteJid: "120@g.us",
        participant: testSocket.actorJid,
        fromMe: false,
      },
      message: {
        conversation: `.${commandName}`,
      },
    },
    chatJid: "120@g.us",
    senderJid: testSocket.actorJid,
    senderUserJid: testSocket.actorJid,
    senderAltJids: [testSocket.actorJid],
    isGroup: true,
    commandName,
    args: overrides.args,
    argsText: overrides.args.join(" "),
    text: `.${commandName}`,
    mentionedJids: overrides.mentionedJids,
    role: "TENANT_ADMIN",
    tenantGroup: createTenantGroup(testSocket.tenantOwnerJid),
    reply: () => Promise.resolve(undefined),
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
