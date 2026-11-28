import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupMemberProfile,
  type GroupRedeemCode,
} from "@prisma/client";

import { AppUserError } from "../../errors/appUserError";
import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { GroupMemberTransactionRepository } from "../../repositories/groupMemberTransaction.repository";
import {
  GroupRedeemCodeRepository,
  parseClaimedJids,
} from "../../repositories/groupRedeemCode.repository";
import { prisma } from "../../repositories/prismaClient";
import {
  clampMoneyCredit,
  formatRemainingDuration,
  formatRupiah,
  MAX_SAFE_MONEY_BIGINT,
  percentOfBigInt,
} from "../../utils/currency";
import { toWibDateKey } from "../../utils/wibDate";
import { generateCorrelationId } from "../member/memberEconomy.service";
import { resolveRank, type MemberRank } from "../member/rank.service";
import { CryptoMarketService } from "./cryptoMarket.service";
import { SHOP_ITEM_MAP } from "./rpgCatalog";
import {
  ACHIEVEMENT_SPECS,
  DAILY_QUEST_SPECS,
  DEPOSITO_DAILY_INTEREST_PERCENT,
  DEPOSITO_MAX_INTEREST_DAYS,
  DEPOSITO_MAX_PRINCIPAL,
  DEPOSITO_MIN_AMOUNT,
  GACHA_CARD_MAP,
  GACHA_CARDS,
  GACHA_PULL_PRICE,
  getStockQuotesAt,
  PROPERTY_CATALOG,
  PROPERTY_HARVEST_TAX_PERCENT,
  PROPERTY_MAP,
  PROPERTY_MAX_ACCUMULATION_HOURS,
  PROPERTY_MIN_HARVEST_MS,
  PROPERTY_SELL_REFUND_PERCENT,
  RANK_SALARY_TABLE,
  rollGachaCard,
  STOCK_MAP,
  type AchievementSpec,
  type DailyQuestSpec,
  type GachaCardSpec,
  type PropertySpec,
  type StockQuote,
} from "./rpgExpansionCatalog";
import { applyDailyAutoWealthTaxInTx, creditTreasuryInTx } from "./autoWealthTax";
import {
  CRATE_TYPES,
  parseRpgState,
  serializeRpgState,
  withAchievementsAdded,
  withCardDelta,
  withCrateDelta,
  withDailyQuestClaimed,
  withDeposito,
  withItemDelta,
  withPropertyDelta,
  withPropertyHarvestAt,
  withSalaryDateKey,
  withStockHolding,
  withUpdatedCooldown,
  type CrateType,
  type MemberRpgState,
} from "./rpgState";

const MAX_STOCK_LOTS_PER_TX = 10_000;
const MAX_TRADE_QTY = 10_000;
const MAX_REDEEM_LIMIT = 100;
const MAX_REDEEM_MONEY = 10_000_000_000n;
const MAX_REDEEM_CLAIMS = 200;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export interface DailyQuestItemStatus {
  spec: DailyQuestSpec;
  completed: boolean;
  claimed: boolean;
}

export interface DailyQuestOverview {
  dateKey: string;
  items: DailyQuestItemStatus[];
  claimableCount: number;
}

export interface ClaimDailyQuestsResult {
  dateKey: string;
  claimedQuests: DailyQuestSpec[];
  totalMoney: bigint;
  totalLimit: number;
  totalXp: number;
  currentMoney: bigint;
  currentLimit: number;
}

export interface AchievementsOverview {
  unlocked: AchievementSpec[];
  newlyUnlocked: AchievementSpec[];
  locked: AchievementSpec[];
  bonusMoney: bigint;
  bonusLimit: number;
  bonusXp: number;
}

export interface PropertyOverviewItem {
  spec: PropertySpec;
  owned: number;
  hourlyIncome: bigint;
}

export interface PropertyOverview {
  items: PropertyOverviewItem[];
  totalOwned: number;
  totalHourlyIncome: bigint;
  pendingHarvest: bigint;
  elapsedMs: number;
  moneyBalance: bigint;
}

export interface PropertyTradeResult {
  action: "buy" | "sell";
  spec: PropertySpec;
  quantity: number;
  totalMoney: bigint;
  autoHarvested: bigint;
  ownedAfter: number;
  currentMoney: bigint;
}

export interface PropertyHarvestResult {
  grossMoney: bigint;
  operationalTax: bigint;
  harvestedMoney: bigint;
  autoWealthTaxPaid: bigint;
  elapsedMs: number;
  totalOwned: number;
  currentMoney: bigint;
}

export interface SalaryClaimResult {
  dateKey: string;
  rank: MemberRank;
  money: bigint;
  autoWealthTaxPaid: bigint;
  limit: number;
  xp: number;
  currentMoney: bigint;
  currentLimit: number;
}

export interface DepositoInfo {
  active: boolean;
  principal: bigint;
  depositedAt: number;
  daysHeld: number;
  ratePercent: number;
  accruedInterest: bigint;
  totalWithdrawValue: bigint;
  moneyBalance: bigint;
}

export interface DepositoOpenResult {
  principal: bigint;
  ratePercent: number;
  currentMoney: bigint;
}

export interface DepositoWithdrawResult {
  principal: bigint;
  daysHeld: number;
  interest: bigint;
  totalReceived: bigint;
  currentMoney: bigint;
}

export interface StockTradeResult {
  action: "buy" | "sell";
  quote: StockQuote;
  lots: number;
  totalMoney: bigint;
  remainingLots: number;
  avgPrice: bigint;
  realizedPnl?: bigint;
  currentMoney: bigint;
}

export interface PortfolioStockEntry {
  ticker: string;
  name: string;
  lots: number;
  avgPrice: bigint;
  currentPrice: bigint;
  marketValue: bigint;
  pnl: bigint;
  pnlPercent: number;
}

export interface FullPortfolioOverview {
  moneyBalance: bigint;
  bankBalance: bigint;
  depositoValue: bigint;
  stocks: PortfolioStockEntry[];
  totalStocksValue: bigint;
  totalCryptoValue: bigint;
  totalPropertyValue: bigint;
  totalPropertyOwned: number;
  uniqueCards: number;
  totalCardCopies: number;
  netWorth: bigint;
}

export interface GachaPullResult {
  card: GachaCardSpec;
  isNew: boolean;
  ownedCopies: number;
  cost: bigint;
  cashback: bigint;
  xpAwarded: number;
  uniqueOwned: number;
  totalCatalog: number;
  currentMoney: bigint;
}

export interface CardCollectionOverview {
  uniqueOwned: number;
  totalCatalog: number;
  totalCopies: number;
  totalPower: number;
  entries: { card: GachaCardSpec; count: number }[];
}

