import type { TenantFeatureSetting, TenantGroup, TenantGroupSetting } from "@prisma/client";

import { welcomeService } from "../../services/welcome/welcome.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import { formatNullableText } from "../../utils/format";

export const welcomeCommands: CommandDefinition[] = [
  {
    name: "welcome",
    execute: handleWelcome,
  },
  {
    name: "setwelcome",
    execute: handleSetWelcome,
  },
];

async function handleWelcome(context: CommandContext): Promise<void> {
  const [statusText] = context.args;
  if (!statusText) {
    await context.reply("Format command salah.\nGunakan: .welcome on atau .welcome off");
    return;
  }

  const enabled = welcomeService.parseWelcomeToggle(statusText);
  const result = await welcomeService.setWelcomeEnabled(context, enabled);

  await context.reply(formatWelcomeConfig(result));
}

async function handleSetWelcome(context: CommandContext): Promise<void> {
  const welcomeMessage = context.argsText.trim();
  if (welcomeMessage.length === 0) {
    await context.reply("Format command salah.\nGunakan: .setwelcome <pesan>");
    return;
  }

  const result = await welcomeService.setWelcomeMessage(context, welcomeMessage);

  await context.reply(formatWelcomeConfig(result));
}

function formatWelcomeConfig(result: {
  tenantGroup: TenantGroup;
  featureSetting: TenantFeatureSetting;
  groupSetting: TenantGroupSetting;
}): string {
  return [
    "Pengaturan welcome berhasil diperbarui.",
    "",
    `Grup: ${formatNullableText(result.tenantGroup.name)}`,
    `Kode: ${result.tenantGroup.tenantCode}`,
    `Welcome: ${result.featureSetting.welcomeEnabled ? "on" : "off"}`,
    `Pesan: ${formatNullableText(result.groupSetting.welcomeMessage)}`,
  ].join("\n");
}
