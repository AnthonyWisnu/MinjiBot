import type { GroupMetadata } from "@whiskeysockets/baileys";

import {
  moderationGuard,
  type ModerationGuard,
} from "../../guards/moderationGuard";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import { TenantGroupSettingRepository } from "../../repositories/tenantGroupSetting.repository";
import { WarnRepository } from "../../repositories/warn.repository";
import type { CommandContext } from "../../types/command";
import { getIdentityCandidateJids, normalizeJid, normalizeUserJid } from "../../utils/jid";
import { extractTargetJidFromMessage } from "../../utils/moderationTarget";

const WIB_TIMEZONE = "Asia/Jakarta";

export interface WarnResult {
  message: string;
  mentions: string[];
}

export class WarnService {
  constructor(
    private readonly warnRepo: WarnRepository = new WarnRepository(),
    private readonly groupSettingRepo: TenantGroupSettingRepository = new TenantGroupSettingRepository(),
    private readonly tenantGroupRepo: TenantGroupRepository = new TenantGroupRepository(),
    private readonly guard: ModerationGuard = moderationGuard,
  ) {}

  async warn(context: CommandContext): Promise<WarnResult> {
    this.assertGroup(context);

    const { targetJid, reason } = await this.resolveTargetAndReason(context);
    const tenantGroup = (await this.tenantGroupRepo.findByGroupJid(context.chatJid)) ?? undefined;
    const moderationContext = await this.guard.resolveContext({
      socket: context.socket,
      groupJid: context.chatJid,
      senderJids: getIdentityCandidateJids(context.senderUserJid),
      targetJids: getIdentityCandidateJids(targetJid),
      tenantGroup,
    });

    this.assertCanModerate(moderationContext.sender);

    if (this.guard.isProtectedUser(moderationContext.target)) {
      throw new Error("[ERROR] Tidak dapat memberikan peringatan kepada bot, owner, atau super owner.");
    }

    if (
      moderationContext.target.isGroupAdmin &&
      !moderationContext.sender.isSuperOwner &&
      !moderationContext.sender.isTenantOwner
    ) {
      throw new Error("[ERROR] Hanya Owner yang dapat memberikan peringatan kepada sesama admin.");
    }

    // Record warning
    await this.warnRepo.create({
      groupJid: context.chatJid,
      userJid: targetJid,
      issuerJid: context.senderUserJid,
      reason,
    });

    const activeCount = await this.warnRepo.countActiveWarnings(context.chatJid, targetJid);
    const settings = await this.groupSettingRepo.ensureForGroup(context.chatJid);
    const threshold = settings.warnThreshold;
    const targetMention = `@${targetJid.split("@")[0] ?? ""}`;

    // Check if threshold reached
    if (activeCount >= threshold) {
      if (settings.warnAction === "KICK") {
        if (moderationContext.botIsAdmin) {
          try {
            await context.socket.groupParticipantsUpdate(context.chatJid, [targetJid], "remove");
            await this.warnRepo.resetWarnings(context.chatJid, targetJid);

            return {
              message: [
                "🚨 *[ PERINGATAN MAKSIMAL ]* 🚨",
                "",
                `Member ${targetMention} telah mencapai batas *${String(activeCount)} / ${String(threshold)}* peringatan!`,
                `• Alasan terakhir: ${reason}`,
                "",
                "🚪 *Member telah otomatis dikeluarkan dari grup.* Riwayat peringatan telah direset.",
              ].join("\n"),
              mentions: [targetJid],
            };
          } catch {
            return {
              message: [
                "🚨 *[ PERINGATAN MAKSIMAL ]* 🚨",
                "",
                `Member ${targetMention} telah mencapai batas *${String(activeCount)} / ${String(threshold)}* peringatan!`,
                `• Alasan terakhir: ${reason}`,
                "",
                "⚠️ Gagal mengeluarkan member secara otomatis. Mohon admin mengeluarkan secara manual.",
              ].join("\n"),
              mentions: [targetJid],
            };
          }
        } else {
          return {
            message: [
              "🚨 *[ PERINGATAN MAKSIMAL ]* 🚨",
              "",
              `Member ${targetMention} telah mencapai batas *${String(activeCount)} / ${String(threshold)}* peringatan!`,
              `• Alasan terakhir: ${reason}`,
              "",
              "⚠️ *Bot bukan admin grup*, sehingga tidak dapat mengeluarkan member secara otomatis. Silakan admin grup menindaklanjuti.",
            ].join("\n"),
            mentions: [targetJid],
          };
        }
      }
    }

    return {
      message: [
        "⚠️ *[ PERINGATAN PELANGGARAN ]* ⚠️",
        "",
        `Member: ${targetMention}`,
        `Alasan: ${reason}`,
        `Status: *${String(activeCount)} / ${String(threshold)}* peringatan`,
        "",
        `_Hati-hati! Mencapai ${String(threshold)} peringatan akan otomatis dikeluarkan dari grup._`,
      ].join("\n"),
      mentions: [targetJid],
    };
  }

