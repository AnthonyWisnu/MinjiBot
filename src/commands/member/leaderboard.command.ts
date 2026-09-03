import type { CommandContext, CommandDefinition } from "../../types/command";
import { leaderboardService } from "../../services/member/leaderboard.service";
import type { LeaderboardResult } from "../../services/member/leaderboard.service";

function formatLeaderboard(
  result: LeaderboardResult,
  title: string,
  unit: string,
): string {
  const lines: string[] = [title, ""];

  if (result.entries.length === 0) {
    lines.push("Belum ada data di grup ini.");
    return lines.join("\n");
  }

  for (const entry of result.entries) {
    lines.push(
      `${String(entry.position)}. @${entry.displayName} [${entry.rank}]`,
    );
    lines.push(`   ${unit}: ${entry.value.toLocaleString("id-ID")}`);
  }

  if (result.callerPosition !== null) {
    lines.push("");
    lines.push(`Posisi kamu: #${String(result.callerPosition)}`);
  }

  return lines.join("\n");
}

async function executeTopRank(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
    return;
  }

  const result = await leaderboardService.getTopRank(
    context.chatJid,
    context.senderUserJid,
  );
  await context.reply(formatLeaderboard(result, "TOP RANK (XP)", "XP"));
}

async function executeTopPoint(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
    return;
  }

  const result = await leaderboardService.getTopPoint(
    context.chatJid,
    context.senderUserJid,
  );
  await context.reply(formatLeaderboard(result, "TOP POIN", "Poin"));
}

export const leaderboardCommands: CommandDefinition[] = [
  {
    name: "toprank",
    aliases: ["rank"],
    execute: executeTopRank,
  },
  {
    name: "toppoint",
    execute: executeTopPoint,
  },
];
