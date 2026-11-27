import { groupMemberProfileRepository } from "../repositories/groupMemberProfile.repository";
import type { CommandContext } from "../types/command";
import { getIdentityCandidateJids } from "./jid";

/**
 * Validasi otorisasi command media/kreatif di chat grup atau Direct Message (DM).
 * - Di dalam grup: selalu lolos (pembatasan tenant/fitur ditangani oleh TenantGuard & FeatureGuard).
 * - Di dalam DM:
 *   - SUPER_OWNER: selalu lolos.
 *   - TENANT_OWNER: lolos jika memiliki setidaknya satu tenant aktif (diverifikasi oleh RoleGuard & repository).
 *   - MEMBER biasa: lolos HANYA jika terdaftar di setidaknya satu grup tenant aktif (tidak diblokir & belum expired).
 */
export async function isMediaCommandAllowed(context: CommandContext): Promise<boolean> {
  if (context.isGroup) {
    return true;
  }

  if (context.role === "SUPER_OWNER" || context.role === "TENANT_OWNER") {
    return true;
  }

  const candidateJids = getIdentityCandidateJids(context.senderUserJid, context.senderAltJids);
  for (const jid of candidateJids) {
    const activeProfiles = await groupMemberProfileRepository.findActiveByUser(jid);
    if (activeProfiles.length > 0) {
      return true;
    }
  }

  return false;
}
