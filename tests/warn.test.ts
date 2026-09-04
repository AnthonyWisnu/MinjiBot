import { test } from "node:test";
import assert from "node:assert/strict";

import { WarnService } from "../src/services/moderation/warn.service";
import type { GroupMemberWarning, TenantGroup, TenantGroupSetting } from "@prisma/client";
import type { CommandContext } from "../src/types/command";

function createMockService(options?: {
  initialWarnings?: GroupMemberWarning[];
  warnThreshold?: number;
  botIsAdmin?: boolean;
  targetIsAdmin?: boolean;
  targetIsProtected?: boolean;
  senderCanModerate?: boolean;
  kickedUsers?: string[];
}) {
  const warnings: GroupMemberWarning[] = options?.initialWarnings ? [...options.initialWarnings] : [];
  const kickedUsers: string[] = options?.kickedUsers ?? [];

  const mockWarnRepo = {
    create: (data: { groupJid: string; userJid: string; issuerJid: string; reason: string }) => {
      const item: GroupMemberWarning = {
        id: `warn_${String(Date.now())}_${String(Math.random())}`,
        groupJid: data.groupJid,
        userJid: data.userJid,
        issuerJid: data.issuerJid,
        reason: data.reason,
        createdAt: new Date(),
      };
      warnings.push(item);
      return Promise.resolve(item);
    },
    countActiveWarnings: (groupJid: string, userJid: string) => {
      const count = warnings.filter((w) => w.groupJid === groupJid && w.userJid === userJid).length;
      return Promise.resolve(count);
    },
    findWarnings: (groupJid: string, userJid: string) => {
      const list = warnings
        .filter((w) => w.groupJid === groupJid && w.userJid === userJid)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return Promise.resolve(list);
    },
    removeLatestWarning: (groupJid: string, userJid: string) => {
      const idx = warnings
        .map((w, i) => ({ w, i }))
        .filter(({ w }) => w.groupJid === groupJid && w.userJid === userJid)
        .sort((a, b) => b.w.createdAt.getTime() - a.w.createdAt.getTime())[0]?.i;

      if (idx !== undefined) {
        const removed = warnings.splice(idx, 1)[0] ?? null;
        return Promise.resolve(removed);
      }
      return Promise.resolve(null);
    },
    resetWarnings: (groupJid: string, userJid: string) => {
      const beforeLen = warnings.length;
      for (let i = warnings.length - 1; i >= 0; i--) {
        const w = warnings[i];
        if (w?.groupJid === groupJid && w.userJid === userJid) {
          warnings.splice(i, 1);
        }
      }
      return Promise.resolve(beforeLen - warnings.length);
    },
  };

  let currentThreshold = options?.warnThreshold ?? 3;
  const mockSettingRepo = {
    ensureForGroup: (groupJid: string) =>
      Promise.resolve({
        id: "tgs_1",
        groupJid,
        welcomeMessage: null,
        goodbyeMessage: null,
        antiLinkAutoKick: false,
        antiSpamMode: "NORMAL",
        tagAllCooldownSec: 600,
        remindAllCooldownSec: 600,
        warnThreshold: currentThreshold,
        warnAction: "KICK",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TenantGroupSetting),
    update: (groupJid: string, data: { warnThreshold?: number }) => {
      if (data.warnThreshold !== undefined) {
        currentThreshold = data.warnThreshold;
      }
      return Promise.resolve({
        id: "tgs_1",
        groupJid,
        welcomeMessage: null,
        goodbyeMessage: null,
        antiLinkAutoKick: false,
        antiSpamMode: "NORMAL",
        tagAllCooldownSec: 600,
        remindAllCooldownSec: 600,
        warnThreshold: currentThreshold,
        warnAction: "KICK",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TenantGroupSetting);
    },
  };

  const mockTenantGroupRepo = {
    findByGroupJid: (groupJid: string) =>
      Promise.resolve({
        id: "tg_1",
        groupJid,
        tenantCode: "TG1234",
        status: "ACTIVE",
        ownerJid: "628999@s.whatsapp.net",
      } as TenantGroup),
  };

  const mockGuard = {
    resolveContext: () =>
      Promise.resolve({
        botIsAdmin: options?.botIsAdmin ?? true,
        sender: {
          userJid: "628111@s.whatsapp.net",
          isSuperOwner: false,
          isTenantOwner: false,
          isTenantAdmin: true,
          isGroupAdmin: true,
          isBot: false,
        },
        target: {
          userJid: "628222@s.whatsapp.net",
          isSuperOwner: false,
          isTenantOwner: false,
          isTenantAdmin: false,
          isGroupAdmin: options?.targetIsAdmin ?? false,
          isBot: false,
        },
      }),
    isProtectedUser: () => options?.targetIsProtected ?? false,
  };

  const service = new WarnService(
    mockWarnRepo as never,
    mockSettingRepo as never,
    mockTenantGroupRepo as never,
    mockGuard as never,
  );

  return { service, warnings, kickedUsers };
}

function makeContext(overrides?: Partial<CommandContext>): CommandContext {
  return {
    socket: {
      groupMetadata: () =>
        Promise.resolve({
          id: "12345@g.us",
          subject: "Test Group",
          participants: [
            { id: "628111@s.whatsapp.net", admin: "admin" },
            { id: "628222@s.whatsapp.net", admin: null },
          ],
        }),
      groupParticipantsUpdate: (_jid: string, participants: string[], action: string) => {
        if (action === "remove") {
          return Promise.resolve([
            { status: "200", jid: participants[0] ?? "" },
          ]);
        }
        return Promise.resolve([]);
      },
    } as never,
    message: {} as never,
    chatJid: "12345@g.us",
    senderJid: "628111@s.whatsapp.net",
    senderUserJid: "628111@s.whatsapp.net",
    senderAltJids: [],
    isGroup: true,
    commandName: "warn",
    args: ["@628222", "toxic", "di", "chat"],
    argsText: "@628222 toxic di chat",
    text: ".warn @628222 toxic di chat",
    mentionedJids: ["628222@s.whatsapp.net"],
    role: "TENANT_ADMIN",
    reply: () => Promise.resolve(),
    ...overrides,
  };
}

void test("WarnService: .warn records violation and increments counter", async () => {
  const { service, warnings } = createMockService();
  const context = makeContext();

  const result = await service.warn(context);

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.reason, "toxic di chat");
  assert.match(result.message, /1 \/ 3/);
  assert.match(result.message, /toxic di chat/);
  assert.deepEqual(result.mentions, ["628222@s.whatsapp.net"]);
});

void test("WarnService: auto-kick when threshold is reached", async () => {
  let kickCalled = false;
  let kickedTarget = "";

  const initialWarnings: GroupMemberWarning[] = [
    {
      id: "w1",
      groupJid: "12345@g.us",
      userJid: "628222@s.whatsapp.net",
      issuerJid: "628111@s.whatsapp.net",
      reason: "Spam 1",
      createdAt: new Date(),
    },
    {
      id: "w2",
      groupJid: "12345@g.us",
      userJid: "628222@s.whatsapp.net",
      issuerJid: "628111@s.whatsapp.net",
      reason: "Spam 2",
      createdAt: new Date(),
    },
  ];

  const { service, warnings } = createMockService({
    initialWarnings,
    warnThreshold: 3,
    botIsAdmin: true,
  });

  const context = makeContext({
    socket: {
      groupMetadata: () =>
        Promise.resolve({
          id: "12345@g.us",
          participants: [
            { id: "628111@s.whatsapp.net", admin: "admin" },
            { id: "628222@s.whatsapp.net", admin: null },
          ],
        }),
      groupParticipantsUpdate: (_jid: string, participants: string[], action: string) => {
        if (action === "remove") {
          kickCalled = true;
          kickedTarget = participants[0] ?? "";
        }
        return Promise.resolve([]);
      },
    } as never,
    args: ["@628222", "Spam", "terakhir"],
  });

  const result = await service.warn(context);

  assert.equal(kickCalled, true);
  assert.equal(kickedTarget, "628222@s.whatsapp.net");
  assert.match(result.message, /PERINGATAN MAKSIMAL/);
  assert.match(result.message, /otomatis dikeluarkan dari grup/);
  // Warnings should be reset upon expulsion
  assert.equal(warnings.length, 0);
});

void test("WarnService: rejects warning to protected users", async () => {
  const { service } = createMockService({ targetIsProtected: true });
  const context = makeContext();

  await assert.rejects(
    async () => {
      await service.warn(context);
    },
    {
      message: "[ERROR] Tidak dapat memberikan peringatan kepada bot, owner, atau super owner.",
    },
  );
});

void test("WarnService: .unwarn removes latest warning", async () => {
  const initialWarnings: GroupMemberWarning[] = [
    {
      id: "w1",
      groupJid: "12345@g.us",
      userJid: "628222@s.whatsapp.net",
      issuerJid: "628111@s.whatsapp.net",
      reason: "Peringatan pertama",
      createdAt: new Date(Date.now() - 10000),
    },
    {
      id: "w2",
      groupJid: "12345@g.us",
      userJid: "628222@s.whatsapp.net",
      issuerJid: "628111@s.whatsapp.net",
      reason: "Peringatan kedua",
      createdAt: new Date(),
    },
  ];

  const { service, warnings } = createMockService({ initialWarnings });
  const context = makeContext({
    commandName: "unwarn",
    args: ["@628222"],
  });

  const result = await service.unwarn(context);

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.id, "w1");
  assert.match(result.message, /PERINGATAN DIBATALKAN/);
  assert.match(result.message, /1 \/ 3/);
});

void test("WarnService: .getWarns lists history and .resetWarn clears all", async () => {
  const initialWarnings: GroupMemberWarning[] = [
    {
      id: "w1",
      groupJid: "12345@g.us",
      userJid: "628222@s.whatsapp.net",
      issuerJid: "628111@s.whatsapp.net",
      reason: "Pelanggaran aturan 1",
      createdAt: new Date(),
    },
  ];

  const { service, warnings } = createMockService({ initialWarnings });
  const context = makeContext({
    commandName: "warns",
    args: ["@628222"],
  });

  const viewResult = await service.getWarns(context);
  assert.match(viewResult.message, /RIWAYAT PERINGATAN/);
  assert.match(viewResult.message, /Pelanggaran aturan 1/);

  const resetResult = await service.resetWarn(context);
  assert.match(resetResult.message, /RESET PERINGATAN/);
  assert.equal(warnings.length, 0);
});

void test("WarnService: .setWarnThreshold configures limit", async () => {
  const { service } = createMockService();
  const context = makeContext({
    commandName: "setwarn",
    args: ["5"],
  });

  const msg = await service.setWarnThreshold(context);
  assert.match(msg, /Batas peringatan grup berhasil diubah menjadi \*5\* kali/);
});
