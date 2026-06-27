import { test } from "node:test";
import assert from "node:assert/strict";

import { TenantStatus, type TenantGroup } from "@prisma/client";
import type { WASocket } from "@whiskeysockets/baileys";

import type { CommandContext } from "../src/types/command";
import type { Role } from "../src/types/role";

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

void test("TenantOwnerTransferService allows super owner to transfer owner by mention", async () => {
  const { service, socket, tenantGroup, auditLogs } = await createTransferService();

  const result = await service.transferOwner(
    createContext(socket, tenantGroup, {
      role: "SUPER_OWNER",
      senderJid: "62895366009208@s.whatsapp.net",
      mentionedJids: ["6285@s.whatsapp.net"],
    }),
  );

  assert.equal(result.oldOwnerJid, "6282@s.whatsapp.net");
  assert.equal(result.newOwnerJid, "6285@s.whatsapp.net");
  assert.equal(tenantGroup.ownerJid, "6285@s.whatsapp.net");
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0]?.metadata.newOwnerJid, "6285@s.whatsapp.net");
});

void test("TenantOwnerTransferService allows current tenant owner to transfer owner by reply", async () => {
  const { service, socket, tenantGroup } = await createTransferService();

  const result = await service.transferOwner(
    createContext(socket, tenantGroup, {
      role: "TENANT_OWNER",
      senderJid: "6282@s.whatsapp.net",
      quotedParticipantJid: "6285@s.whatsapp.net",
    }),
  );

  assert.equal(result.newOwnerJid, "6285@s.whatsapp.net");
  assert.equal(tenantGroup.ownerJid, "6285@s.whatsapp.net");
});

void test("TenantOwnerTransferService rejects tenant admin", async () => {
  const { service, socket, tenantGroup } = await createTransferService();

  await assert.rejects(
    () =>
      service.transferOwner(
        createContext(socket, tenantGroup, {
          role: "TENANT_ADMIN",
          senderJid: "6284@s.whatsapp.net",
          mentionedJids: ["6285@s.whatsapp.net"],
        }),
      ),
    /tidak punya izin/,
  );
});

void test("TenantOwnerTransferService rejects regular group admin", async () => {
  const { service, socket, tenantGroup } = await createTransferService();

  await assert.rejects(
    () =>
      service.transferOwner(
        createContext(socket, tenantGroup, {
          role: "MEMBER",
          senderJid: "6286@s.whatsapp.net",
          mentionedJids: ["6285@s.whatsapp.net"],
        }),
      ),
    /tidak punya izin/,
  );
});

void test("TenantOwnerTransferService rejects regular member", async () => {
  const { service, socket, tenantGroup } = await createTransferService();

  await assert.rejects(
    () =>
      service.transferOwner(
        createContext(socket, tenantGroup, {
          role: "MEMBER",
          senderJid: "6287@s.whatsapp.net",
          mentionedJids: ["6285@s.whatsapp.net"],
        }),
      ),
    /tidak punya izin/,
  );
});

void test("TenantOwnerTransferService rejects empty target", async () => {
  const { service, socket, tenantGroup } = await createTransferService();

  await assert.rejects(
    () =>
      service.transferOwner(
        createContext(socket, tenantGroup, {
          role: "SUPER_OWNER",
          senderJid: "62895366009208@s.whatsapp.net",
        }),
      ),
    /Target owner baru tidak valid/,
  );
});

void test("TenantOwnerTransferService rejects target outside group", async () => {
  const { service, socket, tenantGroup } = await createTransferService();

  await assert.rejects(
    () =>
      service.transferOwner(
        createContext(socket, tenantGroup, {
          role: "SUPER_OWNER",
          senderJid: "62895366009208@s.whatsapp.net",
          mentionedJids: ["6289@s.whatsapp.net"],
        }),
      ),
    /Target owner baru tidak valid/,
  );
});

void test("TenantOwnerTransferService rejects bot target", async () => {
  const { service, socket, tenantGroup } = await createTransferService();

  await assert.rejects(
    () =>
      service.transferOwner(
        createContext(socket, tenantGroup, {
          role: "SUPER_OWNER",
          senderJid: "62895366009208@s.whatsapp.net",
          mentionedJids: ["999@s.whatsapp.net"],
        }),
      ),
    /Bot tidak dapat dijadikan tenant owner/,
  );
});

void test("TenantOwnerTransferService rejects current owner target", async () => {
  const { service, socket, tenantGroup } = await createTransferService();

  await assert.rejects(
    () =>
      service.transferOwner(
        createContext(socket, tenantGroup, {
          role: "SUPER_OWNER",
          senderJid: "62895366009208@s.whatsapp.net",
          mentionedJids: ["6282@s.whatsapp.net"],
        }),
      ),
    /sudah menjadi tenant owner/,
  );
});

void test("TenantOwnerTransferService stores canonical phone JID for LID target", async () => {
  const { service, socket, tenantGroup } = await createTransferService();

  const result = await service.transferOwner(
    createContext(socket, tenantGroup, {
      role: "SUPER_OWNER",
      senderJid: "62895366009208@s.whatsapp.net",
      mentionedJids: ["555555@lid"],
    }),
  );

  assert.equal(result.newOwnerJid, "6285@s.whatsapp.net");
  assert.equal(tenantGroup.ownerJid, "6285@s.whatsapp.net");
});

