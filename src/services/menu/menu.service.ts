import type { TenantFeatureSetting, TenantGroup } from "@prisma/client";

import { TenantFeatureRepository } from "../../repositories/tenantFeature.repository";
import type { CommandContext } from "../../types/command";
import { formatDateId, formatNullableText } from "../../utils/format";

export class MenuService {
  constructor(private readonly tenantFeatureRepository = new TenantFeatureRepository()) {}

  async buildMenu(context: CommandContext): Promise<string> {
    if (!context.isGroup) {
      return this.buildPrivateMenu(context);
    }

    return this.buildGroupMenu(context);
  }

  buildOwnerMenu(): string {
    return [
      "╭── [ MENU SUPER OWNER ] ──",
      "│ Mode: Private Chat - Master Admin",
      "╰──────────────────────────",
      "",
      "╭── [ MANAJEMEN TENANT ]",
      "│ • .pendinggroup : Cek grup baru yang menunggu aktivasi",
      "│ • .activatetenant <kode> <noOwner> <durasi>",
      "│ • .listtenant [all|removed] : Daftar semua tenant",
      "│ • .tenantinfo <kode> : Detail lengkap tenant",
      "│ • .extendtenant <kode> <durasi> : Perpanjang masa aktif",
      "│ • .settenantexpire <kode> <YYYY-MM-DD>",
      "│ • .blocktenant / .unblocktenant <kode>",
      "│ • .removetenant <kode> : Hapus tenant dari sistem",
      "╰──────────────────────────",
      "",
      "╭── [ NAVIGASI ]",
      "│ • .tenantmenu  : Bantuan cepat perintah tenant",
      "│ • .featuremenu : Menu kontrol saklar fitur",
      "│ • .menu        : Menampilkan menu ini",
      "╰──────────────────────────",
    ].join("\n");
  }

  buildTenantOwnerMenu(): string {
    return [
      "╭── [ MENU TENANT OWNER ] ──",
      "│ Mode: Private Chat - Pengelola Sewa",
      "╰───────────────────────────",
      "",
      "╭── [ KONTROL SEWA TENANT ]",
      "│ • .mytenant               : Daftar semua grup sewaan kamu",
      "│ • .usetenant <kode/nomor> : Pilih grup yang ingin diatur",
      "│ • .currenttenant          : Cek grup yang sedang dipilih",
      "│ • .cleartenant            : Lepas pilihan grup aktif",
      "│ • .transferowner @user    : Pindahkan kepemilikan sewa",
      "│ • .addtenantadmin <nomor> : Tambah admin pembantu",
      "│ • .removetenantadmin <no> : Hapus admin pembantu",
      "│ • .listtenantadmin        : Daftar admin pembantu",
      "╰───────────────────────────",
      "",
      "╭── [ PENGATURAN GRUP AKTIF ]",
      "│ • .feature <fitur> <on/off> : Kontrol fitur grup",
      "│ • .welcome [on|off]         : Saklar pesan sambutan",
      "│ • .setwelcome <pesan>       : Atur teks pesan sambutan",
      "│ • .antilink [on|off]        : Proteksi link grup lain",
      "│ • .antispam [on|off]        : Proteksi spam chat",
      "╰───────────────────────────",
      "",
      "╭── [ FITUR PRIVATE CHAT ]",
      "│ • .tt / .ig / .igstory <url>",
      "│ • .play <nama lagu>",
      "│ • .lirik [doc] <judul>",
      "│ • .sticker / .s (caption/reply foto)",
      "│ • .smeme <teks>",
      "│ • .gambar <teks>",
      "│ • .toimg (reply stiker)",
      "│ • .hd [doc]",
      "╰───────────────────────────",
      "",
      "╭── [ INFORMASI ]",
      "│ • .profile : Profil akun sewa kamu",
      "│ • .menu    : Menampilkan menu ini",
      "╰───────────────────────────",
    ].join("\n");
  }

