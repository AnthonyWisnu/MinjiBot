import { env } from "../config/env";
import { logger } from "../config/logger";
import { TenantAdminRepository } from "../repositories/tenantAdmin.repository";
import { TenantGroupRepository } from "../repositories/tenantGroup.repository";
import type { Role } from "../types/role";
import { normalizeUserJid } from "../utils/jid";

export interface RoleResolutionInput {
  chatJid: string;
  senderJid: string;
  isGroup: boolean;
}

export class RoleGuard {
  private readonly superOwnerJids = new Set(
    env.SUPER_OWNER_JIDS.map((jid) => normalizeUserJid(jid)),
  );

  constructor(
    private readonly tenantGroupRepository = new TenantGroupRepository(),
    private readonly tenantAdminRepository = new TenantAdminRepository(),
  ) {}

  async resolveRole(input: RoleResolutionInput): Promise<Role> {
    const senderJid = normalizeUserJid(input.senderJid);

    if (this.isSuperOwner(senderJid)) {
      return "SUPER_OWNER";
    }

    try {
      if (input.isGroup) {
        return await this.resolveGroupRole(input.chatJid, senderJid);
      }

      return await this.resolvePrivateRole(senderJid);
    } catch (error: unknown) {
      logger.error(
        {
          error,
          senderJid,
          chatJid: input.chatJid,
          isGroup: input.isGroup,
        },
        "Gagal resolve role pengguna",
      );

      return "MEMBER";
    }
  }

  isSuperOwner(userJid: string): boolean {
    return this.superOwnerJids.has(normalizeUserJid(userJid));
  }

  hasRole(role: Role, allowedRoles: readonly Role[]): boolean {
    return allowedRoles.includes(role);
  }

  assertRole(role: Role, allowedRoles: readonly Role[]): void {
    if (!this.hasRole(role, allowedRoles)) {
      throw new Error("Akses command tidak diizinkan");
    }
  }

  private async resolveGroupRole(groupJid: string, senderJid: string): Promise<Role> {
    const tenantGroup = await this.tenantGroupRepository.findByGroupJid(groupJid);

    if (tenantGroup?.ownerJid && normalizeUserJid(tenantGroup.ownerJid) === senderJid) {
      return "TENANT_OWNER";
    }

    const isTenantAdmin = await this.tenantAdminRepository.exists(groupJid, senderJid);
    if (isTenantAdmin) {
      return "TENANT_ADMIN";
    }

    return "MEMBER";
  }

  private async resolvePrivateRole(senderJid: string): Promise<Role> {
    const isTenantOwner = await this.tenantGroupRepository.ownerExists(senderJid);

    return isTenantOwner ? "TENANT_OWNER" : "MEMBER";
  }
}

export const roleGuard = new RoleGuard();
