import { test } from "node:test";
import assert from "node:assert/strict";

import { TenantStatus, type TenantAdmin, type TenantGroup } from "@prisma/client";
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

void test("TenantAdminService addTenantAdmin normalizes private phone argument", async () => {
  const { service, socket, tenantGroup, repository } = await createTenantAdminService();

  const result = await service.addTenantAdmin(
    createContext(socket, tenantGroup, {
      isGroup: false,
      role: "TENANT_OWNER",
      senderJid: "6282000000000@s.whatsapp.net",
      args: ["081234567890"],
    }),
  );

  assert.equal(result.adminJid, "6281234567890@s.whatsapp.net");
  assert.deepEqual(
    repository.admins.map((admin) => admin.userJid),
    ["6281234567890@s.whatsapp.net"],
  );
});

void test("TenantAdminService addTenantAdmin rejects private chat without selected tenant", async () => {
  const { service, socket, tenantGroup } = await createTenantAdminService({
    currentTenant: null,
  });

  await assert.rejects(
    () =>
      service.addTenantAdmin(
        createContext(socket, tenantGroup, {
          isGroup: false,
          role: "TENANT_OWNER",
          senderJid: "6282000000000@s.whatsapp.net",
          args: ["081234567890"],
        }),
      ),
    /Belum ada tenant aktif dipilih/,
  );
});

void test("TenantAdminService addTenantAdmin allows tenant owner", async () => {
  const { service, socket, tenantGroup, repository } = await createTenantAdminService();

  const result = await service.addTenantAdmin(
    createContext(socket, tenantGroup, {
      role: "TENANT_OWNER",
      senderJid: "6282000000000@s.whatsapp.net",
      args: ["6281234567890"],
    }),
  );

  assert.equal(result.adminJid, "6281234567890@s.whatsapp.net");
  assert.equal(repository.admins.length, 1);
});

void test("TenantAdminService addTenantAdmin allows super owner", async () => {
  const { service, socket, tenantGroup, repository } = await createTenantAdminService();

  const result = await service.addTenantAdmin(
    createContext(socket, tenantGroup, {
      role: "SUPER_OWNER",
      senderJid: "62895366009208@s.whatsapp.net",
      args: ["6281234567890"],
    }),
  );

  assert.equal(result.adminJid, "6281234567890@s.whatsapp.net");
  assert.equal(repository.admins.length, 1);
});

void test("TenantAdminService addTenantAdmin rejects tenant admin actor", async () => {
  const { service, socket, tenantGroup } = await createTenantAdminService();

  await assert.rejects(
    () =>
      service.addTenantAdmin(
        createContext(socket, tenantGroup, {
          role: "TENANT_ADMIN",
          senderJid: "6284000000000@s.whatsapp.net",
          args: ["6281234567890"],
        }),
      ),
    /tidak punya izin/,
  );
});

void test("TenantAdminService addTenantAdmin rejects tenant owner target", async () => {
  const { service, socket, tenantGroup } = await createTenantAdminService();

  await assert.rejects(
    () =>
      service.addTenantAdmin(
        createContext(socket, tenantGroup, {
          role: "SUPER_OWNER",
          senderJid: "62895366009208@s.whatsapp.net",
          args: ["6282000000000"],
        }),
      ),
    /Tenant owner tidak dapat dijadikan tenant admin/,
  );
});

void test("TenantAdminService addTenantAdmin rejects super owner target", async () => {
  const { service, socket, tenantGroup } = await createTenantAdminService();

  await assert.rejects(
    () =>
      service.addTenantAdmin(
        createContext(socket, tenantGroup, {
          role: "TENANT_OWNER",
          senderJid: "6282000000000@s.whatsapp.net",
          args: ["62895366009208"],
        }),
      ),
    /Super owner tidak dapat dijadikan tenant admin/,
  );
});

void test("TenantAdminService removeTenantAdmin removes existing tenant admin", async () => {
  const existingAdmin = createTenantAdmin("120@g.us", "6284000000000@s.whatsapp.net");
  const { service, socket, tenantGroup, repository } = await createTenantAdminService({
    admins: [existingAdmin],
  });

  const result = await service.removeTenantAdmin(
    createContext(socket, tenantGroup, {
      role: "TENANT_OWNER",
      senderJid: "6282000000000@s.whatsapp.net",
      args: ["6284000000000"],
    }),
  );

  assert.equal(result?.adminJid, "6284000000000@s.whatsapp.net");
  assert.equal(repository.admins.length, 0);
});

void test("TenantAdminService removeTenantAdmin returns null for non tenant admin", async () => {
  const { service, socket, tenantGroup } = await createTenantAdminService();

  const result = await service.removeTenantAdmin(
    createContext(socket, tenantGroup, {
      role: "TENANT_OWNER",
      senderJid: "6282000000000@s.whatsapp.net",
      args: ["6284000000000"],
    }),
  );

  assert.equal(result, null);
});

void test("TenantAdminService listTenantAdmins returns tenant admin list", async () => {
  const existingAdmin = createTenantAdmin("120@g.us", "6284000000000@s.whatsapp.net");
  const { service, socket, tenantGroup } = await createTenantAdminService({
    admins: [existingAdmin],
  });

  const result = await service.listTenantAdmins(
    createContext(socket, tenantGroup, {
      role: "TENANT_ADMIN",
      senderJid: "6284000000000@s.whatsapp.net",
    }),
  );

  assert.deepEqual(
    result.admins.map((admin) => admin.userJid),
    ["6284000000000@s.whatsapp.net"],
  );
});

