import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TenantStatus,
  type TenantGroup,
} from "@prisma/client";

import { SuperOwnerTenantService } from "../src/services/tenant/superOwnerTenant.service";

void test("SuperOwnerTenantService rejects tenant activation without selector", async () => {
  const service = new SuperOwnerTenantService({
    listPending: () => Promise.resolve([]),
    listAll: () => Promise.resolve([]),
    listVisible: () => Promise.resolve([]),
    listRemoved: () => Promise.resolve([]),
    findByGroupJid: () => Promise.resolve(null),
    findByTenantCode: () => Promise.resolve(null),
  } as never);

  await assert.rejects(
    () =>
      service.activateTenant({
        selector: "99",
        ownerJid: "6282@s.whatsapp.net",
        durationText: "30d",
        actorJid: "6280@s.whatsapp.net",
      }),
    /pending/,
  );
});

void test("SuperOwnerTenantService listTenants default excludes removed tenants", async () => {
  const activeTenant = createTenantGroup("active-1", TenantStatus.ACTIVE);
  const removedTenant = createTenantGroup("removed-1", TenantStatus.REMOVED);
  const service = createTenantListService(
    [activeTenant],
    [activeTenant, removedTenant],
    [removedTenant],
  );

  const tenants = await service.listTenants();

  assert.deepEqual(
    tenants.map((tenant) => tenant.tenantCode),
    ["active-1"],
  );
});

void test("SuperOwnerTenantService listTenants all includes removed tenants", async () => {
  const activeTenant = createTenantGroup("active-1", TenantStatus.ACTIVE);
  const removedTenant = createTenantGroup("removed-1", TenantStatus.REMOVED);
  const service = createTenantListService(
    [activeTenant],
    [activeTenant, removedTenant],
    [removedTenant],
  );

  const tenants = await service.listTenants("all");

  assert.deepEqual(
    tenants.map((tenant) => tenant.tenantCode),
    ["active-1", "removed-1"],
  );
});

void test("SuperOwnerTenantService listTenants removed only returns removed tenants", async () => {
  const activeTenant = createTenantGroup("active-1", TenantStatus.ACTIVE);
  const removedTenant = createTenantGroup("removed-1", TenantStatus.REMOVED);
  const service = createTenantListService(
    [activeTenant],
    [activeTenant, removedTenant],
    [removedTenant],
  );

  const tenants = await service.listTenants("removed");

  assert.deepEqual(
    tenants.map((tenant) => tenant.tenantCode),
    ["removed-1"],
  );
});

void test("SuperOwnerTenantService listTenants removed returns empty list without removed tenants", async () => {
  const activeTenant = createTenantGroup("active-1", TenantStatus.ACTIVE);
  const service = createTenantListService([activeTenant], [activeTenant], []);

  const tenants = await service.listTenants("removed");

  assert.deepEqual(tenants, []);
});

function createTenantListService(
  visibleTenants: TenantGroup[],
  allTenants: TenantGroup[],
  removedTenants: TenantGroup[],
): SuperOwnerTenantService {
  return new SuperOwnerTenantService({
    listVisible: () => Promise.resolve(visibleTenants),
    listAll: () => Promise.resolve(allTenants),
    listRemoved: () => Promise.resolve(removedTenants),
  } as never);
}

function createTenantGroup(tenantCode: string, status: TenantStatus): TenantGroup {
  const now = new Date();

  return {
    id: tenantCode,
    groupJid: `${tenantCode}@g.us`,
    tenantCode,
    name: tenantCode,
    status,
    ownerJid: status === TenantStatus.REMOVED ? null : "6282@s.whatsapp.net",
    expiresAt: status === TenantStatus.REMOVED ? null : new Date(Date.now() + 86_400_000),
    isBlocked: false,
    approvedAt: now,
    activatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}