  buildFeatureMenu(): string {
    return [
      "╭── [ KONTROL FITUR TENANT ] ──",
      "│ Gunakan: .feature <fitur> <on/off>",
      "│",
      "│ • downloader : Unduh video TikTok & Reels IG",
      "│ • hd         : Jernihkan foto standar",
      "│ • game       : Kuis, Family100, Tebak, TicTacToe",
      "│ • welcome    : Pesan sambutan member baru",
      "│ • antilink   : Proteksi tautan grup luar",
      "│ • antispam   : Proteksi spam pesan",
      "│ • reminder   : Pengingat waktu dan alarm",
      "│ • tagall     : Mention seluruh member grup",
      "╰──────────────────────────────",
    ].join("\n");
  }

  private buildPrivateMenu(context: CommandContext): string {
    if (context.role === "SUPER_OWNER") {
      return this.buildOwnerMenu();
    }

    if (context.role === "TENANT_OWNER") {
      return this.buildTenantOwnerMenu();
    }

    return [
      "╭── [ BANTUAN MINJIBOT ] ──",
      "│",
      "│ Halo! MinjiBot adalah bot multifungsi grup WhatsApp.",
      "│ Fitur bot lengkap aktif di grup yang terdaftar.",
      "│",
      "│ Hubungi Owner untuk sewa bot di grup kamu.",
      "│ • .menu : Menampilkan info bantuan ini",
      "╰──────────────────────────",
    ].join("\n");
  }

  private async buildGroupMenu(context: CommandContext): Promise<string> {
    const tenantGroup = context.tenantGroup;
    const featureSetting = tenantGroup
      ? await this.tenantFeatureRepository.findByGroupJid(tenantGroup.groupJid)
      : null;

    if (context.role === "SUPER_OWNER") {
      return this.buildSuperOwnerGroupMenu(tenantGroup, featureSetting);
    }

    if (context.role === "TENANT_OWNER") {
      return this.buildTenantOwnerGroupMenu(tenantGroup, featureSetting);
    }

    if (context.role === "TENANT_ADMIN") {
      return this.buildTenantAdminGroupMenu(tenantGroup, featureSetting);
    }

    return this.buildPublicGroupMenu(tenantGroup, featureSetting);
  }

  private buildSuperOwnerGroupMenu(
    tenantGroup: TenantGroup | undefined,
    featureSetting: TenantFeatureSetting | null,
  ): string {
    return [
      "╭── [ DASHBOARD SUPER OWNER ] ──",
      `│ Grup   : ${this.formatGroupName(tenantGroup)}`,
      `│ Kode   : ${tenantGroup ? tenantGroup.tenantCode : "-"}`,
      `│ Status : ${tenantGroup ? tenantGroup.status.toLowerCase() : "belum terdaftar"}`,
      `│ Aktif  : s/d ${tenantGroup ? formatDateId(tenantGroup.expiresAt) : "-"}`,
      "╰───────────────────────────────",
      "",
      "╭── [ MANAJEMEN TENANT ]",
      "│ • .tenantinfo <kode>",
      "│ • .extendtenant <kode> <durasi>",
      "│ • .blocktenant / .unblocktenant <kode>",
      "│ • .transferowner @user",
      "│ • .addtenantadmin / .removetenantadmin <nomor>",
      "│ • .listtenantadmin",
      "╰───────────────────────────────",
      "",
      ...this.buildGroupModerationLines(true),
      "",
      ...this.buildGroupMediaLines(),
      "",
      ...this.buildGroupGameLines(featureSetting),
      "",
      ...this.buildGroupEconomyLines(),
      "",
      "╭── [ PENGATURAN & NAVIGASI ]",
      "│ • .feature <fitur> <on/off>",
      "│ • .status / .tenantstatus",
      "│ • .ownermenu",
      "│ • .tenantmenu",
      "│ • .featuremenu",
      "╰───────────────────────────────",
    ].join("\n");
  }

