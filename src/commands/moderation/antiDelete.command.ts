import type { TenantFeatureSetting, TenantGroup } from "@prisma/client";

import { antiDeleteService } from "../../services/moderation/antiDelete.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatNullableText } from "../../utils/format";
import { formatUserSafeError } from "../../utils/userSafeError";

export const antiDeleteCommands: CommandDefinition[] = [
  {
    name: "antidelete",
    execute: handleAntiDelete,
  },
];

async function handleAntiDelete(context: CommandContext): Promise<void> {
  try {
    const [statusText] = context.args;
    if (!statusText) {
      await context.reply("Format command salah.\nGunakan: .antidelete on atau .antidelete off");
      return;
    }

    const enabled = antiDeleteService.parseAntiDeleteToggle(statusText);
    const result = await antiDeleteService.setAntiDeleteEnabled(context, enabled);

    await context.reply(formatAntiDeleteConfig(result.tenantGroup, result.featureSetting));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Pengaturan antidelete gagal diproses."));
  }
}

function formatAntiDeleteConfig(
  tenantGroup: TenantGroup,
  featureSetting: TenantFeatureSetting,
): string {
  return [
    "Pengaturan antidelete berhasil diperbarui.",
    "",
    `Grup: ${formatNullableText(tenantGroup.name)}`,
    `Kode: ${tenantGroup.tenantCode}`,
    `Anti-Delete: ${featureSetting.antiDeleteEnabled ? "on" : "off"}`,
  ].join("\n");
}
