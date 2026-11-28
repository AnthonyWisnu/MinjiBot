import { MemberTransactionAsset, MemberTransactionType } from "@prisma/client";

import { MAX_SAFE_MONEY_BIGINT, minBigInt } from "../../utils/currency";
import {
  serializeRpgState,
  withAutoWealthTaxDay,
  type MemberRpgState,
} from "./rpgState";

export const AUTO_WEALTH_TAX_THRESHOLD = 2_000_000_000n;
export const AUTO_WEALTH_TAX_RATE_BPS = 150n; // 1,5% per hari WIB atas kelebihan di atas Rp 2 Miliar

export interface AutoWealthTaxTx {
  groupMemberProfile?: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  tenantGroup?: {
    findUnique(args: { where: { groupJid: string } }): Promise<{ treasuryBalance: bigint } | null>;
    update(args: {
      where: { groupJid: string };
      data: { treasuryBalance: bigint };
    }): Promise<unknown>;
  };
  groupMemberTransaction?: {
    createMany(args: {
      data: {
        profileId: string;
        groupJid: string;
        userJid: string;
        asset: MemberTransactionAsset;
        type: MemberTransactionType;
        amount: number | bigint;
        balanceBefore: number | bigint;
        balanceAfter: number | bigint;
        correlationId: string;
        idempotencyKey?: string;
        note?: string;
      }[];
    }): Promise<{ count: number }>;
  };
}

export interface AutoWealthTaxTxRepo {
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

export interface AutoWealthTaxOutcome {
  taxPaid: bigint;
  walletAfter: bigint;
  bankAfter: bigint;
  nextState: MemberRpgState;
}

/**
 * Menghitung pajak kekayaan otomatis (1,5%/hari WIB) hanya atas kelebihan saldo di atas Rp 2 Miliar.
 */
export function computeAutoWealthTax(totalLiquid: bigint): bigint {
  if (totalLiquid <= AUTO_WEALTH_TAX_THRESHOLD) {
    return 0n;
  }
  const excess = totalLiquid - AUTO_WEALTH_TAX_THRESHOLD;
  return (excess * AUTO_WEALTH_TAX_RATE_BPS) / 10_000n;
}

/**
 * Menyetor pajak atau pungutan sistem ke kas grup (`treasuryBalance`) secara aman di dalam transaksi.
 */
export async function creditTreasuryInTx(
  tx: AutoWealthTaxTx,
  groupJid: string,
  amount: bigint,
): Promise<bigint | null> {
  if (amount <= 0n || !tx.tenantGroup) {
    return null;
  }
  const tenant = await tx.tenantGroup.findUnique({ where: { groupJid } });
  if (!tenant) {
    return null;
  }
  const nextTreasury = minBigInt(MAX_SAFE_MONEY_BIGINT, tenant.treasuryBalance + amount);
  await tx.tenantGroup.update({
    where: { groupJid },
    data: { treasuryBalance: nextTreasury },
  });
  return nextTreasury;
}

/**
 * Memungut pajak kekayaan harian otomatis (1x per hari WIB) untuk sultan > Rp 2 Miliar saat aktivitas utama.
 * Memprioritaskan penarikan dari Bank terlebih dahulu agar saldo tabungan besar ikut terkendali.
 */
export async function applyDailyAutoWealthTaxInTx(input: {
  tx: AutoWealthTaxTx;
  profileId: string;
  groupJid: string;
  userJid: string;
  currentWallet: bigint;
  currentBank: bigint;
  state: MemberRpgState;
  todayKey: string;
  correlationId: string;
  txRepo?: AutoWealthTaxTxRepo;
}): Promise<AutoWealthTaxOutcome> {
  const { tx, profileId, groupJid, userJid, currentWallet, currentBank, state, todayKey, correlationId, txRepo } = input;

  if (state.autoWealthTaxDay === todayKey) {
    return { taxPaid: 0n, walletAfter: currentWallet, bankAfter: currentBank, nextState: state };
  }

  const taxDue = computeAutoWealthTax(currentWallet + currentBank);
  if (taxDue <= 0n || !tx.groupMemberProfile?.updateMany) {
    return { taxPaid: 0n, walletAfter: currentWallet, bankAfter: currentBank, nextState: state };
  }

  const bankDebit = minBigInt(currentBank, taxDue);
  const walletDebit = minBigInt(currentWallet, taxDue - bankDebit);
  const totalTax = bankDebit + walletDebit;
  if (totalTax <= 0n) {
    return { taxPaid: 0n, walletAfter: currentWallet, bankAfter: currentBank, nextState: state };
  }

  const nextState = withAutoWealthTaxDay(state, todayKey);
  const debitRes = await tx.groupMemberProfile.updateMany({
    where: {
      id: profileId,
      ...(bankDebit > 0n ? { bankBalance: { gte: bankDebit } } : {}),
      ...(walletDebit > 0n ? { moneyBalance: { gte: walletDebit } } : {}),
    },
    data: {
      ...(bankDebit > 0n ? { bankBalance: { decrement: bankDebit } } : {}),
      ...(walletDebit > 0n ? { moneyBalance: { decrement: walletDebit } } : {}),
      rpgState: serializeRpgState(nextState),
    },
  });

  if (debitRes.count === 0) {
    return { taxPaid: 0n, walletAfter: currentWallet, bankAfter: currentBank, nextState: state };
  }

  await creditTreasuryInTx(tx, groupJid, totalTax);

  const bankAfter = currentBank - bankDebit;
  const walletAfter = currentWallet - walletDebit;
  const entries: {
    profileId: string;
    groupJid: string;
    userJid: string;
    asset: MemberTransactionAsset;
    type: MemberTransactionType;
    amount: bigint;
    balanceBefore: bigint;
    balanceAfter: bigint;
    correlationId: string;
    idempotencyKey: string;
    note: string;
  }[] = [];

  if (bankDebit > 0n) {
    entries.push({
      profileId,
      groupJid,
      userJid,
      asset: MemberTransactionAsset.BANK,
      type: MemberTransactionType.TAX_DEBIT,
      amount: -bankDebit,
      balanceBefore: currentBank,
      balanceAfter: bankAfter,
      correlationId,
      idempotencyKey: `auto_wealth_tax:${groupJid}:${userJid}:${todayKey}:bank`,
      note: "auto_wealth_tax_2b_bank",
    });
  }
  if (walletDebit > 0n) {
    entries.push({
      profileId,
      groupJid,
      userJid,
      asset: MemberTransactionAsset.MONEY,
      type: MemberTransactionType.TAX_DEBIT,
      amount: -walletDebit,
      balanceBefore: currentWallet,
      balanceAfter: walletAfter,
      correlationId,
      idempotencyKey: `auto_wealth_tax:${groupJid}:${userJid}:${todayKey}:wallet`,
      note: "auto_wealth_tax_2b_wallet",
    });
  }

  if (entries.length > 0) {
    if (txRepo) {
      for (const entry of entries) {
        await txRepo.create(entry, tx);
      }
    } else if (tx.groupMemberTransaction?.createMany) {
      await tx.groupMemberTransaction.createMany({ data: entries });
    }
  }

  return { taxPaid: totalTax, walletAfter, bankAfter, nextState };
}