  private buildTenantOwnerGroupMenu(
    tenantGroup: TenantGroup | undefined,
    featureSetting: TenantFeatureSetting | null,
  ): string {
    return [
      "╭── [ DASHBOARD TENANT OWNER ] ──",
      `│ Grup   : ${this.formatGroupName(tenantGroup)}`,
      `│ Kode   : ${tenantGroup ? tenantGroup.tenantCode : "-"}`,
      `│ Status : ${tenantGroup ? tenantGroup.status.toLowerCase() : "belum terdaftar"}`,
      `│ Sewa   : Aktif s/d ${tenantGroup ? formatDateId(tenantGroup.expiresAt) : "-"}`,
      "╰────────────────────────────────",
      "",
      "╭── [ KONTROL SEWA & ADMIN ]",
      "│ • .feature <fitur> <on/off> : Atur on/off fitur grup",
      "│ • .welcome [on|off]        : Saklar pesan sambutan",
      "│ • .setwelcome <pesan>      : Teks pesan sambutan",
      "│ • .transferowner @user     : Pindahkan kepemilikan sewa",
      "│ • .addtenantadmin <nomor>  : Angkat admin pembantu",
      "│ • .removetenantadmin <no>  : Hapus admin pembantu",
      "│ • .listtenantadmin         : Daftar admin pembantu",
      "╰────────────────────────────────",
      "",
      ...this.buildGroupModerationLines(true),
      "",
      ...this.buildGroupUtilityLines(featureSetting),
      "",
      ...this.buildGroupMediaLines(),
      "",
      ...this.buildGroupGameLines(featureSetting),
      "",
      ...this.buildGroupEconomyLines(),
      "",
      "╭── [ INFORMASI SEWA ]",
      "│ • .tenantstatus : Cek masa aktif & info sewa grup",
      "│ • .status       : Cek kesehatan sistem bot",
      "│ • .menu         : Menampilkan menu ini",
      "╰────────────────────────────────",
    ].join("\n");
  }

  private buildTenantAdminGroupMenu(
    tenantGroup: TenantGroup | undefined,
    featureSetting: TenantFeatureSetting | null,
  ): string {
    return [
      "╭── [ DASHBOARD TENANT ADMIN ] ──",
      `│ Grup   : ${this.formatGroupName(tenantGroup)}`,
      `│ Status : ${tenantGroup ? tenantGroup.status.toLowerCase() : "belum terdaftar"}`,
      `│ Akses  : Admin Tenant`,
      "╰────────────────────────────────",
      "",
      "╭── [ PENGATURAN GRUP ]",
      "│ • .welcome [on|off]   : Saklar pesan sambutan",
      "│ • .setwelcome <pesan> : Teks pesan sambutan",
      "│ • .listtenantadmin    : Daftar admin pembantu",
      "╰────────────────────────────────",
      "",
      ...this.buildGroupModerationLines(false),
      "",
      ...this.buildGroupUtilityLines(featureSetting),
      "",
      ...this.buildGroupMediaLines(),
      "",
      ...this.buildGroupGameLines(featureSetting),
      "",
      ...this.buildGroupEconomyLines(),
      "",
      "╭── [ INFORMASI ]",
      "│ • .status / .tenantstatus",
      "│ • .menu",
      "╰────────────────────────────────",
    ].join("\n");
  }

  private buildPublicGroupMenu(
    tenantGroup: TenantGroup | undefined,
    featureSetting: TenantFeatureSetting | null,
  ): string {
    return [
      "╭── [ MINJIBOT - MENU UTAMA ] ──",
      `│ Grup : ${this.formatGroupName(tenantGroup)}`,
      "│ Gunakan titik (.) di awal perintah",
      "╰───────────────────────────────",
      "",
      ...this.buildGroupMediaLines(),
      "",
      ...this.buildGroupGameLines(featureSetting),
      "",
      ...this.buildGroupEconomyLines(),
      "",
      ...this.buildGroupUtilityLines(featureSetting),
      "",
      "╭── [ INFORMASI & BANTUAN ]",
      "│ • .status : Cek kondisi operasional bot",
      "│ • .menu   : Menampilkan daftar perintah ini",
      "╰───────────────────────────────",
    ].join("\n");
  }

  private formatGroupName(tenantGroup: TenantGroup | undefined): string {
    if (!tenantGroup) return "Grup Umum";
    return formatNullableText(tenantGroup.name);
  }

