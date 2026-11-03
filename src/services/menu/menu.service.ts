import os from "node:os";
import type { TenantFeatureSetting, TenantGroup } from "@prisma/client";

import { TenantFeatureRepository } from "../../repositories/tenantFeature.repository";
import type { CommandContext } from "../../types/command";
import { formatDateId, formatNullableText } from "../../utils/format";

export class MenuService {
  constructor(private readonly tenantFeatureRepository = new TenantFeatureRepository()) {}

  buildHeader(context: CommandContext): string {
    const rawNumber = context.senderUserJid.split("@")[0] ?? context.senderUserJid;
    const now = new Date();

    const dayName = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: "Asia/Jakarta",
    }).format(now);

    const dateFormatted = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    }).format(now);

    const timeFormatted = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "Asia/Jakarta",
    }).format(now);

    const cpus = os.cpus();
    const cpuCores = cpus.length;
    const cpuSpeed = cpus[0]?.speed ? (cpus[0].speed / 1000).toFixed(1) : "2.5";
    const totalMemGb = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
    const freeMemGb = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);

    return [
      `Hello @~${rawNumber}`,
      "",
      `🌤️ Hari: ${dayName}`,
      `📅 Tanggal: ${dateFormatted}`,
      `⏰ Waktu: ${timeFormatted} Wib`,
      "",
      "Status:",
      "▶ Country: Indonesia",
      `▶ Platform: ${os.platform()}`,
      `▶ CPU: ${String(cpuCores)} Cores - ${cpuSpeed}GHz`,
      `▶ RAM: ${freeMemGb} GB / ${totalMemGb} GB Free`,
      `▶ Arch: ${os.arch()}`,
    ].join("\n");
  }

  async buildMenu(context: CommandContext): Promise<string> {
    const header = this.buildHeader(context);
    const body = !context.isGroup
      ? this.buildPrivateMenu(context)
      : await this.buildGroupMenu(context);

    return `${header}\n\n${body}`;
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
      "• .purgetenant <kode>",
      "• .addlimitall <kode> <jumlah>",
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
      "• .x <url>",
      "• .pin <url>",
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
      "• .activatetenant <kode> <owner>",
      "• .listtenant",
      "• .tenantinfo <kode>",
      "• .extendtenant <kode> <durasi>",
      "• .settenantexpire <kode> <tgl>",
      "• .blocktenant <kode>",
      "• .unblocktenant <kode>",
      "• .removetenant <kode>",
      "• .purgetenant <kode>",
      "• .addlimitall <kode> <jumlah>",
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
      "• .quote [-s] [teks]",
      "• .tweet [@user] <teks>",
      "• .toimg / .tovideo",
      "• .bass / .chipmunk",
      "• .slowed / .nightcore",
      "• .tovn",
      "• .play <lagu>",
      "• .lirik [doc] <judul>",
      "• .tt <url>",
      "• .ig <url>",
      "• .yt <url>",
      "• .x <url>",
      "• .pin <url>",
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
      "• .stats",
      "• .topaktif",
      "• .deletemydata",
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
      "• .silent [hari]",
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
