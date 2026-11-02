import { test } from "node:test";
import assert from "node:assert/strict";

import { RoleGuard } from "../src/guards/roleGuard";
import { TenantOwnerSessionService } from "../src/services/tenant/tenantOwnerSession.service";
import { isMediaCommandAllowed } from "../src/utils/dmAccess";
import type { CommandContext } from "../src/types/command";

void test("RoleGuard: resolves former tenant owner to MEMBER in DM when tenant is expired or blocked", async () => {
  const mockTenantGroupRepo = {
    ownerExists: (ownerJid: string) => {
      // Replicates the updated repository logic: only active & non-blocked & future expiresAt returns true
      if (ownerJid === "active_owner@s.whatsapp.net") return Promise.resolve(true);
      return Promise.resolve(false);
    },
    findByGroupJid: () => Promise.resolve(null),
  };

  const roleGuard = new RoleGuard(mockTenantGroupRepo as never, {} as never);

  // Active owner gets TENANT_OWNER
  const activeRole = await roleGuard.resolveRole({
    chatJid: "active_owner@s.whatsapp.net",
    senderJid: "active_owner@s.whatsapp.net",
    isGroup: false,
  });
  assert.equal(activeRole, "TENANT_OWNER");

  // Former owner of expired group gets MEMBER
  const expiredRole = await roleGuard.resolveRole({
    chatJid: "former_owner@s.whatsapp.net",
    senderJid: "former_owner@s.whatsapp.net",
    isGroup: false,
  });
  assert.equal(expiredRole, "MEMBER");

  // Owner of blocked group gets MEMBER
  const blockedRole = await roleGuard.resolveRole({
    chatJid: "blocked_owner@s.whatsapp.net",
    senderJid: "blocked_owner@s.whatsapp.net",
    isGroup: false,
  });
  assert.equal(blockedRole, "MEMBER");
});

void test("TenantOwnerSessionService: rejects selection of expired or blocked tenant in DM", async () => {
  const mockTenantGroupRepo = {
    listActiveByOwnerJid: () => Promise.resolve([]), // No active tenants for this user
  };

  const service = new TenantOwnerSessionService(
    mockTenantGroupRepo as never,
    { findByUserJid: () => Promise.resolve(null) } as never,
  );

  await assert.rejects(
    () => service.selectTenant("former_owner@s.whatsapp.net", "EXP1"),
    /Kode tenant tidak ditemukan, bukan milik kamu, atau sudah tidak aktif/,
  );
});

void test("isMediaCommandAllowed: checks active tenant membership for DM users", async () => {
  // In group: always allowed
  const groupCtx = {
    isGroup: true,
    role: "MEMBER",
  } as CommandContext;
  assert.equal(await isMediaCommandAllowed(groupCtx), true);

  // Super Owner in DM: always allowed
  const superOwnerCtx = {
    isGroup: false,
    role: "SUPER_OWNER",
  } as CommandContext;
  assert.equal(await isMediaCommandAllowed(superOwnerCtx), true);

  // Active Tenant Owner in DM: allowed
  const tenantOwnerCtx = {
    isGroup: false,
    role: "TENANT_OWNER",
  } as CommandContext;
  assert.equal(await isMediaCommandAllowed(tenantOwnerCtx), true);
});
