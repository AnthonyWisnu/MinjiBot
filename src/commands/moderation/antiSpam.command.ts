import type { TenantFeatureSetting, TenantGroup, TenantGroupSetting } from "@prisma/client";

import { antiSpamService } from "../../services/moderation/antiSpam.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatNullableText } from "../../utils/format";
import { formatUserSafeError } from "../../utils/userSafeError";

export const antiSpamCommands: CommandDefinition[] = [
  {
    name: "antispam",
    execute: handleAntiSpam,
  },
];

async function handleAntiSpam(context: CommandContext): Promise<void> {
  try {
    const [action, value] = context.args;
    if (!action) {
      await context.reply(
        "Format command salah.\nGunakan: .antispam on, .antispam off, .antispam status, atau .antispam mode <normal/soft/strict>",
      );
      return;
    }

    if (action === "status") {
      const result = await antiSpamService.getAntiSpamConfig(context);
      await context.reply(formatAntiSpamConfig(result));
      return;
    }

    if (action === "mode") {
      if (!value) {
        await context.reply("Format command salah.\nGunakan: .antispam mode <normal/soft/strict>");
        return;
      }

      const mode = antiSpamService.parseAntiSpamMode(value);
      const result = await antiSpamService.setAntiSpamMode(context, mode);
      await context.reply(formatAntiSpamConfig(result));
      return;
    }

    const enabled = antiSpamService.parseAntiSpamToggle(action);
    const result = await antiSpamService.setAntiSpamEnabled(context, enabled);
    await context.reply(formatAntiSpamConfig(result));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Pengaturan antispam gagal diproses."));
  }
}

function formatAntiSpamConfig(result: {
  tenantGroup: TenantGroup;
  featureSetting: TenantFeatureSetting;
  groupSetting: TenantGroupSetting;
}): string {
  return [
    "Pengaturan antispam berhasil diperbarui.",
    "",
    `Grup: ${formatNullableText(result.tenantGroup.name)}`,
    `Kode: ${result.tenantGroup.tenantCode}`,
    `Antispam: ${result.featureSetting.antiSpamEnabled ? "on" : "off"}`,
    `Mode: ${result.groupSetting.antiSpamMode.toLowerCase()}`,
  ].join("\n");
}
