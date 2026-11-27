import { randomUUID } from "node:crypto";

import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupMemberProfile,
  type GroupMemberTransaction,
  type HeavyFeatureType,
} from "@prisma/client";

import { logger } from "../../config/logger";
import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { GroupMemberTransactionRepository } from "../../repositories/groupMemberTransaction.repository";
import { prisma } from "../../repositories/prismaClient";
import { levelUpNotifierService, type LevelUpNotification } from "./levelUpNotifier.service";
import { resolveRank } from "./rank.service";
import type {
  CreditLimitInput,
  CreditPointsInput,
  CreditXpInput,
  ConsumeLimitInput,
  DebitPointsInput,
  RecordGameResultInput,
  RefundLimitInput,
  ReserveLimitInput,
  SetLimitInput,
  SetPointsInput,
  SetXpInput,
} from "../../types/memberEconomy";
import {
  DuplicateOperationError,
  InsufficientLimitError,
  InsufficientPointsError,
  InsufficientReservedLimitError,
  InvalidAmountError,
  MemberProfileNotFoundError,
} from "../../types/memberEconomy";

// Minimal interface for the Prisma client used by this service.
// Allows injection of a mock in tests.
interface TransactionalDb {
  $transaction<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T>;
}

interface PrismaTx {
  groupMemberProfile: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    findUniqueOrThrow(args: { where: Record<string, unknown> }): Promise<GroupMemberProfile>;
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<GroupMemberProfile>;
  };
}

// Profile store interface for dependency injection and testing.
interface ProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
  findByGroupAndUser(
    groupJid: string,
    userJid: string,
    tx?: unknown,
  ): Promise<GroupMemberProfile | null>;
  findActiveByUser(userJid: string, now?: Date): Promise<GroupMemberProfile[]>;
}

// Transaction ledger store interface.
interface TxStore {
  create(
    data: {
      profileId: string;
      groupJid: string;
      userJid: string;
      actorJid?: string;
      targetUserJid?: string;
      asset: MemberTransactionAsset;
      type: MemberTransactionType;
      amount: number;
      balanceBefore?: number;
      balanceAfter?: number;
      feature?: HeavyFeatureType;
      correlationId?: string;
      idempotencyKey?: string;
      note?: string;
    },
    tx?: unknown,
  ): Promise<unknown>;
  findByIdempotencyKey(key: string): Promise<object | null>;
  findByCorrelationId?(
    correlationId: string,
    tx?: unknown,
  ): Promise<{ type: MemberTransactionType }[]>;
}

export const MAX_SAFE_ECONOMY_INT = 1_000_000_000;

function validatePositiveAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_SAFE_ECONOMY_INT) {
    throw new InvalidAmountError(
      `Jumlah harus berupa bilangan bulat positif (maksimal ${MAX_SAFE_ECONOMY_INT.toLocaleString("id-ID")})`,
    );
  }
}

function validateNonNegativeAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_SAFE_ECONOMY_INT) {
    throw new InvalidAmountError(
      `Jumlah harus berupa bilangan bulat non-negatif (maksimal ${MAX_SAFE_ECONOMY_INT.toLocaleString("id-ID")})`,
    );
  }
}

// Generates a unique correlation ID for multi-step operations.
export function generateCorrelationId(): string {
  return randomUUID();
}

export class MemberEconomyService {
  constructor(
    private readonly profileRepo: ProfileStore = new GroupMemberProfileRepository(),
    private readonly txRepo: TxStore = new GroupMemberTransactionRepository(),
    private readonly db: TransactionalDb = prisma,
    private readonly levelUpNotifier: {
      notifyLevelUp(event: LevelUpNotification): Promise<void>;
    } = levelUpNotifierService,
  ) {}

  // ---- Profile ----

  async findOrCreateProfile(groupJid: string, userJid: string): Promise<GroupMemberProfile> {
    return this.profileRepo.findOrCreate(groupJid, userJid);
  }

  async findProfile(groupJid: string, userJid: string): Promise<GroupMemberProfile> {
    const profile = await this.profileRepo.findByGroupAndUser(groupJid, userJid);
    if (!profile) {
      throw new MemberProfileNotFoundError(groupJid, userJid);
    }
    return profile;
  }

  // Returns active profiles sorted by limitBalance DESC for private chat resolution.
  async findBestLimitProfileForPrivateChat(
    userJid: string,
    minLimit: number,
  ): Promise<GroupMemberProfile | null> {
    const profiles = await this.profileRepo.findActiveByUser(userJid);
    return profiles.find((p) => p.limitBalance >= minLimit) ?? null;
  }

