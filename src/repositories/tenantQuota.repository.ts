import { TenantQuotaTransactionType } from "@prisma/client";
import type {
  HeavyFeatureType,
  Prisma,
  TenantOwnerQuota,
  TenantQuotaSource,
  TenantQuotaTransaction,
} from "@prisma/client";

import { prisma, type PrismaTransactionClient } from "./prismaClient";

type Client = typeof prisma | PrismaTransactionClient;

export interface QuotaMutationInput {
  ownerJid: string;
  actorJid?: string;
  groupJid?: string;
  amount: number;
  source: TenantQuotaSource;
  note?: string;
}

export interface QuotaReservationInput {
  ownerJid: string;
  actorJid?: string;
  groupJid?: string;
  amount: number;
  source: TenantQuotaSource;
  feature: HeavyFeatureType;
  correlationId: string;
}

export class TenantQuotaRepository {
  constructor(private readonly client: Client = prisma) {}

  findByOwnerJid(ownerJid: string): Promise<TenantOwnerQuota | null> {
    return this.client.tenantOwnerQuota.findUnique({
      where: { ownerJid },
    });
  }

  listAll(): Promise<TenantOwnerQuota[]> {
    return this.client.tenantOwnerQuota.findMany({
      orderBy: { updatedAt: "desc" },
    });
  }

  ensureForOwner(ownerJid: string): Promise<TenantOwnerQuota> {
    return this.client.tenantOwnerQuota.upsert({
      where: { ownerJid },
      create: { ownerJid },
      update: {},
    });
  }

  addQuota(input: QuotaMutationInput): Promise<TenantOwnerQuota> {
    return prisma.$transaction(async (tx) => {
      const quota = await tx.tenantOwnerQuota.upsert({
        where: { ownerJid: input.ownerJid },
        create: {
          ownerJid: input.ownerJid,
          remainingQuota: input.amount,
          totalAddedQuota: input.amount,
        },
        update: {
          remainingQuota: { increment: input.amount },
          totalAddedQuota: { increment: input.amount },
        },
      });

      await this.createTransaction(tx, {
        ownerJid: input.ownerJid,
        actorJid: input.actorJid,
        groupJid: input.groupJid,
        amount: input.amount,
        type: TenantQuotaTransactionType.ADD,
        source: input.source,
        note: input.note,
      });

      return quota;
    });
  }

  setQuota(input: QuotaMutationInput): Promise<TenantOwnerQuota> {
    return prisma.$transaction(async (tx) => {
      const quota = await tx.tenantOwnerQuota.upsert({
        where: { ownerJid: input.ownerJid },
        create: {
          ownerJid: input.ownerJid,
          remainingQuota: input.amount,
          totalAddedQuota: input.amount,
        },
        update: {
          remainingQuota: input.amount,
        },
      });

      await this.createTransaction(tx, {
        ownerJid: input.ownerJid,
        actorJid: input.actorJid,
        groupJid: input.groupJid,
        amount: input.amount,
        type: TenantQuotaTransactionType.SET,
        source: input.source,
        note: input.note,
      });

      return quota;
    });
  }

  reserveQuota(input: QuotaReservationInput): Promise<TenantOwnerQuota> {
    return prisma.$transaction(async (tx) => {
      const currentQuota = await tx.tenantOwnerQuota.findUnique({
        where: { ownerJid: input.ownerJid },
      });

      if (!currentQuota || currentQuota.remainingQuota < input.amount) {
        throw new Error("Kuota fitur berat tidak cukup");
      }

      const quota = await tx.tenantOwnerQuota.update({
        where: { ownerJid: input.ownerJid },
        data: {
          remainingQuota: { decrement: input.amount },
          reservedQuota: { increment: input.amount },
        },
      });

      await this.createTransaction(tx, {
        ownerJid: input.ownerJid,
        actorJid: input.actorJid,
        groupJid: input.groupJid,
        amount: input.amount,
        type: TenantQuotaTransactionType.RESERVE,
        source: input.source,
        feature: input.feature,
        correlationId: input.correlationId,
      });

      return quota;
    });
  }

  consumeReservedQuota(input: QuotaReservationInput): Promise<TenantOwnerQuota> {
    return prisma.$transaction(async (tx) => {
      const currentQuota = await tx.tenantOwnerQuota.findUnique({
        where: { ownerJid: input.ownerJid },
      });

      if (!currentQuota || currentQuota.reservedQuota < input.amount) {
        throw new Error("Kuota fitur berat yang direservasi tidak cukup");
      }

      const quota = await tx.tenantOwnerQuota.update({
        where: { ownerJid: input.ownerJid },
        data: {
          reservedQuota: { decrement: input.amount },
        },
      });

      await this.createTransaction(tx, {
        ownerJid: input.ownerJid,
        actorJid: input.actorJid,
        groupJid: input.groupJid,
        amount: input.amount,
        type: TenantQuotaTransactionType.CONSUME,
        source: input.source,
        feature: input.feature,
        correlationId: input.correlationId,
      });

      return quota;
    });
  }

  refundReservedQuota(input: QuotaReservationInput): Promise<TenantOwnerQuota> {
    return prisma.$transaction(async (tx) => {
      const currentQuota = await tx.tenantOwnerQuota.findUnique({
        where: { ownerJid: input.ownerJid },
      });

      if (!currentQuota || currentQuota.reservedQuota < input.amount) {
        throw new Error("Kuota fitur berat yang direservasi tidak cukup");
      }

      const quota = await tx.tenantOwnerQuota.update({
        where: { ownerJid: input.ownerJid },
        data: {
          remainingQuota: { increment: input.amount },
          reservedQuota: { decrement: input.amount },
        },
      });

      await this.createTransaction(tx, {
        ownerJid: input.ownerJid,
        actorJid: input.actorJid,
        groupJid: input.groupJid,
        amount: input.amount,
        type: TenantQuotaTransactionType.REFUND,
        source: input.source,
        feature: input.feature,
        correlationId: input.correlationId,
      });

      return quota;
    });
  }

  listTransactions(ownerJid: string): Promise<TenantQuotaTransaction[]> {
    return this.client.tenantQuotaTransaction.findMany({
      where: { ownerJid },
      orderBy: { createdAt: "desc" },
    });
  }

  private createTransaction(
    tx: PrismaTransactionClient,
    data: Prisma.TenantQuotaTransactionUncheckedCreateInput,
  ): Promise<TenantQuotaTransaction> {
    return tx.tenantQuotaTransaction.create({ data });
  }
}
