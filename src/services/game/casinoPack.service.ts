import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupMemberProfile,
} from "@prisma/client";

import { AppUserError } from "../../errors/appUserError";
import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { GroupMemberTransactionRepository } from "../../repositories/groupMemberTransaction.repository";
import { prisma } from "../../repositories/prismaClient";
import { clampMoneyCredit, formatRupiah, minBigInt } from "../../utils/currency";
import { normalizeUserJid } from "../../utils/jid";
import { generateCorrelationId } from "../member/memberEconomy.service";
import { defaultRandom, type RandomProvider } from "../member/randomProvider";
import {
  parseRpgState,
  serializeRpgState,
  withCrateDelta,
  withUgdUntil,
  withUpdatedCooldown,
} from "../rpg/rpgState";

export const CASINO_MIN_BET = 100_000n;
export const CASINO_MAX_BET = 250_000_000n;
export const CASINO_DEFAULT_BET = 1_000_000n;
export const RUSSIAN_SURVIVE_REWARD = 15_000_000n;
export const RUSSIAN_HIT_PENALTY = 5_000_000n;
export const RUSSIAN_UGD_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 5 * 60 * 1000;
const MAX_ACTIVE_TABLES = 200;

export type SuitChoice = "batu" | "gunting" | "kertas";

export interface BlackjackCard {
  rank: string;
  suit: string;
  value: number;
}

export interface BlackjackSession {
  groupJid: string;
  userJid: string;
  bet: bigint;
  playerHand: BlackjackCard[];
  dealerHand: BlackjackCard[];
  expiresAt: number;
  messageId?: string;
}

export interface HiLowSession {
  groupJid: string;
  userJid: string;
  bet: bigint;
  firstCard: BlackjackCard;
  expiresAt: number;
  messageId?: string;
}

export interface SuitChallenge {
  groupJid: string;
  challengerJid: string;
  opponentJid: string;
  bet: bigint;
  choices: Map<string, SuitChoice>;
  expiresAt: number;
}

interface CasinoProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
}

interface CasinoTxStore {
  create(
    data: {
      profileId: string;
      groupJid: string;
      userJid: string;
      asset: MemberTransactionAsset;
      type: MemberTransactionType;
      amount: number | bigint;
      balanceBefore?: number | bigint;
      balanceAfter?: number | bigint;
      correlationId?: string;
      note?: string;
    },
    tx?: unknown,
  ): Promise<unknown>;
}

interface CasinoTx {
  groupMemberProfile: {
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<GroupMemberProfile>;
  };
}

interface CasinoDb {
  $transaction<T>(fn: (tx: CasinoTx) => Promise<T>): Promise<T>;
}

const RANKS: readonly { rank: string; value: number }[] = [
  { rank: "2", value: 2 },
  { rank: "3", value: 3 },
  { rank: "4", value: 4 },
  { rank: "5", value: 5 },
  { rank: "6", value: 6 },
  { rank: "7", value: 7 },
  { rank: "8", value: 8 },
  { rank: "9", value: 9 },
  { rank: "10", value: 10 },
  { rank: "J", value: 10 },
  { rank: "Q", value: 10 },
  { rank: "K", value: 10 },
  { rank: "A", value: 11 },
];
const SUITS = ["♠", "♥", "♦", "♣"] as const;
const ROULETTE_RED_NUMS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export function computeBlackjackTotal(hand: readonly BlackjackCard[]): number {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    total += c.value;
    if (c.rank === "A") aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

export function formatHand(hand: readonly BlackjackCard[]): string {
  return hand.map((c) => `[${c.rank}${c.suit}]`).join(" ");
}

export function evaluateSuitWinner(a: SuitChoice, b: SuitChoice): "a" | "b" | "draw" {
  if (a === b) return "draw";
  if (
    (a === "batu" && b === "gunting") ||
    (a === "gunting" && b === "kertas") ||
    (a === "kertas" && b === "batu")
  ) {
    return "a";
  }
  return "b";
}

function getJakartaDayInt(nowMs: number): number {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMs));
  return Number.parseInt(s.replace(/-/g, ""), 10);
}

export class CasinoPackService {
  private readonly bjSessions = new Map<string, BlackjackSession>();
  private readonly hilowSessions = new Map<string, HiLowSession>();
  private readonly suitChallenges = new Map<string, SuitChallenge>();

  constructor(
    private readonly profileRepo: CasinoProfileStore = new GroupMemberProfileRepository(),
    private readonly txRepo: CasinoTxStore = new GroupMemberTransactionRepository(),
    private readonly random: RandomProvider = defaultRandom,
    private readonly db: CasinoDb = prisma,
  ) {}

  private drawCard(): BlackjackCard {
    const r = RANKS[this.random.intBetween(0, RANKS.length - 1)] ?? { rank: "A", value: 11 };
    const s = SUITS[this.random.intBetween(0, SUITS.length - 1)] ?? "♠";
    return { rank: r.rank, suit: s, value: r.value };
  }

