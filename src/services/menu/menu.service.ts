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
      "│",
      "│ [TENANT]",
      "│ • .pendinggroup",
      "│ • .activatetenant <nomorList/kode> <nomorOwner> <durasi>",
      "│ • .listtenant [all|removed]",
      "│ • .tenantinfo <kode>",
      "│ • .extendtenant <kode> <durasi>",
      "│ • .settenantexpire <kode> <YYYY-MM-DD>",
      "│ • .blocktenant / .unblocktenant <kode>",
      "│ • .removetenant <kode>",
      "│",
      "│ [NAVIGASI]",
      "│ • .tenantmenu",
      "│ • .featuremenu",
      "│ • .menu",
      "╰──────────────────────────",
    ].join("\n");
  }

  buildTenantOwnerMenu(): string {
    return [
      "╭── [ MENU TENANT OWNER ] ──",
      "│",
      "│ [PENGELOLAAN TENANT]",
      "│ • .mytenant",
      "│ • .usetenant <nomor/kode>",
      "│ • .currenttenant",
      "│ • .cleartenant",
      "│ • .transferowner @user",
      "│ • .addtenantadmin / .removetenantadmin <nomor>",
      "│ • .listtenantadmin",
      "│",
      "│ [PENGATURAN GRUP]",
      "│ • .feature <fitur> <on/off>",
      "│ • .welcome [on|off]",
      "│ • .setwelcome <pesan>",
      "│ • .antilink [on|off]",
      "│ • .antispam [on|off|status|mode <normal|soft|strict>]",
      "│",
      "│ [FITUR MEDIA]",
      "│ • .play <nama lagu>",
      "│ • .lirik [doc] <judul>",
      "│ • .tt / .ig / .igstory <url>",
      "│ • .hd [doc]",
      "│ • .sticker / .s",
      "│ • .smeme <teks>",
      "│ • .gambar <teks>",
      "│ • .toimg",
      "│",
      "│ [INFO]",
      "│ • .profile [@user]",
      "│ • .menu",
      "╰───────────────────────────",
    ].join("\n");
  }

  buildFeatureMenu(): string {
    return [
      "╭── [ MENU KONTROL FITUR ] ──",
      "│ Format: .feature <nama> <on/off>",
      "│",
      "│ • downloader : download media TikTok/IG",
      "│ • hd         : penjernih foto standar",
      "│ • game       : kuis, tebak kata/emoji, tictactoe",
      "│ • welcome    : pesan sambutan member baru",
      "│ • antilink   : proteksi link grup lain",
      "│ • antispam   : proteksi spam pesan",
      "│ • reminder   : pengingat waktu / alarm",
      "│ • tagall     : mention semua member grup",
      "╰────────────────────────────",
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
      "│ Fitur bot lengkap dapat diakses di grup aktif.",
      "│ Fitur private chat hanya untuk Tenant Owner.",
      "│",
      "│ • .menu",
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
      ...this.buildTenantHeader("Super Owner", tenantGroup),
      "",
      "╭── [ TENANT & ADMIN ]",
      "│ • .tenantinfo <kode>",
      "│ • .extendtenant <kode> <durasi>",
      "│ • .blocktenant / .unblocktenant <kode>",
      "│ • .transferowner @user",
      "│ • .addtenantadmin / .removetenantadmin <nomor>",
      "│ • .listtenantadmin",
      "╰────────────────────────",
      "",
      ...this.buildGroupModerationLines(true),
      "",
      ...this.buildGroupMediaLines(),
      "",
      ...this.buildGroupGameAndMemberLines(featureSetting),
      "",
      "╭── [ PENGATURAN & MENU ]",
      "│ • .feature <fitur> <on/off>",
      "│ • .ownermenu",
      "│ • .tenantmenu",
      "│ • .featuremenu",
      "╰────────────────────────",
    ].join("\n");
  }

  private buildTenantOwnerGroupMenu(
    tenantGroup: TenantGroup | undefined,
    featureSetting: TenantFeatureSetting | null,
  ): string {
    return [
      ...this.buildTenantHeader("Tenant Owner", tenantGroup),
      "",
      "╭── [ PENGATURAN TENANT ]",
      "│ • .feature <fitur> <on/off>",
      "│ • .welcome [on|off]",
      "│ • .setwelcome <pesan>",
      "│ • .transferowner @user",
      "│ • .addtenantadmin / .removetenantadmin <nomor>",
      "│ • .listtenantadmin",
      "╰────────────────────────",
      "",
      ...this.buildGroupModerationLines(true),
      "",
      ...this.buildGroupMediaLines(),
      "",
      ...this.buildGroupGameAndMemberLines(featureSetting),
      "",
      "╭── [ INFO ]",
      "│ • .status / .tenantstatus",
      "│ • .profile [@user]",
      "│ • .menu",
      "╰────────────────────────",
    ].join("\n");
  }

  private buildTenantAdminGroupMenu(
    tenantGroup: TenantGroup | undefined,
    featureSetting: TenantFeatureSetting | null,
  ): string {
    return [
      ...this.buildTenantHeader("Tenant Admin", tenantGroup),
      "",
      "╭── [ PENGATURAN GRUP ]",
      "│ • .welcome [on|off]",
      "│ • .setwelcome <pesan>",
      "│ • .listtenantadmin",
      "╰────────────────────────",
      "",
      ...this.buildGroupModerationLines(false),
      "",
      ...this.buildGroupMediaLines(),
      "",
      ...this.buildGroupGameAndMemberLines(featureSetting),
      "",
      "╭── [ INFO ]",
      "│ • .status / .tenantstatus",
      "│ • .profile [@user]",
      "│ • .menu",
      "╰────────────────────────",
    ].join("\n");
  }

  private buildPublicGroupMenu(
    tenantGroup: TenantGroup | undefined,
    featureSetting: TenantFeatureSetting | null,
  ): string {
    return [
      ...this.buildTenantHeader("Member", tenantGroup),
      "",
      ...this.buildGroupMediaLines(),
      "",
      ...this.buildGroupGameAndMemberLines(featureSetting),
      "",
      "╭── [ INFO ]",
      "│ • .status / .tenantstatus",
      "│ • .profile [@user]",
      "│ • .menu",
      "╰────────────────────────",
    ].join("\n");
  }

  private buildTenantHeader(roleLabel: string, tenantGroup: TenantGroup | undefined): string[] {
    if (!tenantGroup) {
      return [
        "╭── [ MINJIBOT MENU ] ──",
        `│ Role: ${roleLabel}`,
        "│ Status: Belum terdaftar sebagai tenant",
        "╰────────────────────────",
      ];
    }

    return [
      "╭── [ MINJIBOT MENU ] ──",
      `│ Role   : ${roleLabel}`,
      `│ Grup   : ${formatNullableText(tenantGroup.name)} (${tenantGroup.tenantCode})`,
      `│ Status : ${tenantGroup.status.toLowerCase()}`,
      `│ Aktif  : s/d ${formatDateId(tenantGroup.expiresAt)}`,
      "╰────────────────────────",
    ];
  }

  private buildGroupMediaLines(): string[] {
    return [
      "╭── [ MEDIA & TOOLS ]",
      "│ • .sticker / .s (caption/reply foto)",
      "│ • .smeme <teks>",
      "│ • .gambar <teks>",
      "│ • .toimg (reply sticker)",
      "│ • .play <nama lagu>",
      "│ • .lirik [doc] <judul>",
      "│ • .tt / .ig / .igstory <url>",
      "│ • .hd [doc]",
      "│ • .afk [alasan]",
      "╰────────────────────────",
    ];
  }

  private buildGroupGameAndMemberLines(featureSetting: TenantFeatureSetting | null): string[] {
    const lines: string[] = [];

    if (!featureSetting || featureSetting.reminderEnabled) {
      lines.push(
        "╭── [ PENGINGAT ]",
        "│ • .remind <waktu> <pesan>",
        "│ • .listreminder",
        "╰────────────────────────",
        "",
      );
    }

    if (!featureSetting || featureSetting.tagAllEnabled) {
      lines.push(
        "╭── [ TAG SEMUA ]",
        "│ • .tagall <pesan>",
        "╰────────────────────────",
        "",
      );
    }

    if (!featureSetting || featureSetting.gameEnabled) {
      lines.push(
        "╭── [ GAME & REWARD ]",
        "│ • .kuis",
        "│ • .family100",
        "│ • .tebakkata / .tebakemoji / .tebakangka",
        "│ • .tictactoe @user",
        "│ • .nyerah",
        "╰────────────────────────",
        "",
      );
    }

    lines.push(
      "╭── [ MEMBER & EKONOMI ]",
      "│ • .profile [@user]",
      "│ • .poin",
      "│ • .daily",
      "│ • .rank / .toprank / .toppoint",
      "│ • .belilimit <jumlah>",
      "│ • .giftpoint / .giftlimit @user <jumlah>",
      "╰────────────────────────",
    );

    return lines;
  }

  private buildGroupModerationLines(includeAdvancedAntiSpam: boolean): string[] {
    const lines = [
      "╭── [ MODERASI ]",
      "│ • .add <nomor>",
      "│ • .kick / .promote / .demote @user",
      "│ • .del (reply pesan bot)",
      "│ • .antilink [on|off]",
      "│ • .antispam [on|off|status]",
    ];

    if (includeAdvancedAntiSpam) {
      lines.push("│ • .antispam mode <normal|soft|strict>");
    }

    lines.push("╰────────────────────────");
    return lines;
  }
}

export const menuService = new MenuService();
