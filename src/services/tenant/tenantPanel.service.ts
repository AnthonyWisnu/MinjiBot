import type { WASocket } from "@whiskeysockets/baileys";
import type { TenantGroup } from "@prisma/client";

import { TenantAdminRepository } from "../../repositories/tenantAdmin.repository";
import { TenantFeatureRepository } from "../../repositories/tenantFeature.repository";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import { TenantGroupSettingRepository } from "../../repositories/tenantGroupSetting.repository";
import { tenantOwnerSessionService } from "./tenantOwnerSession.service";
import type { CommandContext } from "../../types/command";
import { getIdentityCandidateJids, normalizeJid, normalizeUserJid } from "../../utils/jid";

const WIB_TIMEZONE = "Asia/Jakarta";

export interface PanelResult {
  message: string;
  mentions: string[];
}

export class TenantPanelService {
  constructor(
    private readonly tenantGroupRepo: TenantGroupRepository = new TenantGroupRepository(),
    private readonly tenantAdminRepo: TenantAdminRepository = new TenantAdminRepository(),
    private readonly tenantFeatureRepo: TenantFeatureRepository = new TenantFeatureRepository(),
    private readonly groupSettingRepo: TenantGroupSettingRepository = new TenantGroupSettingRepository(),
  ) {}

  async renderPanel(context: CommandContext): Promise<PanelResult> {
    const tenantGroup = await this.resolveTenantGroup(context);
    const mentions: string[] = [];

    // 1. Feature & Group Settings
    const feature = await this.tenantFeatureRepo.ensureForGroup(tenantGroup.groupJid);
    const groupSetting = await this.groupSettingRepo.ensureForGroup(tenantGroup.groupJid);

    // 2. Admins
    const tenantAdmins = await this.tenantAdminRepo.listByGroupJid(tenantGroup.groupJid);
    if (tenantGroup.ownerJid) {
      mentions.push(normalizeUserJid(tenantGroup.ownerJid));
    }
    for (const admin of tenantAdmins) {
      mentions.push(normalizeUserJid(admin.userJid));
    }

    // 3. Bot Admin Status
    let botAdminStatus = "Chat Pribadi";
    if (context.isGroup && context.chatJid === tenantGroup.groupJid) {
      const isBotAdmin = await this.checkBotIsAdmin(context.socket, context.chatJid);
      botAdminStatus = isBotAdmin
        ? "✅ Admin Grup (Aktif)"
        : "⚠️ Bukan Admin (Jadikan admin)";
    }

    // 4. Expiry / Active Days
    const expiryInfo = this.formatExpiryInfo(tenantGroup);

    // 5. Build Panel Text
    const lines = [
      "╭── ⚡ *MINJIBOT TENANT PANEL* ──╮",
      `│ 🏢 *${tenantGroup.name ?? "Tanpa Nama"}*`,
      "╰────────────────────────╯",
      "",
      "📋 *INFORMASI SEWA*",
      `• Tenant Code : ${tenantGroup.tenantCode}`,
      `• Status Sewa : ${this.formatStatusBadge(tenantGroup.status)}`,
      `• Masa Aktif  : ${expiryInfo}`,
      `• Status Bot  : ${botAdminStatus}`,
      "",
      "👥 *TIM PENGELOLA*",
      `• Tenant Owner : ${tenantGroup.ownerJid ? `@${tenantGroup.ownerJid.split("@")[0] ?? ""}` : "-"}`,
      `• Tenant Admin : ${this.formatAdminList(tenantAdmins.map((a) => a.userJid))}`,
      "",
      "🛡️ *MODERASI & KEAMANAN*",
      `• Anti-Link     : ${this.fmtBool(feature.antiLinkEnabled)} (Kick: ${this.fmtBool(groupSetting.antiLinkAutoKick)})`,
      `• Anti-Spam     : ${this.fmtBool(feature.antiSpamEnabled)} (Mode: ${groupSetting.antiSpamMode})`,
      `• Anti-Delete   : ${this.fmtBool(feature.antiDeleteEnabled)}`,
      `• Anti-ViewOnce : ${this.fmtBool(feature.antiViewOnceEnabled)}`,
      `• Anti-Raid     : ${this.fmtBool(feature.antiRaidEnabled)} (Surge: ${String(groupSetting.antiRaidThreshold)}/${String(groupSetting.antiRaidWindowSec)}s)`,
      `• Peringatan    : Max ${String(groupSetting.warnThreshold)}x (${groupSetting.warnAction})`,
      "",
      "📢 *NOTIFIKASI*",
      `• Welcome Msg   : ${this.fmtBool(feature.welcomeEnabled)}`,
      `• Goodbye Msg   : ${this.fmtBool(feature.goodbyeEnabled)}`,
      "",
      "🎮 *HIBURAN & UTILITAS*",
      `• Game & Kuis   : ${this.fmtBool(feature.gameEnabled)}`,
      `• Downloader    : ${this.fmtBool(feature.downloaderEnabled)}`,
      `• AI Photo (HD) : ${this.fmtBool(feature.hdEnabled)}`,
      `• Pengingat     : ${this.fmtBool(feature.reminderEnabled)}`,
      `• Tag All       : ${this.fmtBool(feature.tagAllEnabled)}`,
      "",
      "⚙️ *PANDUAN KONTROL CEPAT*",
      "• .feature <fitur> <on/off>",
      "• .setwelcome / .setgoodbye <teks>",
      "• .setwarn <1-10> | .antiraid setting",
      "• .grup <buka|tutup>",
    ];

    return {
      message: lines.join("\n"),
      mentions: [...new Set(mentions)],
    };
  }

