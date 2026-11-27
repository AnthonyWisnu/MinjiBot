import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupMemberProfile,
} from "@prisma/client";

import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { prisma } from "../../repositories/prismaClient";
import { DuplicateOperationError } from "../../types/memberEconomy";
import { clampMoneyCredit } from "../../utils/currency";
import { isConsecutiveWibDay, toWibDateKey } from "../../utils/wibDate";
import { generateCorrelationId } from "./memberEconomy.service";
import { defaultRandom } from "./randomProvider";
import type { RandomProvider } from "./randomProvider";

const DAILY_XP = 100;
const DAILY_POINTS_MIN = 50;
const DAILY_POINTS_MAX = 150;
const DAILY_MONEY_MIN = 1_500_000;
const DAILY_MONEY_MAX = 3_500_000;
const DAILY_STREAK_MONEY_BONUS = 300_000n;
const DAILY_STREAK_BONUS_CAP = 10;
const DAILY_BONUS_LIMIT_PROBABILITY = 0.25;
const DAILY_BONUS_LIMIT_AMOUNT = 3;

export interface DailyClaimResult {
  pointsGained: number;
  moneyGained: bigint;
  xpGained: number;
  bonusLimitGained: number;
  currentPoints: number;
  currentMoney: bigint;
  currentLimit: number;
  currentXp: number;
  currentStreak: number;
}

// Minimal profile store interface for DI and testing.
interface DailyProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
  updateBalances(
    id: string,
    data: {
      lastDailyClaimAt?: Date | null;
      currentStreak?: number;
      longestStreak?: number;
    },
    tx?: unknown,
  ): Promise<GroupMemberProfile>;
}

// Minimal economy service interface for DI and testing.
interface DailyEconomyService {
  findOrCreateProfile(groupJid: string, userJid: string): Promise<GroupMemberProfile>;
  creditPoints(input: {
    groupJid: string;
    userJid: string;
    amount: number;
    type: "DAILY_REWARD";
    idempotencyKey?: string;
    correlationId?: string;
  }): Promise<GroupMemberProfile>;
  creditXp(input: {
    groupJid: string;
    userJid: string;
    amount: number;
    type: "DAILY_REWARD";
    correlationId?: string;
  }): Promise<GroupMemberProfile>;
  creditLimit(input: {
    groupJid: string;
    userJid: string;
    amount: number;
    type: "DAILY_REWARD";
    correlationId?: string;
  }): Promise<GroupMemberProfile>;
}

interface DailyTx {
  groupMemberProfile?: {
    updateMany: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
  groupMemberTransaction?: {
    createMany: (args: {
      data: {
        profileId: string;
        groupJid: string;
        userJid: string;
        asset: MemberTransactionAsset;
        type: MemberTransactionType;
        amount: number | bigint;
        balanceBefore: number | bigint;
        balanceAfter: number | bigint;
        correlationId: string;
        idempotencyKey: string;
      }[];
    }) => Promise<{ count: number }>;
  };
}

interface DailyDb {
  $transaction<T>(fn: (tx: DailyTx) => Promise<T>): Promise<T>;
}

export class DailyClaimService {
  constructor(
    _economyService?: DailyEconomyService,
    private readonly profileRepo: DailyProfileStore = new GroupMemberProfileRepository(),
    private readonly random: RandomProvider = defaultRandom,
    private readonly db: DailyDb = prisma,
  ) {}

