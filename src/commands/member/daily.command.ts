import type { CommandContext, CommandDefinition } from "../../types/command";
import { DuplicateOperationError } from "../../types/memberEconomy";
import { dailyClaimService } from "../../services/member/dailyClaim.service";
import type { DailyClaimResult } from "../../services/member/dailyClaim.service";
import { formatRupiah } from "../../utils/currency";

function formatDailyResult(result: DailyClaimResult): string {
  const lines: string[] = [
    "*─── [ BONUS HARIAN ] ───*",
    "",
    `• Uang diperoleh : +${formatRupiah(result.moneyGained)}`,
    `• Poin diperoleh : +${result.pointsGained.toLocaleString("id-ID")} Poin`,
    `• XP diperoleh   : +${result.xpGained.toLocaleString("id-ID")} XP`,
  ];

  if (result.bonusLimitGained > 0) {
    lines.push(`• Bonus limit    : +${String(result.bonusLimitGained)} Limit`);
  }

  lines.push(`• Streak harian  : ${String(result.currentStreak)} hari`);
  if (result.autoWealthTaxPaid > 0n) {
    lines.push(`• Auto-Tax (>2M) : -${formatRupiah(result.autoWealthTaxPaid)} (1,5%/hr ke Kas Grup)`);
  }
  lines.push("");
  lines.push(`• Dompet saat ini : ${formatRupiah(result.currentMoney)}`);
  lines.push(`• Poin saat ini   : ${result.currentPoints.toLocaleString("id-ID")}`);
  lines.push(`• Limit saat ini  : ${String(result.currentLimit)}`);

  return lines.join("\n");
}

async function executeDaily(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
    return;
  }

  try {
    const result = await dailyClaimService.claimDaily(context.chatJid, context.senderUserJid);
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
  aliases: ["claim"],
  execute: executeDaily,
};
