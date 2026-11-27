import type { CommandContext, CommandDefinition } from "../../types/command";
import { leaderboardService } from "../../services/member/leaderboard.service";
import type { LeaderboardResult } from "../../services/member/leaderboard.service";
import { formatCompactRupiah } from "../../utils/currency";

function formatLeaderboard(
  result: LeaderboardResult,
  title: string,
  unit: string,
  asRupiah = false,
): { text: string; mentions: string[] } {
  const lines: string[] = [title, ""];
  const mentions: string[] = [];

  if (result.entries.length === 0) {
    lines.push("Belum ada data di grup ini.");
    return { text: lines.join("\n"), mentions };
  }

  for (const entry of result.entries) {
    mentions.push(entry.userJid);
    const formattedValue = asRupiah
      ? formatCompactRupiah(entry.value)
      : `${entry.value.toLocaleString("id-ID")} ${unit}`;
    lines.push(`${String(entry.position)}. @${entry.displayName} [${entry.rank}]`);
    lines.push(`   ${asRupiah ? "Total Aset" : unit}: ${formattedValue}`);
  }

  if (result.callerPosition !== null) {
    lines.push("");
    lines.push(`Posisi kamu: #${String(result.callerPosition)}`);
  }

  return { text: lines.join("\n"), mentions };
}

async function executeTopRank(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
    return;
  }

  const result = await leaderboardService.getTopRank(context.chatJid, context.senderUserJid);
  const { text, mentions } = formatLeaderboard(result, "*─── [ TOP RANK (XP) ] ───*", "XP");
  await context.reply(text, { mentions });
}

async function executeTopPoint(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
    return;
  }

  const result = await leaderboardService.getTopPoint(context.chatJid, context.senderUserJid);
  const { text, mentions } = formatLeaderboard(result, "*─── [ TOP POIN GAME ] ───*", "Poin");
  await context.reply(text, { mentions });
}

async function executeTopWealth(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
    return;
  }

  const result = await leaderboardService.getTopWealth(context.chatJid, context.senderUserJid);
  const { text, mentions } = formatLeaderboard(
    result,
    "*─── [ TOP SULTAN GRUP ] ───*",
    "Rp",
    true,
  );
  await context.reply(text, { mentions });
}

export const leaderboardCommands: CommandDefinition[] = [
  {
    name: "toprank",
    aliases: ["topxp"],
    execute: executeTopRank,
  },
  {
    name: "toppoint",
    execute: executeTopPoint,
  },
  {
    name: "toprich",
    aliases: ["leaderboard", "lb", "topsultan", "topuang"],
    execute: executeTopWealth,
  },
];
