import { antiRaidService } from "../../services/moderation/antiRaid.service";
import type { CommandContext, CommandDefinition } from "../../types/command";

export const antiRaidCommands: CommandDefinition[] = [
  {
    name: "antiraid",
    execute: handleAntiRaid,
  },
  {
    name: "grup",
    aliases: ["group"],
    execute: handleGroupSetting,
  },
];

async function handleAntiRaid(context: CommandContext): Promise<void> {
  try {
    const subCommand = context.args[0]?.toLowerCase();

    if (!subCommand || subCommand === "status") {
      const status = await antiRaidService.getStatus(context);
      await context.reply(status);
      return;
    }

    if (subCommand === "on" || subCommand === "aktif" || subCommand === "enable") {
      const result = await antiRaidService.toggleAntiRaid(context, true);
      await context.reply(result);
      return;
    }

    if (subCommand === "off" || subCommand === "mati" || subCommand === "disable") {
      const result = await antiRaidService.toggleAntiRaid(context, false);
      await context.reply(result);
      return;
    }

    if (subCommand === "setting" || subCommand === "set") {
      const threshold = Number(context.args[1]);
      const windowSec = Number(context.args[2]);

      if (!context.args[1] || !context.args[2] || Number.isNaN(threshold) || Number.isNaN(windowSec)) {
        await context.reply("Format salah.\nGunakan: .antiraid setting <threshold> <detik>\nContoh: .antiraid setting 5 10");
        return;
      }

      const result = await antiRaidService.configureSettings(context, threshold, windowSec);
      await context.reply(result);
      return;
    }

    // Direct numerical arguments: .antiraid 5 10
    const threshold = Number(context.args[0]);
    const windowSec = Number(context.args[1]);
    if (!Number.isNaN(threshold) && !Number.isNaN(windowSec) && context.args[1]) {
      const result = await antiRaidService.configureSettings(context, threshold, windowSec);
      await context.reply(result);
      return;
    }

    await context.reply(
      "Format command salah.\nGunakan:\n• .antiraid [on|off]\n• .antiraid status\n• .antiraid setting <threshold> <detik>",
    );
  } catch (error: unknown) {
    await context.reply(formatAntiRaidError(error));
  }
}

async function handleGroupSetting(context: CommandContext): Promise<void> {
  try {
    const action = context.args[0]?.toLowerCase();

    if (action === "buka" || action === "open") {
      const result = await antiRaidService.setGroupMode(context, "open");
      await context.reply(result);
      return;
    }

    if (action === "tutup" || action === "close") {
      const result = await antiRaidService.setGroupMode(context, "close");
      await context.reply(result);
      return;
    }

    await context.reply("Format salah.\nGunakan: .grup <buka|tutup>");
  } catch (error: unknown) {
    await context.reply(formatAntiRaidError(error));
  }
}

function formatAntiRaidError(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("[")) {
    return error.message;
  }
  return "[ERROR] Terjadi kesalahan saat memproses perintah Anti-Raid / Grup.";
}
