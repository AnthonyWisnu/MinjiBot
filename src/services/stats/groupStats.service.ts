import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import type { CommandContext } from "../../types/command";
import { normalizeUserJid } from "../../utils/jid";

const WIB_TIMEZONE = "Asia/Jakarta";

export interface StatsResponse {
  text: string;
  mentions: string[];
}

export class GroupStatsService {
  constructor(
    private readonly profileRepo = new GroupMemberProfileRepository(),
  ) {}

  /**
   * Catat aktivitas pesan member (non-blocking).
   */
  async trackActivity(groupJid: string, userJid: string): Promise<void> {
    await this.profileRepo.recordActivity(groupJid, userJid);
  }

  /**
   * Menampilkan ringkasan statistik grup & top 5 member teraktif.
   */
  async getStats(context: CommandContext): Promise<StatsResponse> {
    if (!context.isGroup) {
      throw new Error("Command ini hanya bisa digunakan di dalam grup.");
    }

    const [stats, topMembers] = await Promise.all([
      this.profileRepo.getGroupActivityStats(context.chatJid),
      this.profileRepo.listTopByMessageCount(context.chatJid, 5),
    ]);

    const latestActiveText = stats.latestActiveAt
      ? formatDateTimeWib(stats.latestActiveAt)
      : "Belum ada";

    const mentions: string[] = [];
    const topLines: string[] = [];

    if (topMembers.length === 0) {
      topLines.push("   _Belum ada aktivitas chat yang tercatat._");
    } else {
      topMembers.forEach((member, index) => {
        const username = member.userJid.split("@")[0] ?? "";
        topLines.push(`   ${String(index + 1)}. @${username} — *${member.messageCount.toLocaleString("id-ID")}* pesan`);
        mentions.push(member.userJid);
      });
    }

    const text = [
      "📊 *[ STATISTIK AKTIVITAS GRUP ]*",
      "",
      `👥 *Total Member Terdata:* ${stats.activeMembers.toLocaleString("id-ID")} member`,
      `💬 *Total Pesan Tercatat:* ${stats.totalMessages.toLocaleString("id-ID")} pesan`,
      `⏰ *Aktivitas Terakhir:* ${latestActiveText}`,
      "",
      "🏆 *Top 5 Member Teraktif:*",
      ...topLines,
      "",
      "💡 _Ketik *.topaktif* untuk melihat peringkat 10 besar._",
    ].join("\n");

    return { text, mentions };
  }

  /**
   * Menampilkan leaderboard 10 member paling aktif chat di grup.
   */
  async getTopActive(context: CommandContext): Promise<StatsResponse> {
    if (!context.isGroup) {
      throw new Error("Command ini hanya bisa digunakan di dalam grup.");
    }

    const topMembers = await this.profileRepo.listTopByMessageCount(context.chatJid, 10);

    if (topMembers.length === 0) {
      return {
        text: "🏆 *[ LEADERBOARD CHAT TERAKTIF ]*\n\n_Belum ada riwayat aktivitas chat yang tercatat di grup ini._",
        mentions: [],
      };
    }

    const medals = ["🥇", "🥈", "🥉"];
    const mentions: string[] = [];
    const lines: string[] = [
      "🏆 *[ LEADERBOARD CHAT TERAKTIF ]*",
      "Menampilkan 10 member dengan jumlah chat terbanyak:",
      "",
    ];

    topMembers.forEach((member, index) => {
      const rankBadge = medals[index] ?? `${String(index + 1)}.`;
      const username = member.userJid.split("@")[0] ?? "";
      lines.push(`${rankBadge} @${username} — *${member.messageCount.toLocaleString("id-ID")}* pesan`);
      mentions.push(member.userJid);
    });

    lines.push("");
    lines.push("💡 _Aktivitas dihitung dari obrolan non-command di grup._");

    return { text: lines.join("\n"), mentions };
  }

