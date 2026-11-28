import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupMemberProfile,
} from "@prisma/client";

import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { prisma } from "../../repositories/prismaClient";
import { clampMoneyCredit, minBigInt } from "../../utils/currency";
import { generateCorrelationId, MAX_SAFE_ECONOMY_INT } from "./memberEconomy.service";

const MAX_MEMBER_LEVEL = 500;
const LEVEL_UP_POINTS_PER_LEVEL = 30;
const LEVEL_UP_LIMIT_PER_LEVEL = 2;
const LEVEL_UP_MONEY_PER_LEVEL_UNIT = 250_000n;
const MAX_LEVEL_UP_MONEY_PER_LEVEL = 6_000_000n;

/**
 * Total kumulatif XP yang dibutuhkan untuk mencapai level tertentu.
 * Level 1 = 0 XP, Level 2 = 150 XP, Level 3 = 350 XP, Level 10 = 3.150 XP, Level 100 = 257.400 XP.
 */
export function xpRequiredForLevel(level: number): number {
  if (level <= 1) {
    return 0;
  }
  const n = Math.min(Math.floor(level), MAX_MEMBER_LEVEL);
  return 25 * (n - 1) * (n + 4);
}

export function calculateReachableLevel(experience: number): number {
  const safeXp = Math.max(0, Math.floor(experience));
  let level = 1;
  while (level < MAX_MEMBER_LEVEL && safeXp >= xpRequiredForLevel(level + 1)) {
    level += 1;
  }
  return level;
}

export function computeLevelUpRewards(
  fromLevel: number,
  toLevel: number,
): { moneyGained: bigint; pointsGained: number; limitGained: number } {
  let moneyGained = 0n;
  let pointsGained = 0;
  let limitGained = 0;

  for (let lvl = fromLevel + 1; lvl <= toLevel; lvl += 1) {
    moneyGained += minBigInt(
      MAX_LEVEL_UP_MONEY_PER_LEVEL,
      BigInt(lvl) * LEVEL_UP_MONEY_PER_LEVEL_UNIT,
    );
    pointsGained += LEVEL_UP_POINTS_PER_LEVEL;
    limitGained += LEVEL_UP_LIMIT_PER_LEVEL;
  }

  return { moneyGained, pointsGained, limitGained };
}

export interface LevelUpResult {
  leveledUp: boolean;
  oldLevel: number;
  newLevel: number;
  levelsGained: number;
  moneyGained: bigint;
  pointsGained: number;
  limitGained: number;
  currentXp: number;
  nextLevelXp: number;
  currentMoney: bigint;
  currentPoints: number;
  currentLimit: number;
}

interface LevelProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
}

interface LevelTx {
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
        amount: number | bigint;
        balanceBefore: number | bigint;
        balanceAfter: number | bigint;
        correlationId: string;
      }[];
    }): Promise<{ count: number }>;
  };
}

interface LevelDb {
  $transaction<T>(fn: (tx: LevelTx) => Promise<T>): Promise<T>;
}

export class LevelService {
  constructor(
    private readonly profileRepo: LevelProfileStore = new GroupMemberProfileRepository(),
    private readonly db: LevelDb = prisma,
  ) {}

  async claimLevelUp(groupJid: string, userJid: string): Promise<LevelUpResult> {
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const currentLevel = Math.max(1, profile.level);
      const reachableLevel = calculateReachableLevel(profile.experience);

      if (reachableLevel <= currentLevel) {
        return {
          leveledUp: false,
          oldLevel: currentLevel,
          newLevel: currentLevel,
          levelsGained: 0,
          moneyGained: 0n,
          pointsGained: 0,
          limitGained: 0,
          currentXp: profile.experience,
          nextLevelXp: xpRequiredForLevel(currentLevel + 1),
          currentMoney: profile.moneyBalance,
          currentPoints: profile.pointsBalance,
          currentLimit: profile.limitBalance,
        };
      }

      const rawRewards = computeLevelUpRewards(currentLevel, reachableLevel);
      const safeMoneyGain = clampMoneyCredit(profile.moneyBalance, rawRewards.moneyGained);
      const safePointsGain = Math.min(
        rawRewards.pointsGained,
        Math.max(0, MAX_SAFE_ECONOMY_INT - profile.pointsBalance),
      );
      const safeLimitGain = rawRewards.limitGained;

      const updateResult = await tx.groupMemberProfile.updateMany({
        where: {
          id: profile.id,
          level: profile.level,
        },
        data: {
          level: reachableLevel,
          moneyBalance: { increment: safeMoneyGain },
          totalMoneyEarned: { increment: safeMoneyGain },
          pointsBalance: { increment: safePointsGain },
          totalPointsEarned: { increment: safePointsGain },
          limitBalance: { increment: safeLimitGain },
          totalLimitsEarned: { increment: safeLimitGain },
        },
      });

      if (updateResult.count === 0) {
        const refreshed = await tx.groupMemberProfile.findUniqueOrThrow({
          where: { id: profile.id },
        });
        return {
          leveledUp: false,
          oldLevel: refreshed.level,
          newLevel: refreshed.level,
          levelsGained: 0,
          moneyGained: 0n,
          pointsGained: 0,
          limitGained: 0,
          currentXp: refreshed.experience,
          nextLevelXp: xpRequiredForLevel(refreshed.level + 1),
          currentMoney: refreshed.moneyBalance,
          currentPoints: refreshed.pointsBalance,
          currentLimit: refreshed.limitBalance,
        };
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
              type: MemberTransactionType.LEVEL_UP_REWARD,
              amount: safeMoneyGain,
              balanceBefore: profile.moneyBalance,
              balanceAfter: updated.moneyBalance,
              correlationId,
            },
            {
              profileId: profile.id,
              groupJid,
              userJid,
              asset: MemberTransactionAsset.POINT,
              type: MemberTransactionType.LEVEL_UP_REWARD,
              amount: safePointsGain,
              balanceBefore: profile.pointsBalance,
              balanceAfter: updated.pointsBalance,
              correlationId,
            },
            {
              profileId: profile.id,
              groupJid,
              userJid,
              asset: MemberTransactionAsset.LIMIT,
              type: MemberTransactionType.LEVEL_UP_REWARD,
              amount: safeLimitGain,
              balanceBefore: profile.limitBalance,
              balanceAfter: updated.limitBalance,
              correlationId,
            },
          ],
        });
      }

      return {
        leveledUp: true,
        oldLevel: currentLevel,
        newLevel: reachableLevel,
        levelsGained: reachableLevel - currentLevel,
        moneyGained: safeMoneyGain,
        pointsGained: safePointsGain,
        limitGained: safeLimitGain,
        currentXp: updated.experience,
        nextLevelXp: xpRequiredForLevel(reachableLevel + 1),
        currentMoney: updated.moneyBalance,
        currentPoints: updated.pointsBalance,
        currentLimit: updated.limitBalance,
      };
    });
  }
}

export const levelService = new LevelService();
