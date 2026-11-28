import assert from "node:assert/strict";
import test from "node:test";
import type { GroupMemberProfile } from "@prisma/client";

import { commandRouter } from "../src/commands";
import {
  GroupMemberProfileRepository,
  INITIAL_LIMIT_BALANCE,
  INITIAL_MONEY_BALANCE,
} from "../src/repositories/groupMemberProfile.repository";
import {
  calculateReachableLevel,
  computeLevelUpRewards,
  LevelService,
  xpRequiredForLevel,
} from "../src/services/member/level.service";
import { LimitPurchaseService, LIMIT_PRICE_POINTS } from "../src/services/member/limitPurchase.service";
import {
  PeriodicCooldownError,
  PeriodicRewardService,
} from "../src/services/member/periodicReward.service";
import {
  EXCHANGE_MONEY_PER_POINT,
  WalletBankService,
} from "../src/services/member/walletBank.service";
import {
  InsufficientBankError,
  InsufficientMoneyError,
  InsufficientPointsError,
  InvalidAmountError,
} from "../src/types/memberEconomy";
import {
  formatRemainingDuration,
  formatRupiah,
  parseAmountOrAll,
  parsePositiveBigIntMoneyInput,
  parsePositiveMoneyInput,
} from "../src/utils/currency";
import { buildMemberProfile } from "./helpers/factories";

void test("Default limit & money constants and idempotent legacy top-up query", async () => {
  assert.equal(INITIAL_LIMIT_BALANCE, 100);
  assert.equal(INITIAL_MONEY_BALANCE, 500_000n);

  const calls: unknown[] = [];
  const repo = new GroupMemberProfileRepository({
    groupMemberProfile: {
      updateMany: (args: unknown) => {
        calls.push(args);
        return Promise.resolve({ count: 14 });
      },
    },
  } as never);

  const count = await repo.topUpLegacyMembersToMinimumLimit();
  assert.equal(count, 14);
  assert.deepEqual(calls[0], {
    where: {
      totalLimitsEarned: { lt: 100 },
      limitBalance: { lt: 100 },
    },
    data: {
      limitBalance: 100,
      totalLimitsEarned: 100,
    },
  });
});

void test("Currency parser & formatter handle shortcuts (k, jt, m, b, t, all) and rupiah formatting", () => {
  assert.equal(formatRupiah(25000), "Rp 25.000");
  assert.equal(formatRupiah(12_500_000n), "Rp 12.500.000");
  assert.equal(parsePositiveMoneyInput("50000"), 50_000);
  assert.equal(parsePositiveMoneyInput("50.000"), 50_000);
  assert.equal(parsePositiveMoneyInput("25k"), 25_000);
  assert.equal(parsePositiveMoneyInput("1.5jt"), 1_500_000);
  assert.equal(parsePositiveMoneyInput("2m"), 2_000_000);
  assert.equal(parsePositiveBigIntMoneyInput("5b"), 5_000_000_000n);
  assert.equal(parsePositiveBigIntMoneyInput("2.4t"), 2_400_000_000_000n);
  assert.equal(parsePositiveMoneyInput("-500"), null);
  assert.equal(parsePositiveMoneyInput("abc"), null);
  assert.equal(parseAmountOrAll("all"), "all");
  assert.equal(parseAmountOrAll("SEMUA"), "all");
  assert.equal(parseAmountOrAll("10k"), 10_000);
  assert.match(formatRemainingDuration(2 * 86_400_000 + 3 * 3_600_000), /2 hari 3 jam/);
});

