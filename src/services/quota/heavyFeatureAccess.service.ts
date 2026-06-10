import { TenantQuotaSource, type TenantOwnerQuota } from "@prisma/client";

import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import type { CommandContext } from "../../types/command";
import { tenantQuotaService } from "./tenantQuota.service";

export type HeavyFeatureQuotaContext =
  | {
      allowed: true;
      ownerJid: string;
      groupJid?: string;
      source: TenantQuotaSource;
      skipQuota: boolean;
    }
  | {
      allowed: false;
      message: string;
    };

export class HeavyFeatureAccessService {
  constructor(private readonly tenantGroupRepository = new TenantGroupRepository()) {}

  async resolveQuotaContext(context: CommandContext): Promise<HeavyFeatureQuotaContext> {
    if (context.isGroup) {
      return this.resolveGroupQuotaContext(context);
    }

    return this.resolvePrivateQuotaContext(context);
  }

  getQuotaEmptyMessage(context: CommandContext): string {
    if (context.isGroup) {
      return "Kuota fitur berat grup ini habis.\nSilakan hubungi Tenant Owner.";
    }

    return "Kuota fitur berat kamu habis.\nHubungi Super Owner untuk menambah kuota.";
  }

  private async resolveGroupQuotaContext(
    context: CommandContext,
  ): Promise<HeavyFeatureQuotaContext> {
    const tenantGroup = context.tenantGroup;
    if (!tenantGroup?.ownerJid) {
      return {
        allowed: false,
        message: "Tenant Owner grup ini belum diatur.",
      };
    }

    const ownerQuota = await tenantQuotaService.getOwnerQuota(tenantGroup.ownerJid);
    if (!hasUsableQuota(ownerQuota)) {
      return {
        allowed: false,
        message: this.getQuotaEmptyMessage(context),
      };
    }

    return {
      allowed: true,
      ownerJid: tenantGroup.ownerJid,
      groupJid: tenantGroup.groupJid,
      source: TenantQuotaSource.GROUP_COMMAND,
      skipQuota: false,
    };
  }

  private async resolvePrivateQuotaContext(
    context: CommandContext,
  ): Promise<HeavyFeatureQuotaContext> {
    if (context.role === "MEMBER" || context.role === "TENANT_ADMIN") {
      return {
        allowed: false,
        message:
          "Fitur ini hanya tersedia untuk Tenant Owner di private chat.\nGunakan fitur ini di grup tenant aktif jika tersedia.",
      };
    }

    if (context.role === "SUPER_OWNER") {
      return {
        allowed: true,
        ownerJid: context.senderJid,
        source: TenantQuotaSource.PRIVATE_COMMAND,
        skipQuota: true,
      };
    }

    const activeTenantGroups = await this.tenantGroupRepository.listActiveByOwnerJid(
      context.senderJid,
    );
    if (activeTenantGroups.length === 0) {
      return {
        allowed: false,
        message:
          "Kamu belum memiliki tenant aktif.\nHubungi Super Owner untuk aktivasi atau perpanjangan.",
      };
    }

    const ownerQuota = await tenantQuotaService.getOwnerQuota(context.senderJid);
    if (!hasUsableQuota(ownerQuota)) {
      return {
        allowed: false,
        message: this.getQuotaEmptyMessage(context),
      };
    }

    return {
      allowed: true,
      ownerJid: context.senderJid,
      groupJid: activeTenantGroups[0]?.groupJid,
      source: TenantQuotaSource.PRIVATE_COMMAND,
      skipQuota: false,
    };
  }
}

function hasUsableQuota(ownerQuota: TenantOwnerQuota | null): boolean {
  return Boolean(ownerQuota && ownerQuota.remainingQuota > 0);
}

export const heavyFeatureAccessService = new HeavyFeatureAccessService();
