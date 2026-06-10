import { test } from "node:test";
import assert from "node:assert/strict";

import { TenantStatus, type TenantGroup } from "@prisma/client";

import { FeatureGuard } from "../src/guards/featureGuard";
import type { CommandContext } from "../src/types/command";
import type { TenantFeatureKey } from "../src/types/feature";

void test("FeatureGuard blocks mapped command when feature is disabled", async () => {
  const guard = new FeatureGuard({
    isFeatureEnabled: (_groupJid: string, feature: TenantFeatureKey) => {
      assert.equal(feature, "tagall");
      return Promise.resolve(false);
    },
  });

  const result = await guard.checkCommandFeature(createContext("tagall"));

  assert.equal(result.allowed, false);
});

void test("FeatureGuard allows command without feature mapping", async () => {
  const guard = new FeatureGuard({
    isFeatureEnabled: () => Promise.resolve(false),
  });

  const result = await guard.checkCommandFeature(createContext("menu"));

  assert.equal(result.allowed, true);
});

function createContext(commandName: string): CommandContext {
  return {
    socket: {},
    message: {},
    chatJid: "120@g.us",
    senderJid: "6281@s.whatsapp.net",
    isGroup: true,
    commandName,
    args: [],
    argsText: "",
    text: `.${commandName}`,
    role: "MEMBER",
    tenantGroup: createTenantGroup(),
    reply: () => Promise.resolve(undefined),
  } as CommandContext;
}

function createTenantGroup(): TenantGroup {
  const now = new Date();

  return {
    id: "tenant-1",
    groupJid: "120@g.us",
    tenantCode: "MNJ001",
    name: "Grup Test",
    status: TenantStatus.ACTIVE,
    ownerJid: "6282@s.whatsapp.net",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    isBlocked: false,
    approvedAt: now,
    activatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}