void test("WalletBankService: deposit, withdraw, transfer, and exchange are atomic and validated", async () => {
  const store = new Map<string, GroupMemberProfile>([
    [
      "u1",
      buildMemberProfile({
        id: "p1",
        userJid: "628111@s.whatsapp.net",
        moneyBalance: 10_000_000n,
        bankBalance: 2_000_000n,
        pointsBalance: 50,
      }),
    ],
    [
      "u2",
      buildMemberProfile({
        id: "p2",
        userJid: "628222@s.whatsapp.net",
        moneyBalance: 1_000_000n,
        bankBalance: 0n,
      }),
    ],
  ]);

  const txRecords: unknown[] = [];
  const profileRepo = {
    findOrCreate: (_g: string, userJid: string) => {
      const found = userJid.includes("628111") ? store.get("u1") : store.get("u2");
      if (!found) throw new Error("not found");
      return Promise.resolve({ ...found });
    },
  };
  const txRepo = {
    create: (data: unknown) => {
      txRecords.push(data);
      return Promise.resolve(data);
    },
  };

  const db = {
    $transaction: <T>(fn: (tx: never) => Promise<T>) =>
      fn({
        groupMemberProfile: {
          updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            const key = args.where.id === "p1" ? "u1" : "u2";
            const prof = store.get(key);
            if (!prof) return Promise.resolve({ count: 0 });

            const moneyGuard = args.where.moneyBalance as { gte?: bigint } | undefined;
            if (moneyGuard?.gte !== undefined && prof.moneyBalance < moneyGuard.gte) {
              return Promise.resolve({ count: 0 });
            }
            const bankGuard = args.where.bankBalance as { gte?: bigint } | undefined;
            if (bankGuard?.gte !== undefined && prof.bankBalance < bankGuard.gte) {
              return Promise.resolve({ count: 0 });
            }

            const decMoney =
              (args.data.moneyBalance as { decrement?: bigint } | undefined)?.decrement ?? 0n;
            const incMoney =
              (args.data.moneyBalance as { increment?: bigint } | undefined)?.increment ?? 0n;
            const decBank =
              (args.data.bankBalance as { decrement?: bigint } | undefined)?.decrement ?? 0n;
            const incBank =
              (args.data.bankBalance as { increment?: bigint } | undefined)?.increment ?? 0n;
            const incPts =
              (args.data.pointsBalance as { increment?: number } | undefined)?.increment ?? 0;

            store.set(key, {
              ...prof,
              moneyBalance: prof.moneyBalance - decMoney + incMoney,
              bankBalance: prof.bankBalance - decBank + incBank,
              pointsBalance: prof.pointsBalance + incPts,
            });
            return Promise.resolve({ count: 1 });
          },
          findUniqueOrThrow: (args: { where: { id: string } }) => {
            const key = args.where.id === "p1" ? "u1" : "u2";
            const prof = store.get(key);
            if (!prof) throw new Error("Profile missing");
            return Promise.resolve({ ...prof });
          },
          update: (args: { where: { id: string }; data: Record<string, unknown> }) => {
            const key = args.where.id === "p1" ? "u1" : "u2";
            const prof = store.get(key);
            if (!prof) throw new Error("Profile missing");
            const incMoney =
              (args.data.moneyBalance as { increment?: bigint } | undefined)?.increment ?? 0n;
            const updated = { ...prof, moneyBalance: prof.moneyBalance + incMoney };
            store.set(key, updated);
            return Promise.resolve({ ...updated });
          },
        },
      } as never),
  };

  const service = new WalletBankService(profileRepo, txRepo, db);

  const dep = await service.depositToBank("g@g.us", "628111@s.whatsapp.net", 4_000_000n);
  assert.equal(dep.moneyBalance, 6_000_000n);
  assert.equal(dep.bankBalance, 6_000_000n);

  const wdr = await service.withdrawFromBank("g@g.us", "628111@s.whatsapp.net", "all");
  assert.equal(wdr.amount, 6_000_000n);
  assert.equal(wdr.moneyBalance, 12_000_000n);
  assert.equal(wdr.bankBalance, 0n);

  await assert.rejects(
    () => service.withdrawFromBank("g@g.us", "628111@s.whatsapp.net", 500_000n),
    InsufficientBankError,
  );

  const tf = await service.transferMoney(
    "g@g.us",
    "628111@s.whatsapp.net",
    "628222@s.whatsapp.net",
    2_000_000n,
  );
  assert.equal(tf.senderMoneyBalance, 10_000_000n);
  assert.equal(tf.targetMoneyBalance, 3_000_000n);

  await assert.rejects(
    () =>
      service.transferMoney("g@g.us", "628111@s.whatsapp.net", "628111@s.whatsapp.net", 500_000n),
    InvalidAmountError,
  );

  // Exchange 10 poin (10 * 200k = 2jt) agar cocok dengan saldo tersisa 10jt
  const ex = await service.exchangeMoneyToPoints("g@g.us", "628111@s.whatsapp.net", 10);
  assert.equal(ex.moneySpent, 10n * EXCHANGE_MONEY_PER_POINT);
  assert.equal(ex.pointsGained, 10);
  assert.equal(ex.pointsBalance, 60);
  assert.equal(ex.moneyBalance, 8_000_000n);

  await assert.rejects(
    () => service.exchangeMoneyToPoints("g@g.us", "628111@s.whatsapp.net", 999_999),
    InsufficientMoneyError,
  );

  assert.ok(txRecords.length >= 8);
});

