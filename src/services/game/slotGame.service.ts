import { prisma } from "../../repositories/prismaClient";
import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { SLOT_CONFIG } from "./gameReward.constants";
import { roleGuard } from "../../guards/roleGuard";
import type { CommandContext } from "../../types/command";

export const SLOT_SYMBOLS = ["🍒", "🍇", "🍉", "🍊", "🍋", "7️⃣"] as const;
export type SlotSymbol = typeof SLOT_SYMBOLS[number];

export interface SlotPlayResult {
  reels: [SlotSymbol, SlotSymbol, SlotSymbol];
  status: "super_jackpot" | "jackpot" | "match_two" | "loss";
  betPoints: number;
  rewardPoints: number;
  rewardXp: number;
  balancePoints: number;
  won: boolean;
  isSuperOwner?: boolean;
}

export class SlotGameService {
  constructor(
    private readonly profileRepo: GroupMemberProfileRepository = new GroupMemberProfileRepository(),
    private readonly prismaClient: typeof prisma = prisma,
  ) {}

  async play(context: CommandContext): Promise<string> {
    if (!context.isGroup) {
      return "Game slot hanya bisa dimainkan di grup aktif.";
    }

    const groupJid = context.chatJid;
    const userJid = context.senderUserJid;
    const bet = SLOT_CONFIG.BET_POINTS;

    const isSuperOwner = context.role === "SUPER_OWNER" || roleGuard.isSuperOwner(userJid);
    const isTenantOwner = context.role === "TENANT_OWNER";
    const isOwner = isSuperOwner || isTenantOwner;

    let profile = await this.profileRepo.findOrCreate(groupJid, userJid);

    // Auto-topup 100 points for Tenant Owner if balance is less than bet
    if (isTenantOwner && profile.pointsBalance < bet) {
      profile = await this.prismaClient.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          pointsBalance: { increment: 100 },
          totalPointsEarned: { increment: 100 },
        },
      });
    }

    if (!isOwner && profile.pointsBalance < bet) {
      return [
        "Poin kamu tidak cukup untuk memutar slot.",
        `Minimal taruhan: ${String(bet)} Poin.`,
        `Saldo kamu: ${String(profile.pointsBalance)} Poin.`,
        "",
        "Kumpulkan poin dengan menjawab kuis (.kuis, .tebakkata, .mtk) atau ambil bonus harian (.claim).",
      ].join("\n");
    }

    // Roll 3 reels
    const reel1 = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)] ?? "🍒";
    const reel2 = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)] ?? "🍇";
    const reel3 = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)] ?? "🍉";
    const reels: [SlotSymbol, SlotSymbol, SlotSymbol] = [reel1, reel2, reel3];

    let status: SlotPlayResult["status"] = "loss";
    let rewardPoints = 0;
    let rewardXp: number = SLOT_CONFIG.LOSS_XP;
    let won = false;

    if (reel1 === reel2 && reel2 === reel3) {
      won = true;
      if (reel1 === "7️⃣") {
        status = "super_jackpot";
        rewardPoints = SLOT_CONFIG.SUPER_JACKPOT_POINTS;
        rewardXp = SLOT_CONFIG.SUPER_JACKPOT_XP;
      } else {
        status = "jackpot";
        rewardPoints = SLOT_CONFIG.JACKPOT_POINTS;
        rewardXp = SLOT_CONFIG.JACKPOT_XP;
      }
    } else if (reel1 === reel2 || reel2 === reel3 || reel1 === reel3) {
      won = true;
      status = "match_two";
      rewardPoints = SLOT_CONFIG.MATCH_TWO_POINTS;
      rewardXp = SLOT_CONFIG.MATCH_TWO_XP;
    }

    // Net point change:
    // If Super Owner, do not deduct below 0
    const netPoints = isSuperOwner && profile.pointsBalance < bet ? rewardPoints : rewardPoints - bet;

    const updated = await this.prismaClient.groupMemberProfile.update({
      where: { id: profile.id },
      data: {
        pointsBalance: { increment: netPoints },
        experience: { increment: rewardXp },
        totalPointsEarned: rewardPoints > 0 ? { increment: rewardPoints } : undefined,
        totalGamesPlayed: { increment: 1 },
        totalGamesWon: won ? { increment: 1 } : undefined,
      },
    });

    return this.formatResult({
      reels,
      status,
      betPoints: bet,
      rewardPoints,
      rewardXp,
      balancePoints: updated.pointsBalance,
      won,
      isSuperOwner,
    });
  }

  private formatResult(result: SlotPlayResult): string {
    const [r1, r2, r3] = result.reels;
    const reelLine = `     [ ${r1} | ${r2} | ${r3} ]`;

    let title = "";
    if (result.status === "super_jackpot") {
      title = "👑 *SUPER JACKPOT 777!*";
    } else if (result.status === "jackpot") {
      title = "🎉 *JACKPOT TIGA KEMBAR!*";
    } else if (result.status === "match_two") {
      title = "✨ *MENANG DUA KEMBAR!*";
    } else {
      title = "❌ *BELUM BERUNTUNG!*";
    }

    const sisaPoin = result.isSuperOwner
      ? "Unlimited (Super Owner)"
      : `${result.balancePoints.toLocaleString("id-ID")} Poin`;

    return [
      "*─── [ MINJI SLOT ] ───*",
      reelLine,
      "",
      title,
      `• Taruhan  : ${String(result.betPoints)} Poin${result.isSuperOwner ? " (Free)" : ""}`,
      `• Hadiah   : ${result.rewardPoints > 0 ? `+${String(result.rewardPoints)}` : "0"} Poin`,
      `• XP       : +${String(result.rewardXp)} XP`,
      `• Sisa Poin: ${sisaPoin}`,
    ].join("\n");
  }
}

export const slotGameService = new SlotGameService();
