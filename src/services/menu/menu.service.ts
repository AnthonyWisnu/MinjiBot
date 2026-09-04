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
      "*─── [ MENU SUPER OWNER ] ───*",
      "Mode: Private Chat",
      "",
      "*─── [ MANAJEMEN TENANT ] ───*",
      "• .pendinggroup",
      "• .activatetenant <kode> <owner>",
      "• .listtenant",
      "• .tenantinfo <kode>",
      "• .extendtenant <kode> <durasi>",
      "• .settenantexpire <kode> <tgl>",
      "• .blocktenant <kode>",
      "• .unblocktenant <kode>",
      "• .removetenant <kode>",
      "",
      "*─── [ NAVIGASI ] ───*",
      "• .tenantmenu",
      "• .featuremenu",
      "• .menu",
    ].join("\n");
  }

  buildTenantOwnerMenu(): string {
    return [
      "*─── [ MENU TENANT OWNER ] ───*",
      "Mode: Private Chat",
      "",
      "*─── [ KONTROL SEWA ] ───*",
      "• .mytenant",
      "• .usetenant <nomor/kode>",
      "• .currenttenant",
      "• .cleartenant",
      "• .transferowner @user",
      "• .addtenantadmin <nomor>",
      "• .removetenantadmin <nomor>",
      "• .listtenantadmin",
      "",
      "*─── [ PENGATURAN GRUP ] ───*",
      "• .feature <fitur> <on/off>",
      "• .welcome [on|off]",
      "• .setwelcome <pesan>",
      "• .goodbye [on|off]",
      "• .setgoodbye <pesan>",
      "• .antilink [on|off]",
      "• .antispam [on|off]",
      "",
      "*─── [ MEDIA PRIVATE ] ───*",
      "• .tt <url>",
      "• .ig <url>",
      "• .yt <url>",
      "• .play <lagu>",
      "• .lirik [doc] <judul>",
      "• .sticker / .s",
      "• .smeme <teks>",
      "• .gambar <teks>",
      "• .toimg",
      "• .hd [doc]",
      "",
      "*─── [ INFORMASI ] ───*",
      "• .profile",
      "• .menu",
    ].join("\n");
  }

  buildFeatureMenu(): string {
    return [
      "*─── [ KONTROL FITUR ] ───*",
      "Format: .feature <fitur> <on/off>",
      "",
      "• downloader",
      "• hd",
      "• game",
      "• welcome",
      "• antilink",
      "• antispam",
      "• reminder",
      "• tagall",
      "• antidelete",
      "• antiviewonce",
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
      "*─── [ BANTUAN MINJIBOT ] ───*",
      "Fitur bot aktif di grup terdaftar.",
      "Hubungi Owner untuk sewa bot.",
      "",
      "• .menu",
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
      "*─── [ DASHBOARD OWNER ] ───*",
      `Grup: ${this.formatGroupName(tenantGroup)}`,
      `Kode: ${tenantGroup ? tenantGroup.tenantCode : "-"}`,
      `Status: ${tenantGroup ? tenantGroup.status.toLowerCase() : "belum terdaftar"}`,
      `Exp: ${tenantGroup ? formatDateId(tenantGroup.expiresAt) : "-"}`,
      "",
      "*─── [ MANAJEMEN TENANT ] ───*",
      "• .tenantinfo <kode>",
      "• .extendtenant <kode> <durasi>",
      "• .blocktenant <kode>",
      "• .unblocktenant <kode>",
      "• .transferowner @user",
      "• .addtenantadmin <nomor>",
      "• .removetenantadmin <nomor>",
      "• .listtenantadmin",
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
      "*─── [ PENGATURAN ] ───*",
      "• .feature <fitur> <on/off>",
      "• .status",
      "• .panel / .tenantstatus",
      "• .ownermenu",
      "• .tenantmenu",
      "• .featuremenu",
      "• .menu",
    ].join("\n");
  }

  private buildTenantOwnerGroupMenu(
    tenantGroup: TenantGroup | undefined,
    featureSetting: TenantFeatureSetting | null,
  ): string {
    return [
      "*─── [ DASHBOARD TENANT ] ───*",
      `Grup: ${this.formatGroupName(tenantGroup)}`,
      `Kode: ${tenantGroup ? tenantGroup.tenantCode : "-"}`,
      `Status: ${tenantGroup ? tenantGroup.status.toLowerCase() : "belum terdaftar"}`,
      `Exp: ${tenantGroup ? formatDateId(tenantGroup.expiresAt) : "-"}`,
      "",
      "*─── [ PENGATURAN SEWA ] ───*",
      "• .feature <fitur> <on/off>",
      "• .welcome [on|off]",
      "• .setwelcome <pesan>",
      "• .goodbye [on|off]",
      "• .setgoodbye <pesan>",
      "• .transferowner @user",
      "• .addtenantadmin <nomor>",
      "• .removetenantadmin <nomor>",
      "• .listtenantadmin",
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
      "*─── [ INFORMASI ] ───*",
      "• .panel / .tenantstatus",
      "• .status",
      "• .featuremenu",
      "• .menu",
    ].join("\n");
  }

  private buildTenantAdminGroupMenu(
    tenantGroup: TenantGroup | undefined,
    featureSetting: TenantFeatureSetting | null,
  ): string {
    return [
      "*─── [ DASHBOARD ADMIN ] ───*",
      `Grup: ${this.formatGroupName(tenantGroup)}`,
      "",
      "*─── [ PENGATURAN GRUP ] ───*",
      "• .welcome [on|off]",
      "• .setwelcome <pesan>",
      "• .goodbye [on|off]",
      "• .setgoodbye <pesan>",
      "• .listtenantadmin",
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
      "*─── [ INFORMASI ] ───*",
      "• .panel / .tenantstatus",
      "• .status",
      "• .menu",
    ].join("\n");
  }

  private buildPublicGroupMenu(
    tenantGroup: TenantGroup | undefined,
    featureSetting: TenantFeatureSetting | null,
  ): string {
    return [
      "*─── [ MINJIBOT MENU ] ───*",
      `Grup: ${this.formatGroupName(tenantGroup)}`,
      "",
      ...this.buildGroupMediaLines(),
      "",
      ...this.buildGroupGameLines(featureSetting),
      "",
      ...this.buildGroupEconomyLines(),
      "",
      ...this.buildGroupUtilityLines(featureSetting),
      "",
      "*─── [ BANTUAN ] ───*",
      "• .status",
      "• .menu",
    ].join("\n");
  }

  private formatGroupName(tenantGroup: TenantGroup | undefined): string {
    if (!tenantGroup) return "Grup Umum";
    return formatNullableText(tenantGroup.name);
  }

  private buildGroupMediaLines(): string[] {
    return [
      "*─── [ MEDIA & TOOLS ] ───*",
      "• .sticker / .s",
      "• .smeme <teks>",
      "• .brat <teks>",
      "• .toimg / .tovideo",
      "• .bass / .chipmunk",
      "• .slowed / .nightcore",
      "• .tovn",
      "• .play <lagu>",
      "• .lirik [doc] <judul>",
      "• .tt <url>",
      "• .ig <url>",
      "• .yt <url>",
      "• .hd [doc]",
      "• .afk [alasan]",
    ];
  }

  private buildGroupGameLines(featureSetting: TenantFeatureSetting | null): string[] {
    if (featureSetting && !featureSetting.gameEnabled) {
      return [];
    }

    return [
      "*─── [ GAME & HIBURAN ] ───*",
      "• .kuis",
      "• .family100",
      "• .tebakkata",
      "• .tebakemoji",
      "• .tebakangka",
      "• .mtk",
      "• .slot",
      "• .tictactoe @user",
      "• .nyerah",
    ];
  }

  private buildGroupEconomyLines(): string[] {
    return [
      "*─── [ SALDO & PROFIL ] ───*",
      "• .profile [@user]",
      "• .poin",
      "• .daily / .claim",
      "• .belilimit <jumlah>",
      "• .giftpoint @user <jumlah>",
      "• .giftlimit @user <jumlah>",
      "• .rank",
      "• .toprank",
      "• .toppoint",
    ];
  }

  private buildGroupUtilityLines(featureSetting: TenantFeatureSetting | null): string[] {
    const lines: string[] = [];
    const reminderOn = !featureSetting || featureSetting.reminderEnabled;
    const tagAllOn = !featureSetting || featureSetting.tagAllEnabled;

    if (reminderOn || tagAllOn) {
      lines.push("*─── [ PENGINGAT ] ───*");
      if (reminderOn) {
        lines.push("• .remind <waktu> <pesan>", "• .listreminder");
      }
      if (tagAllOn) {
        lines.push("• .tagall / .hidetag <pesan>");
      }
    }

    return lines;
  }

  private buildGroupModerationLines(includeAdvanced: boolean): string[] {
    const lines = [
      "*─── [ MODERASI GRUP ] ───*",
      "• .antilink [on|off]",
      "• .antispam [on|off|status]",
      "• .antidelete [on|off]",
      "• .antiviewonce [on|off]",
      "• .antiraid [on|off|status]",
    ];

    if (includeAdvanced) {
      lines.push("• .antispam mode <mode>");
      lines.push("• .antiraid setting <threshold> <detik>");
    }

    lines.push(
      "• .grup [buka|tutup]",
      "• .warn @user [alasan]",
      "• .unwarn @user",
      "• .warns [@user]",
      "• .resetwarn @user",
      "• .setwarn <jumlah>",
      "• .kick @user",
      "• .add <nomor>",
      "• .promote @user",
      "• .demote @user",
      "• .del",
    );

    return lines;
  }
}

export const menuService = new MenuService();