  private async resolveTenantGroup(context: CommandContext): Promise<TenantGroup> {
    this.assertCanAccessPanel(context);

    if (context.isGroup) {
      const group = await this.tenantGroupRepo.findByGroupJid(context.chatJid);
      if (!group) {
        throw new Error("[ERROR] Grup ini belum terdaftar sebagai tenant MinjiBot.");
      }
      return group;
    }

    // Private chat: resolve selected or owned tenant
    const session = await tenantOwnerSessionService.getCurrentTenant(context.senderUserJid);
    if (session.tenantGroup) {
      return session.tenantGroup;
    }

    const owned = await tenantOwnerSessionService.listOwnedTenants(context.senderUserJid);
    if (owned.length > 0 && owned[0]) {
      return owned[0];
    }

    throw new Error("[ERROR] Tidak ada tenant yang aktif dipilih. Gunakan .mytenant lalu .usetenant <kode>.");
  }

  private assertCanAccessPanel(context: CommandContext): void {
    if (
      context.role !== "SUPER_OWNER" &&
      context.role !== "TENANT_OWNER" &&
      context.role !== "TENANT_ADMIN"
    ) {
      throw new Error("[ERROR] Panel ini hanya dapat diakses oleh Tenant Owner, Tenant Admin, atau Super Owner.");
    }
  }

  private async checkBotIsAdmin(socket: WASocket, groupJid: string): Promise<boolean> {
    try {
      const metadata = await socket.groupMetadata(groupJid);
      const botRawId = socket.user?.id;
      if (!botRawId) return false;

      const botJids = getIdentityCandidateJids(botRawId);
      return metadata.participants.some(
        (p) => botJids.includes(normalizeJid(p.id)) && Boolean(p.admin),
      );
    } catch {
      return false;
    }
  }

  private formatExpiryInfo(tenantGroup: TenantGroup): string {
    if (!tenantGroup.expiresAt) {
      return "Permanen (Tanpa batas)";
    }

    const now = Date.now();
    const expiryTime = tenantGroup.expiresAt.getTime();
    const diffDays = Math.ceil((expiryTime - now) / (1000 * 60 * 60 * 24));
    const expiryFormatted = formatDateTimeWib(tenantGroup.expiresAt);

    if (diffDays <= 0) {
      return `❌ Kadaluarsa (${expiryFormatted})`;
    }

    return `${String(diffDays)} hari lagi (${expiryFormatted})`;
  }

  private formatStatusBadge(status: string): string {
    switch (status) {
      case "ACTIVE":
        return "🟢 AKTIF";
      case "PENDING":
        return "🟡 PENDING";
      case "EXPIRED":
        return "🔴 EXPIRED";
      case "BLOCKED":
        return "⛔ BLOCKED";
      default:
        return status;
    }
  }

  private formatAdminList(adminJids: string[]): string {
    if (adminJids.length === 0) return "Belum ada tenant admin";
    return adminJids.map((jid) => `@${jid.split("@")[0] ?? ""}`).join(", ");
  }

  private fmtBool(val: boolean): string {
    return val ? "🟢 ON" : "🔴 OFF";
  }
}

function formatDateTimeWib(date: Date): string {
  const formatted = new Intl.DateTimeFormat("id-ID", {
    timeZone: WIB_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);

  return formatted;
}

export const tenantPanelService = new TenantPanelService();
