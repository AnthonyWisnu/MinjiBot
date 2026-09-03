import { MemberTransactionAsset, MemberTransactionType } from "@prisma/client";
import type { GroupMemberProfile } from "@prisma/client";

import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { GroupMemberTransactionRepository } from "../../repositories/groupMemberTransaction.repository";
import { prisma } from "../../repositories/prismaClient";
import { InsufficientPointsError, InvalidAmountError } from "../../types/memberEconomy";
import { generateCorrelationId } from "./memberEconomy.service";

export const LIMIT_PRICE_POINTS = 100;
const MAX_SAFE_LIMIT_AMOUNT = 1_000_000;

export interface LimitPurchaseResult {
  limitsBought: number;
  pointsSpent: number;
  currentPoints: number;
  currentLimit: number;
}

// Minimal interfaces for DI and testing.
interface PurchaseProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
}

interface PurchaseTxStore {
  create(
    data: {
      profileId: string;
      groupJid: string;
      userJid: string;
      asset: MemberTransactionAsset;
      type: MemberTransactionType;
      amount: number;
      balanceBefore?: number;
      balanceAfter?: number;
      correlationId?: string;
    },
    tx?: unknown,
  ): Promise<unknown>;
}

interface PurchaseDb {
  $transaction<T>(fn: (tx: PurchaseTx) => Promise<T>): Promise<T>;
}

interface PurchaseTx {
  groupMemberProfile: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    findUniqueOrThrow(args: { where: Record<string, unknown> }): Promise<GroupMemberProfile>;
  };
}

export class LimitPurchaseService {
  constructor(
    private readonly profileRepo: PurchaseProfileStore = new GroupMemberProfileRepository(),
    private readonly txRepo: PurchaseTxStore = new GroupMemberTransactionRepository(),
    private readonly db: PurchaseDb = prisma,
  ) {}

  async buyLimit(
    groupJid: string,
    userJid: string,
    amount: number,
  ): Promise<LimitPurchaseResult> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new InvalidAmountError("Jumlah limit harus bilangan bulat positif");
    }
    if (amount > MAX_SAFE_LIMIT_AMOUNT) {
      throw new InvalidAmountError("Jumlah limit terlalu besar");
    }

    const totalPrice = amount * LIMIT_PRICE_POINTS;
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);

      // Atomic: debit points and credit limit in one SQL round-trip.
      const result = await tx.groupMemberProfile.updateMany({
        where: {
          id: profile.id,
          pointsBalance: { gte: totalPrice },
        },
        data: {
          pointsBalance: { decrement: totalPrice },
          limitBalance: { increment: amount },
          totalLimitsEarned: { increment: amount },
        },
      });

      if (result.count === 0) {
        throw new InsufficientPointsError(
          `Poin tidak cukup. Dibutuhkan ${totalPrice.toLocaleString("id-ID")} poin.`,
        );
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: profile.id },
      });

      // Two ledger entries with shared correlationId.
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.POINT,
          type: MemberTransactionType.LIMIT_PURCHASE_POINT_DEBIT,
          amount: totalPrice,
          balanceBefore: profile.pointsBalance,
          balanceAfter: updated.pointsBalance,
          correlationId,
        },
        tx,
      );

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.LIMIT,
          type: MemberTransactionType.LIMIT_PURCHASE_LIMIT_CREDIT,
          amount,
          balanceBefore: profile.limitBalance,
          balanceAfter: updated.limitBalance,
          correlationId,
        },
        tx,
      );

      return {
        limitsBought: amount,
        pointsSpent: totalPrice,
        currentPoints: updated.pointsBalance,
        currentLimit: updated.limitBalance,
      };
    });
  }
}

export const limitPurchaseService = new LimitPurchaseService();