  /**
   * Menemukan sider / member pasif yang tidak mengirim pesan selama X hari.
   */
  async getSilentMembers(context: CommandContext, days = 7): Promise<StatsResponse> {
    if (!context.isGroup) {
      throw new Error("Command ini hanya bisa digunakan di dalam grup.");
    }

    if (!["SUPER_OWNER", "TENANT_OWNER", "TENANT_ADMIN"].includes(context.role)) {
      throw new Error("Command ini hanya dapat digunakan oleh Owner atau Admin Tenant.");
    }

    const parsedDays = Math.max(1, Math.min(365, Math.floor(days)));
    const since = new Date(Date.now() - parsedDays * 24 * 60 * 60 * 1000);

    const botJid = context.socket.user?.id
      ? normalizeUserJid(context.socket.user.id)
      : null;

    // Ambil user JID yang aktif sejak threshold date
    const activeUserJids = await this.profileRepo.listActiveUserJidsSince(context.chatJid, since);
    const activeSet = new Set(activeUserJids.map((j) => normalizeUserJid(j)));

    // Ambil daftar participant langsung dari metadata grup
    let participants: string[] = [];
    try {
      const metadata = await context.socket.groupMetadata(context.chatJid);
      participants = metadata.participants.map((p) => normalizeUserJid(p.id));
    } catch {
      // Fallback jika metadata gagal diambil: gunakan database
      const inactiveProfiles = await this.profileRepo.findInactiveMembers(context.chatJid, since);
      participants = inactiveProfiles.map((p) => normalizeUserJid(p.userJid));
    }

    // Ambil profil tidak aktif dari database untuk keterangan last active
    const inactiveProfiles = await this.profileRepo.findInactiveMembers(context.chatJid, since);
    const profileMap = new Map(inactiveProfiles.map((p) => [normalizeUserJid(p.userJid), p]));

    // Saring member pasif: ada di peserta grup, bukan bot, dan TIDAK aktif di activeSet
    const silentJids = participants.filter((jid) => {
      if (botJid && jid === botJid) return false;
      return !activeSet.has(jid);
    });

    if (silentJids.length === 0) {
      return {
        text: `👻 *[ SIDER / MEMBER PASIF HUNTER ]*\n\n✅ Tidak ditemukan member pasif! Seluruh member aktif dalam *${String(parsedDays)} hari* terakhir.`,
        mentions: [],
      };
    }

    const MAX_DISPLAY = 40;
    const displayed = silentJids.slice(0, MAX_DISPLAY);
    const remaining = silentJids.length - displayed.length;

    const mentions: string[] = [];
    const lines: string[] = [
      "👻 *[ SIDER / MEMBER PASIF HUNTER ]*",
      `Kriteria: Tidak aktif chat $\\ge$ *${String(parsedDays)} hari* terakhir`,
      `Terdeteksi *${String(silentJids.length)}* member pasif / sider:`,
      "",
    ];

    displayed.forEach((jid, index) => {
      const username = jid.split("@")[0] ?? "";
      const profile = profileMap.get(jid);
      let statusDesc = "Belum pernah chat";

      if (profile && profile.messageCount > 0) {
        const diffDays = Math.floor((Date.now() - profile.lastActiveAt.getTime()) / (24 * 60 * 60 * 1000));
        statusDesc = `${String(diffDays)} hari lalu (${String(profile.messageCount)} chat)`;
      }

      lines.push(`${String(index + 1)}. @${username} — _${statusDesc}_`);
      mentions.push(jid);
    });

    if (remaining > 0) {
      lines.push("");
      lines.push(`...dan *${String(remaining)}* member pasif lainnya.`);
    }

    lines.push("");
    lines.push("💡 *Tip Admin:* Gunakan daftar ini untuk menertibkan sider atau evaluasi keanggotaan.");

    return { text: lines.join("\n"), mentions };
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

export const groupStatsService = new GroupStatsService();