  private buildGroupMediaLines(): string[] {
    return [
      "╭── [ MEDIA & DOWNLOADER ]",
      "│ • .sticker / .s  : Buat stiker dari foto/video",
      "│ • .smeme <teks>  : Buat meme teks pada stiker",
      "│ • .gambar <teks> : Generate gambar AI dari teks",
      "│ • .toimg         : Ubah stiker menjadi foto",
      "│ • .play <lagu>   : Putar musik YouTube",
      "│ • .lirik [doc]   : Cari lirik lagu lengkap",
      "│ • .tt <url>      : Download video TikTok tanpa WM",
      "│ • .ig / .igstory : Download Reels / Story Instagram",
      "│ • .hd [doc]      : Jernihkan foto buram / resolusi rendah",
      "│ • .afk [alasan]  : Aktifkan status AFK di grup",
      "╰───────────────────────────────",
    ];
  }

  private buildGroupGameLines(featureSetting: TenantFeatureSetting | null): string[] {
    if (featureSetting && !featureSetting.gameEnabled) {
      return [];
    }

    return [
      "╭── [ GAME & HIBURAN ]",
      "│ • .kuis         : Kuis pintar berhadiah poin",
      "│ • .family100    : Game survei Family 100 seru",
      "│ • .tebakkata    : Susun kata acak berhadiah poin",
      "│ • .tebakemoji   : Tebak teka-teki kombinasi emoji",
      "│ • .tebakangka   : Tebak angka rahasia (1-100)",
      "│ • .tictactoe @u : Duel TicTacToe PvP lawan teman",
      "│ • .nyerah       : Menyerah dari ronde game aktif",
      "╰───────────────────────────────",
    ];
  }

  private buildGroupEconomyLines(): string[] {
    return [
      "╭── [ PROFIL & SALDO MEMBER ]",
      "│ • .profile [@u] : Kartu profil, tier rank & XP",
      "│ • .poin         : Cek cepat sisa poin & limit",
      "│ • .daily        : Klaim hadiah harian (poin + limit)",
      "│ • .belilimit <n>: Tukar poin menjadi kuota limit",
      "│ • .giftpoint @u : Transfer poin ke sesama member",
      "│ • .giftlimit @u : Transfer limit ke sesama member",
      "│ • .rank         : Cek tingkatan tier rank kamu",
      "│ • .toprank      : Top 10 peringkat XP tertinggi grup",
      "│ • .toppoint     : Top 10 saldo poin terbanyak grup",
      "╰───────────────────────────────",
    ];
  }

  private buildGroupUtilityLines(featureSetting: TenantFeatureSetting | null): string[] {
    const lines: string[] = [];
    const reminderOn = !featureSetting || featureSetting.reminderEnabled;
    const tagAllOn = !featureSetting || featureSetting.tagAllEnabled;

    if (reminderOn || tagAllOn) {
      lines.push("╭── [ PENGINGAT & ALARM ]");
      if (reminderOn) {
        lines.push(
          "│ • .remind <waktu> <pesan> : Pasang pengingat otomatis",
          "│ • .listreminder           : Daftar alarm aktif grup",
        );
      }
      if (tagAllOn) {
        lines.push("│ • .tagall <pesan>         : Panggil seluruh member grup");
      }
      lines.push("╰───────────────────────────────");
    }

    return lines;
  }

  private buildGroupModerationLines(includeAdvanced: boolean): string[] {
    const lines = [
      "╭── [ MODERASI & KEAMANAN ]",
      "│ • .antilink [on|off]        : Proteksi link grup lain",
      "│ • .antispam [on|off|status] : Proteksi spam pesan beruntun",
    ];

    if (includeAdvanced) {
      lines.push("│ • .antispam mode <normal|soft|strict>");
    }

    lines.push(
      "│ • .kick @user               : Keluarkan member dari grup",
      "│ • .add <nomor>              : Tambahkan member ke grup",
      "│ • .promote / .demote @user  : Atur jabatan admin WhatsApp",
      "│ • .del                      : Hapus pesan bot (reply pesan)",
      "╰───────────────────────────────",
    );

    return lines;
  }
}

export const menuService = new MenuService();