void test("LevelService: XP thresholds and multi-level claim grant Sultan money, points, and limits", async () => {
  assert.equal(xpRequiredForLevel(1), 0);
  assert.equal(xpRequiredForLevel(2), 150);
  assert.equal(xpRequiredForLevel(3), 350);
  assert.equal(calculateReachableLevel(0), 1);
  assert.equal(calculateReachableLevel(350), 3);

  const rewards = computeLevelUpRewards(1, 3);
  assert.equal(rewards.moneyGained, 1_800_000n + 2_700_000n);
  assert.equal(rewards.pointsGained, 60);
  assert.equal(rewards.limitGained, 4);

  let currentProfile = buildMemberProfile({
    id: "p-lvl",
    level: 1,
    experience: 400,
    moneyBalance: 500_000n,
    pointsBalance: 100,
    limitBalance: 100,
  });

  const service = new LevelService(
    { findOrCreate: () => Promise.resolve({ ...currentProfile }) },
    {
      $transaction: <T>(fn: (tx: never) => Promise<T>) =>
        fn({
          groupMemberProfile: {
            updateMany: (args: { data: Record<string, unknown> }) => {
              const lvl = args.data.level as number;
              const incMoney = (args.data.moneyBalance as { increment: bigint }).increment;
              const incPts = (args.data.pointsBalance as { increment: number }).increment;
              const incLim = (args.data.limitBalance as { increment: number }).increment;
              currentProfile = {
                ...currentProfile,
                level: lvl,
                moneyBalance: currentProfile.moneyBalance + incMoney,
                pointsBalance: currentProfile.pointsBalance + incPts,
                limitBalance: currentProfile.limitBalance + incLim,
              };
              return Promise.resolve({ count: 1 });
            },
            findUniqueOrThrow: () => Promise.resolve({ ...currentProfile }),
          },
          groupMemberTransaction: {
            createMany: () => Promise.resolve({ count: 3 }),
          },
        } as never),
    },
  );

  const res = await service.claimLevelUp("g@g.us", "u@s.net");
  assert.equal(res.leveledUp, true);
  assert.equal(res.oldLevel, 1);
  assert.equal(res.newLevel, 3);
  assert.equal(res.levelsGained, 2);
  assert.equal(res.moneyGained, 4_500_000n);
  assert.equal(res.pointsGained, 60);
  assert.equal(res.limitGained, 4);

  // Second call with same XP should not level up again
  const second = await service.claimLevelUp("g@g.us", "u@s.net");
  assert.equal(second.leveledUp, false);
});

