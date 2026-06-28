import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HeavyFeatureType,
  TenantQuotaSource,
  TenantStatus,
  type TenantGroup,
  type TenantOwnerQuota,
} from "@prisma/client";

import { TenantQuotaService } from "../src/services/quota/tenantQuota.service";
import { SuperOwnerTenantService } from "../src/services/tenant/superOwnerTenant.service";

void test("TenantQuotaService reserves exactly one quota for heavy feature", async () => {
  const calls: unknown[] = [];
  const quota = createOwnerQuota(4, 1);
  const service = new TenantQuotaService({
    findByOwnerJid: () => Promise.resolve(quota),
    listAll: () => Promise.resolve([quota]),
    reserveQuota: (input) => {
      calls.push(input);
      return Promise.resolve(createOwnerQuota(3, 2));
    },
    consumeReservedQuota: () => Promise.resolve(quota),
    refundReservedQuota: () => Promise.resolve(quota),
  });

  const result = await service.reserveHeavyFeatureQuota({
    ownerJid: "6282@s.whatsapp.net",
    actorJid: "6281@s.whatsapp.net",
    groupJid: "120@g.us",
    source: TenantQuotaSource.GROUP_COMMAND,
    feature: HeavyFeatureType.HD_AI_PHOTO,
    correlationId: "job-1",
  });

  assert.equal(result.remainingQuota, 3);
  assert.deepEqual(calls, [
    {
      ownerJid: "6282@s.whatsapp.net",
      actorJid: "6281@s.whatsapp.net",
      groupJid: "120@g.us",
      amount: 1,
      source: TenantQuotaSource.GROUP_COMMAND,
      feature: HeavyFeatureType.HD_AI_PHOTO,
      correlationId: "job-1",
    },
  ]);
});

void test("SuperOwnerTenantService rejects tenant activation with negative initial quota", async () => {
  const service = new SuperOwnerTenantService();

  await assert.rejects(
    () =>
      service.activateTenant({
        selector: "MNJ001",
        ownerJid: "6282@s.whatsapp.net",
        durationText: "30d",
        initialQuota: -1,
        actorJid: "6280@s.whatsapp.net",
      }),
    /Kuota awal tidak boleh negatif/,
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

function createOwnerQuota(remainingQuota: number, reservedQuota: number): TenantOwnerQuota {
  const now = new Date();

  return {
    id: "quota-1",
    ownerJid: "6282@s.whatsapp.net",
    remainingQuota,
    reservedQuota,
    totalAddedQuota: remainingQuota + reservedQuota,
    createdAt: now,
    updatedAt: now,
  };
}