export interface TradeItemResult {
  itemType: "item" | "crate" | "card";
  itemLabel: string;
  quantity: number;
  senderRemaining: number;
  recipientTotal: number;
}

export interface RedeemCodeSummary {
  code: string;
  rewardLimit: number;
  rewardMoney: bigint;
  maxClaims: number;
  claimsUsed: number;
}

export interface RedeemResult {
  code: string;
  rewardLimit: number;
  rewardMoney: bigint;
  rewardPoints: number;
  claimsUsed: number;
  maxClaims: number;
  currentLimit: number;
  currentMoney: bigint;
}

interface ExpansionProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
}

interface ExpansionTxStore {
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

interface ExpansionRedeemStore {
  findByGroupAndCode(groupJid: string, code: string, tx?: unknown): Promise<GroupRedeemCode | null>;
  listByGroup(groupJid: string, limit?: number): Promise<GroupRedeemCode[]>;
  create(
    data: {
      groupJid: string;
      code: string;
      rewardLimit: number;
      rewardMoney: bigint;
      rewardPoints?: number;
      maxClaims: number;
      createdBy: string;
      expiresAt?: Date | null;
    },
    tx?: unknown,
  ): Promise<GroupRedeemCode>;
  updateClaimedBy(id: string, claimedByJids: string[], tx?: unknown): Promise<GroupRedeemCode>;
}

interface ExpansionTx {
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
  tenantGroup?: {
    findUnique(args: { where: { groupJid: string } }): Promise<{ treasuryBalance: bigint } | null>;
    update(args: {
      where: { groupJid: string };
      data: { treasuryBalance: bigint };
    }): Promise<unknown>;
  };
}

interface ExpansionDb {
  $transaction<T>(fn: (tx: ExpansionTx) => Promise<T>): Promise<T>;
}

function computeHourlyPropertyIncome(properties: Record<string, number>): {
  totalOwned: number;
  hourlyIncome: bigint;
  resaleAssetValue: bigint;
} {
  let totalOwned = 0;
  let hourlyIncome = 0n;
  let resaleAssetValue = 0n;
  for (const [id, qty] of Object.entries(properties)) {
    const spec = PROPERTY_MAP.get(id);
    if (!spec || qty <= 0) continue;
    totalOwned += qty;
    hourlyIncome += spec.incomePerHour * BigInt(qty);
    resaleAssetValue += spec.price * BigInt(qty);
  }
  return { totalOwned, hourlyIncome, resaleAssetValue };
}

function computePendingPropertyIncome(
  state: MemberRpgState,
  nowMs: number,
): { pendingMoney: bigint; elapsedMs: number; totalOwned: number; hourlyIncome: bigint } {
  const { totalOwned, hourlyIncome } = computeHourlyPropertyIncome(state.properties);
  if (totalOwned === 0 || hourlyIncome <= 0n || state.lastPropertyHarvestAt <= 0) {
    return { pendingMoney: 0n, elapsedMs: 0, totalOwned, hourlyIncome };
  }
  const rawElapsed = Math.max(0, nowMs - state.lastPropertyHarvestAt);
  const cappedElapsed = Math.min(rawElapsed, PROPERTY_MAX_ACCUMULATION_HOURS * MS_PER_HOUR);
  const pendingMoney = (hourlyIncome * BigInt(cappedElapsed)) / BigInt(MS_PER_HOUR);
  return { pendingMoney, elapsedMs: cappedElapsed, totalOwned, hourlyIncome };
}

function evaluateDailyQuestCompletion(
  profile: GroupMemberProfile,
  state: MemberRpgState,
  todayKey: string,
): Record<DailyQuestSpec["id"], boolean> {
  const absenDone =
    profile.lastDailyClaimAt !== null && toWibDateKey(profile.lastDailyClaimAt) === todayKey;

  let rpgActionsToday = 0;
  for (const ts of Object.values(state.cooldowns)) {
    if (ts > 0 && toWibDateKey(new Date(ts)) === todayKey) {
      rpgActionsToday += 1;
    }
  }
  const kerjaDone = rpgActionsToday >= 2;

  const activeToday =
    toWibDateKey(profile.lastActiveAt) === todayKey && profile.messageCount >= 5;
  const hasAssets =
    Object.keys(state.properties).length > 0 ||
    Object.keys(state.stocks).length > 0 ||
    Object.keys(state.cards).length > 0;
  const wargaDone = activeToday || hasAssets;

  const allDone = absenDone && kerjaDone && wargaDone;
  return {
    absen_harian: absenDone,
    pekerja_keras: kerjaDone,
    warga_aktif: wargaDone,
    bonus_semua: allDone,
  };
}

function evaluateQualifiedAchievements(
  profile: GroupMemberProfile,
  state: MemberRpgState,
): Set<string> {
  const qualified = new Set<string>();
  const totalWealth = profile.moneyBalance + profile.bankBalance;
  const totalProps = Object.values(state.properties).reduce((acc, qty) => acc + qty, 0);
  const uniqueCards = Object.keys(state.cards).length;
  const hasUrCard = Object.keys(state.cards).some((id) => GACHA_CARD_MAP.get(id)?.rarity === "UR");

  if (totalWealth >= 100_000_000n) qualified.add("jutawan");
  if (totalWealth >= 1_000_000_000n) qualified.add("miliarder");
  if (totalWealth >= 1_000_000_000_000n) qualified.add("triliuner");
  if (profile.level >= 5) qualified.add("petualang");
  if (profile.experience >= 40_000) qualified.add("legenda_xp");
  if (totalProps >= 3) qualified.add("juragan_properti");
  if (Object.keys(state.stocks).length > 0 || Object.keys(state.crypto).length > 0) {
    qualified.add("investor_bursa");
  }
  if (uniqueCards >= 5) qualified.add("kolektor_kartu");
  if (hasUrCard) qualified.add("raja_kartu_ur");
  if (state.spouseJid !== null) qualified.add("pasangan_sah");
  if (state.customTitle !== null) qualified.add("sultan_berkelas");
  if (profile.messageCount >= 100) qualified.add("aktif_grup");

  return qualified;
}

function resolveDepositoBreakdown(
  state: MemberRpgState,
  nowMs: number,
): {
  active: boolean;
  principal: bigint;
  depositedAt: number;
  daysHeld: number;
  ratePercent: number;
  accruedInterest: bigint;
  totalWithdrawValue: bigint;
} {
  if (!state.deposito) {
    return {
      active: false,
      principal: 0n,
      depositedAt: 0,
      daysHeld: 0,
      ratePercent: DEPOSITO_DAILY_INTEREST_PERCENT,
      accruedInterest: 0n,
      totalWithdrawValue: 0n,
    };
  }
  const principal = BigInt(state.deposito.principal);
  const elapsedMs = Math.max(0, nowMs - state.deposito.depositedAt);
  const daysHeld = Math.min(DEPOSITO_MAX_INTEREST_DAYS, Math.floor(elapsedMs / MS_PER_DAY));
  const effectiveRate = Math.min(DEPOSITO_DAILY_INTEREST_PERCENT, state.deposito.ratePercent);
  const totalPercent = daysHeld * effectiveRate;
  const accruedInterest = percentOfBigInt(principal, totalPercent);
  return {
    active: true,
    principal,
    depositedAt: state.deposito.depositedAt,
    daysHeld,
    ratePercent: effectiveRate,
    accruedInterest,
    totalWithdrawValue: principal + accruedInterest,
  };
}

export class RpgExpansionService {
  constructor(
    private readonly profileRepo: ExpansionProfileStore = new GroupMemberProfileRepository(),
    private readonly txRepo: ExpansionTxStore = new GroupMemberTransactionRepository(),
    private readonly redeemRepo: ExpansionRedeemStore = new GroupRedeemCodeRepository(),
    private readonly cryptoMarket: CryptoMarketService = new CryptoMarketService(),
    private readonly db: ExpansionDb = prisma,
  ) {}

