import type { TenantFeatureSetting, TenantGroup } from "@prisma/client";

import { antiViewOnceService } from "../../services/moderation/antiViewOnce.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatNullableText } from "../../utils/format";
import { formatUserSafeError } from "../../utils/userSafeError";

export const antiViewOnceCommands: CommandDefinition[] = [
  {
    name: "antiviewonce",
    execute: handleAntiViewOnce,
  },
];

async function handleAntiViewOnce(context: CommandContext): Promise<void> {
  try {
    const [statusText] = context.args;
    if (!statusText) {
      await context.reply("Format command salah.\nGunakan: .antiviewonce on atau .antiviewonce off");
      return;
    }

    const enabled = antiViewOnceService.parseAntiViewOnceToggle(statusText);
    const result = await antiViewOnceService.setAntiViewOnceEnabled(context, enabled);

    await context.reply(formatAntiViewOnceConfig(result.tenantGroup, result.featureSetting));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Pengaturan antiviewonce gagal diproses."));
  }
}

function formatAntiViewOnceConfig(
  tenantGroup: TenantGroup,
  featureSetting: TenantFeatureSetting,
): string {
  return [
    "Pengaturan antiviewonce berhasil diperbarui.",
    "",
    `Grup: ${formatNullableText(tenantGroup.name)}`,
    `Kode: ${tenantGroup.tenantCode}`,
    `Anti-ViewOnce: ${featureSetting.antiViewOnceEnabled ? "on" : "off"}`,
  ].join("\n");
}
