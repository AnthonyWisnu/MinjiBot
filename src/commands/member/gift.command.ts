import { identityResolverService } from "../../services/identity/identityResolver.service";
import { giftService } from "../../services/member/gift.service";
import type { GiftResult } from "../../services/member/gift.service";
import type { CommandContext, CommandDefinition } from "../../types/command";
import {
  DuplicateOperationError,
  InsufficientLimitError,
  InsufficientPointsError,
  InvalidAmountError,
} from "../../types/memberEconomy";
import { getBotCanonicalJids, getIdentityCandidateJids, normalizeUserJid } from "../../utils/jid";

function formatGiftResult(result: GiftResult, recipientJid: string, asset: string): string {
  return [
    "Transfer berhasil.",
    "",
    `Dikirim ke  : @${normalizeUserJid(recipientJid).split("@")[0] ?? recipientJid}`,
    `Jumlah      : ${result.amountSent.toLocaleString("id-ID")}`,
    `Sisa ${asset.toLowerCase().padEnd(5)} : ${result.senderBalance.toLocaleString("id-ID")}`,
  ].join("\n");
}

async function executeGift(context: CommandContext, assetType: "point" | "limit"): Promise<void> {
  if (!context.isGroup || !context.tenantGroup) {
    await context.reply("Perintah ini hanya bisa digunakan di grup aktif.");
    return;
  }

  const rawRecipient = context.mentionedJids[0];
  if (!rawRecipient) {
    await context.reply(
      assetType === "point"
        ? "Gunakan: .giftpoint @user <jumlah>"
        : "Gunakan: .giftlimit @user <jumlah>",
    );
    return;
  }

  const rawAmount = context.args.find((arg) => /^\d+$/.test(arg));
  if (!rawAmount) {
    await context.reply("Jumlah tidak valid. Masukkan angka positif.");
    return;
  }

  const amount = parseInt(rawAmount, 10);

  const recipientJid = await identityResolverService.resolveCanonicalUserJid(
    context.socket,
    context.chatJid,
    rawRecipient,
  );

  const senderCandidates = getIdentityCandidateJids(context.senderUserJid, context.senderAltJids);
  if (
    senderCandidates.includes(recipientJid) ||
    senderCandidates.includes(normalizeUserJid(rawRecipient))
  ) {
    await context.reply("Tidak bisa mengirim ke diri sendiri.");
    return;
  }

  const botJids = getBotCanonicalJids(context.socket);
  if (botJids.has(recipientJid) || botJids.has(normalizeUserJid(rawRecipient))) {
    await context.reply("Tidak bisa mengirim ke bot.");
    return;
  }

  const isMember = await identityResolverService.isGroupMember(
    context.socket,
    context.chatJid,
    rawRecipient,
  );
  if (!isMember) {
    await context.reply("Penerima bukan peserta grup ini.");
    return;
  }

  // Fetch current group participants from Baileys.
  let participantJids: string[] = [];
  try {
    const metadata = await identityResolverService.getGroupMetadata(
      context.socket,
      context.chatJid,
    );
    if (metadata?.participants) {
      participantJids = metadata.participants.map((p) => p.id);
    }
  } catch {
    // fallback if metadata fetch fails
  }

  try {
    const result =
      assetType === "point"
        ? await giftService.giftPoints({
            groupJid: context.chatJid,
            senderJid: context.senderUserJid,
            senderAltJids: context.senderAltJids,
            recipientJid,
            amount,
            idempotencyKey: context.message.key.id ?? undefined,
            participantJids,
            botJids,
          })
        : await giftService.giftLimit({
            groupJid: context.chatJid,
            senderJid: context.senderUserJid,
            senderAltJids: context.senderAltJids,
            recipientJid,
            amount,
            idempotencyKey: context.message.key.id ?? undefined,
            participantJids,
            botJids,
          });

    const assetLabel = assetType === "point" ? "Poin" : "Limit";
    await context.reply(formatGiftResult(result, recipientJid, assetLabel));
  } catch (error: unknown) {
    if (error instanceof DuplicateOperationError) {
      await context.reply("Transfer ini sudah pernah dilakukan.");
      return;
    }
    if (error instanceof InsufficientPointsError || error instanceof InsufficientLimitError) {
      await context.reply("Saldo tidak cukup untuk transfer.");
      return;
    }
    if (error instanceof InvalidAmountError) {
      await context.reply(error.message);
      return;
    }
    await context.reply("Gagal melakukan transfer. Silakan coba lagi.");
  }
}

export const giftCommands: CommandDefinition[] = [
  {
    name: "giftpoint",
    execute: (context) => executeGift(context, "point"),
  },
  {
    name: "giftlimit",
    execute: (context) => executeGift(context, "limit"),
  },
];
