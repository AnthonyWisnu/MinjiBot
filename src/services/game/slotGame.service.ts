import { prisma } from "../../repositories/prismaClient";
import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { SLOT_CONFIG } from "./gameReward.constants";
import { roleGuard } from "../../guards/roleGuard";
import type { CommandContext } from "../../types/command";

export const SLOT_FRUIT_SYMBOLS = ["🍒", "🍇", "🍉", "🍊", "🍋"] as const;
export const SLOT_SYMBOLS = [...SLOT_FRUIT_SYMBOLS, "7️⃣"] as const;
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
  isAllIn?: boolean;
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
    const minBet = SLOT_CONFIG.BET_POINTS;

    const isSuperOwner = context.role === "SUPER_OWNER" || roleGuard.isSuperOwner(userJid);
    const isTenantOwner = context.role === "TENANT_OWNER";
    const isOwner = isSuperOwner || isTenantOwner;

    let profile = await this.profileRepo.findOrCreate(groupJid, userJid);

    // Auto-topup 100 points for Tenant Owner if balance is less than minBet
    if (isTenantOwner && profile.pointsBalance < minBet) {
      profile = await this.prismaClient.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          pointsBalance: { increment: 100 },
          totalPointsEarned: { increment: 100 },
        },
      });
    }

    // Determine bet amount & all-in flag
    let bet: number = minBet;
    let isAllIn = false;
    const betArg = context.args[0]?.toLowerCase().trim();

    if (betArg === "all" || betArg === "allin") {
      if (!isOwner && profile.pointsBalance < minBet) {
        return [
          "Saldo kamu tidak mencukupi untuk all-in.",
          `Minimal taruhan: ${String(minBet)} Poin.`,
          `Saldo kamu saat ini: ${profile.pointsBalance.toLocaleString("id-ID")} Poin.`,
        ].join("\n");
      }
      bet = isOwner && profile.pointsBalance < minBet ? minBet : profile.pointsBalance;
      isAllIn = true;
    } else if (betArg && betArg.length > 0) {
      const parsedBet = Number(betArg);
      if (!Number.isInteger(parsedBet) || parsedBet < minBet) {
        return `Jumlah taruhan tidak valid. Minimal taruhan adalah ${String(minBet)} poin.`;
      }
      if (!isOwner && profile.pointsBalance < parsedBet) {
        return [
          "Poin kamu tidak cukup untuk taruhan ini.",
          `Taruhan diajukan: ${parsedBet.toLocaleString("id-ID")} Poin.`,
          `Saldo kamu: ${profile.pointsBalance.toLocaleString("id-ID")} Poin.`,
          "",
          "Kumpulkan poin dengan menjawab kuis (.kuis, .family100) atau ambil bonus harian (.claim).",
        ].join("\n");
      }
      bet = parsedBet;
      if (profile.pointsBalance > 0 && bet >= Math.floor(profile.pointsBalance * 0.8)) {
        isAllIn = true;
      }
    } else {
      // Default bet
      if (!isOwner && profile.pointsBalance < minBet) {
        return [
          "Poin kamu tidak cukup untuk memutar slot.",
          `Minimal taruhan: ${String(minBet)} Poin.`,
          `Saldo kamu: ${profile.pointsBalance.toLocaleString("id-ID")} Poin.`,
          "",
          "Kumpulkan poin dengan menjawab kuis (.kuis, .family100) atau ambil bonus harian (.claim).",
        ].join("\n");
      }
    }

    // --- Educational Weighted RNG (The Reality Trap) ---
    // 1. All-in: tiny win rate (~6%) - high risk punishment
    // 2. Beginner (1-3 games): ~65% win rate ("Dikasih senang")
    // 3. Casual (4-10 games): ~35% win rate
    // 4. Veteran (11+ games): ~20% win rate (The House Edge)
    let winRate: number;
    if (isAllIn) {
      winRate = 0.06;
    } else if (profile.totalGamesPlayed <= 3) {
      winRate = 0.65;
    } else if (profile.totalGamesPlayed <= 10) {
      winRate = 0.35;
    } else {
      winRate = 0.20;
    }

    const roll = Math.random();
    const isWin = roll < winRate;

    let reels: [SlotSymbol, SlotSymbol, SlotSymbol];
    let status: SlotPlayResult["status"] = "loss";
    let won = false;
    let rewardPoints = 0;
    let rewardXp: number = SLOT_CONFIG.LOSS_XP;

    if (isWin) {
      won = true;
      const winTier = Math.random();
      if (winTier < 0.06) {
        // Super Jackpot: 7️⃣ 7️⃣ 7️⃣
        reels = ["7️⃣", "7️⃣", "7️⃣"];
        status = "super_jackpot";
        rewardPoints = Math.round(bet * 10);
        rewardXp = SLOT_CONFIG.SUPER_JACKPOT_XP;
      } else if (winTier < 0.28) {
        // Jackpot: 3 identical fruit symbols
        const fruit = SLOT_FRUIT_SYMBOLS[Math.floor(Math.random() * SLOT_FRUIT_SYMBOLS.length)] ?? "🍒";
        reels = [fruit, fruit, fruit];
        status = "jackpot";
        rewardPoints = Math.round(bet * 5);
        rewardXp = SLOT_CONFIG.JACKPOT_XP;
      } else {
        // Match Two
        const pair = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)] ?? "🍒";
        const others = SLOT_SYMBOLS.filter((s) => s !== pair);
        const single = others[Math.floor(Math.random() * others.length)] ?? "🍋";
        const singlePos = Math.floor(Math.random() * 3);
        const temp: SlotSymbol[] = [pair, pair, pair];
        temp[singlePos] = single;
        reels = [temp[0] ?? pair, temp[1] ?? pair, temp[2] ?? pair];
        status = "match_two";
        rewardPoints = Math.max(1, Math.round(bet * 1.5));
        rewardXp = SLOT_CONFIG.MATCH_TWO_XP;
      }
    } else {
      // Guaranteed distinct losing combination (3 different symbols)
      won = false;
      status = "loss";
      const shuffled = [...SLOT_SYMBOLS].sort(() => Math.random() - 0.5);
      reels = [shuffled[0] ?? "🍒", shuffled[1] ?? "🍇", shuffled[2] ?? "🍉"];
      rewardPoints = 0;
      rewardXp = SLOT_CONFIG.LOSS_XP;
    }

    // Net point change:
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
      isAllIn,
    });
  }

  private formatResult(result: SlotPlayResult): string {
    const [r1, r2, r3] = result.reels;
    const reelLine = `     [ ${r1} | ${r2} | ${r3} ]`;

    // Special educational response when losing an ALL-IN
    if (result.isAllIn && !result.won) {
      return [
        "*─── [ 🎰 SLOT - RUNGKAD TOTAL! 🎰 ] ───*",
        reelLine,
        "",
        "💀 *KAMU KALAH DALAM TARUHAN ALL-IN!*",
        `• Taruhan Hangus : -${result.betPoints.toLocaleString("id-ID")} Poin`,
        `• Sisa Poin Kamu : ${result.balancePoints.toLocaleString("id-ID")} Poin`,
        "",
        "⚠️ *PELAJARAN HIDUP:*",
        "Mesin slot & judi online dirancang bandar agar kamu kalah total!",
        "Keserakahan all-in hanya akan membawamu ke jurang kemiskinan.",
        "Kumpulkan poin kembali lewat jalur halal (.kuis, .claim).",
      ].join("\n");
    }

    let title = "";
    if (result.status === "super_jackpot") {
      title = "👑 *SUPER JACKPOT 777!* (10x Lipat)";
    } else if (result.status === "jackpot") {
      title = "🎉 *JACKPOT TIGA KEMBAR!* (5x Lipat)";
    } else if (result.status === "match_two") {
      title = "✨ *MENANG DUA KEMBAR!* (1.5x Lipat)";
    } else {
      title = "❌ *BELUM BERUNTUNG!*";
    }

    const sisaPoin = result.isSuperOwner
      ? "Unlimited (Super Owner)"
      : `${result.balancePoints.toLocaleString("id-ID")} Poin`;

    const lines = [
      "*─── [ MINJI SLOT ] ───*",
      reelLine,
      "",
      title,
      `• Taruhan  : ${result.betPoints.toLocaleString("id-ID")} Poin${result.isSuperOwner ? " (Free)" : ""}`,
      `• Hadiah   : ${result.rewardPoints > 0 ? `+${result.rewardPoints.toLocaleString("id-ID")}` : "0"} Poin`,
      `• XP       : +${String(result.rewardXp)} XP`,
      `• Sisa Poin: ${sisaPoin}`,
    ];

    if (result.isAllIn && result.won) {
      lines.push(
        "",
        "⚠️ *Catatan:* Kamu memenangkan taruhan berisiko tinggi dengan peluang hanya 6%! Jangan jadikan kebiasaan karena dalam jangka panjang, bandar selalu menang.",
      );
    }

    return lines.join("\n");
  }
}

export const slotGameService = new SlotGameService();
