import {
  TenantAuditAction,
  TenantStatus,
  type TenantGroup,
} from "@prisma/client";

import { prisma } from "../../repositories/prismaClient";
import { TenantAuditRepository } from "../../repositories/tenantAudit.repository";
import { TenantFeatureRepository } from "../../repositories/tenantFeature.repository";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import { TenantGroupSettingRepository } from "../../repositories/tenantGroupSetting.repository";
import { addDuration, parseDateOnly } from "../../utils/time";

export interface ActivateTenantInput {
  selector: string;
  ownerJid: string;
  durationText: string;
  actorJid: string;
}

export interface ActivatedTenantResult {
  tenantGroup: TenantGroup;
}

export interface TenantInfoResult {
  tenantGroup: TenantGroup;
}

export type TenantListFilter = "visible" | "all" | "removed";

export class SuperOwnerTenantService {
  constructor(
    private readonly tenantGroupRepository = new TenantGroupRepository(),
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
    return { tenantGroup };
  }

  async activateTenant(input: ActivateTenantInput): Promise<ActivatedTenantResult> {
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

      await tenantAuditRepository.create({
        groupJid: activatedTenant.groupJid,
        actorJid: input.actorJid,
        action: TenantAuditAction.TENANT_ACTIVATED,
        metadata: {
          tenantCode: activatedTenant.tenantCode,
          ownerJid: input.ownerJid,
          expiresAt: activatedTenant.expiresAt?.toISOString(),
        },
      });

      return { tenantGroup: activatedTenant };
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