  async getDailyQuests(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<DailyQuestOverview> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);
    const todayKey = toWibDateKey(now);
    const claimedSet = new Set(
      state.dailyQuest.dateKey === todayKey ? state.dailyQuest.claimedIds : [],
    );
    const completion = evaluateDailyQuestCompletion(profile, state, todayKey);

    const items: DailyQuestItemStatus[] = DAILY_QUEST_SPECS.map((spec) => ({
      spec,
      completed: completion[spec.id],
      claimed: claimedSet.has(spec.id),
    }));
    const claimableCount = items.filter((item) => item.completed && !item.claimed).length;

    return { dateKey: todayKey, items, claimableCount };
  }

  async claimDailyQuests(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<ClaimDailyQuestsResult> {
    const todayKey = toWibDateKey(now);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const claimedSet = new Set(
        state.dailyQuest.dateKey === todayKey ? state.dailyQuest.claimedIds : [],
      );
      const completion = evaluateDailyQuestCompletion(profile, state, todayKey);

      const claimable = DAILY_QUEST_SPECS.filter(
        (spec) => completion[spec.id] && !claimedSet.has(spec.id),
      );
      if (claimable.length === 0) {
        const allAlreadyClaimed = DAILY_QUEST_SPECS.every((spec) => claimedSet.has(spec.id));
        if (allAlreadyClaimed) {
          throw new AppUserError(
            "Semua misi harian hari ini sudah kamu klaim! Misi akan direset pukul 00:00 WIB.",
          );
        }
        throw new AppUserError(
          "Belum ada misi selesai yang siap diklaim. Cek progresmu di .misi terlebih dahulu.",
        );
      }

      const rawMoney = claimable.reduce((acc, q) => acc + q.rewardMoney, 0n);
      const moneyCredit = clampMoneyCredit(profile.moneyBalance, rawMoney);
      const totalLimit = claimable.reduce((acc, q) => acc + q.rewardLimit, 0);
      const totalXp = claimable.reduce((acc, q) => acc + q.rewardXp, 0);
      const nextState = withDailyQuestClaimed(
        state,
        todayKey,
        claimable.map((q) => q.id),
      );

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { increment: moneyCredit },
          totalMoneyEarned: { increment: moneyCredit },
          limitBalance: { increment: totalLimit },
          totalLimitsEarned: { increment: totalLimit },
          experience: { increment: totalXp },
          rpgState: serializeRpgState(nextState),
        },
      });

      if (moneyCredit > 0n) {
        await this.txRepo.create(
          {
            profileId: profile.id,
            groupJid,
            userJid,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.DAILY_REWARD,
            amount: moneyCredit,
            balanceBefore: profile.moneyBalance,
            balanceAfter: updated.moneyBalance,
            correlationId,
            note: `daily_quest:${todayKey}:${claimable.map((q) => q.id).join(",")}`,
          },
          tx,
        );
      }

      if (totalLimit > 0) {
        await this.txRepo.create(
          {
            profileId: profile.id,
            groupJid,
            userJid,
            asset: MemberTransactionAsset.LIMIT,
            type: MemberTransactionType.DAILY_REWARD,
            amount: totalLimit,
            balanceBefore: profile.limitBalance,
            balanceAfter: updated.limitBalance,
            correlationId,
            note: `daily_quest_limit:${todayKey}`,
          },
          tx,
        );
      }

      return {
        dateKey: todayKey,
        claimedQuests: claimable,
        totalMoney: moneyCredit,
        totalLimit,
        totalXp,
        currentMoney: updated.moneyBalance,
        currentLimit: updated.limitBalance,
      };
    });
  }

  async getAchievements(groupJid: string, userJid: string): Promise<AchievementsOverview> {
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const existing = new Set(state.achievements);
      const qualified = evaluateQualifiedAchievements(profile, state);

      const newlyUnlocked = ACHIEVEMENT_SPECS.filter(
        (spec) => qualified.has(spec.id) && !existing.has(spec.id),
      );

      let bonusMoney = 0n;
      let bonusLimit = 0;
      let bonusXp = 0;

      if (newlyUnlocked.length > 0) {
        const rawMoney = newlyUnlocked.reduce((acc, a) => acc + a.rewardMoney, 0n);
        bonusMoney = clampMoneyCredit(profile.moneyBalance, rawMoney);
        bonusLimit = newlyUnlocked.reduce((acc, a) => acc + a.rewardLimit, 0);
        bonusXp = newlyUnlocked.reduce((acc, a) => acc + a.rewardXp, 0);

        const nextState = withAchievementsAdded(
          state,
          newlyUnlocked.map((a) => a.id),
        );

        const updated = await tx.groupMemberProfile.update({
          where: { id: profile.id },
          data: {
            moneyBalance: { increment: bonusMoney },
            totalMoneyEarned: { increment: bonusMoney },
            limitBalance: { increment: bonusLimit },
            totalLimitsEarned: { increment: bonusLimit },
            experience: { increment: bonusXp },
            rpgState: serializeRpgState(nextState),
          },
        });

        if (bonusMoney > 0n) {
          await this.txRepo.create(
            {
              profileId: profile.id,
              groupJid,
              userJid,
              asset: MemberTransactionAsset.MONEY,
              type: MemberTransactionType.RPG_EARN,
              amount: bonusMoney,
              balanceBefore: profile.moneyBalance,
              balanceAfter: updated.moneyBalance,
              correlationId,
              note: `achievement:${newlyUnlocked.map((a) => a.id).join(",")}`,
            },
            tx,
          );
        }

        for (const a of newlyUnlocked) {
          existing.add(a.id);
        }
      }

      const unlocked = ACHIEVEMENT_SPECS.filter((spec) => existing.has(spec.id));
      const locked = ACHIEVEMENT_SPECS.filter((spec) => !existing.has(spec.id));

      return {
        unlocked,
        newlyUnlocked,
        locked,
        bonusMoney,
        bonusLimit,
        bonusXp,
      };
    });
  }

  async getPropertiesOverview(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<PropertyOverview> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);
    const pending = computePendingPropertyIncome(state, now.getTime());

    const items: PropertyOverviewItem[] = PROPERTY_CATALOG.map((spec) => {
      const owned = state.properties[spec.id] ?? 0;
      return {
        spec,
        owned,
        hourlyIncome: spec.incomePerHour * BigInt(owned),
      };
    });

    return {
      items,
      totalOwned: pending.totalOwned,
      totalHourlyIncome: pending.hourlyIncome,
      pendingHarvest: pending.pendingMoney,
      elapsedMs: pending.elapsedMs,
      moneyBalance: profile.moneyBalance,
    };
  }

  async buyProperty(
    groupJid: string,
    userJid: string,
    rawPropertyId: string,
    quantity = 1,
    now: Date = new Date(),
  ): Promise<PropertyTradeResult> {
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 10) {
      throw new AppUserError("Jumlah beli properti harus bilangan bulat 1 sampai 10.");
    }

    const spec = PROPERTY_MAP.get(rawPropertyId.trim().toLowerCase());
    if (!spec) {
      const list = PROPERTY_CATALOG.map((p) => p.id).join(", ");
      throw new AppUserError(`Properti "${rawPropertyId}" tidak ada. Pilihan: ${list}.`);
    }

    const totalCost = spec.price * BigInt(quantity);
    const nowMs = now.getTime();
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const playerLevel = Math.max(1, profile.level);
      if (playerLevel < spec.minLevel) {
        throw new AppUserError(
          `Membeli *${spec.name}* membutuhkan minimal *Level ${String(spec.minLevel)}* (levelmu saat ini Lv.${String(playerLevel)}). Naikkan lewat *.levelup*!`,
        );
      }
      const state = parseRpgState(profile.rpgState);
      const currentOwned = state.properties[spec.id] ?? 0;
      if (currentOwned + quantity > spec.maxOwned) {
        throw new AppUserError(
          `Batas maksimal ${spec.name} adalah ${String(spec.maxOwned)} unit (kamu sudah punya ${String(currentOwned)}).`,
        );
      }

      // Auto-panen pendapatan tertunda sebelum menambah properti baru agar timer adil
      const pending = computePendingPropertyIncome(state, nowMs);
      const autoHarvested =
        pending.totalOwned > 0 && pending.pendingMoney > 0n
          ? clampMoneyCredit(profile.moneyBalance, pending.pendingMoney)
          : 0n;

      const effectiveBalance = profile.moneyBalance + autoHarvested;
      if (effectiveBalance < totalCost) {
        throw new AppUserError(
          `Dompet tidak cukup! Harga ${String(quantity)}x ${spec.name} = ${formatRupiah(totalCost)}, dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      let nextState = withPropertyDelta(state, spec.id, quantity);
      nextState = withPropertyHarvestAt(nextState, nowMs);

      const netDelta = autoHarvested - totalCost;
      if (netDelta < 0n) {
        const netDebit = -netDelta;
        const res = await tx.groupMemberProfile.updateMany({
          where: { id: profile.id, moneyBalance: { gte: netDebit } },
          data: {
            moneyBalance: { decrement: netDebit },
            ...(autoHarvested > 0n ? { totalMoneyEarned: { increment: autoHarvested } } : {}),
            rpgState: serializeRpgState(nextState),
          },
        });
        if (res.count === 0) {
          throw new AppUserError("Saldo dompet tidak mencukupi saat membeli properti.");
        }
      } else {
        await tx.groupMemberProfile.update({
          where: { id: profile.id },
          data: {
            moneyBalance: { increment: netDelta },
            totalMoneyEarned: { increment: autoHarvested },
            rpgState: serializeRpgState(nextState),
          },
        });
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
          type: MemberTransactionType.RPG_LOSS,
          amount: -totalCost,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `buy_property:${spec.id}x${String(quantity)}`,
        },
        tx,
      );

      return {
        action: "buy",
        spec,
        quantity,
        totalMoney: totalCost,
        autoHarvested,
        ownedAfter: currentOwned + quantity,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async sellProperty(
    groupJid: string,
    userJid: string,
    rawPropertyId: string,
    quantity = 1,
    now: Date = new Date(),
  ): Promise<PropertyTradeResult> {
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 10) {
      throw new AppUserError("Jumlah jual properti harus bilangan bulat 1 sampai 10.");
    }

    const spec = PROPERTY_MAP.get(rawPropertyId.trim().toLowerCase());
    if (!spec) {
      const list = PROPERTY_CATALOG.map((p) => p.id).join(", ");
      throw new AppUserError(`Properti "${rawPropertyId}" tidak ada. Pilihan: ${list}.`);
    }

    const nowMs = now.getTime();
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const currentOwned = state.properties[spec.id] ?? 0;
      if (currentOwned < quantity) {
        throw new AppUserError(
          `Kamu hanya memiliki ${String(currentOwned)} unit ${spec.name}.`,
        );
      }

      const refundPerUnit = percentOfBigInt(spec.price, PROPERTY_SELL_REFUND_PERCENT);
      const refundTotal = refundPerUnit * BigInt(quantity);
      const credit = clampMoneyCredit(profile.moneyBalance, refundTotal);

      let nextState = withPropertyDelta(state, spec.id, -quantity);
      const remainingTotal = Object.values(nextState.properties).reduce((acc, q) => acc + q, 0);
      nextState = withPropertyHarvestAt(nextState, remainingTotal > 0 ? nowMs : 0);

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { increment: credit },
          totalMoneyEarned: { increment: credit },
          rpgState: serializeRpgState(nextState),
        },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_EARN,
          amount: credit,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `sell_property:${spec.id}x${String(quantity)}`,
        },
        tx,
      );

      return {
        action: "sell",
        spec,
        quantity,
        totalMoney: credit,
        autoHarvested: 0n,
        ownedAfter: currentOwned - quantity,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async harvestProperties(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<PropertyHarvestResult> {
    const nowMs = now.getTime();
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const pending = computePendingPropertyIncome(state, nowMs);

      if (pending.totalOwned === 0) {
        throw new AppUserError(
          "Kamu belum memiliki properti. Lihat daftar properti di .properti dan beli dengan .beliproperti <nama>.",
        );
      }

      if (pending.elapsedMs < PROPERTY_MIN_HARVEST_MS || pending.pendingMoney <= 0n) {
        const waitMs = Math.max(1_000, PROPERTY_MIN_HARVEST_MS - pending.elapsedMs);
        throw new AppUserError(
          `Hasil sewa properti belum siap dipanen. Tunggu ${formatRemainingDuration(waitMs)} lagi ya.`,
        );
      }

      const grossMoney = pending.pendingMoney;
      const operationalTax = percentOfBigInt(grossMoney, PROPERTY_HARVEST_TAX_PERCENT);
      const netMoney = grossMoney > operationalTax ? grossMoney - operationalTax : 0n;
      const credit = clampMoneyCredit(profile.moneyBalance, netMoney);
      let nextState = withPropertyHarvestAt(state, nowMs);
      nextState = withUpdatedCooldown(nextState, "panen", nowMs);

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { increment: credit },
          totalMoneyEarned: { increment: credit },
          rpgState: serializeRpgState(nextState),
        },
      });

      if (operationalTax > 0n) {
        await creditTreasuryInTx(tx, groupJid, operationalTax);
      }

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_EARN,
          amount: credit,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `harvest_properties:${String(pending.totalOwned)}:tax_${String(operationalTax)}`,
        },
        tx,
      );

      const wealthTax = await applyDailyAutoWealthTaxInTx({
        tx,
        profileId: profile.id,
        groupJid,
        userJid,
        currentWallet: updated.moneyBalance,
        currentBank: updated.bankBalance,
        state: nextState,
        todayKey: toWibDateKey(now),
        correlationId,
        txRepo: this.txRepo,
      });

      return {
        grossMoney,
        operationalTax,
        harvestedMoney: credit,
        autoWealthTaxPaid: wealthTax.taxPaid,
        elapsedMs: pending.elapsedMs,
        totalOwned: pending.totalOwned,
        currentMoney: wealthTax.walletAfter,
      };
    });
  }

  async claimSalary(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<SalaryClaimResult> {
    const todayKey = toWibDateKey(now);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      if (state.lastSalaryDateKey === todayKey) {
        throw new AppUserError(
          "Gaji harianmu hari ini sudah diambil! Kembali lagi besok setelah pukul 00:00 WIB.",
        );
      }

      const rank = resolveRank(profile.experience);
      const spec = RANK_SALARY_TABLE[rank];
      const moneyCredit = clampMoneyCredit(profile.moneyBalance, spec.money);
      const nextState = withSalaryDateKey(state, todayKey);

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { increment: moneyCredit },
          totalMoneyEarned: { increment: moneyCredit },
          limitBalance: { increment: spec.limit },
          totalLimitsEarned: { increment: spec.limit },
          experience: { increment: spec.xp },
          rpgState: serializeRpgState(nextState),
        },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.DAILY_REWARD,
          amount: moneyCredit,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `salary:${rank}:${todayKey}`,
        },
        tx,
      );

      const wealthTax = await applyDailyAutoWealthTaxInTx({
        tx,
        profileId: profile.id,
        groupJid,
        userJid,
        currentWallet: updated.moneyBalance,
        currentBank: updated.bankBalance,
        state: nextState,
        todayKey,
        correlationId,
        txRepo: this.txRepo,
      });

      return {
        dateKey: todayKey,
        rank,
        money: moneyCredit,
        autoWealthTaxPaid: wealthTax.taxPaid,
        limit: spec.limit,
        xp: spec.xp,
        currentMoney: wealthTax.walletAfter,
        currentLimit: updated.limitBalance,
      };
    });
  }

  async getDepositoInfo(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<DepositoInfo> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);
    const breakdown = resolveDepositoBreakdown(state, now.getTime());
    return {
      ...breakdown,
      moneyBalance: profile.moneyBalance,
    };
  }

  async openDeposito(
    groupJid: string,
    userJid: string,
    amountOrAll: bigint | "all",
    now: Date = new Date(),
  ): Promise<DepositoOpenResult> {
    const nowMs = now.getTime();
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      if (state.deposito) {
        throw new AppUserError(
          "Kamu masih punya deposito aktif! Cairkan dulu pakai .cairdeposito sebelum membuka deposito baru.",
        );
      }

      const amount =
        amountOrAll === "all"
          ? profile.moneyBalance > DEPOSITO_MAX_PRINCIPAL
            ? DEPOSITO_MAX_PRINCIPAL
            : profile.moneyBalance
          : amountOrAll;
      if (amount < DEPOSITO_MIN_AMOUNT) {
        throw new AppUserError(
          `Minimal setoran deposito adalah ${formatRupiah(DEPOSITO_MIN_AMOUNT)}.`,
        );
      }
      if (amount > DEPOSITO_MAX_PRINCIPAL) {
        throw new AppUserError(
          `Maksimal pokok deposito adalah ${formatRupiah(DEPOSITO_MAX_PRINCIPAL)} agar ekonomi grup tetap seimbang.`,
        );
      }
      if (profile.moneyBalance < amount) {
        throw new AppUserError(
          `Saldo dompet tidak cukup! Dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const nextState = withDeposito(state, {
        principal: amount.toString(),
        depositedAt: nowMs,
        ratePercent: DEPOSITO_DAILY_INTEREST_PERCENT,
      });

      const res = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: amount } },
        data: {
          moneyBalance: { decrement: amount },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (res.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup saat membuka deposito.");
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
          note: `open_deposito:${String(DEPOSITO_DAILY_INTEREST_PERCENT)}pct`,
        },
        tx,
      );

      return {
        principal: amount,
        ratePercent: DEPOSITO_DAILY_INTEREST_PERCENT,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async withdrawDeposito(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<DepositoWithdrawResult> {
    const nowMs = now.getTime();
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const breakdown = resolveDepositoBreakdown(state, nowMs);
      if (!breakdown.active) {
        throw new AppUserError(
          "Kamu tidak punya deposito aktif. Buka deposito dulu dengan .deposito <jumlah>.",
        );
      }

      const credit = clampMoneyCredit(profile.moneyBalance, breakdown.totalWithdrawValue);
      const nextState = withDeposito(state, null);

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { increment: credit },
          totalMoneyEarned: { increment: breakdown.accruedInterest },
          rpgState: serializeRpgState(nextState),
        },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.BANK_WITHDRAW,
          amount: credit,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `withdraw_deposito:${String(breakdown.daysHeld)}d`,
        },
        tx,
      );

      return {
        principal: breakdown.principal,
        daysHeld: breakdown.daysHeld,
        interest: breakdown.accruedInterest,
        totalReceived: credit,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  getStockMarket(now: Date = new Date()): StockQuote[] {
    return getStockQuotesAt(now);
  }

  async buyStock(
    groupJid: string,
    userJid: string,
    rawTicker: string,
    lots: number,
    now: Date = new Date(),
  ): Promise<StockTradeResult> {
    if (!Number.isInteger(lots) || lots <= 0 || lots > MAX_STOCK_LOTS_PER_TX) {
      throw new AppUserError(
        `Jumlah lot harus bilangan bulat antara 1 sampai ${MAX_STOCK_LOTS_PER_TX.toLocaleString("id-ID")}.`,
      );
    }

    const ticker = rawTicker.trim().toUpperCase();
    const quote = this.getStockMarket(now).find((q) => q.ticker === ticker);
    if (!quote) {
      const list = Array.from(STOCK_MAP.keys()).join(", ");
      throw new AppUserError(`Emiten "${rawTicker}" tidak terdaftar di bursa. Pilihan: ${list}.`);
    }

    const totalCost = quote.lotPrice * BigInt(lots);
    if (totalCost <= 0n || totalCost > MAX_SAFE_MONEY_BIGINT) {
      throw new AppUserError("Nominal pembelian saham terlalu besar.");
    }

    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      if (profile.moneyBalance < totalCost) {
        throw new AppUserError(
          `Dompet tidak cukup! Harga ${String(lots)} lot ${quote.ticker} = ${formatRupiah(totalCost)}, dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const state = parseRpgState(profile.rpgState);
      const prev = state.stocks[quote.ticker];
      const prevLots = prev?.lots ?? 0;
      const prevAvg = prev ? BigInt(prev.avgPrice) : 0n;
      const nextLots = prevLots + lots;
      const nextAvg = (prevAvg * BigInt(prevLots) + totalCost) / BigInt(nextLots);

      const nextState = withStockHolding(state, quote.ticker, {
        lots: nextLots,
        avgPrice: nextAvg.toString(),
      });

      const res = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: totalCost } },
        data: {
          moneyBalance: { decrement: totalCost },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (res.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup saat membeli saham.");
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
          amount: -totalCost,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `buy_stock:${quote.ticker}x${String(lots)}`,
        },
        tx,
      );

      return {
        action: "buy",
        quote,
        lots,
        totalMoney: totalCost,
        remainingLots: nextLots,
        avgPrice: nextAvg,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async sellStock(
    groupJid: string,
    userJid: string,
    rawTicker: string,
    lotsOrAll: number | "all",
    now: Date = new Date(),
  ): Promise<StockTradeResult> {
    if (
      lotsOrAll !== "all" &&
      (!Number.isInteger(lotsOrAll) || lotsOrAll <= 0 || lotsOrAll > MAX_STOCK_LOTS_PER_TX)
    ) {
      throw new AppUserError("Jumlah lot jual harus bilangan bulat positif atau 'all'.");
    }

    const ticker = rawTicker.trim().toUpperCase();
    const quote = this.getStockMarket(now).find((q) => q.ticker === ticker);
    if (!quote) {
      const list = Array.from(STOCK_MAP.keys()).join(", ");
      throw new AppUserError(`Emiten "${rawTicker}" tidak terdaftar di bursa. Pilihan: ${list}.`);
    }

    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const prev = state.stocks[quote.ticker];
      if (!prev || prev.lots <= 0) {
        throw new AppUserError(`Kamu tidak memiliki saham ${quote.ticker}.`);
      }

      const sellLots = lotsOrAll === "all" ? prev.lots : lotsOrAll;
      if (sellLots > prev.lots) {
        throw new AppUserError(
          `Saham ${quote.ticker} milikmu hanya ${String(prev.lots)} lot.`,
        );
      }

      const avgPrice = BigInt(prev.avgPrice);
      const grossProceeds = quote.lotPrice * BigInt(sellLots);
      const costBasis = avgPrice * BigInt(sellLots);
      const realizedPnl = grossProceeds - costBasis;
      const credit = clampMoneyCredit(profile.moneyBalance, grossProceeds);
      const remainingLots = prev.lots - sellLots;

      const nextState = withStockHolding(
        state,
        quote.ticker,
        remainingLots > 0 ? { lots: remainingLots, avgPrice: prev.avgPrice } : null,
      );

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { increment: credit },
          ...(realizedPnl > 0n ? { totalMoneyEarned: { increment: realizedPnl } } : {}),
          rpgState: serializeRpgState(nextState),
        },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.EXCHANGE_CREDIT,
          amount: credit,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `sell_stock:${quote.ticker}x${String(sellLots)}`,
        },
        tx,
      );

      return {
        action: "sell",
        quote,
        lots: sellLots,
        totalMoney: credit,
        remainingLots,
        avgPrice,
        realizedPnl,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async getFullPortfolio(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<FullPortfolioOverview> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);
    const quotes = this.getStockMarket(now);
    const quoteMap = new Map(quotes.map((q) => [q.ticker, q]));

    const stocks: PortfolioStockEntry[] = [];
    let totalStocksValue = 0n;
    for (const [ticker, holding] of Object.entries(state.stocks)) {
      const q = quoteMap.get(ticker);
      if (!q || holding.lots <= 0) continue;
      const avgPrice = BigInt(holding.avgPrice);
      const marketValue = q.lotPrice * BigInt(holding.lots);
      const costBasis = avgPrice * BigInt(holding.lots);
      const pnl = marketValue - costBasis;
      const pnlPercent =
        costBasis > 0n ? Number((pnl * 1000n) / costBasis) / 10 : 0;
      totalStocksValue += marketValue;
      stocks.push({
        ticker,
        name: q.name,
        lots: holding.lots,
        avgPrice,
        currentPrice: q.lotPrice,
        marketValue,
        pnl,
        pnlPercent,
      });
    }

    const cryptoQuotes = new Map(
      this.cryptoMarket.getMarketSnapshot(now).map((c) => [c.symbol, c]),
    );
    let totalCryptoValue = 0n;
    for (const [symbol, units] of Object.entries(state.crypto)) {
      const cq = cryptoQuotes.get(symbol);
      if (cq && units > 0) {
        totalCryptoValue += cq.price * BigInt(units);
      }
    }

    const dep = resolveDepositoBreakdown(state, now.getTime());
    const propTotals = computeHourlyPropertyIncome(state.properties);
    const uniqueCards = Object.keys(state.cards).length;
    const totalCardCopies = Object.values(state.cards).reduce((acc, q) => acc + q, 0);

    const netWorth =
      profile.moneyBalance +
      profile.bankBalance +
      dep.totalWithdrawValue +
      totalStocksValue +
      totalCryptoValue +
      propTotals.resaleAssetValue;

    return {
      moneyBalance: profile.moneyBalance,
      bankBalance: profile.bankBalance,
      depositoValue: dep.totalWithdrawValue,
      stocks,
      totalStocksValue,
      totalCryptoValue,
      totalPropertyValue: propTotals.resaleAssetValue,
      totalPropertyOwned: propTotals.totalOwned,
      uniqueCards,
      totalCardCopies,
      netWorth,
    };
  }

  async pullGachaCard(
    groupJid: string,
    userJid: string,
    randomValue?: number,
  ): Promise<GachaPullResult> {
    const correlationId = generateCorrelationId();
    const xpAwarded = 80;

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      if (profile.moneyBalance < GACHA_PULL_PRICE) {
        throw new AppUserError(
          `Dompet tidak cukup untuk gacha kartu! Biaya 1x pull: ${formatRupiah(GACHA_PULL_PRICE)}, dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const state = parseRpgState(profile.rpgState);
      const card = rollGachaCard(randomValue);
      const prevCopies = state.cards[card.id] ?? 0;
      const isNew = prevCopies === 0;
      const cashback = isNew ? 0n : card.duplicateCashback;
      const nextState = withCardDelta(state, card.id, 1);

      const netDebit = GACHA_PULL_PRICE > cashback ? GACHA_PULL_PRICE - cashback : 0n;
      const netCredit = cashback > GACHA_PULL_PRICE ? cashback - GACHA_PULL_PRICE : 0n;

      if (netDebit > 0n) {
        const res = await tx.groupMemberProfile.updateMany({
          where: { id: profile.id, moneyBalance: { gte: GACHA_PULL_PRICE } },
          data: {
            moneyBalance: { decrement: netDebit },
            experience: { increment: xpAwarded },
            rpgState: serializeRpgState(nextState),
          },
        });
        if (res.count === 0) {
          throw new AppUserError("Saldo dompet tidak mencukupi saat gacha kartu.");
        }
      } else {
        const clamped = clampMoneyCredit(profile.moneyBalance, netCredit);
        const res = await tx.groupMemberProfile.updateMany({
          where: { id: profile.id, moneyBalance: { gte: GACHA_PULL_PRICE } },
          data: {
            moneyBalance: { increment: clamped },
            totalMoneyEarned: { increment: clamped },
            experience: { increment: xpAwarded },
            rpgState: serializeRpgState(nextState),
          },
        });
        if (res.count === 0) {
          throw new AppUserError("Saldo dompet tidak mencukupi saat gacha kartu.");
        }
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
          type: MemberTransactionType.RPG_LOSS,
          amount: cashback - GACHA_PULL_PRICE,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `gacha_card:${card.id}:${isNew ? "new" : "dup"}`,
        },
        tx,
      );

      return {
        card,
        isNew,
        ownedCopies: prevCopies + 1,
        cost: GACHA_PULL_PRICE,
        cashback,
        xpAwarded,
        uniqueOwned: Object.keys(nextState.cards).length,
        totalCatalog: GACHA_CARDS.length,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async getCardCollection(groupJid: string, userJid: string): Promise<CardCollectionOverview> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);
    const rarityOrder: Record<string, number> = { UR: 0, SSR: 1, SR: 2, R: 3 };

    const entries: { card: GachaCardSpec; count: number }[] = [];
    let totalCopies = 0;
    let totalPower = 0;

    for (const [id, count] of Object.entries(state.cards)) {
      const card = GACHA_CARD_MAP.get(id);
      if (!card || count <= 0) continue;
      entries.push({ card, count });
      totalCopies += count;
      totalPower += card.power;
    }

    entries.sort((a, b) => {
      const ra = rarityOrder[a.card.rarity] ?? 9;
      const rb = rarityOrder[b.card.rarity] ?? 9;
      if (ra !== rb) return ra - rb;
      return b.card.power - a.card.power;
    });

    return {
      uniqueOwned: entries.length,
      totalCatalog: GACHA_CARDS.length,
      totalCopies,
      totalPower,
      entries,
    };
  }

  async tradeItem(
    groupJid: string,
    senderJid: string,
    targetJid: string,
    rawItemKey: string,
    quantity: number,
  ): Promise<TradeItemResult> {
    if (senderJid === targetJid) {
      throw new AppUserError("Kamu tidak bisa melakukan barter dengan dirimu sendiri.");
    }
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_TRADE_QTY) {
      throw new AppUserError(
        `Jumlah item barter harus bilangan bulat antara 1 sampai ${MAX_TRADE_QTY.toLocaleString("id-ID")}.`,
      );
    }

    const key = rawItemKey.trim().toLowerCase();
    const isCrate = (CRATE_TYPES as readonly string[]).includes(key);
    const cardBySerial = GACHA_CARDS.find(
      (c) => c.id === key || c.serial === key.replace(/^#/, "").padStart(3, "0"),
    );
    const shopItem = SHOP_ITEM_MAP.get(key);

    if (!isCrate && !cardBySerial && !shopItem) {
      throw new AppUserError(
        `Item "${rawItemKey}" tidak dikenali. Kamu bisa barter item tas (.inv), peti (common/uncommon/mythic/legendary), atau kode/nomor kartu (.koleksi).`,
      );
    }

    return this.db.$transaction(async (tx) => {
      const senderProfile = await this.profileRepo.findOrCreate(groupJid, senderJid, tx);
      const targetProfile = await this.profileRepo.findOrCreate(groupJid, targetJid, tx);
      const senderState = parseRpgState(senderProfile.rpgState);
      const targetState = parseRpgState(targetProfile.rpgState);

      let nextSenderState: MemberRpgState;
      let nextTargetState: MemberRpgState;
      let itemType: "item" | "crate" | "card";
      let itemLabel: string;
      let senderRemaining: number;
      let recipientTotal: number;

      if (isCrate) {
        const crateKey = key as CrateType;
        const owned = senderState.crates[crateKey];
        if (owned < quantity) {
          throw new AppUserError(
            `Peti ${crateKey} milikmu hanya ${String(owned)}, tidak cukup untuk kirim ${String(quantity)}.`,
          );
        }
        nextSenderState = withCrateDelta(senderState, crateKey, -quantity);
        nextTargetState = withCrateDelta(targetState, crateKey, quantity);
        itemType = "crate";
        itemLabel = `${crateKey.toUpperCase()} Crate`;
        senderRemaining = nextSenderState.crates[crateKey];
        recipientTotal = nextTargetState.crates[crateKey];
      } else if (cardBySerial) {
        const owned = senderState.cards[cardBySerial.id] ?? 0;
        if (owned < quantity) {
          throw new AppUserError(
            `Kartu [${cardBySerial.rarity}] ${cardBySerial.name} milikmu hanya ${String(owned)} lembar.`,
          );
        }
        nextSenderState = withCardDelta(senderState, cardBySerial.id, -quantity);
        nextTargetState = withCardDelta(targetState, cardBySerial.id, quantity);
        itemType = "card";
        itemLabel = `[${cardBySerial.rarity}] ${cardBySerial.name} (#${cardBySerial.serial})`;
        senderRemaining = nextSenderState.cards[cardBySerial.id] ?? 0;
        recipientTotal = nextTargetState.cards[cardBySerial.id] ?? 0;
      } else {
        const owned = senderState.items[key] ?? 0;
        if (owned < quantity) {
          throw new AppUserError(
            `Item ${shopItem?.label ?? key} milikmu hanya ${String(owned)}, tidak cukup untuk kirim ${String(quantity)}.`,
          );
        }
        nextSenderState = withItemDelta(senderState, key, -quantity);
        nextTargetState = withItemDelta(targetState, key, quantity);
        itemType = "item";
        itemLabel = shopItem?.label ?? key;
        senderRemaining = nextSenderState.items[key] ?? 0;
        recipientTotal = nextTargetState.items[key] ?? 0;
      }

      await tx.groupMemberProfile.update({
        where: { id: senderProfile.id },
        data: { rpgState: serializeRpgState(nextSenderState) },
      });
      await tx.groupMemberProfile.update({
        where: { id: targetProfile.id },
        data: { rpgState: serializeRpgState(nextTargetState) },
      });

      return {
        itemType,
        itemLabel,
        quantity,
        senderRemaining,
        recipientTotal,
      };
    });
  }

  async createRedeemCode(
    groupJid: string,
    createdBy: string,
    rawCode: string,
    rewardLimit: number,
    rewardMoney: bigint,
    maxClaims = 20,
  ): Promise<GroupRedeemCode> {
    const code = rawCode.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,24}$/.test(code)) {
      throw new AppUserError(
        "Kode redeem harus 3 sampai 24 karakter huruf/angka (boleh pakai _ atau -). Contoh: SULTAN2026",
      );
    }
    if (!Number.isInteger(rewardLimit) || rewardLimit < 0 || rewardLimit > MAX_REDEEM_LIMIT) {
      throw new AppUserError(`Hadiah limit harus 0 sampai ${String(MAX_REDEEM_LIMIT)}.`);
    }
    if (rewardMoney < 0n || rewardMoney > MAX_REDEEM_MONEY) {
      throw new AppUserError(
        `Hadiah uang harus antara Rp 0 sampai ${formatRupiah(MAX_REDEEM_MONEY)}.`,
      );
    }
    if (rewardLimit === 0 && rewardMoney === 0n) {
      throw new AppUserError("Minimal hadiah limit atau hadiah uang harus lebih dari 0.");
    }
    if (!Number.isInteger(maxClaims) || maxClaims < 1 || maxClaims > MAX_REDEEM_CLAIMS) {
      throw new AppUserError(`Kuota klaim harus antara 1 sampai ${String(MAX_REDEEM_CLAIMS)}.`);
    }

    const existing = await this.redeemRepo.findByGroupAndCode(groupJid, code);
    if (existing) {
      throw new AppUserError(`Kode "${code}" sudah pernah dibuat di grup ini. Gunakan kode lain.`);
    }

    return this.redeemRepo.create({
      groupJid,
      code,
      rewardLimit,
      rewardMoney,
      maxClaims,
      createdBy,
    });
  }

  async listRedeemCodes(groupJid: string): Promise<RedeemCodeSummary[]> {
    const records = await this.redeemRepo.listByGroup(groupJid, 15);
    return records.map((item) => ({
      code: item.code,
      rewardLimit: item.rewardLimit,
      rewardMoney: item.rewardMoney,
      maxClaims: item.maxClaims,
      claimsUsed: parseClaimedJids(item.claimedByJids).length,
    }));
  }

  async redeemCode(
    groupJid: string,
    userJid: string,
    rawCode: string,
    now: Date = new Date(),
  ): Promise<RedeemResult> {
    const code = rawCode.trim().toUpperCase();
    if (!code) {
      throw new AppUserError("Masukkan kode redeem. Contoh: .redeem SULTAN2026");
    }

    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const record = await this.redeemRepo.findByGroupAndCode(groupJid, code, tx);
      if (!record) {
        throw new AppUserError(`Kode redeem "${code}" tidak ditemukan di grup ini.`);
      }
      if (record.expiresAt && record.expiresAt.getTime() <= now.getTime()) {
        throw new AppUserError(`Kode redeem "${code}" sudah kedaluwarsa.`);
      }

      const claimed = parseClaimedJids(record.claimedByJids);
      if (claimed.includes(userJid)) {
        throw new AppUserError(`Kamu sudah pernah mengklaim kode "${code}".`);
      }
      if (claimed.length >= record.maxClaims) {
        throw new AppUserError(`Kuota klaim untuk kode "${code}" sudah habis.`);
      }

      const nextClaimed = [...claimed, userJid];
      await this.redeemRepo.updateClaimedBy(record.id, nextClaimed, tx);

      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const moneyCredit = clampMoneyCredit(profile.moneyBalance, record.rewardMoney);

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          ...(record.rewardLimit > 0
            ? {
                limitBalance: { increment: record.rewardLimit },
                totalLimitsEarned: { increment: record.rewardLimit },
              }
            : {}),
          ...(moneyCredit > 0n
            ? {
                moneyBalance: { increment: moneyCredit },
                totalMoneyEarned: { increment: moneyCredit },
              }
            : {}),
          ...(record.rewardPoints > 0
            ? {
                pointsBalance: { increment: record.rewardPoints },
                totalPointsEarned: { increment: record.rewardPoints },
              }
            : {}),
        },
      });

      if (moneyCredit > 0n) {
        await this.txRepo.create(
          {
            profileId: profile.id,
            groupJid,
            userJid,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.BANSOS_REWARD,
            amount: moneyCredit,
            balanceBefore: profile.moneyBalance,
            balanceAfter: updated.moneyBalance,
            correlationId,
            note: `redeem:${code}`,
          },
          tx,
        );
      }

      if (record.rewardLimit > 0) {
        await this.txRepo.create(
          {
            profileId: profile.id,
            groupJid,
            userJid,
            asset: MemberTransactionAsset.LIMIT,
            type: MemberTransactionType.BANSOS_REWARD,
            amount: record.rewardLimit,
            balanceBefore: profile.limitBalance,
            balanceAfter: updated.limitBalance,
            correlationId,
            note: `redeem_limit:${code}`,
          },
          tx,
        );
      }

      return {
        code,
        rewardLimit: record.rewardLimit,
        rewardMoney: moneyCredit,
        rewardPoints: record.rewardPoints,
        claimsUsed: nextClaimed.length,
        maxClaims: record.maxClaims,
        currentLimit: updated.limitBalance,
        currentMoney: updated.moneyBalance,
      };
    });
  }
}

export const rpgExpansionService = new RpgExpansionService();
