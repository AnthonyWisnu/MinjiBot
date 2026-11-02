import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupMemberProfile,
  type GroupMemberTransaction,
} from "@prisma/client";
import { MemberEconomyService } from "../src/services/member/memberEconomy.service";
import { buildMemberProfile } from "./helpers/factories";

void test("reconcileOrphanedReservations: refunds 20-minute orphaned limit reservation", async () => {
  const profile: GroupMemberProfile = buildMemberProfile({
    id: "prof_1",
    groupJid: "group@g.us",
    userJid: "user@s.whatsapp.net",
    pointsBalance: 1000,
    limitBalance: 5,
    reservedLimit: 2,
    experience: 100,
    lastDailyClaimAt: null,
    totalGamesPlayed: 0,
    totalGamesWon: 0,
    totalPointsEarned: 1000,
    totalLimitsEarned: 5,
  });

  const oldReserveTx: GroupMemberTransaction = {
    id: "tx_reserve_1",
    profileId: "prof_1",
    groupJid: "group@g.us",
    userJid: "user@s.whatsapp.net",
    actorJid: null,
    targetUserJid: null,
    asset: MemberTransactionAsset.LIMIT,
    type: MemberTransactionType.FEATURE_RESERVE,
    amount: 2,
    balanceBefore: 7,
    balanceAfter: 5,
    feature: null,
    correlationId: "corr_orphan_1",
    idempotencyKey: null,
    metadata: null,
    note: null,
    createdAt: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes ago
  };

  const transactions: GroupMemberTransaction[] = [oldReserveTx];

  const mockDb = {
    groupMemberTransaction: {
      findMany: async (args: {
        where: { correlationId?: { in: string[] }; type?: { in: MemberTransactionType[] } };
      }) => {
        if (args.where.correlationId?.in) {
          // Settled check: return any tx that has matching correlationId and is CONSUME or REFUND
          return transactions.filter(
            (t) =>
              args.where.correlationId?.in?.includes(t.correlationId!) &&
              (t.type === MemberTransactionType.FEATURE_CONSUME ||
                t.type === MemberTransactionType.FEATURE_REFUND),
          );
        }
        // Fetch candidate reserve transactions
        return transactions.filter((t) => t.type === MemberTransactionType.FEATURE_RESERVE);
      },
      findUnique: async (args: { where: { idempotencyKey?: string } }) => {
        return transactions.find((t) => t.idempotencyKey === args.where.idempotencyKey) ?? null;
      },
    },
    groupMemberProfile: {
      findUnique: async (args: { where: { id: string } }) => {
        return args.where.id === profile.id ? profile : null;
      },
      update: async (args: {
        where: { id: string };
        data: { reservedLimit: { decrement: number }; limitBalance: { increment: number } };
      }) => {
        profile.reservedLimit -= args.data.reservedLimit.decrement;
        profile.limitBalance += args.data.limitBalance.increment;
        return profile;
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      return fn(mockDb);
    },
  };

  const mockTxRepo = {
    create: async (data: Record<string, unknown>) => {
      const createdTx = {
        ...data,
        id: `tx_${transactions.length + 1}`,
        createdAt: new Date(),
      } as unknown as GroupMemberTransaction;
      transactions.push(createdTx);
      return createdTx;
    },
    findByIdempotencyKey: async () => null,
  };

  const economyService = new MemberEconomyService(
    {} as never,
    mockTxRepo as never,
    mockDb as never,
  );

  // Initial run: should recover 1 orphaned reservation
  const recoveredCount = await economyService.reconcileOrphanedReservations(15);
  assert.equal(recoveredCount, 1);
  assert.equal(profile.limitBalance, 7, "Limit balance should be refunded to 7");
  assert.equal(profile.reservedLimit, 0, "Reserved limit should be decremented to 0");

  const refundTx = transactions.find((t) => t.type === MemberTransactionType.FEATURE_REFUND);
  assert.ok(refundTx, "Should record a FEATURE_REFUND transaction");
  assert.equal(refundTx?.idempotencyKey, "orphan-refund:corr_orphan_1");

  // Second run: must be idempotent and recover 0
  const secondRunCount = await economyService.reconcileOrphanedReservations(15);
  assert.equal(secondRunCount, 0, "Second run should recover 0 already settled reservations");
  assert.equal(profile.limitBalance, 7, "Balance should remain 7");
});
