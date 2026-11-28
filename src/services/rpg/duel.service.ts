import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupMemberProfile,
} from "@prisma/client";

import { AppUserError } from "../../errors/appUserError";
import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { GroupMemberTransactionRepository } from "../../repositories/groupMemberTransaction.repository";
import { prisma } from "../../repositories/prismaClient";
import { clampMoneyCredit, formatRupiah } from "../../utils/currency";
import { normalizeUserJid } from "../../utils/jid";
import { generateCorrelationId } from "../member/memberEconomy.service";
import { defaultRandom, type RandomProvider } from "../member/randomProvider";

export const DUEL_MIN_BET = 250_000n;
export const DUEL_MAX_BET = 25_000_000n;
const DUEL_TTL_MS = 3 * 60 * 1000;

export interface PendingDuel {
  groupJid: string;
  challengerJid: string;
  opponentJid: string;
  betAmount: bigint;
  expiresAt: number;
}

export interface DuelResolution {
  challengerJid: string;
  opponentJid: string;
  winnerJid: string;
  loserJid: string;
  challengerRoll: number;
  opponentRoll: number;
  betAmount: bigint;
  winnerMoney: bigint;
  loserMoney: bigint;
}

interface DuelProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
}

interface DuelTxStore {
  create(
    data: {
      profileId: string;
      groupJid: string;
      userJid: string;
      actorJid?: string;
      targetUserJid?: string;
      asset: MemberTransactionAsset;
      type: MemberTransactionType;
      amount: number | bigint;
      balanceBefore?: number | bigint;
      balanceAfter?: number | bigint;
      correlationId?: string;
    },
    tx?: unknown,
  ): Promise<unknown>;
}

interface DuelTx {
  groupMemberProfile: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    findUniqueOrThrow(args: { where: Record<string, unknown> }): Promise<GroupMemberProfile>;
  };
}

interface DuelDb {
  $transaction<T>(fn: (tx: DuelTx) => Promise<T>): Promise<T>;
}

export class DuelService {
  private readonly pendingByGroup = new Map<string, PendingDuel>();

  constructor(
    private readonly profileRepo: DuelProfileStore = new GroupMemberProfileRepository(),
    private readonly txRepo: DuelTxStore = new GroupMemberTransactionRepository(),
    private readonly random: RandomProvider = defaultRandom,
    private readonly db: DuelDb = prisma,
  ) {}

  async createChallenge(
    groupJid: string,
    challengerJid: string,
    opponentJid: string,
    betAmount: bigint,
    nowMs = Date.now(),
  ): Promise<PendingDuel> {
    const normChallenger = normalizeUserJid(challengerJid);
    const normOpponent = normalizeUserJid(opponentJid);

    if (!normChallenger || !normOpponent || normChallenger === normOpponent) {
      throw new AppUserError("Tidak bisa menantang duel diri sendiri.");
    }
    if (betAmount < DUEL_MIN_BET || betAmount > DUEL_MAX_BET) {
      throw new AppUserError(
        `Taruhan duel harus antara ${formatRupiah(DUEL_MIN_BET)} sampai ${formatRupiah(DUEL_MAX_BET)}.`,
      );
    }

    const existing = this.pendingByGroup.get(groupJid);
    if (existing && existing.expiresAt > nowMs) {
      throw new AppUserError(
        "Masih ada tantangan duel aktif di grup ini. Tunggu diterima/ditolak atau selesai dulu.",
      );
    }

    const challengerProfile = await this.profileRepo.findOrCreate(groupJid, normChallenger);
    if (challengerProfile.moneyBalance < betAmount) {
      throw new AppUserError(
        `Uang dompetmu tidak cukup untuk taruhan ${formatRupiah(betAmount)} (dompet: ${formatRupiah(challengerProfile.moneyBalance)}).`,
      );
    }

    const opponentProfile = await this.profileRepo.findOrCreate(groupJid, normOpponent);
    if (opponentProfile.moneyBalance < betAmount) {
      throw new AppUserError(
        `Uang dompet lawan tidak cukup untuk taruhan ${formatRupiah(betAmount)}.`,
      );
    }

    const pending: PendingDuel = {
      groupJid,
      challengerJid: normChallenger,
      opponentJid: normOpponent,
      betAmount,
      expiresAt: nowMs + DUEL_TTL_MS,
    };
    this.pendingByGroup.set(groupJid, pending);
    return pending;
  }