void test("TenantAdminService addTenantAdmin stores phone JID from LID participant", async () => {
  const { service, socket, tenantGroup, repository } = await createTenantAdminService();

  const result = await service.addTenantAdmin(
    createContext(socket, tenantGroup, {
      role: "TENANT_OWNER",
      senderJid: "6282000000000@s.whatsapp.net",
      mentionedJids: ["111111@lid"],
    }),
  );

  assert.equal(result.adminJid, "6284000000000@s.whatsapp.net");
  assert.deepEqual(
    repository.admins.map((admin) => admin.userJid),
    ["6284000000000@s.whatsapp.net"],
  );
});

async function createTenantAdminService(
  options: {
    admins?: TenantAdmin[];
    currentTenant?: TenantGroup | null;
  } = {},
): Promise<{
  service: {
    addTenantAdmin(
      context: CommandContext,
    ): Promise<{ tenantGroup: TenantGroup; adminJid: string }>;
    removeTenantAdmin(
      context: CommandContext,
    ): Promise<{ tenantGroup: TenantGroup; adminJid: string } | null>;
    listTenantAdmins(
      context: CommandContext,
    ): Promise<{ tenantGroup: TenantGroup; admins: TenantAdmin[] }>;
  };
  socket: TestSocket;
  tenantGroup: TenantGroup;
  repository: TestTenantAdminRepository;
}> {
  const { TenantAdminService } = await import("../src/services/tenant/tenantAdmin.service");
  const tenantGroup = createTenantGroup();
  const repository = new TestTenantAdminRepository(options.admins ?? []);
  const currentTenant = "currentTenant" in options ? options.currentTenant : tenantGroup;
  const service = new TenantAdminService(repository as never, {
    getCurrentTenant: () =>
      Promise.resolve({
        tenantGroup: currentTenant,
        expired: false,
      }),
  });

  return {
    service,
    socket: createSocket(),
    tenantGroup,
    repository,
  };
}

class TestTenantAdminRepository {
  constructor(public admins: TenantAdmin[]) {}

  listByGroupJid(groupJid: string): Promise<TenantAdmin[]> {
    return Promise.resolve(this.admins.filter((admin) => admin.groupJid === groupJid));
  }

  find(groupJid: string, userJid: string): Promise<TenantAdmin | null> {
    return Promise.resolve(
      this.admins.find((admin) => admin.groupJid === groupJid && admin.userJid === userJid) ?? null,
    );
  }

  add(groupJid: string, userJid: string, createdBy?: string): Promise<TenantAdmin> {
    const existingAdmin = this.admins.find(
      (admin) => admin.groupJid === groupJid && admin.userJid === userJid,
    );
    if (existingAdmin) {
      return Promise.resolve(existingAdmin);
    }

    const admin = createTenantAdmin(groupJid, userJid, createdBy);
    this.admins.push(admin);

    return Promise.resolve(admin);
  }

  remove(groupJid: string, userJid: string): Promise<TenantAdmin> {
    const admin = this.admins.find(
      (item) => item.groupJid === groupJid && item.userJid === userJid,
    );
    if (!admin) {
      throw new Error("Tenant admin tidak ditemukan.");
    }

    this.admins = this.admins.filter(
      (item) => !(item.groupJid === groupJid && item.userJid === userJid),
    );

    return Promise.resolve(admin);
  }
}

interface TestSocket extends WASocket {
  sentMessages: { jid: string; content: { text?: string } }[];
}

function createSocket(): TestSocket {
  return {
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
            id: "6282000000000@s.whatsapp.net",
            admin: "admin",
          },
          {
            id: "111111@lid",
            jid: "6284000000000@s.whatsapp.net",
            lid: "111111@lid",
            admin: null,
          },
        ],
      }),
  } as unknown as TestSocket;
}

function createContext(
  socket: WASocket,
  tenantGroup: TenantGroup,
  options: {
    isGroup?: boolean;
    role: Role;
    senderJid: string;
    args?: string[];
    mentionedJids?: string[];
    quotedParticipantJid?: string;
  },
): CommandContext {
  const isGroup = options.isGroup ?? true;

  return {
    socket,
    message: {
      key: {
        remoteJid: isGroup ? "120@g.us" : options.senderJid,
        participant: isGroup ? options.senderJid : undefined,
        fromMe: false,
      },
      message: {
        conversation: ".addtenantadmin",
      },
    },
    chatJid: isGroup ? "120@g.us" : options.senderJid,
    senderJid: options.senderJid,
    senderUserJid: options.senderJid,
    senderAltJids: [options.senderJid],
    isGroup,
    commandName: "addtenantadmin",
    args: options.args ?? [],
    argsText: options.args?.join(" ") ?? "",
    text: ".addtenantadmin",
    mentionedJids: options.mentionedJids ?? [],
    role: options.role,
    tenantGroup: isGroup ? tenantGroup : undefined,
    quoted: options.quotedParticipantJid
      ? {
          id: "quoted-1",
          participantJid: options.quotedParticipantJid,
        }
      : undefined,
    reply: () => Promise.resolve(undefined),
  };
}

function createTenantGroup(): TenantGroup {
  const now = new Date();

  return {
    id: "tenant-1",
    groupJid: "120@g.us",
    tenantCode: "MNJ001",
    name: "Grup Test",
    status: TenantStatus.ACTIVE,
    ownerJid: "6282000000000@s.whatsapp.net",
    expiresAt: new Date(Date.now() + 86_400_000),
    isBlocked: false,
    approvedAt: now,
    activatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function createTenantAdmin(groupJid: string, userJid: string, createdBy?: string): TenantAdmin {
  const now = new Date();

  return {
    id: `${groupJid}:${userJid}`,
    groupJid,
    userJid,
    createdBy: createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  };
}
