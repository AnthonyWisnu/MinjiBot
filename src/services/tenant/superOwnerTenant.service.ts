import {
  TenantAuditAction,
  TenantQuotaSource,
  TenantQuotaTransactionType,
  TenantStatus,
  type TenantGroup,
  type TenantOwnerQuota,
} from "@prisma/client";

import { prisma } from "../../repositories/prismaClient";
import { TenantAuditRepository } from "../../repositories/tenantAudit.repository";
import { TenantFeatureRepository } from "../../repositories/tenantFeature.repository";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import { TenantGroupSettingRepository } from "../../repositories/tenantGroupSetting.repository";
import { TenantQuotaRepository } from "../../repositories/tenantQuota.repository";
import { addDuration, parseDateOnly } from "../../utils/time";

export interface ActivateTenantInput {
  selector: string;
  ownerJid: string;
  durationText: string;
  initialQuota: number;
  actorJid: string;
}

export interface ActivatedTenantResult {
  tenantGroup: TenantGroup;
  ownerQuota: TenantOwnerQuota;
}

export interface TenantInfoResult {
  tenantGroup: TenantGroup;
  ownerQuota: TenantOwnerQuota | null;
}

export type TenantListFilter = "visible" | "all" | "removed";

export class SuperOwnerTenantService {
  constructor(
    private readonly tenantGroupRepository = new TenantGroupRepository(),
    private readonly tenantQuotaRepository = new TenantQuotaRepository(),
  ) {}

  listPendingGroups(): Promise<TenantGroup[]> {
    return this.tenantGroupRepository.listPending();
  }

  listTenants(filter: TenantListFilter = "visible"): Promise<TenantGroup[]> {
    if (filter === "all") {
      return this.tenantGroupRepository.listAll();
    }

    if (filter === "removed") {
      return this.tenantGroupRepository.listRemoved();
    }

    return this.tenantGroupRepository.listVisible();
  }

  async getTenantInfo(tenantCode: string): Promise<TenantInfoResult> {
    const tenantGroup = await this.findTenantByCodeOrThrow(tenantCode);
    const ownerQuota = tenantGroup.ownerJid
      ? await this.tenantQuotaRepository.findByOwnerJid(tenantGroup.ownerJid)
      : null;

    return { tenantGroup, ownerQuota };
  }

  async activateTenant(input: ActivateTenantInput): Promise<ActivatedTenantResult> {
    if (input.initialQuota < 0) {
      throw new Error("Kuota awal tidak boleh negatif.");
    }

    const pendingTenant = await this.resolvePendingTenant(input.selector);
    const expiresAt = addDuration(new Date(), input.durationText);

    return prisma.$transaction(async (tx) => {
      const tenantGroupRepository = new TenantGroupRepository(tx);
      const tenantFeatureRepository = new TenantFeatureRepository(tx);
      const tenantGroupSettingRepository = new TenantGroupSettingRepository(tx);
      const tenantAuditRepository = new TenantAuditRepository(tx);

      const currentTenant = await tenantGroupRepository.findByGroupJid(pendingTenant.groupJid);
      if (currentTenant?.status !== TenantStatus.PENDING) {
        throw new Error("Tenant pending tidak ditemukan atau sudah diproses.");
      }

      const activatedTenant = await tenantGroupRepository.activate({
        tenantCode: currentTenant.tenantCode,
        ownerJid: input.ownerJid,
        expiresAt,
        actorJid: input.actorJid,
      });

      await tenantFeatureRepository.ensureForGroup(activatedTenant.groupJid);
      await tenantGroupSettingRepository.ensureForGroup(activatedTenant.groupJid);

      const ownerQuota = await tx.tenantOwnerQuota.upsert({
        where: { ownerJid: input.ownerJid },
        create: {
          ownerJid: input.ownerJid,
          remainingQuota: input.initialQuota,
          totalAddedQuota: input.initialQuota,
        },
        update: {
          remainingQuota: { increment: input.initialQuota },
          totalAddedQuota: { increment: input.initialQuota },
        },
      });

      if (input.initialQuota > 0) {
        await tx.tenantQuotaTransaction.create({
          data: {
            ownerJid: input.ownerJid,
            groupJid: activatedTenant.groupJid,
            actorJid: input.actorJid,
            amount: input.initialQuota,
            type: TenantQuotaTransactionType.ADD,
            source: TenantQuotaSource.SUPER_OWNER,
            note: "Kuota awal aktivasi tenant",
          },
        });

        await tenantAuditRepository.create({
          groupJid: activatedTenant.groupJid,
          actorJid: input.actorJid,
          action: TenantAuditAction.QUOTA_ADDED,
          metadata: {
            ownerJid: input.ownerJid,
            amount: input.initialQuota,
          },
        });
      }

      await tenantAuditRepository.create({
        groupJid: activatedTenant.groupJid,
        actorJid: input.actorJid,
        action: TenantAuditAction.TENANT_ACTIVATED,
        metadata: {
          tenantCode: activatedTenant.tenantCode,
          ownerJid: input.ownerJid,
          expiresAt: activatedTenant.expiresAt?.toISOString(),
          initialQuota: input.initialQuota,
        },
      });

      return {
        tenantGroup: activatedTenant,
        ownerQuota,
      };
    });
  }

