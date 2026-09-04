import type { TenantFeatureSetting, TenantGroup } from "@prisma/client";

import { tenantFeatureService } from "../../services/tenant/tenantFeature.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatNullableText } from "../../utils/format";
import { formatUserSafeError } from "../../utils/userSafeError";

export const tenantFeatureCommands: CommandDefinition[] = [
  {
    name: "feature",
    execute: handleFeature,
  },
];

async function handleFeature(context: CommandContext): Promise<void> {
  try {
    const [featureText, enabledText] = context.args;
    if (!featureText || !enabledText) {
      await context.reply("Format command salah.\nGunakan: .feature <fitur> <on/off>");
      return;
    }

    const tenantGroup = await tenantFeatureService.resolveManagedTenant({
      actorJid: context.senderUserJid,
      actorRole: context.role,
      tenantGroup: context.tenantGroup,
      isGroup: context.isGroup,
    });
    const feature = tenantFeatureService.parseFeatureKey(featureText);
    const enabled = tenantFeatureService.parseFeatureEnabled(enabledText);
    const setting = await tenantFeatureService.updateFeature({
      actorJid: context.senderUserJid,
      actorRole: context.role,
      tenantGroup,
      feature,
      enabled,
    });

    await context.reply(formatFeatureUpdated(tenantGroup, setting));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Pengaturan fitur gagal diproses."));
  }
}

function formatFeatureUpdated(tenantGroup: TenantGroup, setting: TenantFeatureSetting): string {
  return [
    "Pengaturan fitur berhasil diperbarui.",
    "",
    `Grup: ${formatNullableText(tenantGroup.name)}`,
    `Kode: ${tenantGroup.tenantCode}`,
    "",
    "[STATUS FITUR]",
    `Downloader: ${formatEnabled(setting.downloaderEnabled)}`,
    `HD: ${formatEnabled(setting.hdEnabled)}`,
    `Game: ${formatEnabled(setting.gameEnabled)}`,
    `Welcome: ${formatEnabled(setting.welcomeEnabled)}`,
    `Goodbye: ${formatEnabled(setting.goodbyeEnabled)}`,
    `Antilink: ${formatEnabled(setting.antiLinkEnabled)}`,
    `Antispam: ${formatEnabled(setting.antiSpamEnabled)}`,
    `Reminder: ${formatEnabled(setting.reminderEnabled)}`,
    `Tag all: ${formatEnabled(setting.tagAllEnabled)}`,
    `Anti-Delete: ${formatEnabled(setting.antiDeleteEnabled)}`,
    `Anti-ViewOnce: ${formatEnabled(setting.antiViewOnceEnabled)}`,
  ].join("\n");
}

function formatEnabled(enabled: boolean): string {
  return enabled ? "on" : "off";
}
