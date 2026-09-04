import { test } from "node:test";
import assert from "node:assert/strict";

import { AntiRaidService } from "../src/services/moderation/antiRaid.service";
import type { TenantFeatureSetting, TenantGroup, TenantGroupSetting } from "@prisma/client";
import type { CommandContext } from "../src/types/command";

function createMockAntiRaid(options?: {
  tenantStatus?: string;
  antiRaidEnabled?: boolean;
  threshold?: number;
  windowSec?: number;
}) {
  const groupSettings: TenantGroupSetting = {
    id: "tgs_1",
    groupJid: "12345@g.us",
    welcomeMessage: null,
    goodbyeMessage: null,
    antiLinkAutoKick: false,
    antiSpamMode: "NORMAL",
    tagAllCooldownSec: 600,
    remindAllCooldownSec: 600,
    warnThreshold: 3,
    warnAction: "KICK",
    antiRaidThreshold: options?.threshold ?? 4,
    antiRaidWindowSec: options?.windowSec ?? 10,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const featureSettings: TenantFeatureSetting = {
    id: "fs_1",
    groupJid: "12345@g.us",
    downloaderEnabled: true,
    hdEnabled: true,
    gameEnabled: true,
    welcomeEnabled: true,
    antiLinkEnabled: true,
    antiSpamEnabled: true,
    reminderEnabled: true,
    tagAllEnabled: true,
    antiDeleteEnabled: true,
    antiViewOnceEnabled: true,
    goodbyeEnabled: true,
    antiRaidEnabled: options?.antiRaidEnabled ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const tenantGroup: TenantGroup = {
    id: "tg_1",
    groupJid: "12345@g.us",
    tenantCode: "TG1234",
    name: "Anti-Raid Test",
    status: (options?.tenantStatus ?? "ACTIVE") as "ACTIVE",
    ownerJid: "628999@s.whatsapp.net",
    expiresAt: new Date(Date.now() + 86400000),
    isBlocked: false,
    approvedAt: new Date(),
    activatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTenantRepo = {
    findByGroupJid: () => Promise.resolve(tenantGroup),
  };

  const mockFeatureRepo = {
    findByGroupJid: () => Promise.resolve(featureSettings),
    update: (_jid: string, data: { antiRaidEnabled?: boolean }) => {
      if (data.antiRaidEnabled !== undefined) {
        featureSettings.antiRaidEnabled = data.antiRaidEnabled;
      }
      return Promise.resolve(featureSettings);
    },
  };

  const mockSettingRepo = {
    ensureForGroup: () => Promise.resolve(groupSettings),
    update: (_jid: string, data: { antiRaidThreshold?: number; antiRaidWindowSec?: number }) => {
      if (data.antiRaidThreshold !== undefined) {
        groupSettings.antiRaidThreshold = data.antiRaidThreshold;
      }
      if (data.antiRaidWindowSec !== undefined) {
        groupSettings.antiRaidWindowSec = data.antiRaidWindowSec;
      }
      return Promise.resolve(groupSettings);
    },
  };

  const service = new AntiRaidService(
    mockTenantRepo as never,
    mockFeatureRepo as never,
    mockSettingRepo as never,
  );

  return { service, groupSettings, featureSettings };
}

function makeMockSocket() {
  const operations: string[] = [];
  const sentMessages: { jid: string; content: Record<string, unknown> }[] = [];

  const socket = {
    groupSettingUpdate: (_jid: string, setting: string) => {
      operations.push(`setting:${setting}`);
      return Promise.resolve();
    },
    groupRevokeInvite: () => {
      operations.push("revokeInvite");
      return Promise.resolve("new_code_123");
    },
    groupMetadata: () =>
      Promise.resolve({
        id: "12345@g.us",
        subject: "Anti-Raid Test",
        participants: [
          { id: "628111@s.whatsapp.net", admin: "admin" },
          { id: "628222@s.whatsapp.net", admin: null },
        ],
      }),
    sendMessage: (jid: string, content: Record<string, unknown>) => {
      sentMessages.push({ jid, content });
      return Promise.resolve({ key: { id: "MSG_ALERT" } });
    },
  };

  return { socket, operations, sentMessages };
}

void test("AntiRaidService: triggers emergency lockdown when participants surge exceeds threshold", async () => {
  const { service } = createMockAntiRaid({ threshold: 4, windowSec: 10 });
  const { socket, operations, sentMessages } = makeMockSocket();

  // 4 participants join at once
  const triggered = await service.handleParticipantsJoin(socket as never, {
    id: "12345@g.us",
    action: "add",
    participants: [
      "628101@s.whatsapp.net",
      "628102@s.whatsapp.net",
      "628103@s.whatsapp.net",
      "628104@s.whatsapp.net",
    ],
  });

  assert.equal(triggered, true);
  // Must lock group and revoke invite
  assert.ok(operations.includes("setting:announcement"));
  assert.ok(operations.includes("revokeInvite"));

  // Must send emergency alert mentioning admins and owner
  assert.equal(sentMessages.length, 1);
  const alertText = sentMessages[0]?.content.text as string;
  assert.match(alertText, /EMERGENCY ANTI-RAID LOCKDOWN/);
  assert.match(alertText, /4 member baru/);

  const mentions = sentMessages[0]?.content.mentions as string[];
  assert.ok(mentions.includes("628111@s.whatsapp.net")); // admin
  assert.ok(mentions.includes("628999@s.whatsapp.net")); // owner
});

void test("AntiRaidService: does not trigger when joins are below threshold", async () => {
  const { service } = createMockAntiRaid({ threshold: 4, windowSec: 10 });
  const { socket, operations } = makeMockSocket();

  const triggered = await service.handleParticipantsJoin(socket as never, {
    id: "12345@g.us",
    action: "add",
    participants: ["628101@s.whatsapp.net", "628102@s.whatsapp.net"],
  });

  assert.equal(triggered, false);
  assert.equal(operations.length, 0);
});

void test("AntiRaidService: ignores when feature is disabled", async () => {
  const { service } = createMockAntiRaid({ antiRaidEnabled: false, threshold: 2 });
  const { socket, operations } = makeMockSocket();

  const triggered = await service.handleParticipantsJoin(socket as never, {
    id: "12345@g.us",
    action: "add",
    participants: ["628101@s.whatsapp.net", "628102@s.whatsapp.net", "628103@s.whatsapp.net"],
  });

  assert.equal(triggered, false);
  assert.equal(operations.length, 0);
});

void test("AntiRaidService: setGroupMode unlocks and locks group chat", async () => {
  const { service } = createMockAntiRaid();
  const { socket, operations } = makeMockSocket();

  const mockContext = {
    isGroup: true,
    role: "TENANT_ADMIN",
    chatJid: "12345@g.us",
    socket,
  } as unknown as CommandContext;

  const openMsg = await service.setGroupMode(mockContext, "open");
  assert.match(openMsg, /Grup telah dibuka/);
  assert.ok(operations.includes("setting:not_announcement"));

  const closeMsg = await service.setGroupMode(mockContext, "close");
  assert.match(closeMsg, /Grup telah ditutup/);
  assert.ok(operations.includes("setting:announcement"));
});
