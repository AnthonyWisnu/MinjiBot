import type { CommandContext, CommandDefinition } from "../../types/command";
import { groupStatsService } from "../../services/stats/groupStats.service";

export const groupStatsCommands: CommandDefinition[] = [
  {
    name: "stats",
    aliases: ["stat", "grupstats", "groupstats"],
    execute: handleStats,
  },
  {
    name: "topaktif",
    aliases: ["topchat", "topactive"],
    execute: handleTopActive,
  },
  {
    name: "silent",
    aliases: ["sider", "inaktif", "inactive"],
    execute: handleSilent,
  },
];

async function handleStats(context: CommandContext): Promise<void> {
  if (!context.isGroup) {
    await context.reply("Command ini hanya bisa digunakan di dalam grup.");
    return;
  }

  try {
    const result = await groupStatsService.getStats(context);
    await context.reply(result.text, { mentions: result.mentions });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Gagal mengambil statistik grup.";
    await context.reply(message);
  }
}

async function handleTopActive(context: CommandContext): Promise<void> {
  if (!context.isGroup) {
    await context.reply("Command ini hanya bisa digunakan di dalam grup.");
    return;
  }

  try {
    const result = await groupStatsService.getTopActive(context);
    await context.reply(result.text, { mentions: result.mentions });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Gagal mengambil peringkat aktivitas grup.";
    await context.reply(message);
  }
}

async function handleSilent(context: CommandContext): Promise<void> {
  if (!context.isGroup) {
    await context.reply("Command ini hanya bisa digunakan di dalam grup.");
    return;
  }

  let days = 7;
  if (context.args[0]) {
    const parsed = parseInt(context.args[0], 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 365) {
      await context.reply("Jumlah hari tidak valid. Masukkan angka antara 1 sampai 365.\nContoh: .silent 7");
      return;
    }
    days = parsed;
  }

  try {
    const result = await groupStatsService.getSilentMembers(context, days);
    await context.reply(result.text, { mentions: result.mentions });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Gagal memindai member pasif.";
    await context.reply(message);
  }
}
