import assert from "node:assert/strict";
import test from "node:test";
import type { TenantFeatureSetting, TenantGroup } from "@prisma/client";
import { TenantStatus } from "@prisma/client";
import type { proto, WAMessage, WASocket } from "@whiskeysockets/baileys";

import { AntiDeleteService } from "../src/services/moderation/antiDelete.service";
import { AntiViewOnceService } from "../src/services/moderation/antiViewOnce.service";
import { TagAllService } from "../src/services/tagall/tagAll.service";
import type { CommandContext } from "../src/types/command";

// ─────────────────────────────────────────────────────────────────────────────
// 1. HideTag Tests
// ─────────────────────────────────────────────────────────────────────────────

void test("HideTag: rejects execution when not called in a group", async () => {
  const service = new TagAllService();
  const context = {
    isGroup: false,
    chatJid: "628123456@s.whatsapp.net",
    role: "TENANT_OWNER",
  } as unknown as CommandContext;

  await assert.rejects(
    async () => {
      await service.sendHideTag(context, "Pengumuman penting");
    },
    {
      message: "Command ini hanya bisa digunakan di grup.",
    },
  );
});

void test("HideTag: rejects execution when caller is regular member", async () => {
  const service = new TagAllService();
  const context = {
    isGroup: true,
    chatJid: "120363001@g.us",
    role: "MEMBER",
  } as unknown as CommandContext;

  await assert.rejects(
    async () => {
      await service.sendHideTag(context, "Pengumuman penting");
    },
    {
      message: "Command ini hanya bisa digunakan oleh owner atau admin tenant.",
    },
  );
});

void test("HideTag: rejects execution with empty message", async () => {
  const service = new TagAllService();
  const context = {
    isGroup: true,
    chatJid: "120363001@g.us",
    role: "TENANT_OWNER",
  } as unknown as CommandContext;

  await assert.rejects(
    async () => {
      await service.sendHideTag(context, "    ");
    },
    {
      message: "Format command salah.\nGunakan: .hidetag <pesan pengumuman>",
    },
  );
});