  rejectChallenge(groupJid: string, actorJid: string, nowMs = Date.now()): PendingDuel {
    const pending = this.pendingByGroup.get(groupJid);
    if (!pending || pending.expiresAt <= nowMs) {
      this.pendingByGroup.delete(groupJid);
      throw new AppUserError("Tidak ada tantangan duel yang sedang menunggu.");
    }

    const normActor = normalizeUserJid(actorJid);
    if (normActor !== pending.opponentJid && normActor !== pending.challengerJid) {
      throw new AppUserError("Hanya penantang atau pihak yang ditantang yang dapat membatalkan duel.");
    }

    this.pendingByGroup.delete(groupJid);
    return pending;
  }

  async acceptChallenge(
    groupJid: string,
    acceptorJid: string,
    nowMs = Date.now(),
  ): Promise<DuelResolution> {
    const pending = this.pendingByGroup.get(groupJid);
    if (!pending || pending.expiresAt <= nowMs) {
      this.pendingByGroup.delete(groupJid);
      throw new AppUserError("Tidak ada tantangan duel yang aktif atau waktu sudah habis.");
    }

    const normAcceptor = normalizeUserJid(acceptorJid);
    if (normAcceptor !== pending.opponentJid) {
      throw new AppUserError("Hanya member yang ditantang yang bisa menerima duel ini.");
    }

    this.pendingByGroup.delete(groupJid);

    const challengerRoll = this.random.intBetween(1, 100);
    let opponentRoll = this.random.intBetween(1, 100);
    if (challengerRoll === opponentRoll) {
      opponentRoll = opponentRoll >= 100 ? 99 : opponentRoll + 1;
    }

    const challengerWon = challengerRoll > opponentRoll;
    const winnerJid = challengerWon ? pending.challengerJid : pending.opponentJid;
    const loserJid = challengerWon ? pending.opponentJid : pending.challengerJid;
    const bet = pending.betAmount;
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const winnerProfile = await this.profileRepo.findOrCreate(groupJid, winnerJid, tx);
      const loserProfile = await this.profileRepo.findOrCreate(groupJid, loserJid, tx);

      if (winnerProfile.moneyBalance < bet || loserProfile.moneyBalance < bet) {
        throw new AppUserError("Saldo dompet salah satu pemain sudah tidak mencukupi untuk duel.");
      }

      const debitLoser = await tx.groupMemberProfile.updateMany({
        where: { id: loserProfile.id, moneyBalance: { gte: bet } },
        data: {
          moneyBalance: { decrement: bet },
          experience: { increment: 20 },
        },
      });
      if (debitLoser.count === 0) {
        throw new AppUserError("Saldo lawan tidak cukup saat memproses duel.");
      }

      const creditAmount = clampMoneyCredit(winnerProfile.moneyBalance, bet);
      const creditWinner = await tx.groupMemberProfile.updateMany({
        where: { id: winnerProfile.id, moneyBalance: { gte: bet } },
        data: {
          moneyBalance: { increment: creditAmount },
          totalMoneyEarned: { increment: creditAmount },
          experience: { increment: 60 },
        },
      });
      if (creditWinner.count === 0) {
        throw new AppUserError("Saldo pemenang tidak memenuhi syarat taruhan saat memproses duel.");
      }

      const updatedWinner = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: winnerProfile.id },
      });
      const updatedLoser = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: loserProfile.id },
      });

      await this.txRepo.create(
        {
          profileId: loserProfile.id,
          groupJid,
          userJid: loserJid,
          targetUserJid: winnerJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.DUEL_STAKE,
          amount: -bet,
          balanceBefore: loserProfile.moneyBalance,
          balanceAfter: updatedLoser.moneyBalance,
          correlationId,
        },
        tx,
      );

      await this.txRepo.create(
        {
          profileId: winnerProfile.id,
          groupJid,
          userJid: winnerJid,
          targetUserJid: loserJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.DUEL_WIN,
          amount: creditAmount,
          balanceBefore: winnerProfile.moneyBalance,
          balanceAfter: updatedWinner.moneyBalance,
          correlationId,
        },
        tx,
      );

      return {
        challengerJid: pending.challengerJid,
        opponentJid: pending.opponentJid,
        winnerJid,
        loserJid,
        challengerRoll,
        opponentRoll,
        betAmount: bet,
        winnerMoney: updatedWinner.moneyBalance,
        loserMoney: updatedLoser.moneyBalance,
      };
    });
  }
}

export const duelService = new DuelService();