  async unwarn(context: CommandContext): Promise<WarnResult> {
    this.assertGroup(context);

    const targetJid = await this.resolveTargetJid(context);
    const tenantGroup = (await this.tenantGroupRepo.findByGroupJid(context.chatJid)) ?? undefined;
    const moderationContext = await this.guard.resolveContext({
      socket: context.socket,
      groupJid: context.chatJid,
      senderJids: getIdentityCandidateJids(context.senderUserJid),
      targetJids: getIdentityCandidateJids(targetJid),
      tenantGroup,
    });

    this.assertCanModerate(moderationContext.sender);

    const removed = await this.warnRepo.removeLatestWarning(context.chatJid, targetJid);
    const targetMention = `@${targetJid.split("@")[0] ?? ""}`;

    if (!removed) {
      return {
        message: `[INFO] ${targetMention} tidak memiliki riwayat peringatan.`,
        mentions: [targetJid],
      };
    }

    const activeCount = await this.warnRepo.countActiveWarnings(context.chatJid, targetJid);
    const settings = await this.groupSettingRepo.ensureForGroup(context.chatJid);

    return {
      message: [
        "✅ *[ PERINGATAN DIBATALKAN ]*",
        "",
        `1 poin peringatan untuk ${targetMention} berhasil dihapus.`,
        `• Peringatan yang dihapus: "${removed.reason}"`,
        `• Status saat ini: *${String(activeCount)} / ${String(settings.warnThreshold)}* peringatan`,
      ].join("\n"),
      mentions: [targetJid],
    };
  }

  async getWarns(context: CommandContext): Promise<WarnResult> {
    this.assertGroup(context);

    let targetJid = extractTargetJidFromMessage(context, { allowPhoneArgument: true });
    targetJid ??= context.senderUserJid;

    const warnings = await this.warnRepo.findWarnings(context.chatJid, targetJid);
    const settings = await this.groupSettingRepo.ensureForGroup(context.chatJid);
    const targetMention = `@${targetJid.split("@")[0] ?? ""}`;

    if (warnings.length === 0) {
      return {
        message: `[INFO] ${targetMention} tidak memiliki riwayat peringatan. Status aman!`,
        mentions: [targetJid],
      };
    }

    const mentions = [targetJid];
    const lines = [
      "📋 *[ RIWAYAT PERINGATAN ]*",
      "",
      `Member: ${targetMention}`,
      `Total: *${String(warnings.length)} / ${String(settings.warnThreshold)}* peringatan`,
      "",
      "Daftar Pelanggaran:",
    ];

    warnings.forEach((warn, index) => {
      const issuerMention = `@${warn.issuerJid.split("@")[0] ?? ""}`;
      mentions.push(warn.issuerJid);
      const dateStr = formatDateTimeWib(warn.createdAt);
      lines.push(`${String(index + 1)}. ${dateStr}`);
      lines.push(`   • Alasan: ${warn.reason}`);
      lines.push(`   • Oleh: ${issuerMention}`);
    });

    return {
      message: lines.join("\n"),
      mentions: [...new Set(mentions)],
    };
  }

  async resetWarn(context: CommandContext): Promise<WarnResult> {
    this.assertGroup(context);

    const targetJid = await this.resolveTargetJid(context);
    const tenantGroup = (await this.tenantGroupRepo.findByGroupJid(context.chatJid)) ?? undefined;
    const moderationContext = await this.guard.resolveContext({
      socket: context.socket,
      groupJid: context.chatJid,
      senderJids: getIdentityCandidateJids(context.senderUserJid),
      targetJids: getIdentityCandidateJids(targetJid),
      tenantGroup,
    });

    this.assertCanModerate(moderationContext.sender);

    const deletedCount = await this.warnRepo.resetWarnings(context.chatJid, targetJid);
    const targetMention = `@${targetJid.split("@")[0] ?? ""}`;

    if (deletedCount === 0) {
      return {
        message: `[INFO] ${targetMention} tidak memiliki peringatan untuk direset.`,
        mentions: [targetJid],
      };
    }

    return {
      message: [
        "🔄 *[ RESET PERINGATAN ]*",
        "",
        `Seluruh poin peringatan (*${String(deletedCount)} poin*) untuk ${targetMention} berhasil direset menjadi 0.`,
      ].join("\n"),
      mentions: [targetJid],
    };
  }

