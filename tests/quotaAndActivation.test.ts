import { test } from "node:test";
import assert from "node:assert/strict";

import { HeavyFeatureType, TenantQuotaSource, type TenantOwnerQuota } from "@prisma/client";

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
