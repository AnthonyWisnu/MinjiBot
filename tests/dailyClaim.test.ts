import { test } from "node:test";
import assert from "node:assert/strict";

import type { GroupMemberProfile } from "@prisma/client";

import { DailyClaimService } from "../src/services/member/dailyClaim.service";
import { LimitPurchaseService, LIMIT_PRICE_POINTS } from "../src/services/member/limitPurchase.service";
import { toWibDateKey, toYesterdayWibDateKey, isConsecutiveWibDay } from "../src/utils/wibDate";
import { DuplicateOperationError, InsufficientPointsError, InvalidAmountError } from "../src/types/memberEconomy";

// ---- WIB date helper tests ----

void test("toWibDateKey returns correct WIB date for UTC midnight", () => {
  // 2026-09-03T00:00:00Z = 2026-09-03T07:00:00 WIB
  const date = new Date("2026-09-03T00:00:00.000Z");
  assert.equal(toWibDateKey(date), "2026-09-03");
});

void test("toWibDateKey at 16:59 UTC returns same WIB day (23:59 WIB)", () => {
  const date = new Date("2026-09-03T16:59:00.000Z");
  assert.equal(toWibDateKey(date), "2026-09-03");
});

void test("toWibDateKey at 17:00 UTC returns next WIB day (00:00 WIB next day)", () => {
  const date = new Date("2026-09-03T17:00:00.000Z");
  assert.equal(toWibDateKey(date), "2026-09-04");
});

void test("toYesterdayWibDateKey returns the previous WIB date", () => {
  const date = new Date("2026-09-03T10:00:00.000Z"); // 2026-09-03 WIB
  assert.equal(toYesterdayWibDateKey(date), "2026-09-02");
});

void test("toYesterdayWibDateKey handles month boundary correctly", () => {
  const date = new Date("2026-09-01T10:00:00.000Z");
  assert.equal(toYesterdayWibDateKey(date), "2026-08-31");
});

void test("isConsecutiveWibDay returns true for consecutive WIB days", () => {
  const day1 = new Date("2026-09-02T10:00:00.000Z"); // Sep 2 WIB
  const day2 = new Date("2026-09-03T10:00:00.000Z"); // Sep 3 WIB
  assert.ok(isConsecutiveWibDay(day1, day2));
});

void test("isConsecutiveWibDay returns false for same WIB day", () => {
  const day1 = new Date("2026-09-03T08:00:00.000Z");
  const day2 = new Date("2026-09-03T10:00:00.000Z");
  assert.ok(!isConsecutiveWibDay(day1, day2));
});

void test("isConsecutiveWibDay returns false for gap of 2 days", () => {
  const day1 = new Date("2026-09-01T10:00:00.000Z");
  const day2 = new Date("2026-09-03T10:00:00.000Z");
  assert.ok(!isConsecutiveWibDay(day1, day2));
});

// ---- DailyClaimService tests ----

void test("DailyClaimService.claimDaily returns pointsGained between 100 and 300", async () => {
  const results: number[] = [];
  // Run 10 times to check range (deterministic via fixed random)
  for (const pts of [100, 150, 200, 250, 300]) {
    const service = makeDailyService({ randomPoints: pts, randomBonus: false });
    const result = await service.claimDaily("g@g.us", "u@s.net", new Date("2026-09-03T10:00:00Z"));
    results.push(result.pointsGained);
  }
  for (const pts of results) {
    assert.ok(pts >= 100 && pts <= 300, `Expected ${String(pts)} to be between 100 and 300`);
  }
});

void test("DailyClaimService.claimDaily returns xpGained = 50", async () => {
  const service = makeDailyService({ randomPoints: 150, randomBonus: false });
  const result = await service.claimDaily("g@g.us", "u@s.net", new Date("2026-09-03T10:00:00Z"));
  assert.equal(result.xpGained, 50);
});

void test("DailyClaimService.claimDaily bonus branch adds 1 limit", async () => {
  const service = makeDailyService({ randomPoints: 150, randomBonus: true });
  const result = await service.claimDaily("g@g.us", "u@s.net", new Date("2026-09-03T10:00:00Z"));
  assert.equal(result.bonusLimitGained, 1);
});

