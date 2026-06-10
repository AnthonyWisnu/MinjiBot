import type { TenantGroup } from "@prisma/client";

import { env } from "../../config/env";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import { TenantSessionRepository } from "../../repositories/tenantSession.repository";
import { addDays } from "../../utils/time";

export interface CurrentTenantResult {
  tenantGroup: TenantGroup | null;
  expired: boolean;
}

export class TenantOwnerSessionService {
  constructor(
    private readonly tenantGroupRepository = new TenantGroupRepository(),
    private readonly tenantSessionRepository = new TenantSessionRepository(),
  ) {}

  listOwnedTenants(ownerJid: string): Promise<TenantGroup[]> {
    return this.tenantGroupRepository.listByOwnerJid(ownerJid);
  }

  async selectTenant(ownerJid: string, selector: string): Promise<TenantGroup> {
    const tenantGroup = await this.resolveOwnedTenant(ownerJid, selector);
    await this.tenantSessionRepository.upsert(
      ownerJid,
      tenantGroup.groupJid,
      this.createSessionExpiresAt(),
    );

    return tenantGroup;
  }

  async getCurrentTenant(ownerJid: string): Promise<CurrentTenantResult> {
    const session = await this.tenantSessionRepository.findByUserJid(ownerJid);
    if (!session) {
      return {
        tenantGroup: null,
        expired: false,
      };
    }

    if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
      await this.tenantSessionRepository.clearByUserJid(ownerJid);
      return {
        tenantGroup: null,
        expired: true,
      };
    }

    const tenantGroup = await this.tenantGroupRepository.findByGroupJid(session.groupJid);
    if (tenantGroup?.ownerJid !== ownerJid) {
      await this.tenantSessionRepository.clearByUserJid(ownerJid);
      return {
        tenantGroup: null,
        expired: false,
      };
    }

    await this.tenantSessionRepository.upsert(
      ownerJid,
      tenantGroup.groupJid,
      this.createSessionExpiresAt(),
    );

    return {
      tenantGroup,
      expired: false,
    };
  }

  async clearCurrentTenant(ownerJid: string): Promise<void> {
    await this.tenantSessionRepository.clearByUserJid(ownerJid);
  }

  private async resolveOwnedTenant(ownerJid: string, selector: string): Promise<TenantGroup> {
    const ownedTenants = await this.tenantGroupRepository.listByOwnerJid(ownerJid);

    if (/^\d+$/.test(selector)) {
      const index = Number(selector);
      const tenantGroup = ownedTenants[index - 1];

      if (!tenantGroup) {
        throw new Error("Nomor tenant tidak ditemukan.");
      }

      return tenantGroup;
    }

    const normalizedCode = selector.toUpperCase();
    const tenantGroup = ownedTenants.find((tenant) => tenant.tenantCode === normalizedCode);

    if (!tenantGroup) {
      throw new Error("Kode tenant tidak ditemukan atau bukan milik kamu.");
    }

    return tenantGroup;
  }

  private createSessionExpiresAt(): Date {
    return addDays(new Date(), env.TENANT_SESSION_TTL_DAYS);
  }
}

export const tenantOwnerSessionService = new TenantOwnerSessionService();
