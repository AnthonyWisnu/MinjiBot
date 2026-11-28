import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupMemberProfile,
} from "@prisma/client";

import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { GroupMemberTransactionRepository } from "../../repositories/groupMemberTransaction.repository";
import { prisma } from "../../repositories/prismaClient";
import {
  InsufficientBankError,
  InsufficientMoneyError,
  InvalidAmountError,
} from "../../types/memberEconomy";
import { formatRupiah, MAX_SAFE_MONEY_BIGINT } from "../../utils/currency";
import { normalizeUserJid } from "../../utils/jid";
import { toWibDateKey } from "../../utils/wibDate";
import { parseRpgState, serializeRpgState, withDailyTransferOut } from "../rpg/rpgState";
import { generateCorrelationId, MAX_SAFE_ECONOMY_INT } from "./memberEconomy.service";

export const EXCHANGE_MONEY_PER_POINT = 50_000n;
export const DAILY_TRANSFER_OUT_BASE = 15_000_000n;
export const DAILY_TRANSFER_OUT_PER_LEVEL = 500_000n;

export function getDailyTransferOutCap(level: number): bigint {
  const safeLevel = Math.max(1, Math.floor(level));
  return DAILY_TRANSFER_OUT_BASE + BigInt(safeLevel) * DAILY_TRANSFER_OUT_PER_LEVEL;
}

export interface BankTransferResult {
  amount: bigint;
  moneyBalance: bigint;
  bankBalance: bigint;
}

export interface MoneyGiftResult {
  amount: bigint;
  senderMoneyBalance: bigint;
  targetMoneyBalance: bigint;
}

export interface MoneyToPointsResult {
  pointsGained: number;
  moneySpent: bigint;
  moneyBalance: bigint;
  pointsBalance: number;
}

interface WalletProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
}

interface WalletTxStore {
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
      note?: string;
    },
    tx?: unknown,
  ): Promise<unknown>;
}

interface WalletTx {
  groupMemberProfile: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    findUniqueOrThrow(args: { where: Record<string, unknown> }): Promise<GroupMemberProfile>;
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<GroupMemberProfile>;
  };
}

interface WalletDb {
  $transaction<T>(fn: (tx: WalletTx) => Promise<T>): Promise<T>;
}

export class WalletBankService {
  constructor(
    private readonly profileRepo: WalletProfileStore = new GroupMemberProfileRepository(),
    private readonly txRepo: WalletTxStore = new GroupMemberTransactionRepository(),
    private readonly db: WalletDb = prisma,
  ) {}