void test("TenantOwnerTransferService updates guard ownership protection after transfer", async () => {
  const { service, socket, tenantGroup } = await createTransferService();

  await service.transferOwner(
    createContext(socket, tenantGroup, {
      role: "SUPER_OWNER",
      senderJid: "62895366009208@s.whatsapp.net",
      mentionedJids: ["6285@s.whatsapp.net"],
    }),
  );

  const { ModerationGuard } = await import("../src/guards/moderationGuard");
  const guard = new ModerationGuard({
    exists: () => Promise.resolve(false),
  } as never);
  const oldOwnerContext = await guard.resolveContext({
    socket,
    groupJid: "120@g.us",
    senderJids: ["62895366009208@s.whatsapp.net"],
    targetJids: ["6282@s.whatsapp.net"],
    tenantGroup,
  });
  const newOwnerContext = await guard.resolveContext({
    socket,
    groupJid: "120@g.us",
    senderJids: ["62895366009208@s.whatsapp.net"],
    targetJids: ["6285@s.whatsapp.net"],
    tenantGroup,
  });

  assert.equal(oldOwnerContext.target.isTenantOwner, false);
  assert.equal(newOwnerContext.target.isTenantOwner, true);
  assert.equal(guard.canKickUser(newOwnerContext).allowed, false);
  assert.equal(guard.canDemoteUser(newOwnerContext).allowed, false);
});

async function createTransferService(): Promise<{
  service: {
    transferOwner(
      context: CommandContext,
    ): Promise<{ oldOwnerJid: string | null; newOwnerJid: string }>;
  };
  socket: TestSocket;
  tenantGroup: TenantGroup;
  auditLogs: TestAuditLog[];
}> {
  const { TenantOwnerTransferService } =
    await import("../src/services/tenant/tenantOwnerTransfer.service");
  const tenantGroup = createTenantGroup("6282@s.whatsapp.net");
  const auditLogs: TestAuditLog[] = [];
  const service = new TenantOwnerTransferService(
    {
      findByGroupJid: () => Promise.resolve(tenantGroup),
      updateOwner: (_groupJid: string, ownerJid: string) => {
        tenantGroup.ownerJid = ownerJid;
        tenantGroup.updatedAt = new Date();

        return Promise.resolve(tenantGroup);
      },
    } as never,
    {
      create: (input: TestAuditLog) => {
        auditLogs.push(input);

        return Promise.resolve(input);
      },
    } as never,
  );

  return {
    service,
    socket: createSocket(),
    tenantGroup,
    auditLogs,
  };
}

interface TestSocket extends WASocket {
  sentMessages: { jid: string; content: { text?: string; delete?: unknown } }[];
}

interface TestAuditLog {
  groupJid?: string;
  actorJid?: string;
  action: unknown;
  metadata: {
    tenantCode?: string;
    oldOwnerJid?: string | null;
    newOwnerJid?: string;
  };
}

function createSocket(): TestSocket {
  const socket = {
    user: {
      id: "999@s.whatsapp.net",
    },
    sentMessages: [],
    groupMetadata: () =>
      Promise.resolve({
        id: "120@g.us",
        subject: "Grup Test",
        participants: [
          {
            id: "999@s.whatsapp.net",
            admin: "admin",
          },
          {
            id: "6282@s.whatsapp.net",
            admin: "admin",
          },
          {
            id: "6284@s.whatsapp.net",
            admin: null,
          },
          {
            id: "555555@lid",
            jid: "6285@s.whatsapp.net",
            lid: "555555@lid",
            admin: null,
          },
          {
            id: "6285@s.whatsapp.net",
            admin: null,
          },
          {
            id: "6286@s.whatsapp.net",
            admin: "admin",
          },
          {
            id: "6287@s.whatsapp.net",
            admin: null,
          },
        ],
      }),
  } as unknown as TestSocket;

  return socket;
}

function createContext(
  socket: WASocket,
  tenantGroup: TenantGroup,
  options: {
    role: Role;
    senderJid: string;
    mentionedJids?: string[];
    quotedParticipantJid?: string;
  },
): CommandContext {
  return {
    socket,
    message: {
      key: {
        remoteJid: "120@g.us",
        participant: options.senderJid,
        fromMe: false,
      },
      message: {
        conversation: ".transferowner",
      },
    },
    chatJid: "120@g.us",
    senderJid: options.senderJid,
    senderUserJid: options.senderJid,
    senderAltJids: [options.senderJid],
    isGroup: true,
    commandName: "transferowner",
    args: [],
    argsText: "",
    text: ".transferowner",
    mentionedJids: options.mentionedJids ?? [],
    role: options.role,
    tenantGroup,
    quoted: options.quotedParticipantJid
      ? {
          id: "quoted-1",
          participantJid: options.quotedParticipantJid,
        }
      : undefined,
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
