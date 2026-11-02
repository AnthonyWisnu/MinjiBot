import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupMemberProfile,
} from "@prisma/client";

import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { prisma } from "../../repositories/prismaClient";
import { DuplicateOperationError } from "../../types/memberEconomy";
import { isConsecutiveWibDay, toWibDateKey } from "../../utils/wibDate";
import { generateCorrelationId } from "./memberEconomy.service";
import { defaultRandom } from "./randomProvider";
import type { RandomProvider } from "./randomProvider";

const DAILY_XP = 50;
const DAILY_POINTS_MIN = 10;
const DAILY_POINTS_MAX = 30;
const DAILY_BONUS_LIMIT_PROBABILITY = 0.1;

export interface DailyClaimResult {
  pointsGained: number;
  xpGained: number;
  bonusLimitGained: number;
  currentPoints: number;
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
        amount: number;
        balanceBefore: number;
        balanceAfter: number;
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
    const xpGained = DAILY_XP;
    const bonusLimitGained = this.random.chance(DAILY_BONUS_LIMIT_PROBABILITY) ? 1 : 0;

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

      if (tx.groupMemberProfile?.updateMany) {
        const updateResult = await tx.groupMemberProfile.updateMany({
          where: {
            id: profile.id,
            OR: [{ lastDailyClaimAt: null }, { lastDailyClaimAt: { lt: startOfTodayWib } }],
          },
          data: {
            pointsBalance: { increment: pointsGained },
            totalPointsEarned: { increment: pointsGained },
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
          amount: number;
          balanceBefore: number;
          balanceAfter: number;
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
        xpGained,
        bonusLimitGained,
        currentPoints: profile.pointsBalance + pointsGained,
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
