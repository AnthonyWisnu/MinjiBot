import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import type { CommandContext } from "../../types/command";
import { getIdentityCandidateJids, normalizeUserJid } from "../../utils/jid";

/**
 * Result of resolving member access to a heavy feature.
 *
 * skipLimit = true  -- Super Owner atau Tenant Owner di grup/private miliknya sendiri.
 *                      Tidak ada limit yang di-charge. Tidak ada ledger entry.
 *
 * skipLimit = false -- Member biasa atau Tenant Owner di grup lain.
 *                      groupJid dan userJid digunakan untuk charge dari profil member.
 *
 * groupJid = "PRIVATE" -- Private chat member biasa. Command handler harus
 *                          memanggil heavyFeatureLimitService.resolvePrivateChatGroupJid().
 */
export type HeavyFeatureAccessResult =
  | {
      allowed: true;
      skipLimit: true;
    }
  | {
      allowed: true;
      skipLimit: false;
      groupJid: string;
      userJid: string;
    }
  | {
      allowed: false;
      message: string;
    };

export class HeavyFeatureAccessService {
  constructor(private readonly tenantGroupRepository = new TenantGroupRepository()) {}

  async resolveAccess(context: CommandContext): Promise<HeavyFeatureAccessResult> {
    if (context.isGroup) {
      return this.resolveGroupAccess(context);
    }

    return this.resolvePrivateAccess(context);
  }

  private resolveGroupAccess(context: CommandContext): HeavyFeatureAccessResult {
    const tenantGroup = context.tenantGroup;
    if (!tenantGroup) {
      return { allowed: false, message: "Grup ini bukan tenant aktif." };
    }

    if (context.role === "SUPER_OWNER") {
      return { allowed: true, skipLimit: true };
    }

    const senderCandidates = getIdentityCandidateJids(context.senderUserJid, context.senderAltJids);
    const ownerNormalized = tenantGroup.ownerJid ? normalizeUserJid(tenantGroup.ownerJid) : null;

    if (ownerNormalized && senderCandidates.includes(ownerNormalized)) {
      return { allowed: true, skipLimit: true };
    }

    return {
      allowed: true,
      skipLimit: false,
      groupJid: context.chatJid,
      userJid: context.senderUserJid,
    };
  }

  private async resolvePrivateAccess(context: CommandContext): Promise<HeavyFeatureAccessResult> {
    if (context.role === "SUPER_OWNER") {
      return { allowed: true, skipLimit: true };
    }

    if (context.role === "TENANT_OWNER") {
      const senderCandidates = getIdentityCandidateJids(
        context.senderUserJid,
        context.senderAltJids,
      );
      for (const jid of senderCandidates) {
        const activeTenantGroups = await this.tenantGroupRepository.listActiveByOwnerJid(jid);
        if (activeTenantGroups.length > 0) {
          return { allowed: true, skipLimit: true };
        }
      }
      // LOG-06: Jika pengirim bukan owner aktif di grup mana pun, jangan langsung menolak;
      // lanjutkan fallback ke resolusi profil MEMBER di grup aktif tempat ia tergabung.
    }

    return {
      allowed: true,
      skipLimit: false,
      groupJid: "PRIVATE",
      userJid: context.senderUserJid,
    };
  }
}

export const heavyFeatureAccessService = new HeavyFeatureAccessService();
