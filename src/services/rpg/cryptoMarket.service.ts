import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupMemberProfile,
} from "@prisma/client";

import { AppUserError } from "../../errors/appUserError";
import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { GroupMemberTransactionRepository } from "../../repositories/groupMemberTransaction.repository";
import { prisma } from "../../repositories/prismaClient";
import { clampMoneyCredit, formatRupiah, MAX_SAFE_MONEY_BIGINT } from "../../utils/currency";
import { generateCorrelationId } from "../member/memberEconomy.service";
import { parseRpgState, serializeRpgState, withUpdatedCryptoHolding } from "./rpgState";

const PRICE_EPOCH_MS = 5 * 60 * 1000;
const MAX_CRYPTO_UNITS_PER_TX = 10_000;

export interface CryptoCoinSpec {
  symbol: string;
  name: string;
  basePrice: bigint;
  volatility: number;
  seedOffset: number;
}

export const CRYPTO_COINS: readonly CryptoCoinSpec[] = [
  { symbol: "BTC", name: "Bitcoin", basePrice: 120_000_000n, volatility: 0.25, seedOffset: 101 },
  { symbol: "ETH", name: "Ethereum", basePrice: 45_000_000n, volatility: 0.28, seedOffset: 211 },
  { symbol: "SOL", name: "Solana", basePrice: 15_000_000n, volatility: 0.35, seedOffset: 307 },
  { symbol: "DOGE", name: "Dogecoin", basePrice: 1_500_000n, volatility: 0.45, seedOffset: 409 },
  { symbol: "MINJI", name: "MinjiCoin", basePrice: 8_000_000n, volatility: 0.48, seedOffset: 503 },
] as const;

export interface CryptoQuote {
  symbol: string;
  name: string;
  price: bigint;
  previousPrice: bigint;
  changePercent: number;
}

export interface CryptoTradeResult {
  action: "buy" | "sell";
  symbol: string;
  coinName: string;
  units: number;
  unitPrice: bigint;
  totalMoney: bigint;
  newHolding: number;
  currentMoney: bigint;
}

export interface CryptoPortfolioItem {
  symbol: string;
  name: string;
  units: number;
  unitPrice: bigint;
  marketValue: bigint;
  changePercent: number;
}

export interface CryptoPortfolioSummary {
  items: CryptoPortfolioItem[];
  totalValue: bigint;
  moneyBalance: bigint;
}

interface CryptoProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
}

interface CryptoTxStore {
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

interface CryptoTx {
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

interface CryptoDb {
  $transaction<T>(fn: (tx: CryptoTx) => Promise<T>): Promise<T>;
}

function deterministicUnitWave(epoch: number, seedOffset: number): number {
  const x = Math.sin((epoch + seedOffset) * 12.9898) * 43758.5453;
  const frac = x - Math.floor(x); // [0, 1)
  const slowWave = Math.sin((epoch + seedOffset) * 0.27) * 0.5;
  return (frac * 2 - 1) * 0.5 + slowWave; // roughly [-1, 1]
}

export function computeCoinPriceAtEpoch(spec: CryptoCoinSpec, epoch: number): bigint {
  const wave = deterministicUnitWave(epoch, spec.seedOffset);
  const multiplier = Math.max(0.35, 1 + wave * spec.volatility);
  const basisPoints = BigInt(Math.round(multiplier * 10_000));
  const rawPrice = (spec.basePrice * basisPoints) / 10_000n;
  // Bulatkan ke kelipatan Rp 10.000 agar harga kripto rapi
  const rounded = ((rawPrice + 5_000n) / 10_000n) * 10_000n;
  return rounded < 100_000n ? 100_000n : rounded;
}

export class CryptoMarketService {
  constructor(
    private readonly profileRepo: CryptoProfileStore = new GroupMemberProfileRepository(),
    private readonly txRepo: CryptoTxStore = new GroupMemberTransactionRepository(),
    private readonly db: CryptoDb = prisma,
  ) {}

  getMarketSnapshot(now: Date = new Date()): CryptoQuote[] {
    const epoch = Math.floor(now.getTime() / PRICE_EPOCH_MS);
    return CRYPTO_COINS.map((spec) => {
      const price = computeCoinPriceAtEpoch(spec, epoch);
      const previousPrice = computeCoinPriceAtEpoch(spec, epoch - 1);
      const changePercent =
        previousPrice > 0n
          ? Number(((price - previousPrice) * 1000n) / previousPrice) / 10
          : 0;
      return {
        symbol: spec.symbol,
        name: spec.name,
        price,
        previousPrice,
        changePercent,
      };
    });
  }

