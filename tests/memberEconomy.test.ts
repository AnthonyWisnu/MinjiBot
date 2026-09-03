import { test } from "node:test";
import assert from "node:assert/strict";

import type { GroupMemberProfile } from "@prisma/client";
import { MemberTransactionAsset, MemberTransactionType } from "@prisma/client";

import { MemberEconomyService } from "../src/services/member/memberEconomy.service";
import {
  resolveRank,
  nextRankThreshold,
  rankProgress,
} from "../src/services/member/rank.service";
import {
  DuplicateOperationError,
  InvalidAmountError,
  InsufficientPointsError,
  InsufficientLimitError,
  InsufficientReservedLimitError,
} from "../src/types/memberEconomy";

// ---- Rank resolver pure tests ----

void test("resolveRank returns Warrior for 0 XP", () => {
  assert.equal(resolveRank(0), "Warrior");
});

void test("resolveRank returns Warrior for 999 XP", () => {
  assert.equal(resolveRank(999), "Warrior");
});

void test("resolveRank returns Elite for exactly 1000 XP", () => {
  assert.equal(resolveRank(1_000), "Elite");
});

void test("resolveRank returns Elite for 4999 XP", () => {
  assert.equal(resolveRank(4_999), "Elite");
});

void test("resolveRank returns Master for exactly 5000 XP", () => {
  assert.equal(resolveRank(5_000), "Master");
});

void test("resolveRank returns Grandmaster for exactly 15000 XP", () => {
  assert.equal(resolveRank(15_000), "Grandmaster");
});

void test("resolveRank returns Epic for exactly 40000 XP", () => {
  assert.equal(resolveRank(40_000), "Epic");
});

void test("resolveRank returns Legend for exactly 100000 XP", () => {
  assert.equal(resolveRank(100_000), "Legend");
});

void test("resolveRank returns Legend for 249999 XP", () => {
  assert.equal(resolveRank(249_999), "Legend");
});

void test("resolveRank returns Mythic for exactly 250000 XP", () => {
  assert.equal(resolveRank(250_000), "Mythic");
});

void test("resolveRank returns Mythic for very high XP", () => {
  assert.equal(resolveRank(999_999_999), "Mythic");
});

void test("nextRankThreshold returns 1000 for Bronze member", () => {
  assert.equal(nextRankThreshold(500), 1_000);
});

void test("nextRankThreshold returns null for Grandmaster member", () => {
  assert.equal(nextRankThreshold(250_000), null);
});

void test("nextRankThreshold returns null for above Grandmaster", () => {
  assert.equal(nextRankThreshold(999_999), null);
});

void test("rankProgress returns correct current and next for Silver member", () => {
  const result = rankProgress(2_500);
  assert.equal(result.current, 1_500);
  assert.equal(result.threshold, 1_000);
  assert.equal(result.next, 5_000);
});

// ---- Amount validation tests ----

void test("MemberEconomyService.creditPoints throws InvalidAmountError for amount 0", async () => {
  const service = makeService({ profileResult: makeProfile() });

  await assert.rejects(
    () => service.creditPoints({ groupJid: "g@g.us", userJid: "u@s.net", amount: 0, type: "GAME_REWARD" }),
    InvalidAmountError,
  );
});

void test("MemberEconomyService.creditPoints throws InvalidAmountError for negative amount", async () => {
  const service = makeService({ profileResult: makeProfile() });

  await assert.rejects(
    () => service.creditPoints({ groupJid: "g@g.us", userJid: "u@s.net", amount: -100, type: "GAME_REWARD" }),
    InvalidAmountError,
  );
});

void test("MemberEconomyService.debitPoints throws InvalidAmountError for amount 0", async () => {
  const service = makeService({ profileResult: makeProfile() });

  await assert.rejects(
    () => service.debitPoints({ groupJid: "g@g.us", userJid: "u@s.net", amount: 0, type: "GIFT_SENT" }),
    InvalidAmountError,
  );
});

void test("MemberEconomyService.setPoints throws InvalidAmountError for negative amount", async () => {
  const service = makeService({ profileResult: makeProfile() });

  await assert.rejects(
    () => service.setPoints({ groupJid: "g@g.us", userJid: "u@s.net", amount: -1 }),
    InvalidAmountError,
  );
});

// ---- creditPoints tests ----

void test("MemberEconomyService.creditPoints calls tx.update with increment", async () => {
  const updateCalls: unknown[] = [];
  const profile = makeProfile({ pointsBalance: 100 });
  const updated = makeProfile({ pointsBalance: 250 });
  const service = makeService({ profileResult: profile, updateResult: updated, updateCalls });

  const result = await service.creditPoints({
    groupJid: "g@g.us",
    userJid: "u@s.net",
    amount: 150,
    type: "GAME_REWARD",
  });

  assert.equal(result.pointsBalance, 250);
  assert.equal(updateCalls.length, 1);
  const updateArg = updateCalls[0] as { data: { pointsBalance: { increment: number } } };
  assert.equal(updateArg.data.pointsBalance.increment, 150);
});