void test("DailyClaimService.claimDaily non-bonus branch adds 0 limit", async () => {
  const service = makeDailyService({ randomPoints: 150, randomBonus: false });
  const result = await service.claimDaily("g@g.us", "u@s.net", new Date("2026-09-03T10:00:00Z"));
  assert.equal(result.bonusLimitGained, 0);
});

void test("DailyClaimService.claimDaily first claim sets streak to 1", async () => {
  const service = makeDailyService({ randomPoints: 100, randomBonus: false, lastDailyClaimAt: null });
  const result = await service.claimDaily("g@g.us", "u@s.net", new Date("2026-09-03T10:00:00Z"));
  assert.equal(result.currentStreak, 1);
});

void test("DailyClaimService.claimDaily consecutive day increments streak", async () => {
  // Last claim was Sep 2 WIB, claiming on Sep 3 WIB -> streak 2
  const lastClaim = new Date("2026-09-02T10:00:00.000Z");
  const service = makeDailyService({
    randomPoints: 100,
    randomBonus: false,
    lastDailyClaimAt: lastClaim,
    currentStreak: 1,
  });
  const result = await service.claimDaily("g@g.us", "u@s.net", new Date("2026-09-03T10:00:00Z"));
  assert.equal(result.currentStreak, 2);
});

void test("DailyClaimService.claimDaily non-consecutive day resets streak to 1", async () => {
  // Last claim was Sep 1 WIB, claiming on Sep 3 WIB (skipped Sep 2) -> streak reset
  const lastClaim = new Date("2026-09-01T10:00:00.000Z");
  const service = makeDailyService({
    randomPoints: 100,
    randomBonus: false,
    lastDailyClaimAt: lastClaim,
    currentStreak: 5,
  });
  const result = await service.claimDaily("g@g.us", "u@s.net", new Date("2026-09-03T10:00:00Z"));
  assert.equal(result.currentStreak, 1);
});

void test("DailyClaimService.claimDaily throws DuplicateOperationError if already claimed today", async () => {
  // lastDailyClaimAt is Sep 3 WIB and claiming on Sep 3 WIB
  const lastClaim = new Date("2026-09-03T08:00:00.000Z");
  const service = makeDailyService({
    randomPoints: 100,
    randomBonus: false,
    lastDailyClaimAt: lastClaim,
  });
  await assert.rejects(
    () => service.claimDaily("g@g.us", "u@s.net", new Date("2026-09-03T10:00:00Z")),
    DuplicateOperationError,
  );
});

// ---- LimitPurchaseService tests ----

void test("LimitPurchaseService.buyLimit: 1 limit costs 1000 points", async () => {
  const calls: unknown[] = [];
  const service = makePurchaseService({ pointsBalance: 5000, updateManyCount: 1, updateManyCalls: calls });
  await service.buyLimit("g@g.us", "u@s.net", 1);
  const arg = calls[0] as { where: { pointsBalance: { gte: number } } };
  assert.equal(arg.where.pointsBalance.gte, LIMIT_PRICE_POINTS);
});

void test("LimitPurchaseService.buyLimit: 3 limits costs 3000 points", async () => {
  const calls: unknown[] = [];
  const service = makePurchaseService({ pointsBalance: 5000, updateManyCount: 1, updateManyCalls: calls });
  await service.buyLimit("g@g.us", "u@s.net", 3);
  const arg = calls[0] as { where: { pointsBalance: { gte: number } } };
  assert.equal(arg.where.pointsBalance.gte, 3 * LIMIT_PRICE_POINTS);
});

void test("LimitPurchaseService.buyLimit throws InsufficientPointsError when not enough points", async () => {
  const service = makePurchaseService({ pointsBalance: 500, updateManyCount: 0 });
  await assert.rejects(
    () => service.buyLimit("g@g.us", "u@s.net", 1),
    InsufficientPointsError,
  );
});

void test("LimitPurchaseService.buyLimit throws InvalidAmountError for amount 0", async () => {
  const service = makePurchaseService({ pointsBalance: 5000, updateManyCount: 1 });
  await assert.rejects(
    () => service.buyLimit("g@g.us", "u@s.net", 0),
    InvalidAmountError,
  );
});

