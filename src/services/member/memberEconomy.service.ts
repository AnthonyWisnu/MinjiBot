import { randomUUID } from "node:crypto";

import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupMemberProfile,
  type HeavyFeatureType,
} from "@prisma/client";

import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { GroupMemberTransactionRepository } from "../../repositories/groupMemberTransaction.repository";
import { prisma } from "../../repositories/prismaClient";
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
    findUniqueOrThrow(args: {
      where: Record<string, unknown>;
    }): Promise<GroupMemberProfile>;
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<GroupMemberProfile>;
  };
}

// Profile store interface for dependency injection and testing.
interface ProfileStore {
  findOrCreate(
    groupJid: string,
    userJid: string,
    tx?: unknown,
  ): Promise<GroupMemberProfile>;
  findByGroupAndUser(
    groupJid: string,
    userJid: string,
    tx?: unknown,
  ): Promise<GroupMemberProfile | null>;
  findActiveByUser(
    userJid: string,
    now?: Date,
  ): Promise<GroupMemberProfile[]>;
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
}

function validatePositiveAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new InvalidAmountError();
  }
}

function validateNonNegativeAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new InvalidAmountError("Jumlah harus berupa bilangan bulat non-negatif");
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
  ) {}

  // ---- Profile ----

  async findOrCreateProfile(
    groupJid: string,
    userJid: string,
  ): Promise<GroupMemberProfile> {
    return this.profileRepo.findOrCreate(groupJid, userJid);
  }

  async findProfile(
    groupJid: string,
    userJid: string,
  ): Promise<GroupMemberProfile> {
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

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(input.groupJid, input.userJid, tx);

      const updated = await tx.groupMemberProfile.update({
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
          balanceAfter: updated.experience,
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          note: input.note,
        },
        tx,
      );

      return updated;
    });
  }

  async setXp(input: SetXpInput): Promise<GroupMemberProfile> {
    validateNonNegativeAmount(input.amount);

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(input.groupJid, input.userJid, tx);

      const updated = await tx.groupMemberProfile.update({
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
          balanceAfter: updated.experience,
          note: input.note,
        },
        tx,
      );

      return updated;
    });
  }

  // ---- Game statistics ----

  // Records game outcome without exposing direct profile mutation to game handlers.
  async recordGameResult(input: RecordGameResultInput): Promise<GroupMemberProfile> {
    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(input.groupJid, input.userJid, tx);

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          totalGamesPlayed: { increment: 1 },
          ...(input.won ? { totalGamesWon: { increment: 1 } } : {}),
        },
      });

      return updated;
    });
  }
}
