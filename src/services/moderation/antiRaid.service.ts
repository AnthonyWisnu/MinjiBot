import type { WASocket } from "@whiskeysockets/baileys";

import { logger } from "../../config/logger";
import { AppUserError } from "../../errors/appUserError";
import { roleGuard } from "../../guards/roleGuard";
import { TenantFeatureRepository } from "../../repositories/tenantFeature.repository";
import { TenantGroupRepository } from "../../repositories/tenantGroup.repository";
import { TenantGroupSettingRepository } from "../../repositories/tenantGroupSetting.repository";
import type { CommandContext } from "../../types/command";
import { normalizeUserJid } from "../../utils/jid";
import { identityResolverService } from "../identity/identityResolver.service";
import { tenantFeatureService } from "../tenant/tenantFeature.service";

export class AntiRaidService {
  private readonly joinTimestampsByGroup = new Map<string, number[]>();
  private readonly lastLockdownByGroup = new Map<string, number>();

  private static readonly MAX_MAP_SIZE = 1_000;
  private static readonly LOCKDOWN_COOLDOWN_MS = 60_000; // 1 menit anti spam alert lockdown

  constructor(
    private readonly tenantGroupRepo: TenantGroupRepository = new TenantGroupRepository(),
    private readonly tenantFeatureRepo: TenantFeatureRepository = new TenantFeatureRepository(),
    private readonly groupSettingRepo: TenantGroupSettingRepository = new TenantGroupSettingRepository(),
  ) {}

  async handleParticipantsJoin(
    socket: WASocket,
    update: { id: string; action: string; participants: string[]; author?: string },
  ): Promise<boolean> {
    if (update.action !== "add" || !update.participants.length) {
      return false;
    }

    const groupJid = update.id;
    const tenantGroup = await this.tenantGroupRepo.findByGroupJid(groupJid);
    if (
      tenantGroup?.status !== "ACTIVE" ||
      tenantGroup.isBlocked ||
      (tenantGroup.expiresAt && tenantGroup.expiresAt.getTime() <= Date.now())
    ) {
      return false;
    }

    const feature = await this.tenantFeatureRepo.findByGroupJid(groupJid);
    if (!feature?.antiRaidEnabled) {
      return false;
    }

    // If an author added the participants, verify if author is immune (bot, super owner, tenant owner, group admin)
    if (update.author) {
      const authorJid = normalizeUserJid(update.author);
      const isBotOrOwner =
        authorJid === normalizeUserJid(socket.user?.id ?? "") ||
        roleGuard.isSuperOwner(authorJid) ||
        (tenantGroup.ownerJid !== null && authorJid === normalizeUserJid(tenantGroup.ownerJid));

      if (isBotOrOwner) {
        return false;
      }

      const isGroupAdmin = await identityResolverService.isGroupAdmin(socket, groupJid, authorJid);
      if (isGroupAdmin) {
        return false;
      }
    }

    const now = Date.now();
    const lastLockdown = this.lastLockdownByGroup.get(groupJid) ?? 0;
    if (now - lastLockdown < AntiRaidService.LOCKDOWN_COOLDOWN_MS) {
      return false;
    }

    const settings = await this.groupSettingRepo.ensureForGroup(groupJid);
    const threshold = settings.antiRaidThreshold;
    const windowMs = settings.antiRaidWindowSec * 1_000;

    this.pruneStaleRecords();

    const existing = this.joinTimestampsByGroup.get(groupJid) ?? [];
    const validTimestamps = existing.filter((t) => now - t <= windowMs);

    update.participants.forEach(() => {
      validTimestamps.push(now);
    });

    this.joinTimestampsByGroup.set(groupJid, validTimestamps);

    if (validTimestamps.length >= threshold) {
      this.lastLockdownByGroup.set(groupJid, now);
      this.joinTimestampsByGroup.delete(groupJid);

      logger.warn(
        {
          groupJid,
          count: validTimestamps.length,
          threshold,
          windowSec: settings.antiRaidWindowSec,
        },
        "Anti-Raid triggered: Surge member baru terdeteksi! Mengaktifkan emergency lockdown.",
      );

      await this.triggerEmergencyLockdown(
        socket,
        groupJid,
        tenantGroup.ownerJid,
        validTimestamps.length,
        settings.antiRaidWindowSec,
      );
      return true;
    }

    return false;
  }

  private async triggerEmergencyLockdown(
    socket: WASocket,
    groupJid: string,
    ownerJid: string | null,
    joinCount: number,
    windowSec: number,
  ): Promise<void> {
    // 1. Lock group to announcement
    try {
      await socket.groupSettingUpdate(groupJid, "announcement");
    } catch (error: unknown) {
      logger.error({ error, groupJid }, "Gagal mengunci grup saat Anti-Raid lockdown");
    }

    // 2. Revoke invite link
    try {
      await socket.groupRevokeInvite(groupJid);
    } catch (error: unknown) {
      logger.warn({ error, groupJid }, "Gagal mencabut invite link saat Anti-Raid lockdown");
    }

    // 3. Resolve admins & tenant owner for mention
    let mentions: string[] = [];
    try {
      const metadata = await socket.groupMetadata(groupJid);
      const adminJids = metadata.participants
        .filter((p) => Boolean(p.admin))
        .map((p) => normalizeUserJid(p.id));

      if (ownerJid) {
        adminJids.push(normalizeUserJid(ownerJid));
      }

      mentions = [...new Set(adminJids)];
    } catch (error: unknown) {
      logger.warn(
        { error, groupJid },
        "Gagal mengambil metadata grup untuk mention Anti-Raid alert",
      );
    }

    // 4. Send alert message
    const message = [
      "🚨 *[ EMERGENCY ANTI-RAID LOCKDOWN ]* 🚨",
      "",
      `⚠️ *Terdeteksi serbuan ${String(joinCount)} member baru dalam ${String(windowSec)} detik!*`,
      "Sistem pertahanan darurat MinjiBot telah diaktifkan untuk melindungi grup:",
      "",
      "🔒 *Status Grup*: Ditutup sementara (Hanya Admin yang dapat mengirim pesan).",
      "🔗 *Tautan Undangan*: Telah dicabut & di-reset secara otomatis.",
      "",
      "Kepada para pengelola grup:",
      "Silakan periksa member yang baru saja bergabung. Ketik *.grup buka* jika situasi sudah aman.",
    ].join("\n");

    try {
      await socket.sendMessage(groupJid, {
        text: message,
        mentions,
      });
    } catch (error: unknown) {
      logger.error({ error, groupJid }, "Gagal mengirim pesan Anti-Raid alert");
    }
  }