void test("LimitPurchaseService.buyLimit throws InvalidAmountError for negative amount", async () => {
  const service = makePurchaseService({ pointsBalance: 5000, updateManyCount: 1 });
  await assert.rejects(
    () => service.buyLimit("g@g.us", "u@s.net", -1),
    InvalidAmountError,
  );
});

void test("LimitPurchaseService.buyLimit returns correct result fields", async () => {
  const service = makePurchaseService({ pointsBalance: 5000, limitBalance: 3, updateManyCount: 1 });
  const result = await service.buyLimit("g@g.us", "u@s.net", 2);
  assert.equal(result.limitsBought, 2);
  assert.equal(result.pointsSpent, 2 * LIMIT_PRICE_POINTS);
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

function makeDailyService(opts: {
  randomPoints: number;
  randomBonus: boolean;
  lastDailyClaimAt?: Date | null;
  currentStreak?: number;
}): DailyClaimService {
  const profile = makeProfile({
    lastDailyClaimAt: opts.lastDailyClaimAt ?? null,
    currentStreak: opts.currentStreak ?? 0,
    longestStreak: 0,
    pointsBalance: 100,
    limitBalance: 3,
    experience: 50,
  });

  const economyService = {
    findOrCreateProfile: (...args: unknown[]): Promise<GroupMemberProfile> => {
      void args;
      return Promise.resolve(profile);
    },
    creditPoints: (...args: unknown[]): Promise<GroupMemberProfile> => {
      void args;
      return Promise.resolve(makeProfile({ pointsBalance: profile.pointsBalance + opts.randomPoints }));
    },
    creditXp: (...args: unknown[]): Promise<GroupMemberProfile> => {
      void args;
      return Promise.resolve(makeProfile({ experience: profile.experience + 50 }));
    },
    creditLimit: (...args: unknown[]): Promise<GroupMemberProfile> => {
      void args;
      return Promise.resolve(makeProfile({ limitBalance: profile.limitBalance + 1 }));
    },
  };

  const profileRepo = {
    findOrCreate: (...args: unknown[]): Promise<GroupMemberProfile> => {
      void args;
      return Promise.resolve(profile);
    },
    updateBalances: (...args: unknown[]): Promise<GroupMemberProfile> => {
      void args;
      return Promise.resolve(profile);
    },
  };

  const random = {
    intBetween: (min: number, max: number) => { void [min, max]; return opts.randomPoints; },
    chance: (p: number) => { void p; return opts.randomBonus; },
  };

  return new DailyClaimService(
    economyService,
    profileRepo,
    random,
  );
}

function makePurchaseService(opts: {
  pointsBalance: number;
  limitBalance?: number;
  updateManyCount: number;
  updateManyCalls?: unknown[];
}): LimitPurchaseService {
  const profile = makeProfile({
    pointsBalance: opts.pointsBalance,
    limitBalance: opts.limitBalance ?? 3,
  });
  const updated = makeProfile({
    pointsBalance: opts.pointsBalance,
    limitBalance: opts.limitBalance ?? 3,
  });

  const profileRepo = {
    findOrCreate: (...args: unknown[]): Promise<GroupMemberProfile> => {
      void args;
      return Promise.resolve(profile);
    },
  };

  const txRepo = {
    create: (...args: unknown[]): Promise<object> => {
      void args;
      return Promise.resolve({});
    },
  };

  const mockTx = {
    groupMemberProfile: {
      updateMany: (args: unknown) => {
        opts.updateManyCalls?.push(args);
        return Promise.resolve({ count: opts.updateManyCount });
      },
      findUniqueOrThrow: (...args: unknown[]): Promise<GroupMemberProfile> => {
        void args;
        return Promise.resolve(updated);
      },
    },
  };

  const db = {
    $transaction: <T>(fn: (tx: typeof mockTx) => Promise<T>) => fn(mockTx),
  };

  return new LimitPurchaseService(
    profileRepo,
    txRepo,
    db,
  );
}