  async setWarnThreshold(context: CommandContext): Promise<string> {
    this.assertGroup(context);

    const rawNum = context.args[0];
    const threshold = Number(rawNum);

    if (!rawNum || Number.isNaN(threshold) || threshold < 1 || threshold > 10) {
      throw new Error("[ERROR] Batas peringatan harus berupa angka antara 1 sampai 10. Contoh: .setwarn 3");
    }

    const tenantGroup = (await this.tenantGroupRepo.findByGroupJid(context.chatJid)) ?? undefined;
    const moderationContext = await this.guard.resolveContext({
      socket: context.socket,
      groupJid: context.chatJid,
      senderJids: getIdentityCandidateJids(context.senderUserJid),
      targetJids: getIdentityCandidateJids(context.senderUserJid),
      tenantGroup,
    });

    if (
      !moderationContext.sender.isSuperOwner &&
      !moderationContext.sender.isTenantOwner &&
      !moderationContext.sender.isTenantAdmin
    ) {
      throw new Error("[ERROR] Hanya Tenant Owner atau Tenant Admin yang dapat mengubah batas peringatan.");
    }

    await this.groupSettingRepo.update(context.chatJid, {
      warnThreshold: threshold,
    });

    return `✅ Batas peringatan grup berhasil diubah menjadi *${String(threshold)}* kali.`;
  }

  private assertGroup(context: CommandContext): void {
    if (!context.isGroup) {
      throw new Error("[ERROR] Command ini hanya dapat digunakan di dalam grup.");
    }
  }

  private assertCanModerate(sender: { isSuperOwner: boolean; isTenantOwner: boolean; isTenantAdmin: boolean; isGroupAdmin: boolean }): void {
    if (!sender.isSuperOwner && !sender.isTenantOwner && !sender.isTenantAdmin && !sender.isGroupAdmin) {
      throw new Error("[ERROR] Kamu tidak memiliki izin untuk menggunakan command moderasi ini.");
    }
  }

  private async resolveTargetJid(context: CommandContext): Promise<string> {
    const targetJid = extractTargetJidFromMessage(context, { allowPhoneArgument: true });
    if (!targetJid) {
      throw new Error("[ERROR] Tag (@user) atau reply pesan target.");
    }

    const metadata = await context.socket.groupMetadata(context.chatJid);
    this.assertUserInGroup(metadata, targetJid);

    return targetJid;
  }

  private async resolveTargetAndReason(context: CommandContext): Promise<{ targetJid: string; reason: string }> {
    const targetFromMentionOrPhone = extractTargetJidFromMessage(context, { allowPhoneArgument: true });
    const isQuoted = Boolean(context.quoted?.participantJid);

    let targetJid: string | null = null;
    let reason = "Melanggar peraturan grup";

    if (isQuoted && context.quoted?.participantJid && (!context.mentionedJids.length && !context.args[0]?.match(/^\+?\d{8,15}$/))) {
      targetJid = normalizeUserJid(context.quoted.participantJid);
      const text = context.args.join(" ").trim();
      if (text.length > 0) {
        reason = text;
      }
    } else {
      targetJid = targetFromMentionOrPhone;
      const text = context.args.slice(1).join(" ").trim();
      if (text.length > 0) {
        reason = text;
      }
    }

    if (!targetJid) {
      throw new Error("[ERROR] Tag (@user) atau reply pesan target untuk diberi peringatan.\nContoh: .warn @user spam stiker");
    }

    const metadata = await context.socket.groupMetadata(context.chatJid);
    this.assertUserInGroup(metadata, targetJid);

    return { targetJid, reason };
  }

  private assertUserInGroup(metadata: GroupMetadata, targetJid: string): void {
    const candidateJids = getIdentityCandidateJids(targetJid);
    const exists = metadata.participants.some((participant) =>
      candidateJids.includes(normalizeJid(participant.id)),
    );

    if (!exists) {
      throw new Error("[ERROR] Target tidak ada di grup ini.");
    }
  }
}

function formatDateTimeWib(date: Date): string {
  const formatted = new Intl.DateTimeFormat("id-ID", {
    timeZone: WIB_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  return `${formatted} WIB`;
}

export const warnService = new WarnService();