  async extendTenant(
    tenantCode: string,
    durationText: string,
    actorJid: string,
  ): Promise<TenantGroup> {
    const tenantGroup = await this.findTenantByCodeOrThrow(tenantCode);
    const now = new Date();
    const baseDate =
      tenantGroup.expiresAt && tenantGroup.expiresAt.getTime() > now.getTime()
        ? tenantGroup.expiresAt
        : now;
    const expiresAt = addDuration(baseDate, durationText);

    return this.updateTenantExpiry(
      tenantGroup,
      expiresAt,
      actorJid,
      TenantAuditAction.TENANT_EXTENDED,
    );
  }

  async setTenantExpire(
    tenantCode: string,
    dateText: string,
    actorJid: string,
  ): Promise<TenantGroup> {
    const tenantGroup = await this.findTenantByCodeOrThrow(tenantCode);
    const expiresAt = parseDateOnly(dateText);

    return this.updateTenantExpiry(
      tenantGroup,
      expiresAt,
      actorJid,
      TenantAuditAction.TENANT_EXTENDED,
    );
  }

  async blockTenant(tenantCode: string, actorJid: string): Promise<TenantGroup> {
    return this.setTenantBlocked(tenantCode, true, actorJid);
  }

  async unblockTenant(tenantCode: string, actorJid: string): Promise<TenantGroup> {
    return this.setTenantBlocked(tenantCode, false, actorJid);
  }

  async removeTenant(tenantCode: string, actorJid: string): Promise<TenantGroup> {
    const tenantGroup = await this.findTenantByCodeOrThrow(tenantCode);

    return prisma.$transaction(async (tx) => {
      const tenantGroupRepository = new TenantGroupRepository(tx);
      const tenantAuditRepository = new TenantAuditRepository(tx);
      const removedTenant = await tenantGroupRepository.remove(tenantGroup.tenantCode);

      await tenantAuditRepository.create({
        groupJid: removedTenant.groupJid,
        actorJid,
        action: TenantAuditAction.TENANT_REMOVED,
        metadata: {
          tenantCode: removedTenant.tenantCode,
        },
      });

      return removedTenant;
    });
  }

  private async resolvePendingTenant(selector: string): Promise<TenantGroup> {
    if (/^\d+$/.test(selector)) {
      const index = Number(selector);
      const pendingGroups = await this.tenantGroupRepository.listPending();
      const tenantGroup = pendingGroups[index - 1];

      if (!tenantGroup) {
        throw new Error("Nomor tenant pending tidak ditemukan.");
      }

      return tenantGroup;
    }

    const tenantGroup = await this.tenantGroupRepository.findByTenantCode(selector.toUpperCase());
    if (tenantGroup?.status !== TenantStatus.PENDING) {
      throw new Error("Kode tenant pending tidak ditemukan.");
    }

    return tenantGroup;
  }

  private async findTenantByCodeOrThrow(tenantCode: string): Promise<TenantGroup> {
    const tenantGroup = await this.tenantGroupRepository.findByTenantCode(tenantCode.toUpperCase());

    if (!tenantGroup) {
      throw new Error("Tenant tidak ditemukan.");
    }

    return tenantGroup;
  }

  private async updateTenantExpiry(
    tenantGroup: TenantGroup,
    expiresAt: Date,
    actorJid: string,
    action: TenantAuditAction,
  ): Promise<TenantGroup> {
    return prisma.$transaction(async (tx) => {
      const tenantGroupRepository = new TenantGroupRepository(tx);
      const tenantAuditRepository = new TenantAuditRepository(tx);
      const nextStatus = tenantGroup.isBlocked ? TenantStatus.BLOCKED : TenantStatus.ACTIVE;

      const updatedTenant = await tenantGroupRepository.updateByGroupJid(tenantGroup.groupJid, {
        expiresAt,
        status: nextStatus,
      });

      await tenantAuditRepository.create({
        groupJid: updatedTenant.groupJid,
        actorJid,
        action,
        metadata: {
          tenantCode: updatedTenant.tenantCode,
          expiresAt: expiresAt.toISOString(),
        },
      });

      return updatedTenant;
    });
  }

  private async setTenantBlocked(
    tenantCode: string,
    blocked: boolean,
    actorJid: string,
  ): Promise<TenantGroup> {
    const tenantGroup = await this.findTenantByCodeOrThrow(tenantCode);

    return prisma.$transaction(async (tx) => {
      const tenantGroupRepository = new TenantGroupRepository(tx);
      const tenantAuditRepository = new TenantAuditRepository(tx);
      const updatedTenant = await tenantGroupRepository.setBlocked(tenantGroup.tenantCode, blocked);

      await tenantAuditRepository.create({
        groupJid: updatedTenant.groupJid,
        actorJid,
        action: blocked ? TenantAuditAction.TENANT_BLOCKED : TenantAuditAction.TENANT_UNBLOCKED,
        metadata: {
          tenantCode: updatedTenant.tenantCode,
        },
      });

      return updatedTenant;
    });
  }
}

export const superOwnerTenantService = new SuperOwnerTenantService();
