import { test } from "node:test";
import assert from "node:assert/strict";

import type { GroupMemberProfile } from "@prisma/client";
import { TenantStatus } from "@prisma/client";

import { GroupMemberProfileRepository } from "../src/repositories/groupMemberProfile.repository";
import { GroupMemberTransactionRepository } from "../src/repositories/groupMemberTransaction.repository";
import { MemberTransactionAsset, MemberTransactionType } from "@prisma/client";

// Helper to build a minimal GroupMemberProfile stub
function makeProfile(overrides: Partial<GroupMemberProfile> = {}): GroupMemberProfile {
  return {
    id: "profile-1",
    groupJid: "group-1@g.us",
    userJid: "user-1@s.whatsapp.net",
    pointsBalance: 0,
    limitBalance: 10,
    reservedLimit: 0,
    experience: 0,
    totalPointsEarned: 0,
    totalLimitsEarned: 10,
    totalGamesPlayed: 0,
    totalGamesWon: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastDailyClaimAt: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

void test("GroupMemberProfileRepository.findOrCreate returns initial balances for new profile", async () => {
  const profile = makeProfile();
  const repo = new GroupMemberProfileRepository({
    groupMemberProfile: {
      upsert: () => Promise.resolve(profile),
    },
  } as never);

  const result = await repo.findOrCreate("group-1@g.us", "user-1@s.whatsapp.net");

  assert.equal(result.pointsBalance, 0);
  assert.equal(result.limitBalance, 10);
  assert.equal(result.reservedLimit, 0);
  assert.equal(result.experience, 0);
  assert.equal(result.totalLimitsEarned, 10);
});

void test("GroupMemberProfileRepository.findOrCreate is idempotent and does not reset spent balance", async () => {
  // Simulates a profile that already has spent some limits
  const existingProfile = makeProfile({ limitBalance: 1, totalPointsEarned: 500 });
  const callArgs: unknown[] = [];

  const repo = new GroupMemberProfileRepository({
    groupMemberProfile: {
      upsert: (args: unknown) => {
        callArgs.push(args);
        return Promise.resolve(existingProfile);
      },
    },
  } as never);

  const result = await repo.findOrCreate("group-1@g.us", "user-1@s.whatsapp.net");

  // Must return existing profile unchanged
  assert.equal(result.limitBalance, 1);
  assert.equal(result.totalPointsEarned, 500);

  // upsert update clause must be empty - no balance reset
  const upsertArg = callArgs[0] as { update: Record<string, unknown> };
  assert.deepEqual(upsertArg.update, {});
});

void test("GroupMemberProfileRepository.findByGroupAndUser returns null for unknown member", async () => {
  const repo = new GroupMemberProfileRepository({
    groupMemberProfile: {
      findUnique: () => Promise.resolve(null),
    },
  } as never);

  const result = await repo.findByGroupAndUser("group-1@g.us", "unknown@s.whatsapp.net");

  assert.equal(result, null);
});

void test("GroupMemberProfileRepository.findByGroupAndUser does not create profile", async () => {
  const calls: unknown[] = [];
  const repo = new GroupMemberProfileRepository({
    groupMemberProfile: {
      findUnique: (args: unknown) => {
        calls.push(args);
        return Promise.resolve(null);
      },
    },
  } as never);

  await repo.findByGroupAndUser("group-1@g.us", "user-1@s.whatsapp.net");

  // Only findUnique was called, never upsert/create
  assert.equal(calls.length, 1);
});

void test("GroupMemberProfileRepository.findActiveByUser filters by active tenant and orders by limitBalance DESC", async () => {
  const profileHighLimit = makeProfile({ id: "p1", groupJid: "group-1@g.us", limitBalance: 5 });
  const profileLowLimit = makeProfile({ id: "p2", groupJid: "group-2@g.us", limitBalance: 1 });

  const capturedArgs: unknown[] = [];
  const repo = new GroupMemberProfileRepository({
    groupMemberProfile: {
      findMany: (args: unknown) => {
        capturedArgs.push(args);
        return Promise.resolve([profileHighLimit, profileLowLimit]);
      },
    },
  } as never);

  const results = await repo.findActiveByUser("user-1@s.whatsapp.net");

  assert.equal(results.length, 2);
  // First result has highest limit
  assert.equal(results[0]?.limitBalance, 5);

  // Verify query includes active tenant filter
  const args = capturedArgs[0] as {
    where: { tenantGroup: { status: string; isBlocked: boolean } };
    orderBy: { limitBalance: string };
  };
  assert.equal(args.where.tenantGroup.status, TenantStatus.ACTIVE);
  assert.equal(args.where.tenantGroup.isBlocked, false);
  assert.equal(args.orderBy.limitBalance, "desc");
});

void test("GroupMemberProfileRepository.listTopByExperience orders by experience DESC with limit", async () => {
  const profiles = [
    makeProfile({ id: "p1", experience: 1000 }),
    makeProfile({ id: "p2", experience: 500 }),
  ];

  const capturedArgs: unknown[] = [];
  const repo = new GroupMemberProfileRepository({
    groupMemberProfile: {
      findMany: (args: unknown) => {
        capturedArgs.push(args);
        return Promise.resolve(profiles);
      },
    },
  } as never);

  await repo.listTopByExperience("group-1@g.us", 10);

  const args = capturedArgs[0] as { orderBy: { experience: string }; take: number };
  assert.equal(args.orderBy.experience, "desc");
  assert.equal(args.take, 10);
});

void test("GroupMemberProfileRepository.listTopByPoints orders by pointsBalance DESC with limit", async () => {
  const capturedArgs: unknown[] = [];
  const repo = new GroupMemberProfileRepository({
    groupMemberProfile: {
      findMany: (args: unknown) => {
        capturedArgs.push(args);
        return Promise.resolve([]);
      },
    },
  } as never);

  await repo.listTopByPoints("group-1@g.us", 10);

  const args = capturedArgs[0] as { orderBy: { pointsBalance: string }; take: number };
  assert.equal(args.orderBy.pointsBalance, "desc");
  assert.equal(args.take, 10);
});

void test("GroupMemberProfileRepository.getPositionByExperience returns 0 for non-existent profile", async () => {
  const repo = new GroupMemberProfileRepository({
    groupMemberProfile: {
      findUnique: () => Promise.resolve(null),
    },
  } as never);

  const position = await repo.getPositionByExperience("group-1@g.us", "unknown@s.whatsapp.net");

  assert.equal(position, 0);
});

void test("GroupMemberProfileRepository.getPositionByExperience returns 1 for top member", async () => {
  const profile = makeProfile({ experience: 9999 });

  const repo = new GroupMemberProfileRepository({
    groupMemberProfile: {
      findUnique: () => Promise.resolve(profile),
      count: () => Promise.resolve(0), // 0 members above this user
    },
  } as never);

  const position = await repo.getPositionByExperience("group-1@g.us", "user-1@s.whatsapp.net");

  assert.equal(position, 1);
});

void test("GroupMemberProfileRepository.getPositionByExperience returns 3 for third place", async () => {
  const profile = makeProfile({ experience: 500 });

  const repo = new GroupMemberProfileRepository({
    groupMemberProfile: {
      findUnique: () => Promise.resolve(profile),
      count: () => Promise.resolve(2), // 2 members have higher XP
    },
  } as never);

  const position = await repo.getPositionByExperience("group-1@g.us", "user-1@s.whatsapp.net");

  assert.equal(position, 3);
});

void test("GroupMemberTransactionRepository.findByIdempotencyKey returns null for unknown key", async () => {
  const repo = new GroupMemberTransactionRepository({
    groupMemberTransaction: {
      findUnique: () => Promise.resolve(null),
    },
  } as never);

  const result = await repo.findByIdempotencyKey("nonexistent-key");

  assert.equal(result, null);
});

void test("GroupMemberTransactionRepository.create passes data to Prisma correctly", async () => {
  const capturedData: unknown[] = [];
  const txRecord = {
    id: "tx-1",
    profileId: "profile-1",
    groupJid: "group-1@g.us",
    userJid: "user-1@s.whatsapp.net",
    actorJid: null,
    targetUserJid: null,
    asset: MemberTransactionAsset.POINT,
    type: MemberTransactionType.DAILY_REWARD,
    amount: 150,
    balanceBefore: 0,
    balanceAfter: 150,
    feature: null,
    correlationId: null,
    idempotencyKey: "daily:group-1@g.us:user-1@s.whatsapp.net:2026-09-03",
    note: null,
    metadata: null,
    createdAt: new Date(),
  };

  const repo = new GroupMemberTransactionRepository({
    groupMemberTransaction: {
      create: (args: { data: unknown }) => {
        capturedData.push(args.data);
        return Promise.resolve(txRecord);
      },
    },
  } as never);

  await repo.create({
    profileId: "profile-1",
    groupJid: "group-1@g.us",
    userJid: "user-1@s.whatsapp.net",
    asset: MemberTransactionAsset.POINT,
    type: MemberTransactionType.DAILY_REWARD,
    amount: 150,
    balanceBefore: 0,
    balanceAfter: 150,
    idempotencyKey: "daily:group-1@g.us:user-1@s.whatsapp.net:2026-09-03",
  });

  assert.equal(capturedData.length, 1);
  const data = capturedData[0] as { amount: number; type: string };
  assert.equal(data.amount, 150);
  assert.equal(data.type, MemberTransactionType.DAILY_REWARD);
});

void test("GroupMemberTransactionRepository.listByProfile orders by createdAt DESC", async () => {
  const capturedArgs: unknown[] = [];
  const repo = new GroupMemberTransactionRepository({
    groupMemberTransaction: {
      findMany: (args: unknown) => {
        capturedArgs.push(args);
        return Promise.resolve([]);
      },
    },
  } as never);

  await repo.listByProfile("profile-1", 20);

  const args = capturedArgs[0] as { orderBy: { createdAt: string }; take: number };
  assert.equal(args.orderBy.createdAt, "desc");
  assert.equal(args.take, 20);
});