void test("HideTag: sends announcement message with invisible mentions of all participants", async () => {
  let sentMessagePayload: any = null;

  const mockSocket = {
    groupMetadata: async () => ({
      id: "120363001@g.us",
      subject: "Test Group",
      participants: [
        { id: "628111@s.whatsapp.net" },
        { id: "628222@s.whatsapp.net" },
        { id: "628333@s.whatsapp.net" },
      ],
    }),
    sendMessage: async (_jid: string, payload: any) => {
      sentMessagePayload = payload;
      return {};
    },
  } as unknown as WASocket;

  const mockSettingRepo = {
    ensureForGroup: async () => ({
      tagAllCooldownSec: 0,
    }),
  };

  const service = new TagAllService(mockSettingRepo as any);
  const context = {
    isGroup: true,
    chatJid: "120363001@g.us",
    role: "TENANT_OWNER",
    socket: mockSocket,
    message: {},
  } as unknown as CommandContext;

  const result = await service.sendHideTag(context, "Rapat jam 8 malam!");

  assert.equal(result.mentionedCount, 3);
  assert.ok(sentMessagePayload !== null);
  assert.ok(sentMessagePayload.text.includes("📢 *[ PENGUMUMAN ]*"));
  assert.ok(sentMessagePayload.text.includes("Rapat jam 8 malam!"));
  assert.deepEqual(sentMessagePayload.mentions, [
    "628111@s.whatsapp.net",
    "628222@s.whatsapp.net",
    "628333@s.whatsapp.net",
  ]);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. AntiDelete Tests
// ─────────────────────────────────────────────────────────────────────────────

void test("AntiDelete: parseAntiDeleteToggle parses 'on' and 'off' correctly", () => {
  const service = new AntiDeleteService();
  assert.equal(service.parseAntiDeleteToggle("on"), true);
  assert.equal(service.parseAntiDeleteToggle("ON"), true);
  assert.equal(service.parseAntiDeleteToggle("off"), false);
  assert.equal(service.parseAntiDeleteToggle("OFF"), false);
  assert.throws(() => service.parseAntiDeleteToggle("invalid"), {
    message: "Status antidelete harus on atau off.",
  });
});

void test("AntiDelete: caches incoming message and restores it upon revoke", async () => {
  const sentMessages: { jid: string; content: any }[] = [];

  const mockSocket = {
    sendMessage: async (jid: string, content: any) => {
      sentMessages.push({ jid, content });
      return {};
    },
  } as unknown as WASocket;

  const mockTenantGroup: TenantGroup = {
    id: "tenant-1",
    groupJid: "120363001@g.us",
    tenantCode: "MNJ001",
    name: "Test Group",
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
    antiViewOnceEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockGroupRepo = {
    findByGroupJid: async () => mockTenantGroup,
  };
  const mockFeatureRepo = {
    findByGroupJid: async () => mockFeatureSetting,
  };

  const service = new AntiDeleteService(mockGroupRepo as any, mockFeatureRepo as any);

  // 1. Cache incoming message
  const originalMsg: WAMessage = {
    key: {
      remoteJid: "120363001@g.us",
      id: "MSG_TO_BE_DELETED_123",
      participant: "62812345678@s.whatsapp.net",
      fromMe: false,
    },
    message: {
      conversation: "rahasia perusahaan jangan disebar",
    },
  };

  await service.cacheMessage(originalMsg);

  // 2. Simulate revoke event
  const revokeKey: proto.IMessageKey = {
    remoteJid: "120363001@g.us",
    id: "MSG_TO_BE_DELETED_123",
    participant: "62812345678@s.whatsapp.net",
    fromMe: false,
  };

  await service.handleMessageRevoke(mockSocket, revokeKey);

  assert.equal(sentMessages.length, 1);
  const sent = sentMessages[0];
  assert.equal(sent.jid, "120363001@g.us");
  assert.ok(sent.content.text.includes("DETEKSI PESAN DITARIK"));
  assert.ok(sent.content.text.includes("62812345678"));
  assert.ok(sent.content.text.includes("rahasia perusahaan jangan disebar"));
  assert.deepEqual(sent.content.mentions, ["62812345678@s.whatsapp.net"]);
});

void test("AntiDelete: ignores revoke when antiDeleteEnabled is false", async () => {
  const sentMessages: any[] = [];
  const mockSocket = {
    sendMessage: async (_jid: string, content: any) => {
      sentMessages.push(content);
      return {};
    },
  } as unknown as WASocket;

  const mockTenantGroup: TenantGroup = {
    id: "tenant-1",
    groupJid: "120363001@g.us",
    tenantCode: "MNJ001",
    name: "Test Group",
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
    antiDeleteEnabled: false, // OFF!
    antiViewOnceEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockGroupRepo = {
    findByGroupJid: async () => mockTenantGroup,
  };
  const mockFeatureRepo = {
    findByGroupJid: async () => mockFeatureSetting,
  };

  const service = new AntiDeleteService(mockGroupRepo as any, mockFeatureRepo as any);

  await service.cacheMessage({
    key: {
      remoteJid: "120363001@g.us",
      id: "MSG_OFF",
      participant: "62812345678@s.whatsapp.net",
      fromMe: false,
    },
    message: { conversation: "test off" },
  });

  await service.handleMessageRevoke(mockSocket, {
    remoteJid: "120363001@g.us",
    id: "MSG_OFF",
  });

  assert.equal(sentMessages.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. AntiViewOnce Tests
// ─────────────────────────────────────────────────────────────────────────────

void test("AntiViewOnce: parseAntiViewOnceToggle parses 'on' and 'off' correctly", () => {
  const service = new AntiViewOnceService();
  assert.equal(service.parseAntiViewOnceToggle("on"), true);
  assert.equal(service.parseAntiViewOnceToggle("ON"), true);
  assert.equal(service.parseAntiViewOnceToggle("off"), false);
  assert.equal(service.parseAntiViewOnceToggle("OFF"), false);
  assert.throws(() => service.parseAntiViewOnceToggle("invalid"), {
    message: "Status antiviewonce harus on atau off.",
  });
});

void test("AntiViewOnce: ignores non-viewOnce messages", async () => {
  const service = new AntiViewOnceService();
  let called = false;

  const mockSocket = {
    sendMessage: async () => {
      called = true;
      return {};
    },
  } as unknown as WASocket;

  const normalMsg: WAMessage = {
    key: {
      remoteJid: "120363001@g.us",
      id: "NORMAL_MSG",
      participant: "62812345678@s.whatsapp.net",
      fromMe: false,
    },
    message: {
      conversation: "halo bukan view once",
    },
  };

  await service.handleViewOnce(mockSocket, normalMsg);
  assert.equal(called, false);
});