  async claimDaily(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<DailyClaimResult> {
    const wibDateKey = toWibDateKey(now);
    const startOfTodayWib = new Date(`${wibDateKey}T00:00:00+07:00`);
    const idempotencyKey = `daily:${groupJid}:${userJid}:${wibDateKey}`;
    const correlationId = generateCorrelationId();

    const pointsGained = this.random.intBetween(DAILY_POINTS_MIN, DAILY_POINTS_MAX);
    const baseMoney = BigInt(this.random.intBetween(DAILY_MONEY_MIN, DAILY_MONEY_MAX));
    const xpGained = DAILY_XP;
    const bonusLimitGained = this.random.chance(DAILY_BONUS_LIMIT_PROBABILITY)
      ? DAILY_BONUS_LIMIT_AMOUNT
      : 0;

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);

      // Check if already claimed today using last claim timestamp.
      if (profile.lastDailyClaimAt !== null) {
        const lastClaimWibKey = toWibDateKey(profile.lastDailyClaimAt);
        if (lastClaimWibKey === wibDateKey) {
          throw new DuplicateOperationError("Bonus harian sudah diambil hari ini");
        }
      }

      const newStreak = this.calculateStreak(profile.lastDailyClaimAt, now, profile.currentStreak);
      const newLongestStreak = Math.max(newStreak, profile.longestStreak);
      const streakMoneyBonus =
        BigInt(Math.min(newStreak, DAILY_STREAK_BONUS_CAP)) * DAILY_STREAK_MONEY_BONUS;
      const moneyGained = clampMoneyCredit(profile.moneyBalance, baseMoney + streakMoneyBonus);

      if (tx.groupMemberProfile?.updateMany) {
        const updateResult = await tx.groupMemberProfile.updateMany({
          where: {
            id: profile.id,
            OR: [{ lastDailyClaimAt: null }, { lastDailyClaimAt: { lt: startOfTodayWib } }],
          },
          data: {
            pointsBalance: { increment: pointsGained },
            totalPointsEarned: { increment: pointsGained },
            moneyBalance: { increment: moneyGained },
            totalMoneyEarned: { increment: moneyGained },
            experience: { increment: xpGained },
            limitBalance: { increment: bonusLimitGained },
            totalLimitsEarned: { increment: bonusLimitGained },
            currentStreak: newStreak,
            longestStreak: newLongestStreak,
            lastDailyClaimAt: now,
          },
        });

        if (updateResult.count === 0) {
          throw new DuplicateOperationError("Bonus harian sudah diambil hari ini");
        }
      } else {
        await this.profileRepo.updateBalances(
          profile.id,
          {
            lastDailyClaimAt: now,
            currentStreak: newStreak,
            longestStreak: newLongestStreak,
          },
          tx,
        );
      }

      if (tx.groupMemberTransaction?.createMany) {
        const txEntries: {
          profileId: string;
          groupJid: string;
          userJid: string;
          asset: MemberTransactionAsset;
          type: MemberTransactionType;
          amount: number | bigint;
          balanceBefore: number | bigint;
          balanceAfter: number | bigint;
          correlationId: string;
          idempotencyKey: string;
        }[] = [
          {
            profileId: profile.id,
            groupJid,
            userJid,
            asset: MemberTransactionAsset.POINT,
            type: MemberTransactionType.DAILY_REWARD,
            amount: pointsGained,
            balanceBefore: profile.pointsBalance,
            balanceAfter: profile.pointsBalance + pointsGained,
            correlationId,
            idempotencyKey,
          },
          {
            profileId: profile.id,
            groupJid,
            userJid,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.DAILY_REWARD,
            amount: moneyGained,
            balanceBefore: profile.moneyBalance,
            balanceAfter: profile.moneyBalance + moneyGained,
            correlationId,
            idempotencyKey: `${idempotencyKey}:money`,
          },
          {
            profileId: profile.id,
            groupJid,
            userJid,
            asset: MemberTransactionAsset.EXPERIENCE,
            type: MemberTransactionType.DAILY_REWARD,
            amount: xpGained,
            balanceBefore: profile.experience,
            balanceAfter: profile.experience + xpGained,
            correlationId,
            idempotencyKey: `${idempotencyKey}:xp`,
          },
        ];

        if (bonusLimitGained > 0) {
          txEntries.push({
            profileId: profile.id,
            groupJid,
            userJid,
            asset: MemberTransactionAsset.LIMIT,
            type: MemberTransactionType.DAILY_REWARD,
            amount: bonusLimitGained,
            balanceBefore: profile.limitBalance,
            balanceAfter: profile.limitBalance + bonusLimitGained,
            correlationId,
            idempotencyKey: `${idempotencyKey}:limit`,
          });
        }

        await tx.groupMemberTransaction.createMany({ data: txEntries });
      }

      return {
        pointsGained,
        moneyGained,
        xpGained,
        bonusLimitGained,
        currentPoints: profile.pointsBalance + pointsGained,
        currentMoney: profile.moneyBalance + moneyGained,
        currentLimit: profile.limitBalance + bonusLimitGained,
        currentXp: profile.experience + xpGained,
        currentStreak: newStreak,
      };
    });
  }

  private calculateStreak(lastClaimAt: Date | null, now: Date, currentStreak: number): number {
    if (!lastClaimAt) {
      return 1;
    }
    if (isConsecutiveWibDay(lastClaimAt, now)) {
      return currentStreak + 1;
    }
    return 1;
  }
}

export const dailyClaimService = new DailyClaimService();
