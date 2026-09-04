import { test } from "node:test";
import assert from "node:assert/strict";

import { TenantPanelService } from "../src/services/tenant/tenantPanel.service";
import type { TenantAdmin, TenantFeatureSetting, TenantGroup, TenantGroupSetting } from "@prisma/client";
import type { CommandContext } from "../src/types/command";

function createMockPanelService(options?: {
  isRegisteredTenant?: boolean;
  botIsAdmin?: boolean;
}) {
  const isRegistered = options?.isRegisteredTenant ?? true;

  const tenantGroup: TenantGroup = {
    id: "tg_1",
    groupJid: "12345@g.us",
    tenantCode: "VIP001",
    name: "Komunitas Sultan",
    status: "ACTIVE",
    ownerJid: "628999@s.whatsapp.net",
    expiresAt: new Date(Date.now() + 15 * 86400000), // 15 hari lagi
    isBlocked: false,
    approvedAt: new Date(),
    activatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const feature: TenantFeatureSetting = {
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
    antiRaidEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const groupSetting: TenantGroupSetting = {
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
    antiRaidThreshold: 4,
    antiRaidWindowSec: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const tenantAdmins: TenantAdmin[] = [
    {
      id: "ta_1",
      groupJid: "12345@g.us",
      userJid: "628111@s.whatsapp.net",
      createdBy: "628999@s.whatsapp.net",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const mockTenantGroupRepo = {
    findByGroupJid: () => Promise.resolve(isRegistered ? tenantGroup : null),
  };

  const mockTenantAdminRepo = {
    listByGroupJid: () => Promise.resolve(tenantAdmins),
  };

  const mockTenantFeatureRepo = {
    ensureForGroup: () => Promise.resolve(feature),
  };

  const mockGroupSettingRepo = {
    ensureForGroup: () => Promise.resolve(groupSetting),
  };

  const service = new TenantPanelService(
    mockTenantGroupRepo as never,
    mockTenantAdminRepo as never,
    mockTenantFeatureRepo as never,
    mockGroupSettingRepo as never,
  );

  return { service };
}

function makeMockContext(overrides?: Partial<CommandContext>): CommandContext {
  return {
    socket: {
      user: { id: "628000:1@s.whatsapp.net" },
      groupMetadata: () =>
        Promise.resolve({
          id: "12345@g.us",
          subject: "Komunitas Sultan",
          participants: [
            { id: "628000@s.whatsapp.net", admin: "admin" }, // Bot is admin
            { id: "628999@s.whatsapp.net", admin: "superadmin" },
            { id: "628111@s.whatsapp.net", admin: "admin" },
          ],
        }),
    } as never,
    message: {} as never,
    chatJid: "12345@g.us",
    senderJid: "628999@s.whatsapp.net",
    senderUserJid: "628999@s.whatsapp.net",
    senderAltJids: [],
    isGroup: true,
    commandName: "panel",
    args: [],
    argsText: "",
    text: ".panel",
    mentionedJids: [],
    role: "TENANT_OWNER",
    reply: () => Promise.resolve(),
    ...overrides,
  };
}

void test("TenantPanelService: renders comprehensive SaaS panel in active tenant group", async () => {
  const { service } = createMockPanelService();
  const context = makeMockContext();

  const result = await service.renderPanel(context);

  assert.match(result.message, /MINJIBOT TENANT PANEL/);
  assert.match(result.message, /Komunitas Sultan/);
  assert.match(result.message, /VIP001/);
  assert.match(result.message, /AKTIF/);
  assert.match(result.message, /15 hari lagi/);
  assert.match(result.message, /Admin Grup/); // bot admin status
  assert.match(result.message, /Anti-Raid/);
  assert.match(result.message, /Peringatan/);
  assert.match(result.message, /PANDUAN KONTROL CEPAT/);

  // Mentions must include tenant owner and admin
  assert.ok(result.mentions.includes("628999@s.whatsapp.net"));
  assert.ok(result.mentions.includes("628111@s.whatsapp.net"));
});

void test("TenantPanelService: blocks regular member from accessing panel", async () => {
  const { service } = createMockPanelService();
  const context = makeMockContext({ role: "MEMBER" });

  await assert.rejects(
    async () => {
      await service.renderPanel(context);
    },
    {
      message: "[ERROR] Panel ini hanya dapat diakses oleh Tenant Owner, Tenant Admin, atau Super Owner.",
    },
  );
});

void test("TenantPanelService: rejects unregistered group", async () => {
  const { service } = createMockPanelService({ isRegisteredTenant: false });
  const context = makeMockContext();

  await assert.rejects(
    async () => {
      await service.renderPanel(context);
    },
    {
      message: "[ERROR] Grup ini belum terdaftar sebagai tenant MinjiBot.",
    },
  );
});