  getQuote(rawSymbol: string, now: Date = new Date()): CryptoQuote {
    const symbol = rawSymbol.trim().toUpperCase();
    const found = this.getMarketSnapshot(now).find((q) => q.symbol === symbol);
    if (!found) {
      const list = CRYPTO_COINS.map((c) => c.symbol).join(", ");
      throw new AppUserError(`Koin "${rawSymbol}" tidak ditemukan. Koin tersedia: ${list}.`);
    }
    return found;
  }

  async buyCrypto(
    groupJid: string,
    userJid: string,
    rawSymbol: string,
    units: number,
    now: Date = new Date(),
  ): Promise<CryptoTradeResult> {
    if (!Number.isInteger(units) || units <= 0 || units > MAX_CRYPTO_UNITS_PER_TX) {
      throw new AppUserError(
        `Jumlah unit harus bilangan bulat antara 1 sampai ${MAX_CRYPTO_UNITS_PER_TX.toLocaleString("id-ID")}.`,
      );
    }

    const quote = this.getQuote(rawSymbol, now);
    const totalCost = quote.price * BigInt(units);
    if (totalCost <= 0n || totalCost > MAX_SAFE_MONEY_BIGINT) {
      throw new AppUserError("Nominal pembelian terlalu besar.");
    }

    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      if (profile.moneyBalance < totalCost) {
        throw new AppUserError(
          `Uang dompet tidak cukup! Harga ${String(units)} ${quote.symbol} = ${formatRupiah(totalCost)}, dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const state = parseRpgState(profile.rpgState);
      const prevQty = state.crypto[quote.symbol] ?? 0;
      const newHolding = prevQty + units;
      const nextState = withUpdatedCryptoHolding(state, quote.symbol, newHolding);

      const updateRes = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: totalCost } },
        data: {
          moneyBalance: { decrement: totalCost },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (updateRes.count === 0) {
        throw new AppUserError("Uang dompet tidak cukup saat membeli kripto.");
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
          type: MemberTransactionType.CRYPTO_BUY,
          amount: -totalCost,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `buy ${String(units)} ${quote.symbol} @ ${quote.price.toString()}`,
        },
        tx,
      );

      return {
        action: "buy",
        symbol: quote.symbol,
        coinName: quote.name,
        units,
        unitPrice: quote.price,
        totalMoney: totalCost,
        newHolding,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async sellCrypto(
    groupJid: string,
    userJid: string,
    rawSymbol: string,
    unitsOrAll: number | "all",
    now: Date = new Date(),
  ): Promise<CryptoTradeResult> {
    if (
      unitsOrAll !== "all" &&
      (!Number.isInteger(unitsOrAll) || unitsOrAll <= 0 || unitsOrAll > MAX_CRYPTO_UNITS_PER_TX)
    ) {
      throw new AppUserError("Jumlah unit jual harus bilangan bulat positif atau 'all'.");
    }

    const quote = this.getQuote(rawSymbol, now);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const currentHolding = state.crypto[quote.symbol] ?? 0;

      const unitsToSell = unitsOrAll === "all" ? currentHolding : unitsOrAll;
      if (currentHolding <= 0 || unitsToSell <= 0 || unitsToSell > currentHolding) {
        throw new AppUserError(
          `Kamu hanya punya ${String(currentHolding)} unit ${quote.symbol} di portofolio.`,
        );
      }

      const rawProceeds = quote.price * BigInt(unitsToSell);
      const proceeds = clampMoneyCredit(profile.moneyBalance, rawProceeds);
      const newHolding = currentHolding - unitsToSell;
      const nextState = withUpdatedCryptoHolding(state, quote.symbol, newHolding);

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { increment: proceeds },
          totalMoneyEarned: { increment: proceeds },
          experience: { increment: 20 },
          rpgState: serializeRpgState(nextState),
        },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.CRYPTO_SELL,
          amount: proceeds,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `sell ${String(unitsToSell)} ${quote.symbol} @ ${quote.price.toString()}`,
        },
        tx,
      );

      return {
        action: "sell",
        symbol: quote.symbol,
        coinName: quote.name,
        units: unitsToSell,
        unitPrice: quote.price,
        totalMoney: proceeds,
        newHolding,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async getPortfolio(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<CryptoPortfolioSummary> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);
    const quotes = this.getMarketSnapshot(now);
    const items: CryptoPortfolioItem[] = [];
    let totalValue = 0n;

    for (const quote of quotes) {
      const units = state.crypto[quote.symbol] ?? 0;
      if (units > 0) {
        const marketValue = BigInt(units) * quote.price;
        totalValue += marketValue;
        items.push({
          symbol: quote.symbol,
          name: quote.name,
          units,
          unitPrice: quote.price,
          marketValue,
          changePercent: quote.changePercent,
        });
      }
    }

    return {
      items,
      totalValue,
      moneyBalance: profile.moneyBalance,
    };
  }
}

export const cryptoMarketService = new CryptoMarketService();