  async depositToBank(
    groupJid: string,
    userJid: string,
    amountOrAll: bigint | "all",
  ): Promise<BankTransferResult> {
    if (amountOrAll !== "all") {
      this.assertPositiveSafeBigInt(amountOrAll);
    }

    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const amount = amountOrAll === "all" ? profile.moneyBalance : amountOrAll;

      if (amount <= 0n || profile.moneyBalance < amount) {
        throw new InsufficientMoneyError(
          `Uang di dompet tidak cukup. Saldo dompet saat ini: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      if (profile.bankBalance + amount > MAX_SAFE_MONEY_BIGINT) {
        throw new InvalidAmountError("Saldo Bank/ATM telah mencapai batas maksimal.");
      }

      const updateResult = await tx.groupMemberProfile.updateMany({
        where: {
          id: profile.id,
          moneyBalance: { gte: amount },
        },
        data: {
          moneyBalance: { decrement: amount },
          bankBalance: { increment: amount },
        },
      });

      if (updateResult.count === 0) {
        throw new InsufficientMoneyError("Uang di dompet tidak cukup untuk disetor ke Bank.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: profile.id },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.BANK_DEPOSIT,
          amount: -amount,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
        },
        tx,
      );

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.BANK,
          type: MemberTransactionType.BANK_DEPOSIT,
          amount,
          balanceBefore: profile.bankBalance,
          balanceAfter: updated.bankBalance,
          correlationId,
        },
        tx,
      );

      return {
        amount,
        moneyBalance: updated.moneyBalance,
        bankBalance: updated.bankBalance,
      };
    });
  }

  async withdrawFromBank(
    groupJid: string,
    userJid: string,
    amountOrAll: bigint | "all",
  ): Promise<BankTransferResult> {
    if (amountOrAll !== "all") {
      this.assertPositiveSafeBigInt(amountOrAll);
    }

    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const amount = amountOrAll === "all" ? profile.bankBalance : amountOrAll;

      if (amount <= 0n || profile.bankBalance < amount) {
        throw new InsufficientBankError(
          `Saldo di Bank/ATM tidak cukup. Saldo Bank saat ini: ${formatRupiah(profile.bankBalance)}.`,
        );
      }

      if (profile.moneyBalance + amount > MAX_SAFE_MONEY_BIGINT) {
        throw new InvalidAmountError("Saldo dompet telah mencapai batas maksimal.");
      }

      const updateResult = await tx.groupMemberProfile.updateMany({
        where: {
          id: profile.id,
          bankBalance: { gte: amount },
        },
        data: {
          bankBalance: { decrement: amount },
          moneyBalance: { increment: amount },
        },
      });

      if (updateResult.count === 0) {
        throw new InsufficientBankError("Saldo di Bank/ATM tidak cukup untuk ditarik.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: profile.id },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.BANK,
          type: MemberTransactionType.BANK_WITHDRAW,
          amount: -amount,
          balanceBefore: profile.bankBalance,
          balanceAfter: updated.bankBalance,
          correlationId,
        },
        tx,
      );

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.BANK_WITHDRAW,
          amount,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
        },
        tx,
      );

      return {
        amount,
        moneyBalance: updated.moneyBalance,
        bankBalance: updated.bankBalance,
      };
    });
  }

  async transferMoney(
    groupJid: string,
    senderJid: string,
    targetJid: string,
    amount: bigint,
    now: Date = new Date(),
  ): Promise<MoneyGiftResult> {
    this.assertPositiveSafeBigInt(amount);

    const normalizedSender = normalizeUserJid(senderJid);
    const normalizedTarget = normalizeUserJid(targetJid);
    if (!normalizedSender || !normalizedTarget || normalizedSender === normalizedTarget) {
      throw new InvalidAmountError("Tidak dapat mentransfer uang ke diri sendiri.");
    }

    const todayKey = toWibDateKey(now);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const senderProfile = await this.profileRepo.findOrCreate(groupJid, normalizedSender, tx);
      const targetProfile = await this.profileRepo.findOrCreate(groupJid, normalizedTarget, tx);

      const senderState = parseRpgState(senderProfile.rpgState);
      const sentToday =
        senderState.dailyTransferOut.dateKey === todayKey
          ? BigInt(senderState.dailyTransferOut.amount)
          : 0n;
      const dailyCap = getDailyTransferOutCap(senderProfile.level);
      if (sentToday + amount > dailyCap) {
        const remaining = dailyCap > sentToday ? dailyCap - sentToday : 0n;
        throw new InvalidAmountError(
          `Batas transfer keluar harianmu (${formatRupiah(dailyCap)}/hari WIB untuk Lv.${String(Math.max(1, senderProfile.level))}) tercapai! Sisa kuota transfer hari ini: ${formatRupiah(remaining)}.`,
        );
      }

      if (targetProfile.moneyBalance + amount > MAX_SAFE_MONEY_BIGINT) {
        throw new InvalidAmountError("Dompet penerima sudah mencapai batas maksimal.");
      }

      const nextSenderState = withDailyTransferOut(senderState, todayKey, sentToday + amount);
      const debitResult = await tx.groupMemberProfile.updateMany({
        where: {
          id: senderProfile.id,
          moneyBalance: { gte: amount },
        },
        data: {
          moneyBalance: { decrement: amount },
          rpgState: serializeRpgState(nextSenderState),
        },
      });

      if (debitResult.count === 0) {
        throw new InsufficientMoneyError(
          `Uang di dompet tidak cukup. Saldo dompet kamu: ${formatRupiah(senderProfile.moneyBalance)}.`,
        );
      }

      const updatedSender = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: senderProfile.id },
      });

      const updatedTarget = await tx.groupMemberProfile.update({
        where: { id: targetProfile.id },
        data: {
          moneyBalance: { increment: amount },
          totalMoneyEarned: { increment: amount },
        },
      });

      await this.txRepo.create(
        {
          profileId: senderProfile.id,
          groupJid,
          userJid: normalizedSender,
          actorJid: normalizedSender,
          targetUserJid: normalizedTarget,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.GIFT_SENT,
          amount: -amount,
          balanceBefore: senderProfile.moneyBalance,
          balanceAfter: updatedSender.moneyBalance,
          correlationId,
        },
        tx,
      );

      await this.txRepo.create(
        {
          profileId: targetProfile.id,
          groupJid,
          userJid: normalizedTarget,
          actorJid: normalizedSender,
          targetUserJid: normalizedTarget,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.GIFT_RECEIVED,
          amount,
          balanceBefore: targetProfile.moneyBalance,
          balanceAfter: updatedTarget.moneyBalance,
          correlationId,
        },
        tx,
      );

      return {
        amount,
        senderMoneyBalance: updatedSender.moneyBalance,
        targetMoneyBalance: updatedTarget.moneyBalance,
      };
    });
  }

  async exchangeMoneyToPoints(
    groupJid: string,
    userJid: string,
    pointsAmount: number,
  ): Promise<MoneyToPointsResult> {
    this.assertPositiveSafePoints(pointsAmount);

    const moneyCost = BigInt(pointsAmount) * EXCHANGE_MONEY_PER_POINT;
    if (moneyCost <= 0n || moneyCost > MAX_SAFE_MONEY_BIGINT) {
      throw new InvalidAmountError("Jumlah poin yang ingin ditukar terlalu besar.");
    }

    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);

      if (profile.pointsBalance + pointsAmount > MAX_SAFE_ECONOMY_INT) {
        throw new InvalidAmountError("Saldo poin sudah mencapai batas maksimal.");
      }

      const updateResult = await tx.groupMemberProfile.updateMany({
        where: {
          id: profile.id,
          moneyBalance: { gte: moneyCost },
        },
        data: {
          moneyBalance: { decrement: moneyCost },
          pointsBalance: { increment: pointsAmount },
          totalPointsEarned: { increment: pointsAmount },
        },
      });

      if (updateResult.count === 0) {
        throw new InsufficientMoneyError(
          `Uang di dompet tidak cukup. Dibutuhkan ${formatRupiah(moneyCost)} untuk ${pointsAmount.toLocaleString("id-ID")} poin (kurs ${formatRupiah(EXCHANGE_MONEY_PER_POINT)}/poin).`,
        );
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: profile.id },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.EXCHANGE_DEBIT,
          amount: -moneyCost,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
        },
        tx,
      );

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.POINT,
          type: MemberTransactionType.EXCHANGE_CREDIT,
          amount: pointsAmount,
          balanceBefore: profile.pointsBalance,
          balanceAfter: updated.pointsBalance,
          correlationId,
        },
        tx,
      );

      return {
        pointsGained: pointsAmount,
        moneySpent: moneyCost,
        moneyBalance: updated.moneyBalance,
        pointsBalance: updated.pointsBalance,
      };
    });
  }

  private assertPositiveSafeBigInt(amount: bigint): void {
    if (amount <= 0n || amount > MAX_SAFE_MONEY_BIGINT) {
      throw new InvalidAmountError("Nominal harus bilangan bulat positif yang valid.");
    }
  }

  private assertPositiveSafePoints(amount: number): void {
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_SAFE_ECONOMY_INT) {
      throw new InvalidAmountError(
        `Jumlah poin harus bilangan bulat positif (maksimal ${MAX_SAFE_ECONOMY_INT.toLocaleString("id-ID")}).`,
      );
    }
  }
}

export const walletBankService = new WalletBankService();