void test("PeriodicRewardService: weekly & monthly rewards enforce cooldown with Sultan scale", async () => {
  let profile = buildMemberProfile({
    id: "p-per",
    moneyBalance: 500_000n,
    pointsBalance: 100,
    limitBalance: 100,
    experience: 0,
    lastWeeklyClaimAt: null,
    lastMonthlyClaimAt: null,
  });

  const service = new PeriodicRewardService(
    { findOrCreate: () => Promise.resolve({ ...profile }) },
    { intBetween: (min) => min, chance: () => false },
    {
      $transaction: <T>(fn: (tx: never) => Promise<T>) =>
        fn({
          groupMemberProfile: {
            updateMany: (args: { data: Record<string, unknown> }) => {
              profile = {
                ...profile,
                moneyBalance:
                  profile.moneyBalance + (args.data.moneyBalance as { increment: bigint }).increment,
                pointsBalance:
                  profile.pointsBalance + (args.data.pointsBalance as { increment: number }).increment,
                limitBalance:
                  profile.limitBalance + (args.data.limitBalance as { increment: number }).increment,
                experience:
                  profile.experience + (args.data.experience as { increment: number }).increment,
                lastWeeklyClaimAt:
                  (args.data.lastWeeklyClaimAt as Date | undefined) ?? profile.lastWeeklyClaimAt,
                lastMonthlyClaimAt:
                  (args.data.lastMonthlyClaimAt as Date | undefined) ?? profile.lastMonthlyClaimAt,
              };
              return Promise.resolve({ count: 1 });
            },
            findUniqueOrThrow: () => Promise.resolve({ ...profile }),
          },
          groupMemberTransaction: {
            createMany: () => Promise.resolve({ count: 4 }),
          },
        } as never),
    },
  );

  const now = new Date("2026-11-28T05:00:00Z");
  const weekly = await service.claimWeekly("g@g.us", "u@s.net", now);
  assert.equal(weekly.moneyGained, 7_200_000n);
  assert.equal(weekly.pointsGained, 250);
  assert.equal(weekly.limitGained, 5);

  await assert.rejects(
    () => service.claimWeekly("g@g.us", "u@s.net", new Date(now.getTime() + 60_000)),
    PeriodicCooldownError,
  );

  const monthly = await service.claimMonthly("g@g.us", "u@s.net", now);
  assert.equal(monthly.moneyGained, 45_000_000n);
  assert.equal(monthly.pointsGained, 1_000);
  assert.equal(monthly.limitGained, 20);
});

void test("LimitPurchaseService.buyAllLimits buys maximum affordable limits", async () => {
  let profile = buildMemberProfile({
    id: "p-buyall",
    pointsBalance: 350,
    limitBalance: 100,
  });

  const service = new LimitPurchaseService(
    { findOrCreate: () => Promise.resolve({ ...profile }) },
    { create: () => Promise.resolve({}) },
    {
      $transaction: <T>(fn: (tx: never) => Promise<T>) =>
        fn({
          groupMemberProfile: {
            updateMany: (args: { data: Record<string, unknown> }) => {
              const dec = (args.data.pointsBalance as { decrement: number }).decrement;
              const inc = (args.data.limitBalance as { increment: number }).increment;
              profile = {
                ...profile,
                pointsBalance: profile.pointsBalance - dec,
                limitBalance: profile.limitBalance + inc,
              };
              return Promise.resolve({ count: 1 });
            },
            findUniqueOrThrow: () => Promise.resolve({ ...profile }),
          },
        } as never),
    },
  );

  const result = await service.buyAllLimits("g@g.us", "u@s.net");
  assert.equal(result.limitsBought, Math.floor(350 / LIMIT_PRICE_POINTS));
  assert.equal(result.pointsSpent, 300);
  assert.equal(result.currentPoints, 50);
  assert.equal(result.currentLimit, 103);

  await assert.rejects(
    () => service.buyAllLimits("g@g.us", "u@s.net"),
    InsufficientPointsError,
  );
});

void test("Phase 1 commands are registered in commandRouter", () => {
  for (const cmd of [
    "dompet",
    "wallet",
    "atm",
    "atmall",
    "pull",
    "pullall",
    "transfer",
    "tf",
    "tukar",
    "weekly",
    "monthly",
    "levelup",
    "buy",
    "buyall",
    "toprich",
    "leaderboard",
  ]) {
    assert.equal(commandRouter.has(cmd), true, `Command .${cmd} harus terdaftar di commandRouter`);
  }
});
