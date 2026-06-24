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
      "[MENU SUPER OWNER]",
      "",
      "[TENANT]",
      ".pendinggroup",
      ".activatetenant <nomorList/kode> <nomorOwner> <durasi> <quota>",
      ".listtenant",
      ".tenantinfo <kode>",
      ".extendtenant <kode> <durasi>",
      ".settenantexpire <kode> <YYYY-MM-DD>",
      ".blocktenant <kode>",
      ".unblocktenant <kode>",
      ".removetenant <kode>",
      "",
      "[KUOTA OWNER]",
      ".addquota <nomorOwner> <jumlah>",
      ".setownerquota <nomorOwner> <jumlah>",
      ".ownerquota <nomorOwner>",
      ".listownerquota",
      "",
      "[MENU]",
      ".tenantmenu",
      ".quotamenu",
      ".featuremenu",
      ".menu",
    ].join("\n");
  }

  buildTenantOwnerMenu(): string {
    return [
      "[MENU TENANT OWNER]",
      "",
      "[TENANT]",
      ".mytenant",
      ".usetenant <nomor/kode>",
      ".currenttenant",
      ".cleartenant",
      "",
      "[PENGATURAN TENANT]",
      ".feature <fitur> <on/off>",
      ".welcome on",
      ".welcome off",
      ".setwelcome <pesan>",
      ".antilink on",
      ".antilink off",
      ".antispam on",
      ".antispam off",
      ".addtenantadmin <nomor>",
      "",
      "[FITUR PRIVATE CHAT]",
      ".tt <link>",
      ".ig <link>",
      ".igstory <link>",
      ".s",
      ".sticker",
      ".gambar",
      ".toimg",
      ".hdai",
      ".hdai doc",
      "",
      "[INFO]",
      ".quota",
      ".menu",
    ].join("\n");
  }

  buildFeatureMenu(): string {
    return [
      "[MENU FITUR]",
      "",
      ".feature downloader on",
      ".feature downloader off",
      ".feature hd on",
      ".feature hd off",
      ".feature hdai on",
      ".feature hdai off",
      ".feature welcome on",
      ".feature welcome off",
      ".feature antilink on",
      ".feature antilink off",
      ".feature antispam on",
      ".feature antispam off",
      ".feature reminder on",
      ".feature reminder off",
      ".feature tagall on",
      ".feature tagall off",
      ".feature game on",
      ".feature game off",
    ].join("\n");
  }

  buildQuotaMenu(): string {
    return [
      "[MENU KUOTA]",
      "",
      "[SUPER OWNER]",
      ".addquota <nomorOwner> <jumlah>",
      ".setownerquota <nomorOwner> <jumlah>",
      ".ownerquota <nomorOwner>",
      ".listownerquota",
      "",
      "[TENANT OWNER]",
      ".quota",
      "",
      "[GRUP]",
      ".quota",
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
      "[BANTUAN MINJIBOT]",
      "",
      ".menu",
      "",
      "Fitur private hanya tersedia untuk Tenant Owner.",
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
      "[MENU GRUP SUPER OWNER]",
      "",
      ...this.buildTenantSummaryLines(tenantGroup),
      "",
      "[TENANT]",
      ".tenantinfo <kode>",
      ".extendtenant <kode> <durasi>",
      ".blocktenant <kode>",
      ".unblocktenant <kode>",
      "",
      ...this.buildGroupModerationLines(true),
      "",
      ...this.buildGroupFeatureLines(featureSetting, true),
      "",
      "[MENU]",
      ".ownermenu",
      ".tenantmenu",
      ".featuremenu",
      ".quotamenu",
    ].join("\n");
  }

  private buildTenantOwnerGroupMenu(
    tenantGroup: TenantGroup | undefined,
    featureSetting: TenantFeatureSetting | null,
  ): string {
    return [
      "[MENU GRUP TENANT OWNER]",
      "",
      ...this.buildTenantSummaryLines(tenantGroup),
      "",
      "[PENGATURAN]",
      ".feature <fitur> <on/off>",
      "",
      ...this.buildGroupModerationLines(true),
      "",
      "[WELCOME]",
      ".welcome on",
      ".welcome off",
      ".setwelcome <pesan>",
      "",
      ...this.buildGroupFeatureLines(featureSetting, true),
    ].join("\n");
  }

  private buildTenantAdminGroupMenu(
    tenantGroup: TenantGroup | undefined,
    featureSetting: TenantFeatureSetting | null,
  ): string {
    return [
      "[MENU TENANT ADMIN]",
      "",
      ...this.buildTenantSummaryLines(tenantGroup),
      "",
      ...this.buildGroupModerationLines(true),
      "",
      "[WELCOME]",
      ".welcome on",
      ".welcome off",
      ".setwelcome <pesan>",
      "",
      ...this.buildGroupFeatureLines(featureSetting, false),
    ].join("\n");
  }

  private buildPublicGroupMenu(
    tenantGroup: TenantGroup | undefined,
    featureSetting: TenantFeatureSetting | null,
  ): string {
    return [
      "[MENU MINJIBOT]",
      "",
      ...this.buildTenantSummaryLines(tenantGroup),
      "",
      ...this.buildGroupFeatureLines(featureSetting, false),
      "",
      "[INFO]",
      ".status",
      ".tenantstatus",
      ".quota",
      ".menu",
    ].join("\n");
  }

  private buildTenantSummaryLines(tenantGroup: TenantGroup | undefined): string[] {
    if (!tenantGroup) {
      return ["[TENANT]", "Status: belum terdaftar"];
    }

    return [
      "[TENANT]",
      `Grup: ${formatNullableText(tenantGroup.name)}`,
      `Kode: ${tenantGroup.tenantCode}`,
      `Status: ${tenantGroup.status.toLowerCase()}`,
      `Masa aktif sampai: ${formatDateId(tenantGroup.expiresAt)}`,
    ];
  }

  private buildGroupFeatureLines(
    featureSetting: TenantFeatureSetting | null,
    includeManagementCommands: boolean,
  ): string[] {
    const lines = ["[MEDIA]", ".s", ".sticker", ".gambar", ".toimg"];

    if (!featureSetting || featureSetting.downloaderEnabled) {
      lines.push(".tt <link>", ".ig <link>", ".igstory <link>");
    }

    if (!featureSetting || featureSetting.hdEnabled) {
      lines.push(".hd", ".hd doc");
    }

    if (!featureSetting || featureSetting.hdAiEnabled) {
      lines.push(".hdai", ".hdai doc");
    }

    if (!featureSetting || featureSetting.reminderEnabled) {
      lines.push("", "[PENGINGAT]", ".remind <waktu> <pesan>", ".listreminder");
    }

    if (!featureSetting || featureSetting.tagAllEnabled) {
      lines.push("", "[TAG SEMUA]", ".tagall <pesan>");
    }

    if (!featureSetting || featureSetting.gameEnabled) {
      lines.push(
        "",
        "[GAME]",
        ".kuis",
        ".family100",
        ".tebakkata",
        ".tebakemoji",
        ".tebakangka",
        ".tictactoe",
        ".rank",
        ".poin",
        ".profile",
        ".daily",
      );
    }

    if (includeManagementCommands) {
      lines.push("", "[PENGATURAN]", ".feature <fitur> <on/off>");
    }

    return lines;
  }

  private buildGroupModerationLines(includeAdvancedAntiSpam: boolean): string[] {
    const lines = [
      "[MODERASI]",
      ".kick",
      ".del",
      ".antilink on",
      ".antilink off",
      ".antispam on",
      ".antispam off",
      ".antispam status",
    ];

    if (includeAdvancedAntiSpam) {
      lines.push(".antispam mode normal", ".antispam mode strict");
    }

    return lines;
  }
}

export const menuService = new MenuService();
