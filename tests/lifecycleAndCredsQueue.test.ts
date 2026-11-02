import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/minjibot_test";
process.env.COMMAND_PREFIX = ".";
process.env.SUPER_OWNER_JIDS = "628000000101@s.whatsapp.net";
process.env.SESSION_DIR = "./sessions-test";
process.env.TEMP_DIR = "./tmp-test";
process.env.LOG_LEVEL = "silent";

import { queueSaveCreds, flushCredsQueue } from "../src/bot/subscribers";
import { ReminderService } from "../src/services/reminder/reminder.service";
import { TenantStatus, type Reminder, type TenantGroup } from "@prisma/client";

void test("queueSaveCreds: serializes 10 concurrent creds.update triggers without overlap", async () => {
  let activeWrites = 0;
  let maxConcurrentWrites = 0;
  let totalSaveCredsCalls = 0;

  const mockSaveCreds = async () => {
    activeWrites++;
    totalSaveCredsCalls++;
    maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);

    // Simulate async file I/O
    await new Promise((resolve) => setTimeout(resolve, 30));

    activeWrites--;
  };

  // Launch 10 parallel triggers
  const promises = Array.from({ length: 10 }, () => queueSaveCreds(mockSaveCreds));
  await Promise.all(promises);
  await flushCredsQueue();

  assert.equal(
    maxConcurrentWrites,
    1,
    "There should never be more than 1 concurrent saveCreds write",
  );
  assert.ok(totalSaveCredsCalls <= 10, "Total calls should be bounded");
  assert.equal(activeWrites, 0, "All writes should be completed");
});

void test("ReminderService.sendDueReminder: suppresses retry and marks completed on 403 Forbidden", async () => {
  let markSentCalledWithId: string | null = null;

  const mockReminderRepo = {
    markSent: async (id: string) => {
      markSentCalledWithId = id;
    },
  };

  const activeTenant: TenantGroup = {
    id: "tg_act",
    groupJid: "123_test@g.us",
    tenantCode: "ACT1",
    name: "Active Group",
    status: TenantStatus.ACTIVE,
    ownerJid: "owner@s.whatsapp.net",
    expiresAt: new Date(Date.now() + 86400000),
    isBlocked: false,
    approvedAt: new Date(),
    activatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTenantGroupRepo = {
    findByGroupJid: async () => activeTenant,
  };

  const service = new ReminderService(
    mockReminderRepo as never,
    mockTenantGroupRepo as never,
    {} as never,
  );

  const mockSocket = {
    sendMessage: async () => {
      // Simulate Baileys 403 Forbidden Boom error when bot kicked from group
      const error = new Error("not-authorized");
      (error as unknown as { output: { statusCode: number } }).output = { statusCode: 403 };
      throw error;
    },
  };

  const reminder: Reminder = {
    id: "rem_1",
    groupJid: "123_test@g.us",
    message: "Rapat jam 2",
    remindAt: new Date(),
    isSent: false,
    createdBy: "user@s.whatsapp.net",
    mentionAll: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    sentAt: null,
  };

  // Should NOT throw error
  await service.sendDueReminder(mockSocket as never, reminder);

  assert.equal(
    markSentCalledWithId,
    "rem_1",
    "Should mark reminder as sent when group returned 403 Forbidden",
  );
});
