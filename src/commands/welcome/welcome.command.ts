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
  {
    name: "goodbye",
    execute: handleGoodbye,
  },
  {
    name: "leave",
    execute: handleGoodbye,
  },
  {
    name: "setgoodbye",
    execute: handleSetGoodbye,
  },
  {
    name: "setleave",
    execute: handleSetGoodbye,
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

async function handleGoodbye(context: CommandContext): Promise<void> {
  const [statusText] = context.args;
  if (!statusText) {
    await context.reply("Format command salah.\nGunakan: .goodbye on atau .goodbye off");
    return;
  }

  const enabled = welcomeService.parseGoodbyeToggle(statusText);
  const result = await welcomeService.setGoodbyeEnabled(context, enabled);

  await context.reply(formatGoodbyeConfig(result));
}

async function handleSetGoodbye(context: CommandContext): Promise<void> {
  const goodbyeMessage = context.argsText.trim();
  if (goodbyeMessage.length === 0) {
    await context.reply("Format command salah.\nGunakan: .setgoodbye <pesan>");
    return;
  }

  const result = await welcomeService.setGoodbyeMessage(context, goodbyeMessage);

  await context.reply(formatGoodbyeConfig(result));
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

function formatGoodbyeConfig(result: {
  tenantGroup: TenantGroup;
  featureSetting: TenantFeatureSetting;
  groupSetting: TenantGroupSetting;
}): string {
  return [
    "Pengaturan goodbye berhasil diperbarui.",
    "",
    `Grup: ${formatNullableText(result.tenantGroup.name)}`,
    `Kode: ${result.tenantGroup.tenantCode}`,
    `Goodbye: ${result.featureSetting.goodbyeEnabled ? "on" : "off"}`,
    `Pesan: ${formatNullableText(result.groupSetting.goodbyeMessage)}`,
  ].join("\n");
}
