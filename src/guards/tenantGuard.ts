import { TenantAuditAction, TenantStatus, type TenantGroup } from "@prisma/client";

import { prisma } from "../repositories/prismaClient";
import { TenantAuditRepository } from "../repositories/tenantAudit.repository";
import { TenantGroupRepository } from "../repositories/tenantGroup.repository";
import type { CommandContext } from "../types/command";

const EXPIRED_ALLOWED_COMMANDS = new Set(["menu", "status", "tenantstatus", "owner", "whoami"]);

interface TenantGroupLookup {
  findByGroupJid(groupJid: string): Promise<TenantGroup | null>;
}

export type TenantGuardResult =
  | {
      allowed: true;
      tenantGroup?: TenantGroup;
    }
  | {
      allowed: false;
      message: string;
      tenantGroup?: TenantGroup;
    };

export class TenantGuard {
  constructor(
    private readonly tenantGroupRepository: TenantGroupLookup = new TenantGroupRepository(),
  ) {}

  async checkGroupCommandAccess(context: CommandContext): Promise<TenantGuardResult> {
    if (!context.isGroup) {
      return { allowed: true };
    }

    const tenantGroup = await this.loadCurrentTenant(context.chatJid, context.senderUserJid);
    context.tenantGroup = tenantGroup ?? undefined;

    if (!tenantGroup) {
      return {
        allowed: false,
        message: "Grup ini belum terdaftar sebagai tenant.",
      };
    }

    if (this.isInfoCommand(context.commandName)) {
      return {
        allowed: true,
        tenantGroup,
      };
    }

    if (tenantGroup.isBlocked || tenantGroup.status === TenantStatus.BLOCKED) {
      return {
        allowed: false,
        tenantGroup,
        message: "Grup ini sedang diblokir. Silakan hubungi owner bot.",
      };
    }

    if (tenantGroup.status === TenantStatus.PENDING) {
      return {
        allowed: false,
        tenantGroup,
        message: "Grup ini belum aktif sebagai tenant. Silakan hubungi owner bot untuk aktivasi.",
      };
    }

    if (tenantGroup.status === TenantStatus.REMOVED) {
      return {
        allowed: false,
        tenantGroup,
        message: "Grup ini sudah dihapus dari manajemen tenant.",
      };
    }

    if (tenantGroup.status === TenantStatus.EXPIRED) {
      return {
        allowed: false,
        tenantGroup,
        message: "Masa aktif grup ini sudah habis.\nSilakan hubungi owner bot untuk perpanjangan.",
      };
    }

    if (!tenantGroup.expiresAt || tenantGroup.expiresAt.getTime() <= Date.now()) {
      const expiredTenant = await this.markExpired(tenantGroup, context.senderUserJid);
      context.tenantGroup = expiredTenant;

      return {
        allowed: false,
        tenantGroup: expiredTenant,
        message: "Masa aktif grup ini sudah habis.\nSilakan hubungi owner bot untuk perpanjangan.",
      };
    }

    return {
      allowed: true,
      tenantGroup,
    };
  }

  isInfoCommand(commandName: string): boolean {
    return EXPIRED_ALLOWED_COMMANDS.has(commandName.toLowerCase());
  }

  private async loadCurrentTenant(groupJid: string, actorJid: string): Promise<TenantGroup | null> {
    const tenantGroup = await this.tenantGroupRepository.findByGroupJid(groupJid);

    if (
      tenantGroup?.status === TenantStatus.ACTIVE &&
      tenantGroup.expiresAt &&
      tenantGroup.expiresAt.getTime() <= Date.now()
    ) {
      return this.markExpired(tenantGroup, actorJid);
    }

    return tenantGroup;
  }

  private async markExpired(tenantGroup: TenantGroup, actorJid: string): Promise<TenantGroup> {
    return prisma.$transaction(async (tx) => {
      const tenantGroupRepository = new TenantGroupRepository(tx);
      const tenantAuditRepository = new TenantAuditRepository(tx);

      const expiredTenant = await tenantGroupRepository.updateStatus(
        tenantGroup.tenantCode,
        TenantStatus.EXPIRED,
      );

      await tenantAuditRepository.create({
        groupJid: expiredTenant.groupJid,
        actorJid,
        action: TenantAuditAction.TENANT_EXPIRED,
        metadata: {
          tenantCode: expiredTenant.tenantCode,
          expiresAt: expiredTenant.expiresAt?.toISOString(),
        },
      });

      return expiredTenant;
    });
  }
}

export const tenantGuard = new TenantGuard();
