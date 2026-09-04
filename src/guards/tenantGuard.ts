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

  private readonly tenantCache = new Map<string, { tenant: TenantGroup | null; cachedAt: number }>();
  private static readonly CACHE_TTL_MS = 20_000; // 20 detik

  invalidateCache(groupJid: string): void {
    this.tenantCache.delete(groupJid);
  }

  isInfoCommand(commandName: string): boolean {
    return EXPIRED_ALLOWED_COMMANDS.has(commandName.toLowerCase());
  }

  private async loadCurrentTenant(groupJid: string, actorJid: string): Promise<TenantGroup | null> {
    const cached = this.tenantCache.get(groupJid);
    const now = Date.now();
    let tenantGroup: TenantGroup | null;

    if (cached && now - cached.cachedAt < TenantGuard.CACHE_TTL_MS) {
      tenantGroup = cached.tenant;
    } else {
      tenantGroup = await this.tenantGroupRepository.findByGroupJid(groupJid);
      this.tenantCache.set(groupJid, { tenant: tenantGroup, cachedAt: now });

      if (this.tenantCache.size > 500) {
        for (const [key, item] of this.tenantCache.entries()) {
          if (now - item.cachedAt >= TenantGuard.CACHE_TTL_MS) {
            this.tenantCache.delete(key);
          }
        }
      }
    }

    if (
      tenantGroup?.status === TenantStatus.ACTIVE &&
      tenantGroup.expiresAt &&
      tenantGroup.expiresAt.getTime() <= now
    ) {
      const expired = await this.markExpired(tenantGroup, actorJid);
      this.tenantCache.set(groupJid, { tenant: expired, cachedAt: now });
      return expired;
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
