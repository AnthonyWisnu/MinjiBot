import {
  type HeavyFeatureType,
  TenantAuditAction,
  TenantQuotaSource,
  TenantQuotaTransactionType,
  type TenantGroup,
  type TenantOwnerQuota,
} from "@prisma/client";

import { prisma } from "../../repositories/prismaClient";
import { TenantAuditRepository } from "../../repositories/tenantAudit.repository";
import { TenantQuotaRepository } from "../../repositories/tenantQuota.repository";

interface TenantQuotaStore {
  findByOwnerJid(ownerJid: string): Promise<TenantOwnerQuota | null>;
  listAll(): Promise<TenantOwnerQuota[]>;
  reserveQuota(input: {
    ownerJid: string;
    actorJid?: string;
    groupJid?: string;
    amount: number;
    source: TenantQuotaSource;
    feature: HeavyFeatureType;
    correlationId: string;
  }): Promise<TenantOwnerQuota>;
  consumeReservedQuota(input: {
    ownerJid: string;
    actorJid?: string;
    groupJid?: string;
    amount: number;
    source: TenantQuotaSource;
    feature: HeavyFeatureType;
    correlationId: string;
  }): Promise<TenantOwnerQuota>;
  refundReservedQuota(input: {
    ownerJid: string;
    actorJid?: string;
    groupJid?: string;
    amount: number;
    source: TenantQuotaSource;
    feature: HeavyFeatureType;
    correlationId: string;
  }): Promise<TenantOwnerQuota>;
}

export interface OwnerQuotaMutationInput {
  ownerJid: string;
  actorJid: string;
  amount: number;
}

export interface QuotaReservationInput {
  ownerJid: string;
  actorJid: string;
  groupJid?: string;
  source: TenantQuotaSource;
  feature: HeavyFeatureType;
  correlationId: string;
}

export class TenantQuotaService {
  constructor(
    private readonly tenantQuotaRepository: TenantQuotaStore = new TenantQuotaRepository(),
  ) {}

  getOwnerQuota(ownerJid: string): Promise<TenantOwnerQuota | null> {
    return this.tenantQuotaRepository.findByOwnerJid(ownerJid);
  }

  listOwnerQuota(): Promise<TenantOwnerQuota[]> {
    return this.tenantQuotaRepository.listAll();
  }

  async getGroupQuota(tenantGroup: TenantGroup): Promise<TenantOwnerQuota | null> {
    if (!tenantGroup.ownerJid) {
      return null;
    }

    return this.tenantQuotaRepository.findByOwnerJid(tenantGroup.ownerJid);
  }

  async addOwnerQuota(input: OwnerQuotaMutationInput): Promise<TenantOwnerQuota> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new Error("Jumlah quota harus berupa angka lebih dari nol.");
    }

    return prisma.$transaction(async (tx) => {
      const tenantAuditRepository = new TenantAuditRepository(tx);
      const ownerQuota = await tx.tenantOwnerQuota.upsert({
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

      await tx.tenantQuotaTransaction.create({
        data: {
          ownerJid: input.ownerJid,
          actorJid: input.actorJid,
          amount: input.amount,
          type: TenantQuotaTransactionType.ADD,
          source: TenantQuotaSource.SUPER_OWNER,
          note: "Quota ditambahkan oleh Super Owner",
        },
      });

      await tenantAuditRepository.create({
        actorJid: input.actorJid,
        action: TenantAuditAction.QUOTA_ADDED,
        metadata: {
          ownerJid: input.ownerJid,
          amount: input.amount,
        },
      });

      return ownerQuota;
    });
  }

  async setOwnerQuota(input: OwnerQuotaMutationInput): Promise<TenantOwnerQuota> {
    if (!Number.isInteger(input.amount) || input.amount < 0) {
      throw new Error("Jumlah quota harus berupa angka nol atau lebih.");
    }

    return prisma.$transaction(async (tx) => {
      const tenantAuditRepository = new TenantAuditRepository(tx);
      const ownerQuota = await tx.tenantOwnerQuota.upsert({
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

      await tx.tenantQuotaTransaction.create({
        data: {
          ownerJid: input.ownerJid,
          actorJid: input.actorJid,
          amount: input.amount,
          type: TenantQuotaTransactionType.SET,
          source: TenantQuotaSource.SUPER_OWNER,
          note: "Quota diatur oleh Super Owner",
        },
      });

      await tenantAuditRepository.create({
        actorJid: input.actorJid,
        action: TenantAuditAction.QUOTA_SET,
        metadata: {
          ownerJid: input.ownerJid,
          amount: input.amount,
        },
      });

      return ownerQuota;
    });
  }

  reserveHeavyFeatureQuota(input: QuotaReservationInput): Promise<TenantOwnerQuota> {
    return this.tenantQuotaRepository.reserveQuota({
      ownerJid: input.ownerJid,
      actorJid: input.actorJid,
      groupJid: input.groupJid,
      amount: 1,
      source: input.source,
      feature: input.feature,
      correlationId: input.correlationId,
    });
  }

  consumeHeavyFeatureQuota(input: QuotaReservationInput): Promise<TenantOwnerQuota> {
    return this.tenantQuotaRepository.consumeReservedQuota({
      ownerJid: input.ownerJid,
      actorJid: input.actorJid,
      groupJid: input.groupJid,
      amount: 1,
      source: input.source,
      feature: input.feature,
      correlationId: input.correlationId,
    });
  }

  refundHeavyFeatureQuota(input: QuotaReservationInput): Promise<TenantOwnerQuota> {
    return this.tenantQuotaRepository.refundReservedQuota({
      ownerJid: input.ownerJid,
      actorJid: input.actorJid,
      groupJid: input.groupJid,
      amount: 1,
      source: input.source,
      feature: input.feature,
      correlationId: input.correlationId,
    });
  }
}

export const tenantQuotaService = new TenantQuotaService();