  async toggleAntiRaid(context: CommandContext, enabled: boolean): Promise<string> {
    this.assertGroup(context);
    this.assertCanManage(context);

    await this.tenantFeatureRepo.ensureForGroup(context.chatJid);
    await this.tenantFeatureRepo.update(context.chatJid, {
      antiRaidEnabled: enabled,
    });
    tenantFeatureService.invalidateCache(context.chatJid);

    return `🛡️ Anti-Raid Protection berhasil ${enabled ? "*diaktifkan (ON)*" : "*dinonaktifkan (OFF)*"}.`;
  }

  async configureSettings(
    context: CommandContext,
    threshold: number,
    windowSec: number,
  ): Promise<string> {
    this.assertGroup(context);
    this.assertCanManage(context);

    if (Number.isNaN(threshold) || threshold < 2 || threshold > 50) {
      throw new AppUserError("Threshold serbuan harus berupa angka antara 2 sampai 50.");
    }

    if (Number.isNaN(windowSec) || windowSec < 3 || windowSec > 120) {
      throw new AppUserError("Rentang waktu (detik) harus berupa angka antara 3 sampai 120 detik.");
    }

    await this.groupSettingRepo.ensureForGroup(context.chatJid);
    await this.groupSettingRepo.update(context.chatJid, {
      antiRaidThreshold: threshold,
      antiRaidWindowSec: windowSec,
    });

    return `🛡️ Setelan Anti-Raid berhasil diperbarui:\n• Batas Serbuan: *${String(threshold)} member*\n• Rentang Waktu: *${String(windowSec)} detik*`;
  }

  async getStatus(context: CommandContext): Promise<string> {
    this.assertGroup(context);

    const feature = await this.tenantFeatureRepo.findByGroupJid(context.chatJid);
    const settings = await this.groupSettingRepo.ensureForGroup(context.chatJid);
    const isEnabled = feature ? feature.antiRaidEnabled : true;

    return [
      "🛡️ *[ STATUS ANTI-RAID PROTECTION ]*",
      "",
      `• Status: ${isEnabled ? "✅ Aktif (ON)" : "❌ Nonaktif (OFF)"}`,
      `• Batas Serbuan: *${String(settings.antiRaidThreshold)} member*`,
      `• Rentang Waktu: *${String(settings.antiRaidWindowSec)} detik*`,
      "",
      "Aksi Darurat Otomatis jika terpicu:",
      "1. Grup otomatis dikunci (hanya admin yang dapat chat).",
      "2. Link undangan grup dicabut & di-reset.",
      "3. Mengirim peringatan darurat dan me-mention seluruh admin.",
    ].join("\n");
  }

  async setGroupMode(context: CommandContext, mode: "open" | "close"): Promise<string> {
    this.assertGroup(context);
    this.assertCanManage(context);

    const isBotAdmin = await identityResolverService.isBotGroupAdmin(
      context.socket,
      context.chatJid,
    );
    if (!isBotAdmin) {
      throw new AppUserError("Bot harus menjadi admin grup untuk mengubah setelan ini.");
    }

    const setting = mode === "open" ? "not_announcement" : "announcement";
    await context.socket.groupSettingUpdate(context.chatJid, setting);

    return mode === "open"
      ? "🔓 *Grup telah dibuka.* Seluruh anggota sekarang dapat mengirim pesan."
      : "🔒 *Grup telah ditutup.* Hanya admin yang dapat mengirim pesan.";
  }

  private assertGroup(context: CommandContext): void {
    if (!context.isGroup) {
      throw new AppUserError("Command ini hanya dapat digunakan di dalam grup.");
    }
  }

  private assertCanManage(context: CommandContext): void {
    if (
      context.role !== "SUPER_OWNER" &&
      context.role !== "TENANT_OWNER" &&
      context.role !== "TENANT_ADMIN"
    ) {
      throw new AppUserError("Hanya Owner atau Admin yang dapat mengatur setelan ini.");
    }
  }

  private pruneStaleRecords(): void {
    if (this.joinTimestampsByGroup.size <= AntiRaidService.MAX_MAP_SIZE) {
      return;
    }

    const now = Date.now();
    for (const [groupJid, timestamps] of this.joinTimestampsByGroup.entries()) {
      const valid = timestamps.filter((t) => now - t <= 60_000);
      if (valid.length === 0) {
        this.joinTimestampsByGroup.delete(groupJid);
      } else {
        this.joinTimestampsByGroup.set(groupJid, valid);
      }
    }

    for (const [groupJid, lockdownTime] of this.lastLockdownByGroup.entries()) {
      if (now - lockdownTime > 300_000) {
        this.lastLockdownByGroup.delete(groupJid);
      }
    }
  }
}

export const antiRaidService = new AntiRaidService();