  private validateBet(bet: bigint): void {
    if (bet < CASINO_MIN_BET || bet > CASINO_MAX_BET) {
      throw new AppUserError(
        `Taruhan harus antara ${formatRupiah(CASINO_MIN_BET)} sampai ${formatRupiah(CASINO_MAX_BET)}.`,
      );
    }
  }

  private async settleMoneyDelta(input: {
    groupJid: string;
    userJid: string;
    bet: bigint;
    netDelta: bigint; // positive = win net, negative = loss, 0 = draw
    xp: number;
    note: string;
  }): Promise<{ newBalance: bigint; deltaApplied: bigint }> {
    const normUser = normalizeUserJid(input.userJid);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const prof = await this.profileRepo.findOrCreate(input.groupJid, normUser, tx);
      if (prof.moneyBalance < input.bet) {
        throw new AppUserError(
          `Uang dompetmu kurang untuk taruhan ${formatRupiah(input.bet)} (dompet: ${formatRupiah(prof.moneyBalance)}).`,
        );
      }

      let deltaApplied = input.netDelta;
      if (deltaApplied > 0n) {
        deltaApplied = clampMoneyCredit(prof.moneyBalance, deltaApplied);
      } else if (deltaApplied < 0n) {
        const loss = minBigInt(prof.moneyBalance, -deltaApplied);
        deltaApplied = -loss;
      }

      const updated = await tx.groupMemberProfile.update({
        where: { id: prof.id },
        data: {
          ...(deltaApplied > 0n
            ? {
                moneyBalance: { increment: deltaApplied },
                totalMoneyEarned: { increment: deltaApplied },
              }
            : deltaApplied < 0n
              ? { moneyBalance: { decrement: -deltaApplied } }
              : {}),
          experience: { increment: input.xp },
        },
      });

      if (deltaApplied !== 0n) {
        await this.txRepo.create(
          {
            profileId: prof.id,
            groupJid: input.groupJid,
            userJid: normUser,
            asset: MemberTransactionAsset.MONEY,
            type: deltaApplied > 0n ? MemberTransactionType.GAME_REWARD : MemberTransactionType.RPG_LOSS,
            amount: deltaApplied,
            balanceBefore: prof.moneyBalance,
            balanceAfter: updated.moneyBalance,
            correlationId,
            note: input.note,
          },
          tx,
        );
      }

      return { newBalance: updated.moneyBalance, deltaApplied };
    });
  }

  // ======================== BLACKJACK 21 ========================

  getBlackjackSession(groupJid: string, userJid: string, nowMs = Date.now()): BlackjackSession | null {
    this.sweep(nowMs);
    return this.bjSessions.get(`${groupJid}::${normalizeUserJid(userJid)}`) ?? null;
  }

  setBlackjackMessageId(groupJid: string, userJid: string, messageId: string): void {
    const s = this.bjSessions.get(`${groupJid}::${normalizeUserJid(userJid)}`);
    if (s) s.messageId = messageId;
  }

  async startBlackjack(
    groupJid: string,
    userJid: string,
    bet: bigint,
    nowMs = Date.now(),
  ): Promise<{ finished: boolean; session: BlackjackSession; text: string }> {
    this.sweep(nowMs);
    this.validateBet(bet);
    const normUser = normalizeUserJid(userJid);
    const key = `${groupJid}::${normUser}`;
    if (this.bjSessions.has(key)) {
      throw new AppUserError("Kamu masih punya meja Blackjack aktif! Reply *hit* atau *stand*.");
    }

    const prof = await this.profileRepo.findOrCreate(groupJid, normUser);
    if (prof.moneyBalance < bet) {
      throw new AppUserError(
        `Dompetmu kurang untuk taruhan ${formatRupiah(bet)} (dompet: ${formatRupiah(prof.moneyBalance)}).`,
      );
    }

    if (this.bjSessions.size >= MAX_ACTIVE_TABLES) {
      const oldest = this.bjSessions.keys().next().value;
      if (oldest) this.bjSessions.delete(oldest);
    }

    const session: BlackjackSession = {
      groupJid,
      userJid: normUser,
      bet,
      playerHand: [this.drawCard(), this.drawCard()],
      dealerHand: [this.drawCard(), this.drawCard()],
      expiresAt: nowMs + SESSION_TTL_MS,
    };

    const pTotal = computeBlackjackTotal(session.playerHand);
    if (pTotal === 21) {
      const bonusWin = (bet * 3n) / 2n; // Natural Blackjack +1.5x
      const { newBalance } = await this.settleMoneyDelta({
        groupJid,
        userJid: normUser,
        bet,
        netDelta: bonusWin,
        xp: 90,
        note: "blackjack_natural",
      });
      return {
        finished: true,
        session,
        text: [
          "*── [ BLACKJACK NATURAL 21! ] ──*",
          `Kartumu : ${formatHand(session.playerHand)} (21)`,
          `Bandar  : ${formatHand(session.dealerHand)} (${String(computeBlackjackTotal(session.dealerHand))})`,
          `Menang  : *+${formatRupiah(bonusWin)}* (+90 XP)`,
          `Dompet  : ${formatRupiah(newBalance)}`,
        ].join("\n"),
      };
    }

    this.bjSessions.set(key, session);
    const dealerUp = session.dealerHand[0];
    return {
      finished: false,
      session,
      text: [
        "*── [ BLACKJACK 21 ] ──*",
        `Taruhan : ${formatRupiah(bet)}`,
        `Kartumu : ${formatHand(session.playerHand)} (*${String(pTotal)}*)`,
        `Bandar  : [${dealerUp ? `${dealerUp.rank}${dealerUp.suit}` : "?"}] [??]`,
        "",
        "Reply pesan ini: *hit* (tambah kartu), *stand* (berhenti), atau *double* (gandakan taruhan).",
      ].join("\n"),
    };
  }

  async actionBlackjack(
    groupJid: string,
    userJid: string,
    action: "hit" | "stand" | "double",
    nowMs = Date.now(),
  ): Promise<{ finished: boolean; text: string }> {
    this.sweep(nowMs);
    const normUser = normalizeUserJid(userJid);
    const key = `${groupJid}::${normUser}`;
    const session = this.bjSessions.get(key);
    if (!session) {
      throw new AppUserError("Kamu tidak punya meja Blackjack aktif. Mulai dengan *.blackjack <taruhan>*.");
    }

    if (action === "double") {
      const doubled = session.bet * 2n;
      const prof = await this.profileRepo.findOrCreate(groupJid, normUser);
      if (prof.moneyBalance < doubled) {
        throw new AppUserError("Dompetmu tidak cukup untuk Double Down.");
      }
      session.bet = doubled;
      session.playerHand.push(this.drawCard());
    } else if (action === "hit") {
      session.playerHand.push(this.drawCard());
    }

    const pTotal = computeBlackjackTotal(session.playerHand);
    if (pTotal > 21) {
      this.bjSessions.delete(key);
      const { newBalance } = await this.settleMoneyDelta({
        groupJid,
        userJid: normUser,
        bet: session.bet,
        netDelta: -session.bet,
        xp: 15,
        note: "blackjack_bust",
      });
      return {
        finished: true,
        text: [
          "*── [ BLACKJACK: BUST! ] ──*",
          `Kartumu : ${formatHand(session.playerHand)} (*${String(pTotal)}* > 21)`,
          `Kalah   : *-${formatRupiah(session.bet)}*`,
          `Dompet  : ${formatRupiah(newBalance)}`,
        ].join("\n"),
      };
    }

    if (action === "hit" && pTotal < 21) {
      session.expiresAt = nowMs + SESSION_TTL_MS;
      const dealerUp = session.dealerHand[0];
      return {
        finished: false,
        text: [
          "*── [ BLACKJACK 21 ] ──*",
          `Kartumu : ${formatHand(session.playerHand)} (*${String(pTotal)}*)`,
          `Bandar  : [${dealerUp ? `${dealerUp.rank}${dealerUp.suit}` : "?"}] [??]`,
          "",
          "Reply *hit* atau *stand*!",
        ].join("\n"),
      };
    }

    // Dealer draws until 17+
    while (computeBlackjackTotal(session.dealerHand) < 17) {
      session.dealerHand.push(this.drawCard());
    }

    this.bjSessions.delete(key);
    const dTotal = computeBlackjackTotal(session.dealerHand);
    let outcome: "win" | "lose" | "push";
    if (dTotal > 21 || pTotal > dTotal) {
      outcome = "win";
    } else if (pTotal < dTotal) {
      outcome = "lose";
    } else {
      outcome = "push";
    }

    const netDelta = outcome === "win" ? session.bet : outcome === "lose" ? -session.bet : 0n;
    const xp = outcome === "win" ? 65 : 20;
    const { newBalance } = await this.settleMoneyDelta({
      groupJid,
      userJid: normUser,
      bet: session.bet,
      netDelta,
      xp,
      note: `blackjack_${outcome}`,
    });

    const headline =
      outcome === "win"
        ? "*── [ BLACKJACK: MENANG! ] ──*"
        : outcome === "lose"
          ? "*── [ BLACKJACK: KALAH ] ──*"
          : "*── [ BLACKJACK: SERI (PUSH) ] ──*";
    const resultLine =
      outcome === "win"
        ? `Menang  : *+${formatRupiah(session.bet)}* (+65 XP)`
        : outcome === "lose"
          ? `Kalah   : *-${formatRupiah(session.bet)}*`
          : "Hasil   : Taruhan dikembalikan utuh.";

    return {
      finished: true,
      text: [
        headline,
        `Kartumu : ${formatHand(session.playerHand)} (*${String(pTotal)}*)`,
        `Bandar  : ${formatHand(session.dealerHand)} (*${String(dTotal)}*)`,
        resultLine,
        `Dompet  : ${formatRupiah(newBalance)}`,
      ].join("\n"),
    };
  }

  // ======================== HI-LOW CARD ========================

  getHiLowSession(groupJid: string, userJid: string, nowMs = Date.now()): HiLowSession | null {
    this.sweep(nowMs);
    return this.hilowSessions.get(`${groupJid}::${normalizeUserJid(userJid)}`) ?? null;
  }

  setHiLowMessageId(groupJid: string, userJid: string, messageId: string): void {
    const s = this.hilowSessions.get(`${groupJid}::${normalizeUserJid(userJid)}`);
    if (s) s.messageId = messageId;
  }

  async startHiLow(
    groupJid: string,
    userJid: string,
    bet: bigint,
    nowMs = Date.now(),
  ): Promise<{ session: HiLowSession; text: string }> {
    this.sweep(nowMs);
    this.validateBet(bet);
    const normUser = normalizeUserJid(userJid);
    const prof = await this.profileRepo.findOrCreate(groupJid, normUser);
    if (prof.moneyBalance < bet) {
      throw new AppUserError(`Dompetmu kurang untuk taruhan ${formatRupiah(bet)}.`);
    }

    const firstCard = this.drawCard();
    const session: HiLowSession = {
      groupJid,
      userJid: normUser,
      bet,
      firstCard,
      expiresAt: nowMs + SESSION_TTL_MS,
    };
    this.hilowSessions.set(`${groupJid}::${normUser}`, session);

    return {
      session,
      text: [
        "*── [ TEBAK KARTU HI-LOW ] ──*",
        `Taruhan       : ${formatRupiah(bet)}`,
        `Kartu Pertama : *[${firstCard.rank}${firstCard.suit}]* (Nilai ${String(firstCard.value)})`,
        "",
        "Kartu berikutnya lebih *tinggi* atau *rendah*?",
        "_Reply pesan ini: *tinggi* atau *rendah*!_",
      ].join("\n"),
    };
  }

  async resolveHiLow(
    groupJid: string,
    userJid: string,
    guess: "tinggi" | "rendah",
    nowMs = Date.now(),
  ): Promise<string> {
    this.sweep(nowMs);
    const normUser = normalizeUserJid(userJid);
    const key = `${groupJid}::${normUser}`;
    const session = this.hilowSessions.get(key);
    if (!session) {
      throw new AppUserError("Tidak ada sesi Hi-Low aktif. Mulai dengan *.hilow <taruhan>*.");
    }
    this.hilowSessions.delete(key);

    const nextCard = this.drawCard();
    const isPush = nextCard.value === session.firstCard.value;
    const isWin =
      !isPush &&
      ((guess === "tinggi" && nextCard.value > session.firstCard.value) ||
        (guess === "rendah" && nextCard.value < session.firstCard.value));

    const netDelta = isPush ? 0n : isWin ? (session.bet * 9n) / 10n : -session.bet;
    const { newBalance } = await this.settleMoneyDelta({
      groupJid,
      userJid: normUser,
      bet: session.bet,
      netDelta,
      xp: isWin ? 50 : 15,
      note: `hilow_${isPush ? "push" : isWin ? "win" : "lose"}`,
    });

    return [
      isPush ? "*── [ HI-LOW: SERI! ] ──*" : isWin ? "*── [ HI-LOW: MENANG! ] ──*" : "*── [ HI-LOW: KALAH ] ──*",
      `Kartu 1 : [${session.firstCard.rank}${session.firstCard.suit}] -> Kartu 2: *[${nextCard.rank}${nextCard.suit}]*`,
      `Tebakan : ${guess.toUpperCase()}`,
      isPush
        ? "Hasil   : Nilai sama, taruhan kembali."
        : isWin
          ? `Hadiah  : *+${formatRupiah(netDelta)}* (+50 XP)`
          : `Kalah   : *-${formatRupiah(session.bet)}*`,
      `Dompet  : ${formatRupiah(newBalance)}`,
    ].join("\n");
  }

  // ======================== INSTANT CASINO GAMES ========================

  async playDice(groupJid: string, userJid: string, bet: bigint): Promise<string> {
    this.validateBet(bet);
    const p1 = this.random.intBetween(1, 6);
    const p2 = this.random.intBetween(1, 6);
    const d1 = this.random.intBetween(1, 6);
    const d2 = this.random.intBetween(1, 6);
    const pSum = p1 + p2;
    const dSum = d1 + d2;
    const isDoubleSix = p1 === 6 && p2 === 6;

    const netDelta = isDoubleSix ? bet * 2n : pSum > dSum ? bet : pSum < dSum ? -bet : 0n;
    const { newBalance } = await this.settleMoneyDelta({
      groupJid,
      userJid,
      bet,
      netDelta,
      xp: netDelta > 0n ? 50 : 15,
      note: "casino_dice",
    });

    return [
      "*── [ ADU DADU SULTAN ] ──*",
      `Dadumu : [${String(p1)}] + [${String(p2)}] = *${String(pSum)}*`,
      `Bandar : [${String(d1)}] + [${String(d2)}] = *${String(dSum)}*`,
      netDelta > 0n
        ? `Menang : *+${formatRupiah(netDelta)}*${isDoubleSix ? " (DOUBLE 6 JACKPOT!)" : ""}`
        : netDelta < 0n
          ? `Kalah  : *-${formatRupiah(bet)}*`
          : "Hasil  : Seri! Taruhan kembali.",
      `Dompet : ${formatRupiah(newBalance)}`,
    ].join("\n");
  }

  async playCoinflip(
    groupJid: string,
    userJid: string,
    pick: "gambar" | "angka",
    bet: bigint,
  ): Promise<string> {
    this.validateBet(bet);
    const rolled: "gambar" | "angka" = this.random.intBetween(0, 1) === 0 ? "gambar" : "angka";
    const win = rolled === pick;
    const netDelta = win ? bet : -bet;

    const { newBalance } = await this.settleMoneyDelta({
      groupJid,
      userJid,
      bet,
      netDelta,
      xp: win ? 45 : 15,
      note: "casino_coinflip",
    });

    return [
      "*── [ LEMPAR KOIN ] ──*",
      `Pilihanmu : *${pick.toUpperCase()}*`,
      `Hasil     : *${rolled.toUpperCase()}*`,
      win ? `Menang    : *+${formatRupiah(bet)}* (+45 XP)` : `Kalah     : *-${formatRupiah(bet)}*`,
      `Dompet    : ${formatRupiah(newBalance)}`,
    ].join("\n");
  }

  async playGuessDie(
    groupJid: string,
    userJid: string,
    guess: number,
    bet: bigint,
  ): Promise<string> {
    this.validateBet(bet);
    if (!Number.isInteger(guess) || guess < 1 || guess > 6) {
      throw new AppUserError("Pilih angka dadu antara 1 sampai 6. Contoh: *.tebakdadu 4 1000000*");
    }
    const rolled = this.random.intBetween(1, 6);
    const win = rolled === guess;
    const netDelta = win ? bet * 4n : -bet;

    const { newBalance } = await this.settleMoneyDelta({
      groupJid,
      userJid,
      bet,
      netDelta,
      xp: win ? 80 : 15,
      note: "casino_tebakdadu",
    });

    return [
      "*── [ TEBAK DADU (5X) ] ──*",
      `Tebakan : *${String(guess)}* | Hasil Dadu: *${String(rolled)}*`,
      win ? `JACKPOT : *+${formatRupiah(netDelta)}* (+80 XP)` : `Kalah   : *-${formatRupiah(bet)}*`,
      `Dompet  : ${formatRupiah(newBalance)}`,
    ].join("\n");
  }

  async playRoulette(
    groupJid: string,
    userJid: string,
    rawChoice: string,
    bet: bigint,
  ): Promise<string> {
    this.validateBet(bet);
    const choice = rawChoice.trim().toLowerCase();
    const isNumberChoice = /^\d+$/.test(choice);
    const chosenNum = isNumberChoice ? Number.parseInt(choice, 10) : -1;
    const validText = ["merah", "hitam", "hijau", "genap", "ganjil"].includes(choice);
    if (!validText && (!isNumberChoice || chosenNum < 0 || chosenNum > 36)) {
      throw new AppUserError(
        "Pilihan Roulette: *merah*, *hitam*, *hijau*, *genap*, *ganjil*, atau angka *0-36*.\nContoh: *.roulette merah 2000000*",
      );
    }

    const rolled = this.random.intBetween(0, 36);
    const color = rolled === 0 ? "hijau" : ROULETTE_RED_NUMS.has(rolled) ? "merah" : "hitam";

    let multiplier = 0n;
    if (isNumberChoice && chosenNum === rolled) {
      multiplier = 35n;
    } else if (choice === "hijau" && rolled === 0) {
      multiplier = 35n;
    } else if ((choice === "merah" || choice === "hitam") && choice === color) {
      multiplier = 1n;
    } else if (choice === "genap" && rolled > 0 && rolled % 2 === 0) {
      multiplier = 1n;
    } else if (choice === "ganjil" && rolled % 2 === 1) {
      multiplier = 1n;
    }

    const netDelta = multiplier > 0n ? bet * multiplier : -bet;
    const { newBalance } = await this.settleMoneyDelta({
      groupJid,
      userJid,
      bet,
      netDelta,
      xp: multiplier > 0n ? 70 : 15,
      note: "casino_roulette",
    });

    return [
      "*── [ ROULETTE SULTAN ] ──*",
      `Bola Berhenti : *${String(rolled)} (${color.toUpperCase()})*`,
      `Taruhanmu     : ${choice.toUpperCase()}`,
      multiplier > 0n
        ? `MENANG!       : *+${formatRupiah(netDelta)}* (+70 XP)`
        : `Kalah         : *-${formatRupiah(bet)}*`,
      `Dompet        : ${formatRupiah(newBalance)}`,
    ].join("\n");
  }

  // ======================== SUIT (VS BOT & PVP) ========================

  async playSuitVsBot(
    groupJid: string,
    userJid: string,
    choice: SuitChoice,
    bet: bigint,
  ): Promise<string> {
    this.validateBet(bet);
    const opts: readonly SuitChoice[] = ["batu", "gunting", "kertas"];
    const botChoice = opts[this.random.intBetween(0, 2)] ?? "batu";
    const verdict = evaluateSuitWinner(choice, botChoice);
    const netDelta = verdict === "a" ? bet : verdict === "b" ? -bet : 0n;

    const { newBalance } = await this.settleMoneyDelta({
      groupJid,
      userJid,
      bet,
      netDelta,
      xp: verdict === "a" ? 45 : 15,
      note: "suit_vs_bot",
    });

    return [
      "*── [ SUIT VS MINJI ] ──*",
      `Kamu  : *${choice.toUpperCase()}*`,
      `Minji : *${botChoice.toUpperCase()}*`,
      verdict === "a"
        ? `Menang: *+${formatRupiah(bet)}* (+45 XP)`
        : verdict === "b"
          ? `Kalah : *-${formatRupiah(bet)}*`
          : "Hasil : Seri! Taruhan kembali.",
      `Dompet: ${formatRupiah(newBalance)}`,
    ].join("\n");
  }

  async createSuitPvp(
    groupJid: string,
    challengerJid: string,
    opponentJid: string,
    bet: bigint,
    nowMs = Date.now(),
  ): Promise<SuitChallenge> {
    this.sweep(nowMs);
    this.validateBet(bet);
    const normA = normalizeUserJid(challengerJid);
    const normB = normalizeUserJid(opponentJid);
    if (normA === normB) {
      throw new AppUserError("Tidak bisa suit melawan diri sendiri! Untuk lawan bot: *.suit batu 1000000*.");
    }

    const [pA, pB] = await Promise.all([
      this.profileRepo.findOrCreate(groupJid, normA),
      this.profileRepo.findOrCreate(groupJid, normB),
    ]);
    if (pA.moneyBalance < bet || pB.moneyBalance < bet) {
      throw new AppUserError(
        `Kedua pemain harus punya saldo minimal ${formatRupiah(bet)} untuk suit PvP.`,
      );
    }

    const challenge: SuitChallenge = {
      groupJid,
      challengerJid: normA,
      opponentJid: normB,
      bet,
      choices: new Map(),
      expiresAt: nowMs + SESSION_TTL_MS,
    };
    this.suitChallenges.set(groupJid, challenge);
    return challenge;
  }

  async submitSuitPvpChoice(
    candidateJids: readonly string[],
    choice: SuitChoice,
    nowMs = Date.now(),
  ): Promise<{
    dmReply: string;
    groupBroadcast: { groupJid: string; text: string; mentions: string[] } | null;
  }> {
    this.sweep(nowMs);
    const normSet = new Set(candidateJids.map((j) => normalizeUserJid(j)).filter(Boolean));
    let matched: { challenge: SuitChallenge; playerJid: string } | null = null;
    for (const ch of this.suitChallenges.values()) {
      if (normSet.has(ch.challengerJid)) {
        matched = { challenge: ch, playerJid: ch.challengerJid };
        break;
      }
      if (normSet.has(ch.opponentJid)) {
        matched = { challenge: ch, playerJid: ch.opponentJid };
        break;
      }
    }

    if (!matched) {
      throw new AppUserError("Kamu tidak sedang punya tantangan Suit PvP aktif.");
    }

    const { challenge, playerJid } = matched;
    challenge.choices.set(playerJid, choice);

    const choiceA = challenge.choices.get(challenge.challengerJid);
    const choiceB = challenge.choices.get(challenge.opponentJid);
    if (!choiceA || !choiceB) {
      return {
        dmReply: `Pilihanmu (*${choice.toUpperCase()}*) terkunci! Menunggu lawan memilih lewat DM bot.`,
        groupBroadcast: null,
      };
    }

    this.suitChallenges.delete(challenge.groupJid);
    const verdict = evaluateSuitWinner(choiceA, choiceB);
    const tagA = `@${challenge.challengerJid.split("@")[0] ?? challenge.challengerJid}`;
    const tagB = `@${challenge.opponentJid.split("@")[0] ?? challenge.opponentJid}`;

    if (verdict === "draw") {
      return {
        dmReply: "Kedua pemain sudah memilih! Hasil diumumkan di grup.",
        groupBroadcast: {
          groupJid: challenge.groupJid,
          mentions: [challenge.challengerJid, challenge.opponentJid],
          text: [
            "*── [ HASIL SUIT PVP: SERI! ] ──*",
            `${tagA} (${choiceA.toUpperCase()}) vs ${tagB} (${choiceB.toUpperCase()})`,
            "Hasil seri! Tidak ada uang yang berpindah.",
          ].join("\n"),
        },
      };
    }

    const winnerJid = verdict === "a" ? challenge.challengerJid : challenge.opponentJid;
    const loserJid = verdict === "a" ? challenge.opponentJid : challenge.challengerJid;
    const correlationId = generateCorrelationId();

    const transferred = await this.db.$transaction(async (tx) => {
      const loser = await this.profileRepo.findOrCreate(challenge.groupJid, loserJid, tx);
      const winner = await this.profileRepo.findOrCreate(challenge.groupJid, winnerJid, tx);
      const actualBet = minBigInt(loser.moneyBalance, challenge.bet);
      const credit = clampMoneyCredit(winner.moneyBalance, actualBet);

      const updL = await tx.groupMemberProfile.update({
        where: { id: loser.id },
        data: {
          ...(actualBet > 0n ? { moneyBalance: { decrement: actualBet } } : {}),
          experience: { increment: 20 },
        },
      });
      const updW = await tx.groupMemberProfile.update({
        where: { id: winner.id },
        data: {
          ...(credit > 0n
            ? { moneyBalance: { increment: credit }, totalMoneyEarned: { increment: credit } }
            : {}),
          experience: { increment: 75 },
        },
      });

      if (actualBet > 0n) {
        await this.txRepo.create(
          {
            profileId: loser.id,
            groupJid: challenge.groupJid,
            userJid: loserJid,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.DUEL_STAKE,
            amount: -actualBet,
            balanceBefore: loser.moneyBalance,
            balanceAfter: updL.moneyBalance,
            correlationId,
            note: "suit_pvp_loss",
          },
          tx,
        );
        await this.txRepo.create(
          {
            profileId: winner.id,
            groupJid: challenge.groupJid,
            userJid: winnerJid,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.DUEL_WIN,
            amount: credit,
            balanceBefore: winner.moneyBalance,
            balanceAfter: updW.moneyBalance,
            correlationId,
            note: "suit_pvp_win",
          },
          tx,
        );
      }
      return credit;
    });

    const tagWinner = `@${winnerJid.split("@")[0] ?? winnerJid}`;
    return {
      dmReply: "Pertandingan Suit selesai! Cek hasil di grup.",
      groupBroadcast: {
        groupJid: challenge.groupJid,
        mentions: [challenge.challengerJid, challenge.opponentJid],
        text: [
          "*── [ HASIL SUIT PVP ] ──*",
          `${tagA} (${choiceA.toUpperCase()}) vs ${tagB} (${choiceB.toUpperCase()})`,
          `Pemenang : ${tagWinner} (+${formatRupiah(transferred)} & +75 XP!)`,
        ].join("\n"),
      },
    };
  }

  // ======================== RUSSIAN ROULETTE ========================

  async playRussianRoulette(
    groupJid: string,
    userJid: string,
    nowMs = Date.now(),
  ): Promise<string> {
    const normUser = normalizeUserJid(userJid);
    const chamber = this.random.intBetween(1, 6);
    const hitBullet = chamber === 1;
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const prof = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      const state = parseRpgState(prof.rpgState);
      if (state.ugdUntil > nowMs) {
        const remMin = Math.ceil((state.ugdUntil - nowMs) / 60_000);
        throw new AppUserError(`Kamu masih dirawat di UGD (${String(remMin)} menit lagi)! Istirahat dulu.`);
      }

      if (hitBullet) {
        const penalty = minBigInt(prof.moneyBalance, RUSSIAN_HIT_PENALTY);
        const nextState = withUgdUntil(state, nowMs + RUSSIAN_UGD_MS);
        const updated = await tx.groupMemberProfile.update({
          where: { id: prof.id },
          data: {
            ...(penalty > 0n ? { moneyBalance: { decrement: penalty } } : {}),
            rpgState: serializeRpgState(nextState),
          },
        });
        if (penalty > 0n) {
          await this.txRepo.create(
            {
              profileId: prof.id,
              groupJid,
              userJid: normUser,
              asset: MemberTransactionAsset.MONEY,
              type: MemberTransactionType.RPG_LOSS,
              amount: -penalty,
              balanceBefore: prof.moneyBalance,
              balanceAfter: updated.moneyBalance,
              correlationId,
              note: "russian_roulette_hit",
            },
            tx,
          );
        }

        return [
          "*── [ RUSSIAN ROULETTE: DOR!! ] ──*",
          "Peluru tepat di kamar #1! Kamu langsung dilarikan ke *UGD selama 5 menit*.",
          `Biaya UGD : -${formatRupiah(penalty)}`,
          `Dompet    : ${formatRupiah(updated.moneyBalance)}`,
        ].join("\n");
      }

      const credit = clampMoneyCredit(prof.moneyBalance, RUSSIAN_SURVIVE_REWARD);
      const updated = await tx.groupMemberProfile.update({
        where: { id: prof.id },
        data: {
          moneyBalance: { increment: credit },
          totalMoneyEarned: { increment: credit },
          experience: { increment: 80 },
        },
      });
      await this.txRepo.create(
        {
          profileId: prof.id,
          groupJid,
          userJid: normUser,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.GAME_REWARD,
          amount: credit,
          balanceBefore: prof.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: "russian_roulette_survive",
        },
        tx,
      );

      return [
        "*── [ RUSSIAN ROULETTE: KLIK... SELAMAT! ] ──*",
        `Kamar #${String(chamber)} kosong! Nyalimu berbuah manis!`,
        `Hadiah : *+${formatRupiah(credit)}* (+80 XP)`,
        `Dompet : ${formatRupiah(updated.moneyBalance)}`,
      ].join("\n");
    });
  }

  // ======================== DAILY LUCKY SPIN ========================

  async playDailySpin(groupJid: string, userJid: string, nowMs = Date.now()): Promise<string> {
    const normUser = normalizeUserJid(userJid);
    const todayInt = getJakartaDayInt(nowMs);
    const roll = this.random.intBetween(1, 100);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const prof = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      const state = parseRpgState(prof.rpgState);
      if ((state.cooldowns.spin_day ?? 0) === todayInt) {
        throw new AppUserError("Kamu sudah memutar Roda Keberuntungan (.spin) hari ini! Kembali lagi besok pukul 00:00 WIB.");
      }

      let nextState = withUpdatedCooldown(state, "spin_day", todayInt);
      let moneyPrize = 0n;
      let limitPrize = 0;
      let pointsPrize = 0;
      let label = "";

      if (roll <= 8) {
        moneyPrize = 50_000_000n;
        label = `JACKPOT SULTAN ${formatRupiah(moneyPrize)}!`;
      } else if (roll <= 22) {
        limitPrize = 3;
        label = "+3 Limit Gratis!";
      } else if (roll <= 36) {
        nextState = withCrateDelta(nextState, "mythic", 1);
        label = "+1 Peti Gacha MYTHIC (.open mythic)!";
      } else if (roll <= 55) {
        moneyPrize = 20_000_000n;
        label = `Uang Tunai ${formatRupiah(moneyPrize)}!`;
      } else if (roll <= 75) {
        pointsPrize = 100;
        label = "+100 Poin Game (bisa buat .belilimit)!";
      } else if (roll <= 92) {
        moneyPrize = 5_000_000n;
        label = `Uang Tunai ${formatRupiah(moneyPrize)}!`;
      } else {
        moneyPrize = 500_000n;
        label = `Hiburan ${formatRupiah(moneyPrize)} (nyaris zonk!)`;
      }

      const credit = moneyPrize > 0n ? clampMoneyCredit(prof.moneyBalance, moneyPrize) : 0n;
      const updated = await tx.groupMemberProfile.update({
        where: { id: prof.id },
        data: {
          ...(credit > 0n
            ? { moneyBalance: { increment: credit }, totalMoneyEarned: { increment: credit } }
            : {}),
          ...(limitPrize > 0
            ? { limitBalance: { increment: limitPrize }, totalLimitsEarned: { increment: limitPrize } }
            : {}),
          ...(pointsPrize > 0
            ? { pointsBalance: { increment: pointsPrize }, totalPointsEarned: { increment: pointsPrize } }
            : {}),
          experience: { increment: 60 },
          rpgState: serializeRpgState(nextState),
        },
      });

      if (credit > 0n) {
        await this.txRepo.create(
          {
            profileId: prof.id,
            groupJid,
            userJid: normUser,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.DAILY_REWARD,
            amount: credit,
            balanceBefore: prof.moneyBalance,
            balanceAfter: updated.moneyBalance,
            correlationId,
            note: "daily_spin_money",
          },
          tx,
        );
      }

      return [
        "*── [ RODA KEBERUNTUNGAN ] ──*",
        `Hadiah : *${label}*`,
        "Bonus  : +60 XP",
        `Dompet : ${formatRupiah(updated.moneyBalance)} | Limit: ${String(updated.limitBalance)}`,
      ].join("\n");
    });
  }

  private sweep(nowMs: number): void {
    for (const [k, s] of this.bjSessions.entries()) {
      if (s.expiresAt <= nowMs) this.bjSessions.delete(k);
    }
    for (const [k, s] of this.hilowSessions.entries()) {
      if (s.expiresAt <= nowMs) this.hilowSessions.delete(k);
    }
    for (const [k, s] of this.suitChallenges.entries()) {
      if (s.expiresAt <= nowMs) this.suitChallenges.delete(k);
    }
  }
}

export const casinoPackService = new CasinoPackService();
