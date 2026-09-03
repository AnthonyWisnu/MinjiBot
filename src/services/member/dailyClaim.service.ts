import type { GroupMemberProfile } from "@prisma/client";

import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { DuplicateOperationError } from "../../types/memberEconomy";
import { isConsecutiveWibDay, toWibDateKey } from "../../utils/wibDate";
import { MemberEconomyService } from "./memberEconomy.service";
import { defaultRandom } from "./randomProvider";
import type { RandomProvider } from "./randomProvider";
import { generateCorrelationId } from "./memberEconomy.service";

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
  findOrCreate(groupJid: string, userJid: string): Promise<GroupMemberProfile>;
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

export class DailyClaimService {
  constructor(
    private readonly economyService: DailyEconomyService = new MemberEconomyService(),
    private readonly profileRepo: DailyProfileStore = new GroupMemberProfileRepository(),
    private readonly random: RandomProvider = defaultRandom,
  ) {}

  async claimDaily(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<DailyClaimResult> {
    const wibDateKey = toWibDateKey(now);
    const idempotencyKey = `daily:${groupJid}:${userJid}:${wibDateKey}`;
    const correlationId = generateCorrelationId();

    // Check if already claimed today using last claim timestamp.
    const profile = await this.economyService.findOrCreateProfile(groupJid, userJid);
    if (profile.lastDailyClaimAt !== null) {
      const lastClaimWibKey = toWibDateKey(profile.lastDailyClaimAt);
      if (lastClaimWibKey === wibDateKey) {
        throw new DuplicateOperationError("Bonus harian sudah diambil hari ini");
      }
    }

    // Calculate rewards.
    const pointsGained = this.random.intBetween(DAILY_POINTS_MIN, DAILY_POINTS_MAX);
    const xpGained = DAILY_XP;
    const bonusLimitGained = this.random.chance(DAILY_BONUS_LIMIT_PROBABILITY) ? 1 : 0;

    // Calculate new streak.
    const newStreak = this.calculateStreak(profile.lastDailyClaimAt, now, profile.currentStreak);
    const newLongestStreak = Math.max(newStreak, profile.longestStreak);

    // Credit points - idempotency key prevents concurrent double-claim.
    await this.economyService.creditPoints({
      groupJid,
      userJid,
      amount: pointsGained,
      type: "DAILY_REWARD",
      idempotencyKey,
      correlationId,
    });

    // Credit XP.
    await this.economyService.creditXp({
      groupJid,
      userJid,
      amount: xpGained,
      type: "DAILY_REWARD",
      correlationId,
    });

    // Credit bonus limit if applicable.
    if (bonusLimitGained > 0) {
      await this.economyService.creditLimit({
        groupJid,
        userJid,
        amount: bonusLimitGained,
        type: "DAILY_REWARD",
        correlationId,
      });
    }

    // Update streak and claim timestamp.
    await this.profileRepo.updateBalances(profile.id, {
      lastDailyClaimAt: now,
      currentStreak: newStreak,
      longestStreak: newLongestStreak,
    });

    // Return final state from a fresh read.
    const updated = await this.economyService.findOrCreateProfile(groupJid, userJid);

    return {
      pointsGained,
      xpGained,
      bonusLimitGained,
      currentPoints: updated.pointsBalance,
      currentLimit: updated.limitBalance,
      currentXp: updated.experience,
      currentStreak: newStreak,
    };
  }

  private calculateStreak(
    lastClaimAt: Date | null,
    now: Date,
    currentStreak: number,
  ): number {
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
