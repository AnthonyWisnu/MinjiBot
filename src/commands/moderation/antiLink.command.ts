import type { TenantFeatureSetting, TenantGroup } from "@prisma/client";

import { antiLinkService } from "../../services/moderation/antiLink.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatNullableText } from "../../utils/format";
import { formatUserSafeError } from "../../utils/userSafeError";

export const antiLinkCommands: CommandDefinition[] = [
  {
    name: "antilink",
    execute: handleAntiLink,
  },
];

async function handleAntiLink(context: CommandContext): Promise<void> {
  try {
    const [statusText] = context.args;
    if (!statusText) {
      await context.reply("Format command salah.\nGunakan: .antilink on atau .antilink off");
      return;
    }

    const enabled = antiLinkService.parseAntiLinkToggle(statusText);
    const result = await antiLinkService.setAntiLinkEnabled(context, enabled);

    await context.reply(formatAntiLinkConfig(result.tenantGroup, result.featureSetting));
  } catch (error: unknown) {
    await context.reply(formatUserSafeError(error, "Pengaturan antilink gagal diproses."));
  }
}

function formatAntiLinkConfig(
  tenantGroup: TenantGroup,
  featureSetting: TenantFeatureSetting,
): string {
  return [
    "Pengaturan antilink berhasil diperbarui.",
    "",
    `Grup: ${formatNullableText(tenantGroup.name)}`,
    `Kode: ${tenantGroup.tenantCode}`,
    `Antilink: ${featureSetting.antiLinkEnabled ? "on" : "off"}`,
  ].join("\n");
}
