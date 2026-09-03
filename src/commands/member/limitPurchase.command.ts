import type { CommandContext, CommandDefinition } from "../../types/command";
import {
  InsufficientPointsError,
  InvalidAmountError,
} from "../../types/memberEconomy";
import { limitPurchaseService, LIMIT_PRICE_POINTS } from "../../services/member/limitPurchase.service";
import type { LimitPurchaseResult } from "../../services/member/limitPurchase.service";

function formatPurchaseResult(result: LimitPurchaseResult): string {
  return [
    "Pembelian limit berhasil.",
    "",
    `Limit dibeli   : ${String(result.limitsBought)}`,
    `Poin digunakan : ${result.pointsSpent.toLocaleString("id-ID")}`,
    `Poin saat ini  : ${result.currentPoints.toLocaleString("id-ID")}`,
    `Limit saat ini : ${String(result.currentLimit)}`,
  ].join("\n");
}

async function executeLimitPurchase(context: CommandContext): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
    return;
  }

  const rawAmount = context.args[0];
  if (!rawAmount) {
    await context.reply(
      `Gunakan: .belilimit <jumlah>\nHarga: ${LIMIT_PRICE_POINTS.toLocaleString("id-ID")} poin per limit.`,
    );
    return;
  }

  const amount = parseInt(rawAmount, 10);

  try {
    const result = await limitPurchaseService.buyLimit(
      context.chatJid,
      context.senderUserJid,
      amount,
    );
    await context.reply(formatPurchaseResult(result));
  } catch (error: unknown) {
    if (error instanceof InvalidAmountError) {
      await context.reply(
        `Jumlah tidak valid. Masukkan bilangan bulat positif.\nContoh: .belilimit 2`,
      );
      return;
    }
    if (error instanceof InsufficientPointsError) {
      await context.reply(
        `Poin tidak cukup. Harga ${LIMIT_PRICE_POINTS.toLocaleString("id-ID")} poin per limit.`,
      );
      return;
    }
    await context.reply("Gagal membeli limit. Silakan coba lagi.");
  }
}

export const limitPurchaseCommand: CommandDefinition = {
  name: "belilimit",
  execute: executeLimitPurchase,
};
