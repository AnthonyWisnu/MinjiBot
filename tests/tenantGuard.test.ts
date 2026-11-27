import { test } from "node:test";
import assert from "node:assert/strict";

import { TenantStatus, type TenantGroup } from "@prisma/client";

import { TenantGuard } from "../src/guards/tenantGuard";
import type { CommandContext } from "../src/types/command";

void test("TenantGuard allows active tenant command", async () => {
  const tenantGroup = createTenantGroup(TenantStatus.ACTIVE, addDays(1));
  const guard = new TenantGuard({
    findByGroupJid: () => Promise.resolve(tenantGroup),
  });

  const result = await guard.checkGroupCommandAccess(createContext("tagall"));

  assert.equal(result.allowed, true);
  assert.equal(result.tenantGroup?.groupJid, tenantGroup.groupJid);
});

void test("TenantGuard blocks normal command for pending tenant", async () => {
  const guard = new TenantGuard({
    findByGroupJid: () => Promise.resolve(createTenantGroup(TenantStatus.PENDING, null)),
  });

  const result = await guard.checkGroupCommandAccess(createContext("tagall"));

  assert.equal(result.allowed, false);
  assert.match((result as { allowed: false; message: string }).message, /belum aktif/);
});

void test("TenantGuard allows info command for expired tenant", async () => {
  const guard = new TenantGuard({
    findByGroupJid: () => Promise.resolve(createTenantGroup(TenantStatus.EXPIRED, new Date(0))),
  });

  const result = await guard.checkGroupCommandAccess(createContext("menu"));

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
    reply: () => Promise.resolve(undefined),
  } as CommandContext;
}

function createTenantGroup(status: TenantStatus, expiresAt: Date | null): TenantGroup {
  const now = new Date();

  return {
    id: "tenant-1",
    groupJid: "120@g.us",
    tenantCode: "MNJ001",
    name: "Grup Test",
    status,
    ownerJid: "6282@s.whatsapp.net",
    expiresAt,
    isBlocked: false,
    approvedAt: null,
    activatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function addDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
