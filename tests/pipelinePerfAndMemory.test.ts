import { test } from "node:test";
import assert from "node:assert/strict";

import { TenantStatus, type TenantGroup } from "@prisma/client";
import { TenantContextInterceptor } from "../src/bot/pipeline/interceptors/tenantContext.interceptor";
import { tenantRuntimeCacheService } from "../src/services/tenant/tenantRuntimeCache.service";
import { AntiDeleteService } from "../src/services/moderation/antiDelete.service";
import { ActivityBufferService } from "../src/services/stats/activityBuffer.service";
import type { IncomingPipelineContext } from "../src/bot/pipeline/types";

void test("TenantContextInterceptor: halts non-command message on EXPIRED tenant group", async () => {
  const expiredTenant: TenantGroup = {
    id: "tg_exp",
    groupJid: "123_expired@g.us",
    tenantCode: "EXP1",
    name: "Expired Group",
    status: TenantStatus.EXPIRED,
    ownerJid: "owner@s.whatsapp.net",
    expiresAt: new Date(Date.now() - 10000),
    isBlocked: false,
    approvedAt: new Date(),
    activatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Seed the runtime cache with expired snapshot
  tenantRuntimeCacheService.set("123_expired@g.us", {
    tenant: expiredTenant,
    featureSetting: null,
    groupSetting: null,
  });

  const interceptor = new TenantContextInterceptor();

  const context: IncomingPipelineContext = {
    remoteJid: "123_expired@g.us",
    isGroup: true,
    socket: {} as never,
    message: {
      key: {
        remoteJid: "123_expired@g.us",
        participant: "member@s.whatsapp.net",
      },
      message: {
        conversation: "halo semua apa kabar",
      },
    },
  } as unknown as IncomingPipelineContext;

  const result = await interceptor.intercept(context);
  assert.equal(result?.halt, true, "Should halt chatter on expired group");
});

void test("TenantContextInterceptor: allows valid command on EXPIRED tenant group for renew info", async () => {
  const expiredTenant: TenantGroup = {
    id: "tg_exp",
    groupJid: "123_expired@g.us",
    tenantCode: "EXP1",
    name: "Expired Group",
    status: TenantStatus.EXPIRED,
    ownerJid: "owner@s.whatsapp.net",
    expiresAt: new Date(Date.now() - 10000),
    isBlocked: false,
    approvedAt: new Date(),
    activatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  tenantRuntimeCacheService.set("123_expired@g.us", {
    tenant: expiredTenant,
    featureSetting: null,
    groupSetting: null,
  });

  const interceptor = new TenantContextInterceptor();

  const context: IncomingPipelineContext = {
    remoteJid: "123_expired@g.us",
    isGroup: true,
    socket: {} as never,
    message: {
      key: {
        remoteJid: "123_expired@g.us",
        participant: "member@s.whatsapp.net",
      },
      message: {
        conversation: ".sewa",
      },
    },
  } as unknown as IncomingPipelineContext;

  const result = await interceptor.intercept(context);
  assert.equal(result, null, "Should allow commands to proceed to command handler");
  assert.ok(context.tenantSnapshot, "Snapshot should be attached to pipeline context");
});

void test("AntiDeleteService: memory buffer tracking respects 64 MB maximum cap", () => {
  const antiDelete = new AntiDeleteService({} as never);

  // Initial state should be 0
  assert.equal(antiDelete.getCurrentMediaBytes(), 0);

  // Cache regular text message - does not consume media buffer memory
  antiDelete.cacheMessage({
    key: {
      remoteJid: "group@g.us",
      id: "msg_text_1",
      fromMe: false,
      participant: "user@s.whatsapp.net",
    },
    message: {
      conversation: "Hello world text message",
    },
  });

  assert.equal(antiDelete.getCurrentMediaBytes(), 0);
  assert.ok(antiDelete.getCurrentMediaBytes() <= 64 * 1024 * 1024);
});

void test("ActivityBufferService: batches 50 incoming messages and flushes them in bulk", async () => {
  const flushedCalls: { groupJid: string; userJid: string; count: number }[] = [];

  const mockRepo = {
    recordActivityBatch: async (groupJid: string, userJid: string, count: number) => {
      flushedCalls.push({ groupJid, userJid, count });
    },
  };

  const bufferService = new ActivityBufferService(mockRepo as never);

  // Record 50 messages across 2 users in same group
  for (let i = 0; i < 30; i++) {
    bufferService.recordMessage("grp@g.us", "userA@s.whatsapp.net");
  }
  for (let i = 0; i < 20; i++) {
    bufferService.recordMessage("grp@g.us", "userB@s.whatsapp.net");
  }

  assert.equal(bufferService.getPendingCount(), 50);

  // Flush group
  await bufferService.flushGroup("grp@g.us");

  assert.equal(bufferService.getPendingCount(), 0);
  assert.equal(flushedCalls.length, 2);

  const userA = flushedCalls.find((x) => x.userJid === "userA@s.whatsapp.net");
  const userB = flushedCalls.find((x) => x.userJid === "userB@s.whatsapp.net");

  assert.equal(userA?.count, 30);
  assert.equal(userB?.count, 20);
});