  // ---- Points ----

  async creditPoints(input: CreditPointsInput): Promise<GroupMemberProfile> {
    validatePositiveAmount(input.amount);

    if (input.idempotencyKey) {
      const existing = await this.txRepo.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        throw new DuplicateOperationError();
      }
    }

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(input.groupJid, input.userJid, tx);

      if (profile.pointsBalance + input.amount > MAX_SAFE_ECONOMY_INT) {
        throw new InvalidAmountError(
          `Saldo poin melebihi batas maksimum (${MAX_SAFE_ECONOMY_INT.toLocaleString("id-ID")})`,
        );
      }

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          pointsBalance: { increment: input.amount },
          totalPointsEarned: { increment: input.amount },
        },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid: input.groupJid,
          userJid: input.userJid,
          actorJid: input.actorJid,
          targetUserJid: input.targetUserJid,
          asset: MemberTransactionAsset.POINT,
          type: MemberTransactionType[input.type],
          amount: input.amount,
          balanceBefore: profile.pointsBalance,
          balanceAfter: updated.pointsBalance,
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          note: input.note,
        },
        tx,
      );

      return updated;
    });
  }

  // Debit uses updateMany with predicate to guarantee no concurrent overspend.
  async debitPoints(input: DebitPointsInput): Promise<GroupMemberProfile> {
    validatePositiveAmount(input.amount);

    if (input.idempotencyKey) {
      const existing = await this.txRepo.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        throw new DuplicateOperationError();
      }
    }

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(input.groupJid, input.userJid, tx);

      // Atomic conditional update: only succeeds if pointsBalance >= amount
      const result = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, pointsBalance: { gte: input.amount } },
        data: { pointsBalance: { decrement: input.amount } },
      });

      if (result.count === 0) {
        throw new InsufficientPointsError();
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: profile.id },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid: input.groupJid,
          userJid: input.userJid,
          actorJid: input.actorJid,
          targetUserJid: input.targetUserJid,
          asset: MemberTransactionAsset.POINT,
          type: MemberTransactionType[input.type],
          amount: input.amount,
          balanceBefore: profile.pointsBalance,
          balanceAfter: updated.pointsBalance,
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          note: input.note,
        },
        tx,
      );

      return updated;
    });
  }

  async setPoints(input: SetPointsInput): Promise<GroupMemberProfile> {
    validateNonNegativeAmount(input.amount);

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(input.groupJid, input.userJid, tx);

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: { pointsBalance: input.amount },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid: input.groupJid,
          userJid: input.userJid,
          actorJid: input.actorJid,
          asset: MemberTransactionAsset.POINT,
          type: MemberTransactionType.SUPER_OWNER_SET,
          amount: input.amount,
          balanceBefore: profile.pointsBalance,
          balanceAfter: updated.pointsBalance,
          note: input.note,
        },
        tx,
      );

      return updated;
    });
  }

  // ---- Limits ----

  async creditLimit(input: CreditLimitInput): Promise<GroupMemberProfile> {
    validatePositiveAmount(input.amount);

    if (input.idempotencyKey) {
      const existing = await this.txRepo.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        throw new DuplicateOperationError();
      }
    }

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(input.groupJid, input.userJid, tx);

      if (profile.limitBalance + input.amount > MAX_SAFE_ECONOMY_INT) {
        throw new InvalidAmountError(
          `Saldo limit melebihi batas maksimum (${MAX_SAFE_ECONOMY_INT.toLocaleString("id-ID")})`,
        );
      }

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          limitBalance: { increment: input.amount },
          totalLimitsEarned: { increment: input.amount },
        },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid: input.groupJid,
          userJid: input.userJid,
          actorJid: input.actorJid,
          targetUserJid: input.targetUserJid,
          asset: MemberTransactionAsset.LIMIT,
          type: MemberTransactionType[input.type],
          amount: input.amount,
          balanceBefore: profile.limitBalance,
          balanceAfter: updated.limitBalance,
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          note: input.note,
        },
        tx,
      );

      return updated;
    });
  }

  // Reserve: move from limitBalance to reservedLimit.
  // Uses updateMany predicate to prevent concurrent overspend.
  async reserveLimit(input: ReserveLimitInput): Promise<GroupMemberProfile> {
    validatePositiveAmount(input.amount);

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(input.groupJid, input.userJid, tx);

      const result = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, limitBalance: { gte: input.amount } },
        data: {
          limitBalance: { decrement: input.amount },
          reservedLimit: { increment: input.amount },
        },
      });

      if (result.count === 0) {
        throw new InsufficientLimitError();
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: profile.id },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid: input.groupJid,
          userJid: input.userJid,
          actorJid: input.actorJid,
          asset: MemberTransactionAsset.LIMIT,
          type: MemberTransactionType.FEATURE_RESERVE,
          amount: input.amount,
          balanceBefore: profile.limitBalance,
          balanceAfter: updated.limitBalance,
          feature: input.feature,
          correlationId: input.correlationId,
        },
        tx,
      );

      return updated;
    });
  }

  // Consume: decrement reservedLimit (permanent consumption, limitBalance unchanged).
  async consumeLimit(input: ConsumeLimitInput): Promise<GroupMemberProfile> {
    validatePositiveAmount(input.amount);

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(input.groupJid, input.userJid, tx);

      if (input.correlationId) {
        let existingTxs: { type: MemberTransactionType }[] = [];
        if (typeof this.txRepo.findByCorrelationId === "function") {
          existingTxs = await this.txRepo.findByCorrelationId(input.correlationId, tx);
        } else if (
          typeof (
            tx as unknown as {
              groupMemberTransaction?: {
                findMany: (args: unknown) => Promise<{ type: MemberTransactionType }[]>;
              };
            }
          ).groupMemberTransaction?.findMany === "function"
        ) {
          existingTxs = await (
            tx as unknown as {
              groupMemberTransaction: {
                findMany: (args: unknown) => Promise<{ type: MemberTransactionType }[]>;
              };
            }
          ).groupMemberTransaction.findMany({
            where: { correlationId: input.correlationId },
          });
        }

        if (existingTxs.length > 0) {
          const hasReserve = existingTxs.some(
            (t) => t.type === MemberTransactionType.FEATURE_RESERVE,
          );
          const hasConsume = existingTxs.some(
            (t) => t.type === MemberTransactionType.FEATURE_CONSUME,
          );
          const hasRefund = existingTxs.some(
            (t) => t.type === MemberTransactionType.FEATURE_REFUND,
          );

          if (!hasReserve) {
            throw new Error("Transaksi reservasi tidak ditemukan.");
          }
          if (hasConsume) {
            return profile;
          }
          if (hasRefund) {
            throw new Error("Limit sudah di-refund, tidak dapat dikonsumsi.");
          }
        }
      }

      const result = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, reservedLimit: { gte: input.amount } },
        data: { reservedLimit: { decrement: input.amount } },
      });

      if (result.count === 0) {
        throw new InsufficientReservedLimitError();
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: profile.id },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid: input.groupJid,
          userJid: input.userJid,
          actorJid: input.actorJid,
          asset: MemberTransactionAsset.LIMIT,
          type: MemberTransactionType.FEATURE_CONSUME,
          amount: input.amount,
          balanceBefore: profile.reservedLimit,
          balanceAfter: updated.reservedLimit,
          feature: input.feature,
          correlationId: input.correlationId,
        },
        tx,
      );

      return updated;
    });
  }

  // Refund: move from reservedLimit back to limitBalance.
  async refundLimit(input: RefundLimitInput): Promise<GroupMemberProfile> {
    validatePositiveAmount(input.amount);

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(input.groupJid, input.userJid, tx);

      if (input.correlationId) {
        let existingTxs: { type: MemberTransactionType }[] = [];
        if (typeof this.txRepo.findByCorrelationId === "function") {
          existingTxs = await this.txRepo.findByCorrelationId(input.correlationId, tx);
        } else if (
          typeof (
            tx as unknown as {
              groupMemberTransaction?: {
                findMany: (args: unknown) => Promise<{ type: MemberTransactionType }[]>;
              };
            }
          ).groupMemberTransaction?.findMany === "function"
        ) {
          existingTxs = await (
            tx as unknown as {
              groupMemberTransaction: {
                findMany: (args: unknown) => Promise<{ type: MemberTransactionType }[]>;
              };
            }
          ).groupMemberTransaction.findMany({
            where: { correlationId: input.correlationId },
          });
        }

        if (existingTxs.length > 0) {
          const hasReserve = existingTxs.some(
            (t) => t.type === MemberTransactionType.FEATURE_RESERVE,
          );
          const hasConsume = existingTxs.some(
            (t) => t.type === MemberTransactionType.FEATURE_CONSUME,
          );
          const hasRefund = existingTxs.some(
            (t) => t.type === MemberTransactionType.FEATURE_REFUND,
          );

          if (!hasReserve) {
            throw new Error("Transaksi reservasi tidak ditemukan.");
          }
          if (hasRefund) {
            return profile;
          }
          if (hasConsume) {
            return profile;
          }
        }
      }

      const result = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, reservedLimit: { gte: input.amount } },
        data: {
          reservedLimit: { decrement: input.amount },
          limitBalance: { increment: input.amount },
        },
      });

      if (result.count === 0) {
        throw new InsufficientReservedLimitError();
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: profile.id },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid: input.groupJid,
          userJid: input.userJid,
          actorJid: input.actorJid,
          asset: MemberTransactionAsset.LIMIT,
          type: MemberTransactionType.FEATURE_REFUND,
          amount: input.amount,
          balanceBefore: profile.reservedLimit,
          balanceAfter: updated.reservedLimit,
          feature: input.feature,
          correlationId: input.correlationId,
        },
        tx,
      );

      return updated;
    });
  }

  async setLimit(input: SetLimitInput): Promise<GroupMemberProfile> {
    validateNonNegativeAmount(input.amount);

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(input.groupJid, input.userJid, tx);

      if (profile.limitBalance + input.amount > MAX_SAFE_ECONOMY_INT) {
        throw new InvalidAmountError(
          `Saldo limit melebihi batas maksimum (${MAX_SAFE_ECONOMY_INT.toLocaleString("id-ID")})`,
        );
      }

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: { limitBalance: input.amount },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid: input.groupJid,
          userJid: input.userJid,
          actorJid: input.actorJid,
          asset: MemberTransactionAsset.LIMIT,
          type: MemberTransactionType.SUPER_OWNER_SET,
          amount: input.amount,
          balanceBefore: profile.limitBalance,
          balanceAfter: updated.limitBalance,
          note: input.note,
        },
        tx,
      );

      return updated;
    });
  }

  // ---- XP ----

  // XP is permanent progression - cannot be spent or transferred.
  async creditXp(input: CreditXpInput): Promise<GroupMemberProfile> {
    validatePositiveAmount(input.amount);

    if (input.idempotencyKey) {
      const existing = await this.txRepo.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        throw new DuplicateOperationError();
      }
    }

    let oldExperience = 0;

    const updated = await this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(input.groupJid, input.userJid, tx);
      oldExperience = profile.experience;

      if (profile.experience + input.amount > MAX_SAFE_ECONOMY_INT) {
        throw new InvalidAmountError(
          `Saldo XP melebihi batas maksimum (${MAX_SAFE_ECONOMY_INT.toLocaleString("id-ID")})`,
        );
      }

      const updatedProfile = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: { experience: { increment: input.amount } },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid: input.groupJid,
          userJid: input.userJid,
          actorJid: input.actorJid,
          asset: MemberTransactionAsset.EXPERIENCE,
          type: MemberTransactionType[input.type],
          amount: input.amount,
          balanceBefore: profile.experience,
          balanceAfter: updatedProfile.experience,
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          note: input.note,
        },
        tx,
      );

      return updatedProfile;
    });

    const oldRank = resolveRank(oldExperience);
    const newRank = resolveRank(updated.experience);

    if (newRank !== oldRank && updated.experience > oldExperience) {
      void this.levelUpNotifier.notifyLevelUp({
        groupJid: input.groupJid,
        userJid: input.userJid,
        oldRank,
        newRank,
        newXp: updated.experience,
      });
    }

    return updated;
  }

  async setXp(input: SetXpInput): Promise<GroupMemberProfile> {
    validateNonNegativeAmount(input.amount);

    let oldExperience = 0;

    const updated = await this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(input.groupJid, input.userJid, tx);
      oldExperience = profile.experience;

      const updatedProfile = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: { experience: input.amount },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid: input.groupJid,
          userJid: input.userJid,
          actorJid: input.actorJid,
          asset: MemberTransactionAsset.EXPERIENCE,
          type: MemberTransactionType.SUPER_OWNER_SET,
          amount: input.amount,
          balanceBefore: profile.experience,
          balanceAfter: updatedProfile.experience,
          note: input.note,
        },
        tx,
      );

      return updatedProfile;
    });

    const oldRank = resolveRank(oldExperience);
    const newRank = resolveRank(updated.experience);

    if (newRank !== oldRank && updated.experience > oldExperience) {
      void this.levelUpNotifier.notifyLevelUp({
        groupJid: input.groupJid,
        userJid: input.userJid,
        oldRank,
        newRank,
        newXp: updated.experience,
      });
    }

    return updated;
  }

  // ---- Game statistics ----

  // Records game outcome without exposing direct profile mutation to game handlers.
  async recordGameResult(input: RecordGameResultInput): Promise<GroupMemberProfile> {
    if (input.idempotencyKey) {
      const existing = await this.txRepo.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        throw new DuplicateOperationError();
      }
    }

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(input.groupJid, input.userJid, tx);

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          totalGamesPlayed: { increment: 1 },
          ...(input.won ? { totalGamesWon: { increment: 1 } } : {}),
        },
      });

      if (input.idempotencyKey) {
        await this.txRepo.create(
          {
            profileId: profile.id,
            groupJid: input.groupJid,
            userJid: input.userJid,
            asset: MemberTransactionAsset.POINT,
            type: MemberTransactionType.GAME_REWARD,
            amount: 0,
            correlationId: input.correlationId,
            idempotencyKey: input.idempotencyKey,
            note: input.won ? "game-win-stat" : "game-played-stat",
          },
          tx,
        );
      }

      return updated;
    });
  }

  /**
   * Rekonsiliasi orphan limit reservation (reservasi menggantung > olderThanMinutes).
   * Mengembalikan saldo limit ke balance normal secara idempoten jika proses terputus / crash.
   */
  async reconcileOrphanedReservations(olderThanMinutes = 15): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);

    const prismaClient = this.db as unknown as {
      groupMemberTransaction?: {
        findMany: (args: Record<string, unknown>) => Promise<GroupMemberTransaction[]>;
      };
    };
    if (!prismaClient.groupMemberTransaction) {
      return 0;
    }

    const reserveTxs = await prismaClient.groupMemberTransaction.findMany({
      where: {
        asset: MemberTransactionAsset.LIMIT,
        type: MemberTransactionType.FEATURE_RESERVE,
        correlationId: { not: null },
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: "asc" },
    });

    if (reserveTxs.length === 0) {
      return 0;
    }

    const correlationIds = Array.from(
      new Set(reserveTxs.map((t) => t.correlationId).filter((id): id is string => Boolean(id))),
    );

    const settledTxs = await prismaClient.groupMemberTransaction.findMany({
      where: {
        correlationId: { in: correlationIds },
        type: {
          in: [MemberTransactionType.FEATURE_CONSUME, MemberTransactionType.FEATURE_REFUND],
        },
      },
      select: { correlationId: true },
    });

    const settledSet = new Set(
      settledTxs.map((t) => t.correlationId).filter((id): id is string => Boolean(id)),
    );
    const orphanTxs = reserveTxs.filter((t) =>
      Boolean(t.correlationId && !settledSet.has(t.correlationId)),
    );

    let recoveredCount = 0;
    for (const orphan of orphanTxs) {
      if (!orphan.correlationId) continue;
      const correlationId = orphan.correlationId;

      try {
        await this.db.$transaction(async (tx) => {
          const rawTx = tx as unknown as typeof prisma;
          const existingRefund = await rawTx.groupMemberTransaction.findUnique({
            where: { idempotencyKey: `orphan-refund:${correlationId}` },
          });
          if (existingRefund) {
            return;
          }

          const profile = await rawTx.groupMemberProfile.findUnique({
            where: { id: orphan.profileId },
          });
          if (!profile) {
            return;
          }

          const decrementAmount = Math.min(profile.reservedLimit, orphan.amount);
          const updated = await rawTx.groupMemberProfile.update({
            where: { id: profile.id },
            data: {
              reservedLimit: { decrement: decrementAmount },
              limitBalance: { increment: orphan.amount },
            },
          });

          await this.txRepo.create(
            {
              profileId: profile.id,
              groupJid: orphan.groupJid,
              userJid: orphan.userJid,
              asset: MemberTransactionAsset.LIMIT,
              type: MemberTransactionType.FEATURE_REFUND,
              amount: orphan.amount,
              balanceBefore: profile.reservedLimit,
              balanceAfter: updated.reservedLimit,
              feature: orphan.feature ?? undefined,
              correlationId,
              idempotencyKey: `orphan-refund:${correlationId}`,
              note: `Orphan reservation recovery (${String(olderThanMinutes)}m timeout)`,
            },
            tx,
          );

          recoveredCount++;
        });
      } catch (err: unknown) {
        logger.error(
          { err, correlationId: orphan.correlationId, profileId: orphan.profileId },
          "Failed to reconcile orphaned limit reservation",
        );
      }
    }

    return recoveredCount;
  }
}

export const memberEconomyService = new MemberEconomyService();
