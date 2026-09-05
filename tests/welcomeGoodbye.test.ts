import assert from "node:assert/strict";
import test from "node:test";
import type { TenantFeatureSetting, TenantGroup, TenantGroupSetting } from "@prisma/client";
import { TenantStatus } from "@prisma/client";
import type { WASocket } from "@whiskeysockets/baileys";

import {
  WelcomeService,
  DEFAULT_WELCOME_MESSAGE,
  DEFAULT_GOODBYE_MESSAGE,
} from "../src/services/welcome/welcome.service";

void test("Welcome & GoodBye Templates: Default texts match formal Opsi 2 specification", () => {
  assert.ok(DEFAULT_WELCOME_MESSAGE.includes("Selamat datang {user} di *{group}*."));
  assert.ok(DEFAULT_WELCOME_MESSAGE.includes("• Membaca dan menaati aturan di deskripsi grup"));
  assert.ok(DEFAULT_WELCOME_MESSAGE.includes("• Menjaga etika, kesopanan, dan ketertiban bersama"));
  assert.ok(DEFAULT_WELCOME_MESSAGE.includes("• Ketik *.menu* untuk mengakses perintah bot"));
  assert.ok(DEFAULT_WELCOME_MESSAGE.includes("Selamat bergabung dan selamat berdiskusi."));

  assert.ok(DEFAULT_GOODBYE_MESSAGE.includes("*[ PEMBERITAHUAN ]*"));
  assert.ok(DEFAULT_GOODBYE_MESSAGE.includes("{user} telah keluar dari *{group}*."));
  assert.ok(
    DEFAULT_GOODBYE_MESSAGE.includes(
      "Terima kasih atas kerja sama dan kebersamaannya selama ini. Sampai jumpa di lain kesempatan.",
    ),
  );
});

void test("WelcomeService: renderMessage replaces {user} and {group} placeholders", () => {
  const service = new WelcomeService();
  const mockTenant = {
    name: "Komunitas Bisnis",
  } as unknown as TenantGroup;

  const rendered = service.renderMessage(
    "Halo {user} di {group}!",
    mockTenant,
    ["6281234567890@s.whatsapp.net"],
  );

  assert.equal(rendered, "Halo @6281234567890 di Komunitas Bisnis!");
});

void test("WelcomeService: parseGoodbyeToggle accepts on/off and rejects invalid", () => {
  const service = new WelcomeService();
  assert.equal(service.parseGoodbyeToggle("on"), true);
  assert.equal(service.parseGoodbyeToggle("ON"), true);
  assert.equal(service.parseGoodbyeToggle("off"), false);
  assert.equal(service.parseGoodbyeToggle("OFF"), false);
  assert.throws(() => service.parseGoodbyeToggle("invalid"), {
    message: "Status goodbye harus on atau off.",
  });
});

