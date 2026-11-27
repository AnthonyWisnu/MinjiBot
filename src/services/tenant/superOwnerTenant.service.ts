import { TenantAuditAction, TenantStatus, type TenantGroup } from "@prisma/client";

import { AppUserError } from "../../errors/appUserError";
import { prisma } from "../../repositories/prismaClient";
import { TenantAuditRepository } from "../../repositories/tenantAudit.repository";
import { TenantFeatureRepository } from "../../repositories/tenantFeature.repository";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import { TenantGroupSettingRepository } from "../../repositories/tenantGroupSetting.repository";
import { tenantGuard } from "../../guards/tenantGuard";
import { tenantFeatureService } from "./tenantFeature.service";
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
  constructor(private readonly tenantGroupRepository = new TenantGroupRepository()) {}

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

    const result = await prisma.$transaction(async (tx) => {
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

    tenantGuard.invalidateCache(result.tenantGroup.groupJid);
    tenantFeatureService.invalidateCache(result.tenantGroup.groupJid);

    return result;
  }

  async extendTenant(
    tenantCode: string,
    durationText: string,
    actorJid: string,
  ): Promise<TenantGroup> {
    const tenantGroup = await this.findTenantByCodeOrThrow(tenantCode);
    if (tenantGroup.status === TenantStatus.PENDING || !tenantGroup.ownerJid) {
      throw new AppUserError(
        "Tenant belum diaktifkan. Gunakan .tenant activate <kode> <@owner> <durasi> terlebih dahulu.",
      );
    }

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
    if (tenantGroup.status === TenantStatus.PENDING || !tenantGroup.ownerJid) {
      throw new AppUserError(
        "Tenant belum diaktifkan. Gunakan .tenant activate <kode> <@owner> <durasi> terlebih dahulu.",
      );
    }

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

    const result = await prisma.$transaction(async (tx) => {
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

    tenantGuard.invalidateCache(result.groupJid);
    tenantFeatureService.invalidateCache(result.groupJid);

    return result;
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
    const result = await prisma.$transaction(async (tx) => {
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

    tenantGuard.invalidateCache(result.groupJid);
    tenantFeatureService.invalidateCache(result.groupJid);

    return result;
  }

  private async setTenantBlocked(
    tenantCode: string,
    blocked: boolean,
    actorJid: string,
  ): Promise<TenantGroup> {
    const tenantGroup = await this.findTenantByCodeOrThrow(tenantCode);

    let restoredStatus: TenantStatus = TenantStatus.ACTIVE;
    if (!blocked) {
      if (!tenantGroup.ownerJid) {
        restoredStatus = TenantStatus.PENDING;
      } else if (tenantGroup.expiresAt && tenantGroup.expiresAt.getTime() <= Date.now()) {
        restoredStatus = TenantStatus.EXPIRED;
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const tenantGroupRepository = new TenantGroupRepository(tx);
      const tenantAuditRepository = new TenantAuditRepository(tx);
      const updatedTenant = await tenantGroupRepository.setBlocked(
        tenantGroup.tenantCode,
        blocked,
        restoredStatus,
      );

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

    tenantGuard.invalidateCache(result.groupJid);
    tenantFeatureService.invalidateCache(result.groupJid);

    return result;
  }
}

export const superOwnerTenantService = new SuperOwnerTenantService();
