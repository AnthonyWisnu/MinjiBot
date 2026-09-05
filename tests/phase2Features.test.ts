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

void test("messageRevoke.subscriber: handles WAMessageStubType.REVOKE when message is null", async () => {
  const { handleMessagesUpdate } = await import("../src/bot/subscribers/messageRevoke.subscriber");
  const { antiDeleteService } = await import("../src/services/moderation/antiDelete.service");

  let revokedKey: any = null;
  const originalHandler = antiDeleteService.handleMessageRevoke.bind(antiDeleteService);
  antiDeleteService.handleMessageRevoke = async (_socket, key) => {
    revokedKey = key;
  };

  try {
    const mockSocket = {} as unknown as WASocket;
    // Baileys standard REVOKE event: message is null, stubType is 1
    await handleMessagesUpdate(mockSocket, [
      {
        key: {
          remoteJid: "120363001@g.us",
          id: "DELETED_MSG_ID",
          participant: "628111@s.whatsapp.net",
        },
        update: {
          message: null,
          messageStubType: 1, // WAMessageStubType.REVOKE
        },
      },
    ]);

    assert.ok(revokedKey !== null);
    assert.equal(revokedKey.id, "DELETED_MSG_ID");
  } finally {
    antiDeleteService.handleMessageRevoke = originalHandler;
  }
});

void test("AntiDeleteInterceptor: triggers handleMessageRevoke on REVOKE protocol message in upsert", async () => {
  const { AntiDeleteInterceptor } = await import("../src/bot/pipeline/interceptors/antiDelete.interceptor");
  const { antiDeleteService } = await import("../src/services/moderation/antiDelete.service");

  let revokedKey: any = null;
  const originalHandler = antiDeleteService.handleMessageRevoke.bind(antiDeleteService);
  antiDeleteService.handleMessageRevoke = async (_socket, key) => {
    revokedKey = key;
  };

  try {
    const interceptor = new AntiDeleteInterceptor();
    const context: any = {
      socket: {},
      message: {
        key: { remoteJid: "120363001@g.us", id: "REVOKE_MSG_ID" },
        message: {
          protocolMessage: {
            type: 0, // REVOKE
            key: {
              remoteJid: "120363001@g.us",
              id: "TARGET_MSG_ID",
            },
          },
        },
      },
    };

    await interceptor.intercept(context);
    assert.ok(revokedKey !== null);
    assert.equal(revokedKey.id, "TARGET_MSG_ID");
  } finally {
    antiDeleteService.handleMessageRevoke = originalHandler;
  }
});

void test("AntiDelete: ignores revoke when sender is Super Owner or Tenant Owner", async () => {
  const sentMessages: any[] = [];
  const mockSocket = {
    user: { id: "628000@s.whatsapp.net" },
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
    ownerJid: "628999@s.whatsapp.net", // Tenant Owner
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

  const mockGroupRepo = { findByGroupJid: async () => mockTenantGroup };
  const mockFeatureRepo = { findByGroupJid: async () => mockFeatureSetting };
  const service = new AntiDeleteService(mockGroupRepo as any, mockFeatureRepo as any);

  // 1. Tenant Owner deletes a message -> MUST BE IGNORED
  await service.cacheMessage({
    key: {
      remoteJid: "120363001@g.us",
      id: "OWNER_MSG",
      participant: "628999@s.whatsapp.net", // Matches tenant owner
      fromMe: false,
    },
    message: { conversation: "pesan rahasia owner" },
  });

  await service.handleMessageRevoke(mockSocket, {
    remoteJid: "120363001@g.us",
    id: "OWNER_MSG",
  });

  assert.equal(sentMessages.length, 0, "Tenant owner deleted message must not be reposted");

  // 2. Super Owner deletes a message -> MUST BE IGNORED
  await service.cacheMessage({
    key: {
      remoteJid: "120363001@g.us",
      id: "SUPER_OWNER_MSG",
      participant: "62895366009208@s.whatsapp.net", // Matches super owner
      fromMe: false,
    },
    message: { conversation: "pesan rahasia super owner" },
  });

  await service.handleMessageRevoke(mockSocket, {
    remoteJid: "120363001@g.us",
    id: "SUPER_OWNER_MSG",
  });

  assert.equal(sentMessages.length, 0, "Super owner deleted message must not be reposted");
});

void test("AntiViewOnce: ignores viewOnce when sender is Super Owner or Tenant Owner", async () => {
  let called = false;
  const mockSocket = {
    user: { id: "628000@s.whatsapp.net" },
    sendMessage: async () => {
      called = true;
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

  const mockGroupRepo = { findByGroupJid: async () => mockTenantGroup };
  const mockFeatureRepo = { findByGroupJid: async () => mockFeatureSetting };
  const service = new AntiViewOnceService(mockGroupRepo as any, mockFeatureRepo as any);

  // Tenant Owner sends View Once -> MUST BE IGNORED
  const ownerViewOnce: WAMessage = {
    key: {
      remoteJid: "120363001@g.us",
      id: "VO_OWNER",
      participant: "628999@s.whatsapp.net",
      fromMe: false,
    },
    message: {
      viewOnceMessage: {
        message: {
          imageMessage: {
            url: "https://example.com/img.jpg",
          },
        },
      },
    },
  };

  await service.handleViewOnce(mockSocket, ownerViewOnce);
  assert.equal(called, false, "Tenant owner view-once must not be forwarded");
});