void test("MemberEconomyService.creditPoints creates exactly one ledger entry with correct fields", async () => {
  const createCalls: unknown[] = [];
  const profile = makeProfile({ pointsBalance: 0 });
  const updated = makeProfile({ pointsBalance: 100 });
  const service = makeService({ profileResult: profile, updateResult: updated, createCalls });

  await service.creditPoints({ groupJid: "g@g.us", userJid: "u@s.net", amount: 100, type: "DAILY_REWARD" });

  assert.equal(createCalls.length, 1);
  const ledger = createCalls[0] as {
    asset: string;
    type: string;
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
  };
  assert.equal(ledger.asset, MemberTransactionAsset.POINT);
  assert.equal(ledger.type, MemberTransactionType.DAILY_REWARD);
  assert.equal(ledger.amount, 100);
  assert.equal(ledger.balanceBefore, 0);
  assert.equal(ledger.balanceAfter, 100);
});

// ---- debitPoints tests ----

void test("MemberEconomyService.debitPoints uses updateMany with pointsBalance predicate", async () => {
  const updateManyCalls: unknown[] = [];
  const profile = makeProfile({ pointsBalance: 500 });
  const updated = makeProfile({ pointsBalance: 300 });
  const service = makeService({
    profileResult: profile,
    updateManyCount: 1,
    updateResult: updated,
    updateManyCalls,
  });

  await service.debitPoints({ groupJid: "g@g.us", userJid: "u@s.net", amount: 200, type: "GIFT_SENT" });

  assert.equal(updateManyCalls.length, 1);
  const arg = updateManyCalls[0] as {
    where: { id: string; pointsBalance: { gte: number } };
    data: { pointsBalance: { decrement: number } };
  };
  assert.equal(arg.where.pointsBalance.gte, 200);
  assert.equal(arg.data.pointsBalance.decrement, 200);
});

void test("MemberEconomyService.debitPoints throws InsufficientPointsError when updateMany count is 0", async () => {
  const profile = makeProfile({ pointsBalance: 50 });
  const service = makeService({ profileResult: profile, updateManyCount: 0 });

  await assert.rejects(
    () => service.debitPoints({ groupJid: "g@g.us", userJid: "u@s.net", amount: 200, type: "GIFT_SENT" }),
    InsufficientPointsError,
  );
});

void test("MemberEconomyService.debitPoints creates no ledger entry when insufficient balance", async () => {
  const createCalls: unknown[] = [];
  const profile = makeProfile({ pointsBalance: 50 });
  const service = makeService({ profileResult: profile, updateManyCount: 0, createCalls });

  try {
    await service.debitPoints({ groupJid: "g@g.us", userJid: "u@s.net", amount: 200, type: "GIFT_SENT" });
  } catch {
    // expected
  }
  assert.equal(createCalls.length, 0);
});

// ---- Idempotency tests ----

void test("MemberEconomyService.creditPoints throws DuplicateOperationError for repeated idempotency key", async () => {
  const existingTx = { id: "tx-existing" };
  const service = makeService({ profileResult: makeProfile(), idempotencyResult: existingTx });

  await assert.rejects(
    () => service.creditPoints({
      groupJid: "g@g.us",
      userJid: "u@s.net",
      amount: 100,
      type: "DAILY_REWARD",
      idempotencyKey: "daily:g@g.us:u@s.net:2026-09-03",
    }),
    DuplicateOperationError,
  );
});

// ---- reserveLimit tests ----

void test("MemberEconomyService.reserveLimit uses updateMany with limitBalance predicate", async () => {
  const updateManyCalls: unknown[] = [];
  const profile = makeProfile({ limitBalance: 5, reservedLimit: 0 });
  const updated = makeProfile({ limitBalance: 4, reservedLimit: 1 });
  const service = makeService({ profileResult: profile, updateManyCount: 1, updateResult: updated, updateManyCalls });

  await service.reserveLimit({
    groupJid: "g@g.us",
    userJid: "u@s.net",
    amount: 1,
    feature: "TIKTOK_DOWNLOAD",
    correlationId: "corr-1",
  });

  const arg = updateManyCalls[0] as {
    where: { id: string; limitBalance: { gte: number } };
  };
  assert.equal(arg.where.limitBalance.gte, 1);
});

void test("MemberEconomyService.reserveLimit throws InsufficientLimitError when updateMany count is 0", async () => {
  const profile = makeProfile({ limitBalance: 0 });
  const service = makeService({ profileResult: profile, updateManyCount: 0 });

  await assert.rejects(
    () => service.reserveLimit({ groupJid: "g@g.us", userJid: "u@s.net", amount: 1, feature: "TIKTOK_DOWNLOAD", correlationId: "c" }),
    InsufficientLimitError,
  );
});

// ---- consumeLimit tests ----

void test("MemberEconomyService.consumeLimit throws InsufficientReservedLimitError when no reserved", async () => {
  const profile = makeProfile({ reservedLimit: 0 });
  const service = makeService({ profileResult: profile, updateManyCount: 0 });

  await assert.rejects(
    () => service.consumeLimit({ groupJid: "g@g.us", userJid: "u@s.net", amount: 1, feature: "TIKTOK_DOWNLOAD", correlationId: "c" }),
    InsufficientReservedLimitError,
  );
});

