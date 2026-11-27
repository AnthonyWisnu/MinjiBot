import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupMemberProfile,
} from "@prisma/client";

import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { prisma } from "../../repositories/prismaClient";
import { generateCorrelationId, MAX_SAFE_ECONOMY_INT } from "./memberEconomy.service";
import { defaultRandom, type RandomProvider } from "./randomProvider";

const WEEKLY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const MONTHLY_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export const WEEKLY_REWARD_CONFIG = {
  MONEY_MIN: 75_000,
  MONEY_MAX: 150_000,
  POINTS_MIN: 250,
  POINTS_MAX: 500,
  XP: 350,
  LIMIT: 5,
} as const;

export const MONTHLY_REWARD_CONFIG = {
  MONEY_MIN: 350_000,
  MONEY_MAX: 600_000,
  POINTS_MIN: 1_000,
  POINTS_MAX: 2_000,
  XP: 1_200,
  LIMIT: 20,
} as const;

export class PeriodicCooldownError extends Error {
  constructor(
    public readonly period: "weekly" | "monthly",
    public readonly remainingMs: number,
  ) {
    super(`Bonus ${period} masih dalam masa tunggu.`);
    this.name = "PeriodicCooldownError";
  }
}

export interface PeriodicClaimResult {
  period: "weekly" | "monthly";
  moneyGained: number;
  pointsGained: number;
  xpGained: number;
  limitGained: number;
  currentMoney: number;
  currentPoints: number;
  currentLimit: number;
  currentXp: number;
}

interface PeriodicProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
}

interface PeriodicTx {
  groupMemberProfile: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    findUniqueOrThrow(args: { where: Record<string, unknown> }): Promise<GroupMemberProfile>;
  };
  groupMemberTransaction?: {
    createMany(args: {
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
      }[];
    }): Promise<{ count: number }>;
  };
}

interface PeriodicDb {
  $transaction<T>(fn: (tx: PeriodicTx) => Promise<T>): Promise<T>;
}

export class PeriodicRewardService {
  constructor(
    private readonly profileRepo: PeriodicProfileStore = new GroupMemberProfileRepository(),
    private readonly random: RandomProvider = defaultRandom,
    private readonly db: PeriodicDb = prisma,
  ) {}

  claimWeekly(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<PeriodicClaimResult> {
    return this.claimPeriodic("weekly", groupJid, userJid, now);
  }

  claimMonthly(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<PeriodicClaimResult> {
    return this.claimPeriodic("monthly", groupJid, userJid, now);
  }

  private async claimPeriodic(
    period: "weekly" | "monthly",
    groupJid: string,
    userJid: string,
    now: Date,
  ): Promise<PeriodicClaimResult> {
    const isWeekly = period === "weekly";
    const cooldownMs = isWeekly ? WEEKLY_COOLDOWN_MS : MONTHLY_COOLDOWN_MS;
    const config = isWeekly ? WEEKLY_REWARD_CONFIG : MONTHLY_REWARD_CONFIG;
    const fieldName = isWeekly ? "lastWeeklyClaimAt" : "lastMonthlyClaimAt";
    const txType = isWeekly
      ? MemberTransactionType.WEEKLY_REWARD
      : MemberTransactionType.MONTHLY_REWARD;

    const moneyRaw = this.random.intBetween(config.MONEY_MIN, config.MONEY_MAX);
    const pointsRaw = this.random.intBetween(config.POINTS_MIN, config.POINTS_MAX);
    const xpGained = config.XP;
    const limitGained = config.LIMIT;
    const correlationId = generateCorrelationId();
    const cutoff = new Date(now.getTime() - cooldownMs);

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const lastClaim = isWeekly ? profile.lastWeeklyClaimAt : profile.lastMonthlyClaimAt;

      if (lastClaim !== null) {
        const elapsed = now.getTime() - lastClaim.getTime();
        if (elapsed < cooldownMs) {
          throw new PeriodicCooldownError(period, cooldownMs - elapsed);
        }
      }

      const moneyGained = Math.min(moneyRaw, Math.max(0, MAX_SAFE_ECONOMY_INT - profile.moneyBalance));
      const pointsGained = Math.min(
        pointsRaw,
        Math.max(0, MAX_SAFE_ECONOMY_INT - profile.pointsBalance),
      );

      const updateResult = await tx.groupMemberProfile.updateMany({
        where: {
          id: profile.id,
          OR: [{ [fieldName]: null }, { [fieldName]: { lte: cutoff } }],
        },
        data: {
          moneyBalance: { increment: moneyGained },
          totalMoneyEarned: { increment: moneyGained },
          pointsBalance: { increment: pointsGained },
          totalPointsEarned: { increment: pointsGained },
          experience: { increment: xpGained },
          limitBalance: { increment: limitGained },
          totalLimitsEarned: { increment: limitGained },
          [fieldName]: now,
        },
      });

      if (updateResult.count === 0) {
        throw new PeriodicCooldownError(period, cooldownMs);
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: profile.id },
      });

      if (tx.groupMemberTransaction?.createMany) {
        await tx.groupMemberTransaction.createMany({
          data: [
            {
              profileId: profile.id,
              groupJid,
              userJid,
              asset: MemberTransactionAsset.MONEY,
              type: txType,
              amount: moneyGained,
              balanceBefore: profile.moneyBalance,
              balanceAfter: updated.moneyBalance,
              correlationId,
            },
            {
              profileId: profile.id,
              groupJid,
              userJid,
              asset: MemberTransactionAsset.POINT,
              type: txType,
              amount: pointsGained,
              balanceBefore: profile.pointsBalance,
              balanceAfter: updated.pointsBalance,
              correlationId,
            },
            {
              profileId: profile.id,
              groupJid,
              userJid,
              asset: MemberTransactionAsset.EXPERIENCE,
              type: txType,
              amount: xpGained,
              balanceBefore: profile.experience,
              balanceAfter: updated.experience,
              correlationId,
            },
            {
              profileId: profile.id,
              groupJid,
              userJid,
              asset: MemberTransactionAsset.LIMIT,
              type: txType,
              amount: limitGained,
              balanceBefore: profile.limitBalance,
              balanceAfter: updated.limitBalance,
              correlationId,
            },
          ],
        });
      }

      return {
        period,
        moneyGained,
        pointsGained,
        xpGained,
        limitGained,
        currentMoney: updated.moneyBalance,
        currentPoints: updated.pointsBalance,
        currentLimit: updated.limitBalance,
        currentXp: updated.experience,
      };
    });
  }
}

export const periodicRewardService = new PeriodicRewardService();
