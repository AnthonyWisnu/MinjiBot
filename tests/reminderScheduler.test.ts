import assert from "node:assert/strict";
import test from "node:test";
import { TenantStatus, type Reminder, type TenantGroup } from "@prisma/client";
import type { WASocket } from "@whiskeysockets/baileys";

import { ReminderService } from "../src/services/reminder/reminder.service";

test("ReminderService: sendDueReminder sends message and marks sent when tenant is active", async () => {
  let markedSentId = "";
  let sentMessageText = "";

  const mockReminderRepo: any = {
    markSent: async (id: string) => {
      markedSentId = id;
    },
  };

  const activeTenant: TenantGroup = {
    id: "tenant-1",
    groupJid: "group-1@g.us",
    tenantCode: "GRP1",
    name: "Active Group",
    status: TenantStatus.ACTIVE,
    expiresAt: new Date(Date.now() + 86400000),
    isBlocked: false,
    ownerJid: "owner@s.whatsapp.net",
    approvedAt: new Date(),
    activatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTenantRepo: any = {
    findByGroupJid: async () => activeTenant,
  };

  const service = new ReminderService(mockReminderRepo, mockTenantRepo, {} as any);

  const mockSocket = {
    sendMessage: async (_jid: string, content: { text: string }) => {
      sentMessageText = content.text;
    },
  } as unknown as WASocket;

  const dueReminder: Reminder = {
    id: "rem-1",
    groupJid: "group-1@g.us",
    message: "Waktunya meeting!",
    remindAt: new Date(),
    createdBy: "user@s.whatsapp.net",
    mentionAll: false,
    isSent: false,
    sentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await service.sendDueReminder(mockSocket, dueReminder);
  assert.equal(sentMessageText, "Waktunya meeting!");
  assert.equal(markedSentId, "rem-1");
});

test("ReminderService: sendDueReminder skips and marks sent when tenant is expired", async () => {
  let markedSentId = "";
  let messageSent = false;

  const mockReminderRepo: any = {
    markSent: async (id: string) => {
      markedSentId = id;
    },
  };

  const expiredTenant: TenantGroup = {
    id: "tenant-1",
    groupJid: "group-1@g.us",
    tenantCode: "GRP1",
    name: "Expired Group",
    status: TenantStatus.EXPIRED,
    expiresAt: new Date(Date.now() - 86400000),
    isBlocked: false,
    ownerJid: "owner@s.whatsapp.net",
    approvedAt: new Date(),
    activatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTenantRepo: any = {
    findByGroupJid: async () => expiredTenant,
  };

  const service = new ReminderService(mockReminderRepo, mockTenantRepo, {} as any);

  const mockSocket = {
    sendMessage: async () => {
      messageSent = true;
    },
  } as unknown as WASocket;

  const dueReminder: Reminder = {
    id: "rem-2",
    groupJid: "group-1@g.us",
    message: "Expired test reminder",
    remindAt: new Date(),
    createdBy: "user@s.whatsapp.net",
    mentionAll: false,
    isSent: false,
    sentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await service.sendDueReminder(mockSocket, dueReminder);
  assert.equal(messageSent, false);
  assert.equal(markedSentId, "rem-2");
});

test("ReminderService: sendDueReminder marks sent on 403 / forbidden error without retrying indefinitely", async () => {
  let markedSentId = "";

  const mockReminderRepo: any = {
    markSent: async (id: string) => {
      markedSentId = id;
    },
  };

  const activeTenant: TenantGroup = {
    id: "tenant-1",
    groupJid: "group-1@g.us",
    tenantCode: "GRP1",
    name: "Active Group",
    status: TenantStatus.ACTIVE,
    expiresAt: new Date(Date.now() + 86400000),
    isBlocked: false,
    ownerJid: "owner@s.whatsapp.net",
    approvedAt: new Date(),
    activatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTenantRepo: any = {
    findByGroupJid: async () => activeTenant,
  };

  const service = new ReminderService(mockReminderRepo, mockTenantRepo, {} as any);

  const mockSocket = {
    sendMessage: async () => {
      const err: any = new Error("forbidden");
      err.output = { statusCode: 403 };
      throw err;
    },
  } as unknown as WASocket;

  const dueReminder: Reminder = {
    id: "rem-3",
    groupJid: "group-1@g.us",
    message: "Forbidden reminder",
    remindAt: new Date(),
    createdBy: "user@s.whatsapp.net",
    mentionAll: false,
    isSent: false,
    sentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await service.sendDueReminder(mockSocket, dueReminder);
  assert.equal(markedSentId, "rem-3");
});
