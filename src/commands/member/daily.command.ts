import type { CommandContext, CommandDefinition } from "../../types/command";
import { DuplicateOperationError } from "../../types/memberEconomy";
import { dailyClaimService } from "../../services/member/dailyClaim.service";
import type { DailyClaimResult } from "../../services/member/dailyClaim.service";

function formatDailyResult(result: DailyClaimResult): string {
  const lines: string[] = [
    "Bonus harian berhasil diambil.",
    "",
    `Poin diperoleh : +${result.pointsGained.toLocaleString("id-ID")}`,
    `XP diperoleh   : +${String(result.xpGained)}`,
  ];

  if (result.bonusLimitGained > 0) {
    lines.push(`Bonus limit    : +${String(result.bonusLimitGained)}`);
  }

  lines.push(`Streak harian  : ${String(result.currentStreak)} hari`);
  lines.push("");
  lines.push(`Poin saat ini  : ${result.currentPoints.toLocaleString("id-ID")}`);
  lines.push(`Limit saat ini : ${String(result.currentLimit)}`);

  return lines.join("\n");
}

async function executeDaily(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
    return;
  }

  try {
    const result = await dailyClaimService.claimDaily(
      context.chatJid,
      context.senderUserJid,
    );
    await context.reply(formatDailyResult(result));
  } catch (error: unknown) {
    if (error instanceof DuplicateOperationError) {
      await context.reply("Bonus harian sudah diambil hari ini. Coba lagi besok.");
      return;
    }
    await context.reply("Gagal mengambil bonus harian. Silakan coba lagi.");
  }
}

export const dailyCommand: CommandDefinition = {
  name: "daily",
  execute: executeDaily,
};