void test("GoodBye Event: sends formal notice when participant is removed", async () => {
  const sentMessages: { jid: string; content: any }[] = [];
  const mockSocket = {
    user: { id: "6289999999999:1@s.whatsapp.net" },
    sendMessage: async (jid: string, content: any) => {
      sentMessages.push({ jid, content });
      return {};
    },
  } as unknown as WASocket;

  const mockTenantGroup: TenantGroup = {
    id: "tenant-1",
    groupJid: "120363001@g.us",
    tenantCode: "MNJ001",
    name: "Komunitas Kreatif",
    status: TenantStatus.ACTIVE,
    ownerJid: "628999@s.whatsapp.net",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    isBlocked: false,
    approvedAt: new Date(),
    activatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockFeatureSetting: TenantFeatureSetting = {
    id: "feature-1",
    groupJid: "120363001@g.us",
    downloaderEnabled: true,
    hdEnabled: true,
    gameEnabled: true,
    welcomeEnabled: true,
    antiLinkEnabled: true,
    antiSpamEnabled: true,
    reminderEnabled: true,
    tagAllEnabled: true,
    antiDeleteEnabled: true,
    goodbyeEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockGroupSetting: TenantGroupSetting = {
    id: "setting-1",
    groupJid: "120363001@g.us",
    welcomeMessage: null, // default
    goodbyeMessage: null, // default
    antiLinkAutoKick: false,
    antiSpamMode: "NORMAL" as any,
    tagAllCooldownSec: 600,
    remindAllCooldownSec: 600,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockGroupRepo = {
    findByGroupJid: async () => mockTenantGroup,
  };
  const mockFeatureRepo = {
    findByGroupJid: async () => mockFeatureSetting,
  };
  const mockGroupSettingRepo = {
    ensureForGroup: async () => mockGroupSetting,
  };

  const service = new WelcomeService(
    mockGroupRepo as any,
    mockFeatureRepo as any,
    mockGroupSettingRepo as any,
  );

  await service.handleParticipantsUpdate(mockSocket, {
    id: "120363001@g.us",
    action: "remove",
    participants: ["628123456789@s.whatsapp.net"],
  });

  assert.equal(sentMessages.length, 1);
  const sent = sentMessages[0];
  assert.equal(sent.jid, "120363001@g.us");
  assert.ok(sent.content.text.includes("*[ PEMBERITAHUAN ]*"));
  assert.ok(sent.content.text.includes("@628123456789"));
  assert.ok(sent.content.text.includes("telah keluar dari *Komunitas Kreatif*."));
  assert.ok(sent.content.text.includes("Terima kasih atas kerja sama dan kebersamaannya selama ini."));
  assert.deepEqual(sent.content.mentions, ["628123456789@s.whatsapp.net"]);
});

void test("GoodBye Event: ignores when goodbyeEnabled is false", async () => {
  const sentMessages: any[] = [];
  const mockSocket = {
    user: { id: "6289999999999:1@s.whatsapp.net" },
    sendMessage: async (jid: string, content: any) => {
      sentMessages.push({ jid, content });
      return {};
    },
  } as unknown as WASocket;

  const mockTenantGroup: TenantGroup = {
    id: "tenant-1",
    groupJid: "120363001@g.us",
    tenantCode: "MNJ001",
    name: "Komunitas Kreatif",
    status: TenantStatus.ACTIVE,
    ownerJid: "628999@s.whatsapp.net",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    isBlocked: false,
    approvedAt: new Date(),
    activatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockFeatureSetting: TenantFeatureSetting = {
    id: "feature-1",
    groupJid: "120363001@g.us",
    downloaderEnabled: true,
    hdEnabled: true,
    gameEnabled: true,
    welcomeEnabled: true,
    antiLinkEnabled: true,
    antiSpamEnabled: true,
    reminderEnabled: true,
    tagAllEnabled: true,
    antiDeleteEnabled: true,
    goodbyeEnabled: false, // OFF!
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockGroupRepo = { findByGroupJid: async () => mockTenantGroup };
  const mockFeatureRepo = { findByGroupJid: async () => mockFeatureSetting };
  const mockGroupSettingRepo = { ensureForGroup: async () => ({}) };

  const service = new WelcomeService(
    mockGroupRepo as any,
    mockFeatureRepo as any,
    mockGroupSettingRepo as any,
  );

  await service.handleParticipantsUpdate(mockSocket, {
    id: "120363001@g.us",
    action: "remove",
    participants: ["628123456789@s.whatsapp.net"],
  });

  assert.equal(sentMessages.length, 0);
});

void test("GoodBye Event: ignores when participant removed is the bot itself", async () => {
  const sentMessages: any[] = [];
  const mockSocket = {
    user: { id: "6289999999999@s.whatsapp.net" },
    sendMessage: async (jid: string, content: any) => {
      sentMessages.push({ jid, content });
      return {};
    },
  } as unknown as WASocket;

  const mockTenantGroup = {
    status: TenantStatus.ACTIVE,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    isBlocked: false,
  } as unknown as TenantGroup;

  const mockFeatureSetting = {
    goodbyeEnabled: true,
  } as unknown as TenantFeatureSetting;

  const mockGroupRepo = { findByGroupJid: async () => mockTenantGroup };
  const mockFeatureRepo = { findByGroupJid: async () => mockFeatureSetting };
  const mockGroupSettingRepo = { ensureForGroup: async () => ({}) };

  const service = new WelcomeService(
    mockGroupRepo as any,
    mockFeatureRepo as any,
    mockGroupSettingRepo as any,
  );

  await service.handleParticipantsUpdate(mockSocket, {
    id: "120363001@g.us",
    action: "remove",
    participants: ["6289999999999@s.whatsapp.net"], // Bot itself!
  });

  assert.equal(sentMessages.length, 0);
});