// ---- refundLimit tests ----

void test("MemberEconomyService.refundLimit throws InsufficientReservedLimitError when no reserved", async () => {
  const profile = makeProfile({ reservedLimit: 0 });
  const service = makeService({ profileResult: profile, updateManyCount: 0 });

  await assert.rejects(
    () => service.refundLimit({ groupJid: "g@g.us", userJid: "u@s.net", amount: 1, feature: "TIKTOK_DOWNLOAD", correlationId: "c" }),
    InsufficientReservedLimitError,
  );
});

// ---- creditXp tests ----

void test("MemberEconomyService.creditXp calls tx.update with experience increment", async () => {
  const updateCalls: unknown[] = [];
  const profile = makeProfile({ experience: 0 });
  const updated = makeProfile({ experience: 50 });
  const service = makeService({ profileResult: profile, updateResult: updated, updateCalls });

  await service.creditXp({ groupJid: "g@g.us", userJid: "u@s.net", amount: 50, type: "DAILY_REWARD" });

  const arg = updateCalls[0] as { data: { experience: { increment: number } } };
  assert.equal(arg.data.experience.increment, 50);
});

// ---- recordGameResult tests ----

void test("MemberEconomyService.recordGameResult increments totalGamesPlayed and totalGamesWon when won", async () => {
  const updateCalls: unknown[] = [];
  const profile = makeProfile({ totalGamesPlayed: 5, totalGamesWon: 2 });
  const updated = makeProfile({ totalGamesPlayed: 6, totalGamesWon: 3 });
  const service = makeService({ profileResult: profile, updateResult: updated, updateCalls });

  await service.recordGameResult({ groupJid: "g@g.us", userJid: "u@s.net", won: true });

  const arg = updateCalls[0] as { data: { totalGamesPlayed: { increment: number }; totalGamesWon: { increment: number } } };
  assert.equal(arg.data.totalGamesPlayed.increment, 1);
  assert.equal(arg.data.totalGamesWon.increment, 1);
});

void test("MemberEconomyService.recordGameResult does not increment totalGamesWon when lost", async () => {
  const updateCalls: unknown[] = [];
  const profile = makeProfile();
  const updated = makeProfile({ totalGamesPlayed: 1 });
  const service = makeService({ profileResult: profile, updateResult: updated, updateCalls });

  await service.recordGameResult({ groupJid: "g@g.us", userJid: "u@s.net", won: false });

  const arg = updateCalls[0] as { data: Record<string, unknown> };
  assert.ok(!("totalGamesWon" in arg.data), "totalGamesWon should not be in update data when lost");
});

// ---- Helpers ----

function makeProfile(overrides: Partial<GroupMemberProfile> = {}): GroupMemberProfile {
  return {
    id: "profile-1",
    groupJid: "g@g.us",
    userJid: "u@s.net",
    pointsBalance: 0,
    limitBalance: 3,
    reservedLimit: 0,
    experience: 0,
    totalPointsEarned: 0,
    totalLimitsEarned: 3,
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

function makeService(opts: {
  profileResult?: GroupMemberProfile;
  updateManyCount?: number;
  updateResult?: GroupMemberProfile;
  updateManyCalls?: unknown[];
  updateCalls?: unknown[];
  createCalls?: unknown[];
  idempotencyResult?: unknown;
}): MemberEconomyService {
  const defaultProfile = makeProfile();
  const profile = opts.profileResult ?? defaultProfile;
  const updated = opts.updateResult ?? defaultProfile;

  const profileRepo = {
    findOrCreate: (
      ...args: [string, string, unknown?]
    ): Promise<GroupMemberProfile> => {
      void args;
      return Promise.resolve(profile);
    },
    findByGroupAndUser: (
      ...args: [string, string, unknown?]
    ): Promise<GroupMemberProfile | null> => {
      void args;
      return Promise.resolve(null);
    },
    findActiveByUser: (...args: [string, Date?]): Promise<GroupMemberProfile[]> => {
      void args;
      return Promise.resolve([]);
    },
  };

  const txRepo = {
    create: (data: unknown, ...args: unknown[]): Promise<object> => {
      void args;
      opts.createCalls?.push(data);
      return Promise.resolve({});
    },
    findByIdempotencyKey: (...args: [string]): Promise<object | null> => {
      void args;
      return Promise.resolve(opts.idempotencyResult ?? null);
    },
  };

  const mockTx = {
    groupMemberProfile: {
      updateMany: (args: unknown) => {
        opts.updateManyCalls?.push(args);
        return Promise.resolve({ count: opts.updateManyCount ?? 1 });
      },
      findUniqueOrThrow: (...args: unknown[]): Promise<GroupMemberProfile> => {
        void args;
        return Promise.resolve(updated);
      },
      update: (args: unknown) => {
        opts.updateCalls?.push(args);
        return Promise.resolve(updated);
      },
    },
  };

  const db = {
    $transaction: <T>(fn: (tx: typeof mockTx) => Promise<T>) => fn(mockTx),
  };

  return new MemberEconomyService(profileRepo, txRepo, db);
}
