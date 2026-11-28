import {
  MemberTransactionAsset,
  MemberTransactionType,
  Prisma,
  type GroupMemberProfile,
  type TenantGroup,
} from "@prisma/client";

import { AppUserError } from "../../errors/appUserError";
import { roleGuard } from "../../guards/roleGuard";
import {
  readGroupEventSection,
  writeGroupEventSection,
} from "../group/groupEventState.store";
import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { GroupMemberTransactionRepository } from "../../repositories/groupMemberTransaction.repository";
import { prisma } from "../../repositories/prismaClient";
import {
  absBigInt,
  clampMoneyCredit,
  formatRemainingDuration,
  formatRupiah,
  MAX_SAFE_MONEY_BIGINT,
  minBigInt,
} from "../../utils/currency";
import { normalizeUserJid } from "../../utils/jid";
import { generateCorrelationId, MAX_SAFE_ECONOMY_INT } from "../member/memberEconomy.service";
import { defaultRandom, type RandomProvider } from "../member/randomProvider";
import { PET_LABELS } from "./rpgCatalog";
import { DEFAULT_GROUP_TREASURY } from "./rpgEconomy.service";
import {
  getRemainingCooldownMs,
  parseRpgState,
  PET_TYPES,
  serializeRpgState,
  withCrateDelta,
  withDonatedAdded,
  withPetState,
  withUpdatedCooldown,
  type MemberRpgState,
  type PetType,
} from "./rpgState";

export const DANA_KAGET_MIN_AMOUNT = 500_000n;
export const DANA_KAGET_MAX_AMOUNT = 200_000_000n;
export const DANA_KAGET_MIN_QUOTA = 2;
export const DANA_KAGET_MAX_QUOTA = 30;
export const DANA_KAGET_TTL_MS = 30 * 60 * 1000;

export const POIN_KAGET_MIN_AMOUNT = 50;
export const POIN_KAGET_MAX_AMOUNT = 100_000;

export const TRAKTIR_MIN_AMOUNT = 500_000n;
export const TRAKTIR_MAX_AMOUNT = 200_000_000n;
export const TRAKTIR_MAX_RECIPIENTS = 10;

export const LOTTERY_TICKET_PRICE = 1_000_000n;
export const LOTTERY_BASE_SEED_POOL = 3_000_000n;
export const LOTTERY_MAX_TICKETS_PER_USER = 3;

export const ARENA_MIN_BET = 100_000n;
export const ARENA_MAX_BET = 15_000_000n;
export const ARENA_COOLDOWN_MS = 10_000;

export const POINT_DUEL_MIN_BET = 10;
export const POINT_DUEL_MAX_BET = 5_000;
export const POINT_DUEL_TTL_MS = 3 * 60 * 1000;

export const PET_ARENA_MIN_BET = 500_000n;
export const PET_ARENA_MAX_BET = 15_000_000n;
export const PET_ARENA_COOLDOWN_MS = 4 * 60 * 1000;
const MAX_PET_LEVEL = 20;

export const POINT_SHOP_XP_PER_POINT = 3;
export const POINT_SHOP_MIN_XP_POINTS = 10;
export const POINT_SHOP_MAX_XP_POINTS = 10_000;
export const POINT_SHOP_CRATE_PRICES: Record<"common" | "uncommon" | "mythic", number> = {
  common: 60,
  uncommon: 180,
  mythic: 500,
};

export const SEDEKAH_MIN_AMOUNT = 500_000n;
export const SEDEKAH_MAX_AMOUNT = 200_000_000n;
export const SEDEKAH_COOLDOWN_MS = 20 * 60 * 1000;

const MAX_ACTIVE_GROUPS = 100;

const HORSE_NAMES = [
  "Kilat Merah",
  "Petir Hitam",
  "Badai Emas",
  "Topan Biru",
  "Pangeran Salju",
] as const;

const SNAIL_NAMES = [
  "Turbo Lendir",
  "Siput Ngesot",
  "Keong Racun",
  "Rossi Cangkang",
  "Siput Nitro",
] as const;

export type ColorWheelChoice = "merah" | "biru" | "hijau" | "emas";
export type CockfightSide = "merah" | "putih";
export type PointShopCrateKey = "common" | "uncommon" | "mythic";

export interface ActiveDanaKaget {
  groupJid: string;
  creatorJid: string;
  totalAmount: bigint;
  remainingAmount: bigint;
  totalQuota: number;
  remainingQuota: number;
  claimedBy: Map<string, bigint>;
  createdAt: number;
  expiresAt: number;
}

export interface ActivePoinKaget {
  groupJid: string;
  creatorJid: string;
  totalPoints: number;
  remainingPoints: number;
  totalQuota: number;
  remainingQuota: number;
  claimedBy: Map<string, number>;
  createdAt: number;
  expiresAt: number;
}

export interface DanaKagetClaimResult {
  creatorJid: string;
  amountWon: bigint;
  remainingAmount: bigint;
  remainingQuota: number;
  totalQuota: number;
  finished: boolean;
  xpGained: number;
  currentMoney: bigint;
}

export interface PoinKagetClaimResult {
  creatorJid: string;
  pointsWon: number;
  remainingPoints: number;
  remainingQuota: number;
  totalQuota: number;
  finished: boolean;
  xpGained: number;
  currentPoints: number;
}

export interface TraktirResult {
  totalSpent: bigint;
  shareEach: bigint;
  recipients: string[];
  xpGained: number;
  currentMoney: bigint;
}

export interface LotteryTicketEntry {
  userJid: string;
  number: number;
}

export interface GroupLotteryState {
  groupJid: string;
  roundNumber: number;
  jackpotPool: bigint;
  tickets: LotteryTicketEntry[];
  lastWinningNumber: number | null;
  lastWinners: string[];
  lastPayoutEach: bigint;
  lastOutcome: "jackpot" | "consolation" | "rollover" | null;
}

export interface LotteryBuyResult {
  roundNumber: number;
  number: number;
  pricePaid: bigint;
  jackpotPool: bigint;
  userTicketCount: number;
  totalTickets: number;
  currentMoney: bigint;
}

export interface LotteryDrawResult {
  roundNumber: number;
  winningNumber: number;
  outcome: "jackpot" | "consolation" | "rollover";
  winners: { userJid: string; ticketNumber: number; payout: bigint }[];
  totalPaid: bigint;
  nextJackpotPool: bigint;
}

export interface RaceResult {
  kind: "kuda" | "siput";
  pickedLane: number;
  winnerLane: number;
  won: boolean;
  bet: bigint;
  netDelta: bigint;
  xpGained: number;
  lanes: { lane: number; name: string; progress: number }[];
  currentMoney: bigint;
}

export interface CockfightResult {
  pickedSide: CockfightSide;
  winnerSide: CockfightSide;
  won: boolean;
  bet: bigint;
  netDelta: bigint;
  xpGained: number;
  story: string;
  currentMoney: bigint;
}

export interface ColorWheelResult {
  pickedColor: ColorWheelChoice;
  landedColor: ColorWheelChoice;
  won: boolean;
  isJackpotGold: boolean;
  bet: bigint;
  netDelta: bigint;
  xpGained: number;
  currentMoney: bigint;
}

export interface PendingPointDuel {
  groupJid: string;
  challengerJid: string;
  opponentJid: string;
  betPoints: number;
  expiresAt: number;
}

export interface PointDuelResolution {
  challengerJid: string;
  opponentJid: string;
  winnerJid: string;
  loserJid: string;
  challengerRoll: number;
  opponentRoll: number;
  betPoints: number;
  winnerPoints: number;
  loserPoints: number;
  winnerXp: number;
  loserXp: number;
}

export interface PetArenaResult {
  challengerJid: string;
  opponentJid: string;
  challengerPet: { id: PetType; label: string; level: number; power: number };
  opponentPet: { id: PetType; label: string; level: number; power: number };
  winnerJid: string;
  loserJid: string;
  bet: bigint;
  winnerPetExpGained: number;
  winnerPetLeveledUp: boolean;
  winnerPetNewLevel: number;
  winnerMoney: bigint;
  loserMoney: bigint;
}

export interface BuyXpResult {
  pointsSpent: number;
  xpGained: number;
  currentPoints: number;
  currentXp: number;
}

export interface BuyCratePointResult {
  crate: PointShopCrateKey;
  quantity: number;
  pointsSpent: number;
  currentPoints: number;
  ownedCrates: number;
}

export interface SedekahResult {
  amountDonated: bigint;
  xpGained: number;
  totalDonatedAllTime: bigint;
  currentMoney: bigint;
  treasuryBalance: bigint;
}

interface ArenaProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
  listRecentActiveProfiles(
    groupJid: string,
    excludeUserJid: string,
    limit?: number,
  ): Promise<GroupMemberProfile[]>;
}

interface ArenaTxStore {
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
      idempotencyKey?: string;
      note?: string;
    },
    tx?: unknown,
  ): Promise<unknown>;
  findByIdempotencyKey?(key: string): Promise<object | null>;
}

interface ArenaTx {
  groupMemberProfile: {
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<GroupMemberProfile>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    findUniqueOrThrow(args: { where: Record<string, unknown> }): Promise<GroupMemberProfile>;
  };
  tenantGroup?: {
    findUnique(args: { where: { groupJid: string } }): Promise<TenantGroup | null>;
    update(args: {
      where: { groupJid: string };
      data: Record<string, unknown>;
    }): Promise<TenantGroup>;
  };
}

interface ArenaDb {
  $transaction<T>(fn: (tx: ArenaTx) => Promise<T>): Promise<T>;
  tenantGroup?: {
    findUnique(args: { where: { groupJid: string } }): Promise<TenantGroup | null>;
    findMany?(args?: {
      where?: { groupEventState?: { not: typeof Prisma.DbNull } };
      select?: { groupJid: true; groupEventState: true };
    }): Promise<Pick<TenantGroup, "groupJid" | "groupEventState">[]>;
    update?(args: {
      where: { groupJid: string };
      data: Record<string, unknown>;
    }): Promise<TenantGroup>;
  };
}

function evictOldestIfNeeded<K, V>(map: Map<K, V>, maxEntries: number): void {
  while (map.size >= maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}

function getStrongestPet(state: MemberRpgState): { id: PetType; level: number; exp: number } | null {
  let best: { id: PetType; level: number; exp: number } | null = null;
  for (const petKey of PET_TYPES) {
    const p = state.pets[petKey];
    if (p.level > 0) {
      if (!best || p.level > best.level || (p.level === best.level && p.exp > best.exp)) {
        best = { id: petKey, level: p.level, exp: p.exp };
      }
    }
  }
  return best;
}

function parsePersistedLotterySection(
  groupJid: string,
  raw: unknown,
): GroupLotteryState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const roundNumber =
    typeof obj.roundNumber === "number" && Number.isInteger(obj.roundNumber) && obj.roundNumber >= 1
      ? obj.roundNumber
      : 1;
  const jackpotPool =
    typeof obj.jackpotPool === "string" && /^\d+$/.test(obj.jackpotPool)
      ? BigInt(obj.jackpotPool)
      : LOTTERY_BASE_SEED_POOL;
  const tickets: LotteryTicketEntry[] = [];
  if (Array.isArray(obj.tickets)) {
    for (const item of obj.tickets) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const t = item as Record<string, unknown>;
      if (
        typeof t.userJid === "string" &&
        t.userJid.length > 0 &&
        typeof t.number === "number" &&
        Number.isInteger(t.number) &&
        t.number >= 0 &&
        t.number <= 99
      ) {
        tickets.push({ userJid: t.userJid, number: t.number });
      }
    }
  }
  const lastWinningNumber =
    typeof obj.lastWinningNumber === "number" &&
    Number.isInteger(obj.lastWinningNumber) &&
    obj.lastWinningNumber >= 0 &&
    obj.lastWinningNumber <= 99
      ? obj.lastWinningNumber
      : null;
  const lastWinners: string[] = [];
  if (Array.isArray(obj.lastWinners)) {
    for (const w of obj.lastWinners) {
      if (typeof w === "string" && w.length > 0) {
        lastWinners.push(w);
      }
    }
  }
  const lastPayoutEach =
    typeof obj.lastPayoutEach === "string" && /^\d+$/.test(obj.lastPayoutEach)
      ? BigInt(obj.lastPayoutEach)
      : 0n;
  const lastOutcome: GroupLotteryState["lastOutcome"] =
    obj.lastOutcome === "jackpot" ||
    obj.lastOutcome === "consolation" ||
    obj.lastOutcome === "rollover"
      ? obj.lastOutcome
      : null;

  return {
    groupJid,
    roundNumber,
    jackpotPool,
    tickets,
    lastWinningNumber,
    lastWinners,
    lastPayoutEach,
    lastOutcome,
  };
}

function serializePersistedLotterySection(state: GroupLotteryState): Prisma.InputJsonValue {
  return {
    roundNumber: state.roundNumber,
    jackpotPool: state.jackpotPool.toString(),
    tickets: state.tickets.map((t) => ({ userJid: t.userJid, number: t.number })),
    lastWinningNumber: state.lastWinningNumber,
    lastWinners: state.lastWinners.slice(0, 20),
    lastPayoutEach: state.lastPayoutEach.toString(),
    lastOutcome: state.lastOutcome,
  };
}

function parsePersistedDropsSection(
  groupJid: string,
  raw: unknown,
): { dana: ActiveDanaKaget | null; poin: ActivePoinKaget | null } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { dana: null, poin: null };
  }
  const obj = raw as Record<string, unknown>;

  let dana: ActiveDanaKaget | null = null;
  if (obj.dana && typeof obj.dana === "object" && !Array.isArray(obj.dana)) {
    const d = obj.dana as Record<string, unknown>;
    if (
      typeof d.creatorJid === "string" &&
      d.creatorJid.length > 0 &&
      typeof d.totalAmount === "string" &&
      /^\d+$/.test(d.totalAmount) &&
      typeof d.remainingAmount === "string" &&
      /^\d+$/.test(d.remainingAmount) &&
      typeof d.totalQuota === "number" &&
      typeof d.remainingQuota === "number" &&
      typeof d.createdAt === "number" &&
      typeof d.expiresAt === "number"
    ) {
      const claimedBy = new Map<string, bigint>();
      if (d.claimedBy && typeof d.claimedBy === "object" && !Array.isArray(d.claimedBy)) {
        for (const [jid, amt] of Object.entries(d.claimedBy as Record<string, unknown>)) {
          if (typeof amt === "string" && /^\d+$/.test(amt)) {
            claimedBy.set(jid, BigInt(amt));
          }
        }
      }
      dana = {
        groupJid,
        creatorJid: d.creatorJid,
        totalAmount: BigInt(d.totalAmount),
        remainingAmount: BigInt(d.remainingAmount),
        totalQuota: Math.max(1, Math.floor(d.totalQuota)),
        remainingQuota: Math.max(0, Math.floor(d.remainingQuota)),
        claimedBy,
        createdAt: Math.floor(d.createdAt),
        expiresAt: Math.floor(d.expiresAt),
      };
    }
  }

  let poin: ActivePoinKaget | null = null;
  if (obj.poin && typeof obj.poin === "object" && !Array.isArray(obj.poin)) {
    const p = obj.poin as Record<string, unknown>;
    if (
      typeof p.creatorJid === "string" &&
      p.creatorJid.length > 0 &&
      typeof p.totalPoints === "number" &&
      typeof p.remainingPoints === "number" &&
      typeof p.totalQuota === "number" &&
      typeof p.remainingQuota === "number" &&
      typeof p.createdAt === "number" &&
      typeof p.expiresAt === "number"
    ) {
      const claimedBy = new Map<string, number>();
      if (p.claimedBy && typeof p.claimedBy === "object" && !Array.isArray(p.claimedBy)) {
        for (const [jid, pts] of Object.entries(p.claimedBy as Record<string, unknown>)) {
          if (typeof pts === "number" && Number.isFinite(pts) && pts >= 0) {
            claimedBy.set(jid, Math.floor(pts));
          }
        }
      }
      poin = {
        groupJid,
        creatorJid: p.creatorJid,
        totalPoints: Math.max(1, Math.floor(p.totalPoints)),
        remainingPoints: Math.max(0, Math.floor(p.remainingPoints)),
        totalQuota: Math.max(1, Math.floor(p.totalQuota)),
        remainingQuota: Math.max(0, Math.floor(p.remainingQuota)),
        claimedBy,
        createdAt: Math.floor(p.createdAt),
        expiresAt: Math.floor(p.expiresAt),
      };
    }
  }

  return { dana, poin };
}

function serializePersistedDropsSection(
  dana: ActiveDanaKaget | null,
  poin: ActivePoinKaget | null,
): Prisma.InputJsonValue | null {
  if (!dana && !poin) return null;

  const danaClaimed: Record<string, string> = {};
  if (dana) {
    for (const [jid, amt] of dana.claimedBy.entries()) {
      danaClaimed[jid] = amt.toString();
    }
  }

  const poinClaimed: Record<string, number> = {};
  if (poin) {
    for (const [jid, pts] of poin.claimedBy.entries()) {
      poinClaimed[jid] = pts;
    }
  }

  return {
    dana: dana
      ? {
          creatorJid: dana.creatorJid,
          totalAmount: dana.totalAmount.toString(),
          remainingAmount: dana.remainingAmount.toString(),
          totalQuota: dana.totalQuota,
          remainingQuota: dana.remainingQuota,
          claimedBy: danaClaimed,
          createdAt: dana.createdAt,
          expiresAt: dana.expiresAt,
        }
      : null,
    poin: poin
      ? {
          creatorJid: poin.creatorJid,
          totalPoints: poin.totalPoints,
          remainingPoints: poin.remainingPoints,
          totalQuota: poin.totalQuota,
          remainingQuota: poin.remainingQuota,
          claimedBy: poinClaimed,
          createdAt: poin.createdAt,
          expiresAt: poin.expiresAt,
        }
      : null,
  };
}

export class ArenaGiveawayShopService {
  private readonly danaDrops = new Map<string, ActiveDanaKaget>();
  private readonly poinDrops = new Map<string, ActivePoinKaget>();
  private readonly hydratedDropsGroups = new Set<string>();
  private readonly lotteries = new Map<string, GroupLotteryState>();
  private readonly hydratedLotteryGroups = new Set<string>();
  private readonly pendingPointDuels = new Map<string, PendingPointDuel>();

  constructor(
    private readonly profileRepo: ArenaProfileStore = new GroupMemberProfileRepository(),
    private readonly txRepo: ArenaTxStore = new GroupMemberTransactionRepository(),
    private readonly random: RandomProvider = defaultRandom,
    private readonly db: ArenaDb = prisma,
  ) {}

  private async hydrateDropsState(groupJid: string): Promise<void> {
    if (this.hydratedDropsGroups.has(groupJid)) return;
    this.hydratedDropsGroups.add(groupJid);

    const raw = await readGroupEventSection(this.db.tenantGroup, groupJid, "drops");
    if (!raw) return;
    const parsed = parsePersistedDropsSection(groupJid, raw);
    if (parsed.dana) {
      evictOldestIfNeeded(this.danaDrops, MAX_ACTIVE_GROUPS);
      this.danaDrops.set(groupJid, parsed.dana);
    }
    if (parsed.poin) {
      evictOldestIfNeeded(this.poinDrops, MAX_ACTIVE_GROUPS);
      this.poinDrops.set(groupJid, parsed.poin);
    }
  }

  private async persistDropsState(groupJid: string): Promise<void> {
    const payload = serializePersistedDropsSection(
      this.danaDrops.get(groupJid) ?? null,
      this.poinDrops.get(groupJid) ?? null,
    );
    await writeGroupEventSection(this.db.tenantGroup, groupJid, "drops", payload);
  }

  async refundExpiredDropsForGroup(
    groupJid: string,
    nowMs = Date.now(),
  ): Promise<{ moneyRefunded: bigint; pointsRefunded: number }> {
    await this.hydrateDropsState(groupJid);
    let moneyRefunded = 0n;
    let pointsRefunded = 0;
    let changed = false;

    const dana = this.danaDrops.get(groupJid);
    if (dana && (dana.expiresAt <= nowMs || dana.remainingQuota <= 0 || dana.remainingAmount <= 0n)) {
      this.danaDrops.delete(groupJid);
      changed = true;

      if (dana.remainingAmount > 0n) {
        const idempotencyKey = `refund:danakaget:${groupJid}:${String(dana.createdAt)}`;
        try {
          const alreadyRefunded = this.txRepo.findByIdempotencyKey
            ? await this.txRepo.findByIdempotencyKey(idempotencyKey)
            : null;
          if (!alreadyRefunded) {
            const correlationId = generateCorrelationId();
            moneyRefunded = await this.db.$transaction(async (tx) => {
              const creator = await this.profileRepo.findOrCreate(groupJid, dana.creatorJid, tx);
              const refundCredit = clampMoneyCredit(creator.moneyBalance, dana.remainingAmount);
              if (refundCredit <= 0n) return 0n;
              const saved = await tx.groupMemberProfile.update({
                where: { id: creator.id },
                data: { moneyBalance: { increment: refundCredit } },
              });
              await this.txRepo.create(
                {
                  profileId: creator.id,
                  groupJid,
                  userJid: dana.creatorJid,
                  asset: MemberTransactionAsset.MONEY,
                  type: MemberTransactionType.CORRECTION,
                  amount: refundCredit,
                  balanceBefore: creator.moneyBalance,
                  balanceAfter: saved.moneyBalance,
                  correlationId,
                  idempotencyKey,
                  note: "danakaget_expired_refund",
                },
                tx,
              );
              return refundCredit;
            });
          }
        } catch (error: unknown) {
          this.danaDrops.set(groupJid, dana);
          throw error;
        }
      }
    }

    const poin = this.poinDrops.get(groupJid);
    if (poin && (poin.expiresAt <= nowMs || poin.remainingQuota <= 0 || poin.remainingPoints <= 0)) {
      this.poinDrops.delete(groupJid);
      changed = true;

      if (poin.remainingPoints > 0) {
        const idempotencyKey = `refund:poinkaget:${groupJid}:${String(poin.createdAt)}`;
        try {
          const alreadyRefunded = this.txRepo.findByIdempotencyKey
            ? await this.txRepo.findByIdempotencyKey(idempotencyKey)
            : null;
          if (!alreadyRefunded) {
            const correlationId = generateCorrelationId();
            pointsRefunded = await this.db.$transaction(async (tx) => {
              const creator = await this.profileRepo.findOrCreate(groupJid, poin.creatorJid, tx);
              const safeRefund = Math.min(
                poin.remainingPoints,
                Math.max(0, MAX_SAFE_ECONOMY_INT - creator.pointsBalance),
              );
              if (safeRefund <= 0) return 0;
              const saved = await tx.groupMemberProfile.update({
                where: { id: creator.id },
                data: { pointsBalance: { increment: safeRefund } },
              });
              await this.txRepo.create(
                {
                  profileId: creator.id,
                  groupJid,
                  userJid: poin.creatorJid,
                  asset: MemberTransactionAsset.POINT,
                  type: MemberTransactionType.CORRECTION,
                  amount: safeRefund,
                  balanceBefore: creator.pointsBalance,
                  balanceAfter: saved.pointsBalance,
                  correlationId,
                  idempotencyKey,
                  note: "poinkaget_expired_refund",
                },
                tx,
              );
              return safeRefund;
            });
          }
        } catch (error: unknown) {
          this.poinDrops.set(groupJid, poin);
          throw error;
        }
      }
    }

    if (changed) {
      await this.persistDropsState(groupJid);
    }

    return { moneyRefunded, pointsRefunded };
  }

  async reconcileExpiredDropsAcrossGroups(
    nowMs = Date.now(),
  ): Promise<{ groupsChecked: number; refundedDrops: number }> {
    const groupJids = new Set<string>([
      ...this.danaDrops.keys(),
      ...this.poinDrops.keys(),
    ]);

    if (this.db.tenantGroup?.findMany) {
      try {
        const rows = await this.db.tenantGroup.findMany({
          where: { groupEventState: { not: Prisma.DbNull } },
          select: { groupJid: true, groupEventState: true },
        });
        for (const row of rows) {
          const raw = row.groupEventState;
          if (raw && typeof raw === "object" && !Array.isArray(raw) && "drops" in raw) {
            groupJids.add(row.groupJid);
          }
        }
      } catch {
        // Fallback aman jika mock tenantGroup tidak mendukung filter findMany
      }
    }

    let refundedDrops = 0;
    for (const gJid of groupJids) {
      const res = await this.refundExpiredDropsForGroup(gJid, nowMs);
      if (res.moneyRefunded > 0n) refundedDrops += 1;
      if (res.pointsRefunded > 0) refundedDrops += 1;
    }

    return { groupsChecked: groupJids.size, refundedDrops };
  }

  private async hydrateLotteryState(groupJid: string): Promise<void> {
    if (this.hydratedLotteryGroups.has(groupJid)) return;
    this.hydratedLotteryGroups.add(groupJid);

    const raw = await readGroupEventSection(this.db.tenantGroup, groupJid, "lottery");
    if (!raw) return;
    const parsed = parsePersistedLotterySection(groupJid, raw);
    if (parsed) {
      evictOldestIfNeeded(this.lotteries, MAX_ACTIVE_GROUPS);
      this.lotteries.set(groupJid, parsed);
    }
  }

  private async persistLotteryState(groupJid: string): Promise<void> {
    const state = this.lotteries.get(groupJid);
    if (!state) return;
    await writeGroupEventSection(
      this.db.tenantGroup,
      groupJid,
      "lottery",
      serializePersistedLotterySection(state),
    );
  }

  // ======================== 1. DANA KAGET, POIN KAGET & TRAKTIR ========================

  async createDanaKaget(
    groupJid: string,
    creatorJid: string,
    totalAmount: bigint,
    quota: number,
    nowMs = Date.now(),
  ): Promise<ActiveDanaKaget> {
    await this.refundExpiredDropsForGroup(groupJid, nowMs);
    const normCreator = normalizeUserJid(creatorJid);
    if (totalAmount < DANA_KAGET_MIN_AMOUNT || totalAmount > DANA_KAGET_MAX_AMOUNT) {
      throw new AppUserError(
        `Nominal Dana Kaget harus antara ${formatRupiah(DANA_KAGET_MIN_AMOUNT)} sampai ${formatRupiah(DANA_KAGET_MAX_AMOUNT)}.`,
      );
    }
    if (!Number.isInteger(quota) || quota < DANA_KAGET_MIN_QUOTA || quota > DANA_KAGET_MAX_QUOTA) {
      throw new AppUserError(
        `Kuota penerima Dana Kaget harus antara ${String(DANA_KAGET_MIN_QUOTA)} sampai ${String(DANA_KAGET_MAX_QUOTA)} orang.`,
      );
    }

    const existing = this.danaDrops.get(groupJid);
    if (existing && existing.remainingQuota > 0 && existing.expiresAt > nowMs) {
      throw new AppUserError(
        `Masih ada Dana Kaget aktif di grup ini (sisa ${String(existing.remainingQuota)} slot). Ketik *.ambilkaget* dulu!`,
      );
    }

    const correlationId = generateCorrelationId();
    await this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normCreator, tx);
      if (profile.moneyBalance < totalAmount) {
        throw new AppUserError(
          `Dompetmu kurang! Butuh ${formatRupiah(totalAmount)}, dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const nextState = withDonatedAdded(parseRpgState(profile.rpgState), totalAmount);
      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: totalAmount } },
        data: {
          moneyBalance: { decrement: totalAmount },
          experience: { increment: 24 },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Saldo dompet tidak mencukupi saat membuat Dana Kaget.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid: normCreator,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.GIFT_SENT,
          amount: -totalAmount,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: `danakaget_create_q${String(quota)}`,
        },
        tx,
      );
    });

    evictOldestIfNeeded(this.danaDrops, MAX_ACTIVE_GROUPS);
    const drop: ActiveDanaKaget = {
      groupJid,
      creatorJid: normCreator,
      totalAmount,
      remainingAmount: totalAmount,
      totalQuota: quota,
      remainingQuota: quota,
      claimedBy: new Map(),
      createdAt: nowMs,
      expiresAt: nowMs + DANA_KAGET_TTL_MS,
    };
    this.danaDrops.set(groupJid, drop);
    await this.persistDropsState(groupJid);
    return drop;
  }

  async claimDanaKaget(
    groupJid: string,
    claimerJid: string,
    nowMs = Date.now(),
  ): Promise<DanaKagetClaimResult> {
    await this.refundExpiredDropsForGroup(groupJid, nowMs);
    const normClaimer = normalizeUserJid(claimerJid);
    const drop = this.danaDrops.get(groupJid);
    if (!drop || drop.remainingQuota <= 0 || drop.expiresAt <= nowMs) {
      this.danaDrops.delete(groupJid);
      throw new AppUserError(
        "Belum ada Dana Kaget aktif di grup ini. Buat dengan *.danakaget <uang> <kuota>*!",
      );
    }
    if (drop.creatorJid === normClaimer) {
      throw new AppUserError("Pembuat Dana Kaget tidak bisa mengambil ampaonya sendiri!");
    }
    if (drop.claimedBy.has(normClaimer)) {
      throw new AppUserError("Kamu sudah kebagian Dana Kaget ini! Sisakan untuk yang lain.");
    }

    const slice = this.computeRandomBigIntSlice(drop.remainingAmount, drop.remainingQuota, 1_000n);
    const prevRemAmount = drop.remainingAmount;
    const prevRemQuota = drop.remainingQuota;

    // Optimistically reserve slot synchronously to block concurrent double-claim in event loop
    drop.claimedBy.set(normClaimer, slice);
    drop.remainingAmount -= slice;
    drop.remainingQuota -= 1;

    const correlationId = generateCorrelationId();
    const xpGained = 12;

    try {
      const updated = await this.db.$transaction(async (tx) => {
        const profile = await this.profileRepo.findOrCreate(groupJid, normClaimer, tx);
        const credit = clampMoneyCredit(profile.moneyBalance, slice);
        const saved = await tx.groupMemberProfile.update({
          where: { id: profile.id },
          data: {
            moneyBalance: { increment: credit },
            totalMoneyEarned: { increment: credit },
            experience: { increment: xpGained },
          },
        });
        await this.txRepo.create(
          {
            profileId: profile.id,
            groupJid,
            userJid: normClaimer,
            actorJid: drop.creatorJid,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.GIFT_RECEIVED,
            amount: credit,
            balanceBefore: profile.moneyBalance,
            balanceAfter: saved.moneyBalance,
            correlationId,
            note: "danakaget_claim",
          },
          tx,
        );
        return saved;
      });

      const finished = drop.remainingQuota <= 0;
      if (finished) {
        this.danaDrops.delete(groupJid);
      }
      await this.persistDropsState(groupJid);

      return {
        creatorJid: drop.creatorJid,
        amountWon: slice,
        remainingAmount: drop.remainingAmount,
        remainingQuota: drop.remainingQuota,
        totalQuota: drop.totalQuota,
        finished,
        xpGained,
        currentMoney: updated.moneyBalance,
      };
    } catch (error: unknown) {
      // Roll back reservation if DB fails
      drop.claimedBy.delete(normClaimer);
      drop.remainingAmount = prevRemAmount;
      drop.remainingQuota = prevRemQuota;
      throw error;
    }
  }

  async createPoinKaget(
    groupJid: string,
    creatorJid: string,
    totalPoints: number,
    quota: number,
    nowMs = Date.now(),
  ): Promise<ActivePoinKaget> {
    await this.refundExpiredDropsForGroup(groupJid, nowMs);
    const normCreator = normalizeUserJid(creatorJid);
    if (
      !Number.isInteger(totalPoints) ||
      totalPoints < POIN_KAGET_MIN_AMOUNT ||
      totalPoints > POIN_KAGET_MAX_AMOUNT
    ) {
      throw new AppUserError(
        `Jumlah Poin Kaget harus antara ${String(POIN_KAGET_MIN_AMOUNT)} sampai ${POIN_KAGET_MAX_AMOUNT.toLocaleString("id-ID")} Poin.`,
      );
    }
    if (!Number.isInteger(quota) || quota < DANA_KAGET_MIN_QUOTA || quota > DANA_KAGET_MAX_QUOTA) {
      throw new AppUserError(
        `Kuota penerima Poin Kaget harus antara ${String(DANA_KAGET_MIN_QUOTA)} sampai ${String(DANA_KAGET_MAX_QUOTA)} orang.`,
      );
    }
    if (totalPoints < quota) {
      throw new AppUserError("Total poin harus minimal sama dengan jumlah kuota penerima.");
    }

    const existing = this.poinDrops.get(groupJid);
    if (existing && existing.remainingQuota > 0 && existing.expiresAt > nowMs) {
      throw new AppUserError(
        `Masih ada Poin Kaget aktif di grup ini (sisa ${String(existing.remainingQuota)} slot). Ketik *.ambilpoin*!`,
      );
    }

    const correlationId = generateCorrelationId();
    await this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normCreator, tx);
      if (profile.pointsBalance < totalPoints) {
        throw new AppUserError(
          `Poinmu tidak cukup! Butuh ${totalPoints.toLocaleString("id-ID")} Poin, saldomu: ${profile.pointsBalance.toLocaleString("id-ID")} Poin.`,
        );
      }

      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, pointsBalance: { gte: totalPoints } },
        data: {
          pointsBalance: { decrement: totalPoints },
          experience: { increment: 18 },
        },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Saldo poin tidak mencukupi saat membuat Poin Kaget.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid: normCreator,
          asset: MemberTransactionAsset.POINT,
          type: MemberTransactionType.GIFT_SENT,
          amount: -totalPoints,
          balanceBefore: profile.pointsBalance,
          balanceAfter: updated.pointsBalance,
          correlationId,
          note: `poinkaget_create_q${String(quota)}`,
        },
        tx,
      );
    });

    evictOldestIfNeeded(this.poinDrops, MAX_ACTIVE_GROUPS);
    const drop: ActivePoinKaget = {
      groupJid,
      creatorJid: normCreator,
      totalPoints,
      remainingPoints: totalPoints,
      totalQuota: quota,
      remainingQuota: quota,
      claimedBy: new Map(),
      createdAt: nowMs,
      expiresAt: nowMs + DANA_KAGET_TTL_MS,
    };
    this.poinDrops.set(groupJid, drop);
    await this.persistDropsState(groupJid);
    return drop;
  }

  async claimPoinKaget(
    groupJid: string,
    claimerJid: string,
    nowMs = Date.now(),
  ): Promise<PoinKagetClaimResult> {
    await this.refundExpiredDropsForGroup(groupJid, nowMs);
    const normClaimer = normalizeUserJid(claimerJid);
    const drop = this.poinDrops.get(groupJid);
    if (!drop || drop.remainingQuota <= 0 || drop.expiresAt <= nowMs) {
      this.poinDrops.delete(groupJid);
      throw new AppUserError(
        "Belum ada Poin Kaget aktif di grup ini. Buat dengan *.poinkaget <poin> <kuota>*!",
      );
    }
    if (drop.creatorJid === normClaimer) {
      throw new AppUserError("Pembuat Poin Kaget tidak bisa mengambil bagiannya sendiri!");
    }
    if (drop.claimedBy.has(normClaimer)) {
      throw new AppUserError("Kamu sudah mengambil Poin Kaget ronde ini!");
    }

    const slice = this.computeRandomIntSlice(drop.remainingPoints, drop.remainingQuota);
    const prevRemPts = drop.remainingPoints;
    const prevRemQuota = drop.remainingQuota;

    drop.claimedBy.set(normClaimer, slice);
    drop.remainingPoints -= slice;
    drop.remainingQuota -= 1;

    const correlationId = generateCorrelationId();
    const xpGained = 9;

    try {
      const updated = await this.db.$transaction(async (tx) => {
        const profile = await this.profileRepo.findOrCreate(groupJid, normClaimer, tx);
        const safeGain = Math.min(slice, Math.max(0, MAX_SAFE_ECONOMY_INT - profile.pointsBalance));
        const saved = await tx.groupMemberProfile.update({
          where: { id: profile.id },
          data: {
            pointsBalance: { increment: safeGain },
            totalPointsEarned: { increment: safeGain },
            experience: { increment: xpGained },
          },
        });
        await this.txRepo.create(
          {
            profileId: profile.id,
            groupJid,
            userJid: normClaimer,
            actorJid: drop.creatorJid,
            asset: MemberTransactionAsset.POINT,
            type: MemberTransactionType.GIFT_RECEIVED,
            amount: safeGain,
            balanceBefore: profile.pointsBalance,
            balanceAfter: saved.pointsBalance,
            correlationId,
            note: "poinkaget_claim",
          },
          tx,
        );
        return saved;
      });

      const finished = drop.remainingQuota <= 0;
      if (finished) {
        this.poinDrops.delete(groupJid);
      }
      await this.persistDropsState(groupJid);

      return {
        creatorJid: drop.creatorJid,
        pointsWon: slice,
        remainingPoints: drop.remainingPoints,
        remainingQuota: drop.remainingQuota,
        totalQuota: drop.totalQuota,
        finished,
        xpGained,
        currentPoints: updated.pointsBalance,
      };
    } catch (error: unknown) {
      drop.claimedBy.delete(normClaimer);
      drop.remainingPoints = prevRemPts;
      drop.remainingQuota = prevRemQuota;
      throw error;
    }
  }

  async treatActiveMembers(
    groupJid: string,
    senderJid: string,
    totalAmount: bigint,
  ): Promise<TraktirResult> {
    const normSender = normalizeUserJid(senderJid);
    if (totalAmount < TRAKTIR_MIN_AMOUNT || totalAmount > TRAKTIR_MAX_AMOUNT) {
      throw new AppUserError(
        `Nominal traktir harus antara ${formatRupiah(TRAKTIR_MIN_AMOUNT)} sampai ${formatRupiah(TRAKTIR_MAX_AMOUNT)}.`,
      );
    }

    const candidates = await this.profileRepo.listRecentActiveProfiles(
      groupJid,
      normSender,
      TRAKTIR_MAX_RECIPIENTS + 5,
    );
    const recipients = candidates
      .filter((p) => !roleGuard.isSuperOwner(p.userJid))
      .slice(0, TRAKTIR_MAX_RECIPIENTS);

    if (recipients.length === 0) {
      throw new AppUserError(
        "Belum ada member aktif lain di grup untuk ditraktir. Ajak temanmu ngobrol dulu!",
      );
    }

    const shareEach = totalAmount / BigInt(recipients.length);
    if (shareEach <= 0n) {
      throw new AppUserError("Nominal traktir terlalu kecil untuk dibagi rata.");
    }
    const totalSpent = shareEach * BigInt(recipients.length);
    const xpGained = 30;
    const correlationId = generateCorrelationId();

    const senderAfter = await this.db.$transaction(async (tx) => {
      const sender = await this.profileRepo.findOrCreate(groupJid, normSender, tx);
      if (sender.moneyBalance < totalSpent) {
        throw new AppUserError(
          `Dompetmu kurang untuk traktir ${formatRupiah(totalSpent)} (dompet: ${formatRupiah(sender.moneyBalance)}).`,
        );
      }

      const nextState = withDonatedAdded(parseRpgState(sender.rpgState), totalSpent);
      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: sender.id, moneyBalance: { gte: totalSpent } },
        data: {
          moneyBalance: { decrement: totalSpent },
          experience: { increment: xpGained },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup saat memproses traktiran.");
      }
      const updatedSender = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: sender.id },
      });

      await this.txRepo.create(
        {
          profileId: sender.id,
          groupJid,
          userJid: normSender,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.GIFT_SENT,
          amount: -totalSpent,
          balanceBefore: sender.moneyBalance,
          balanceAfter: updatedSender.moneyBalance,
          correlationId,
          note: `traktir_${String(recipients.length)}org`,
        },
        tx,
      );

      for (const rec of recipients) {
        const freshRec = await this.profileRepo.findOrCreate(groupJid, rec.userJid, tx);
        const credit = clampMoneyCredit(freshRec.moneyBalance, shareEach);
        const updatedRec = await tx.groupMemberProfile.update({
          where: { id: freshRec.id },
          data: {
            moneyBalance: { increment: credit },
            totalMoneyEarned: { increment: credit },
          },
        });
        await this.txRepo.create(
          {
            profileId: freshRec.id,
            groupJid,
            userJid: freshRec.userJid,
            actorJid: normSender,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.GIFT_RECEIVED,
            amount: credit,
            balanceBefore: freshRec.moneyBalance,
            balanceAfter: updatedRec.moneyBalance,
            correlationId,
            note: "traktir_receive",
          },
          tx,
        );
      }

      return updatedSender;
    });

    return {
      totalSpent,
      shareEach,
      recipients: recipients.map((r) => r.userJid),
      xpGained,
      currentMoney: senderAfter.moneyBalance,
    };
  }

  // ======================== 2. LOTERE JACKPOT GRUP ========================

  getLotteryOverview(groupJid: string): GroupLotteryState {
    const state = this.getOrCreateLottery(groupJid);
    return {
      ...state,
      tickets: [...state.tickets],
      lastWinners: [...state.lastWinners],
    };
  }

  async loadLotteryOverview(groupJid: string): Promise<GroupLotteryState> {
    await this.hydrateLotteryState(groupJid);
    return this.getLotteryOverview(groupJid);
  }

  async buyLotteryTicket(
    groupJid: string,
    userJid: string,
    ticketNumber: number,
  ): Promise<LotteryBuyResult> {
    if (!Number.isInteger(ticketNumber) || ticketNumber < 0 || ticketNumber > 99) {
      throw new AppUserError("Pilih nomor lotere 2 digit antara *00* sampai *99*! Contoh: .belitiket 42");
    }

    await this.hydrateLotteryState(groupJid);
    const normUser = normalizeUserJid(userJid);
    const lottery = this.getOrCreateLottery(groupJid);
    const myTickets = lottery.tickets.filter((t) => t.userJid === normUser);

    if (myTickets.length >= LOTTERY_MAX_TICKETS_PER_USER) {
      throw new AppUserError(
        `Kamu sudah membeli maksimal ${String(LOTTERY_MAX_TICKETS_PER_USER)} tiket di ronde #${String(lottery.roundNumber)}. Tunggu hasil *.undilotere*!`,
      );
    }
    if (myTickets.some((t) => t.number === ticketNumber)) {
      throw new AppUserError(
        `Kamu sudah memiliki tiket nomor *${String(ticketNumber).padStart(2, "0")}* di ronde ini.`,
      );
    }

    const correlationId = generateCorrelationId();
    const updated = await this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      if (profile.moneyBalance < LOTTERY_TICKET_PRICE) {
        throw new AppUserError(
          `Harga 1 tiket lotere ${formatRupiah(LOTTERY_TICKET_PRICE)}, dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: LOTTERY_TICKET_PRICE } },
        data: { moneyBalance: { decrement: LOTTERY_TICKET_PRICE } },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup membeli tiket lotere.");
      }

      const saved = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid: normUser,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -LOTTERY_TICKET_PRICE,
          balanceBefore: profile.moneyBalance,
          balanceAfter: saved.moneyBalance,
          correlationId,
          note: `lotere_r${String(lottery.roundNumber)}_n${String(ticketNumber).padStart(2, "0")}`,
        },
        tx,
      );
      return saved;
    });

    lottery.tickets.push({ userJid: normUser, number: ticketNumber });
    lottery.jackpotPool = minBigInt(
      MAX_SAFE_MONEY_BIGINT,
      lottery.jackpotPool + LOTTERY_TICKET_PRICE,
    );
    await this.persistLotteryState(groupJid);

    return {
      roundNumber: lottery.roundNumber,
      number: ticketNumber,
      pricePaid: LOTTERY_TICKET_PRICE,
      jackpotPool: lottery.jackpotPool,
      userTicketCount: myTickets.length + 1,
      totalTickets: lottery.tickets.length,
      currentMoney: updated.moneyBalance,
    };
  }

  async drawLottery(
    groupJid: string,
    actorJid: string,
    isAdminOrOwner: boolean,
  ): Promise<LotteryDrawResult> {
    await this.hydrateLotteryState(groupJid);
    const lottery = this.getOrCreateLottery(groupJid);
    const normActor = normalizeUserJid(actorJid);
    const minTickets = isAdminOrOwner ? 1 : 2;
    if (lottery.tickets.length < minTickets) {
      throw new AppUserError(
        `Minimal harus ada ${String(minTickets)} tiket terjual sebelum *.undilotere* dijalankan (saat ini: ${String(lottery.tickets.length)} tiket).`,
      );
    }

    const actorBought = lottery.tickets.some((t) => t.userJid === normActor);
    if (!isAdminOrOwner && !actorBought) {
      throw new AppUserError(
        "Hanya peserta yang sudah beli tiket atau Admin grup yang bisa mengundi lotere!",
      );
    }

    const roundNumber = lottery.roundNumber;
    const pool = lottery.jackpotPool;
    const ticketsSnapshot = [...lottery.tickets];
    const winningNumber = this.random.intBetween(0, 99);

    const exactMatches = ticketsSnapshot.filter((t) => t.number === winningNumber);
    let outcome: "jackpot" | "consolation" | "rollover" = "rollover";
    let matchedEntries: LotteryTicketEntry[] = [];
    let payoutPool = 0n;
    let nextPool = pool;
    let xpReward = 0;

    if (exactMatches.length > 0) {
      outcome = "jackpot";
      matchedEntries = exactMatches;
      payoutPool = pool;
      nextPool = LOTTERY_BASE_SEED_POOL;
      xpReward = 60;
    } else {
      // Cari tiket terdekat dalam jarak <= 5
      let minDist = 100;
      for (const t of ticketsSnapshot) {
        const dist = Math.abs(t.number - winningNumber);
        if (dist < minDist) minDist = dist;
      }
      if (minDist <= 5) {
        outcome = "consolation";
        matchedEntries = ticketsSnapshot.filter(
          (t) => Math.abs(t.number - winningNumber) === minDist,
        );
        payoutPool = pool / 4n; // 25% hadiah hiburan
        nextPool = pool - payoutPool; // 75% rollover ke ronde berikut!
        xpReward = 24;
      }
    }

    const winners: { userJid: string; ticketNumber: number; payout: bigint }[] = [];
    let totalPaid = 0n;

    if (matchedEntries.length > 0 && payoutPool > 0n) {
      const shareEach = payoutPool / BigInt(matchedEntries.length);
      const correlationId = generateCorrelationId();

      await this.db.$transaction(async (tx) => {
        for (const entry of matchedEntries) {
          const prof = await this.profileRepo.findOrCreate(groupJid, entry.userJid, tx);
          const credit = clampMoneyCredit(prof.moneyBalance, shareEach);
          const updated = await tx.groupMemberProfile.update({
            where: { id: prof.id },
            data: {
              moneyBalance: { increment: credit },
              totalMoneyEarned: { increment: credit },
              experience: { increment: xpReward },
            },
          });
          await this.txRepo.create(
            {
              profileId: prof.id,
              groupJid,
              userJid: entry.userJid,
              asset: MemberTransactionAsset.MONEY,
              type: MemberTransactionType.GAME_REWARD,
              amount: credit,
              balanceBefore: prof.moneyBalance,
              balanceAfter: updated.moneyBalance,
              correlationId,
              note: `lotere_${outcome}_r${String(roundNumber)}`,
            },
            tx,
          );
          winners.push({ userJid: entry.userJid, ticketNumber: entry.number, payout: credit });
          totalPaid += credit;
        }
      });
    }

    // Advance lottery to next round
    lottery.roundNumber += 1;
    lottery.tickets = [];
    lottery.jackpotPool = nextPool;
    lottery.lastWinningNumber = winningNumber;
    lottery.lastWinners = winners.map((w) => w.userJid);
    lottery.lastPayoutEach = winners[0]?.payout ?? 0n;
    lottery.lastOutcome = outcome;
    await this.persistLotteryState(groupJid);

    return {
      roundNumber,
      winningNumber,
      outcome,
      winners,
      totalPaid,
      nextJackpotPool: nextPool,
    };
  }

  // ======================== 3. ARENA TARUHAN CEPAT ========================

  async playRace(
    groupJid: string,
    userJid: string,
    kind: "kuda" | "siput",
    pickedLane: number,
    bet: bigint,
    nowMs = Date.now(),
  ): Promise<RaceResult> {
    if (!Number.isInteger(pickedLane) || pickedLane < 1 || pickedLane > 5) {
      throw new AppUserError(`Pilih nomor lintasan antara 1 sampai 5! Contoh: .balap${kind} 2 500k`);
    }
    this.validateArenaBet(bet);

    const names = kind === "kuda" ? HORSE_NAMES : SNAIL_NAMES;
    const winnerLane = this.random.intBetween(1, 5);
    const won = pickedLane === winnerLane;
    // +2.8x net profit (3.8x total return) -> seru & anti-inflasi!
    const netDelta = won ? (bet * 28n) / 10n : -bet;
    const xpGained = won ? 24 : 6;

    const lanes = names.map((name, idx) => {
      const lane = idx + 1;
      const progress = lane === winnerLane ? 10 : this.random.intBetween(4, 9);
      return { lane, name, progress };
    });

    const settled = await this.settleArenaBet({
      groupJid,
      userJid,
      cooldownKey: `balap_${kind}`,
      bet,
      netDelta,
      xpGained,
      note: `balap_${kind}_${won ? "win" : "lose"}`,
      nowMs,
    });

    return {
      kind,
      pickedLane,
      winnerLane,
      won,
      bet,
      netDelta: settled.deltaApplied,
      xpGained,
      lanes,
      currentMoney: settled.currentMoney,
    };
  }

  async playCockfight(
    groupJid: string,
    userJid: string,
    pickedSide: CockfightSide,
    bet: bigint,
    nowMs = Date.now(),
  ): Promise<CockfightResult> {
    this.validateArenaBet(bet);
    const won = this.random.chance(0.48);
    const winnerSide: CockfightSide = won
      ? pickedSide
      : pickedSide === "merah"
        ? "putih"
        : "merah";
    const netDelta = won ? bet : -bet;
    const xpGained = won ? 18 : 6;

    const winStories = [
      `Jago ${winnerSide.toUpperCase()} melancarkan tendangan taji kilat dan menjatuhkan lawan!`,
      `Serangan sayap bertubi-tubi Jago ${winnerSide.toUpperCase()} bikin lawan kabur keluar arena!`,
    ] as const;
    const loseStories = [
      `Jago ${pickedSide.toUpperCase()} terpeleset pasir dan terkena serangan telak Jago ${winnerSide.toUpperCase()}!`,
      `Jago ${pickedSide.toUpperCase()} malah sibuk mematuk jagung lalu kalah KO dari Jago ${winnerSide.toUpperCase()}!`,
    ] as const;
    const pool = won ? winStories : loseStories;
    const story = pool[this.random.intBetween(0, pool.length - 1)] ?? pool[0];

    const settled = await this.settleArenaBet({
      groupJid,
      userJid,
      cooldownKey: "aduayam",
      bet,
      netDelta,
      xpGained,
      note: `aduayam_${won ? "win" : "lose"}`,
      nowMs,
    });

    return {
      pickedSide,
      winnerSide,
      won,
      bet,
      netDelta: settled.deltaApplied,
      xpGained,
      story,
      currentMoney: settled.currentMoney,
    };
  }

  async playColorWheel(
    groupJid: string,
    userJid: string,
    pickedColor: ColorWheelChoice,
    bet: bigint,
    nowMs = Date.now(),
  ): Promise<ColorWheelResult> {
    this.validateArenaBet(bet);
    const roll = this.random.intBetween(1, 100);
    const landedColor: ColorWheelChoice =
      roll <= 35 ? "merah" : roll <= 70 ? "biru" : roll <= 92 ? "hijau" : "emas";
    const won = landedColor === pickedColor;
    const isJackpotGold = won && landedColor === "emas";

    let netDelta = -bet;
    if (won) {
      if (landedColor === "emas") {
        netDelta = bet * 5n;
      } else if (landedColor === "hijau") {
        netDelta = (bet * 15n) / 10n;
      } else {
        netDelta = (bet * 8n) / 10n;
      }
    }
    const xpGained = isJackpotGold ? 48 : won ? 24 : 6;

    const settled = await this.settleArenaBet({
      groupJid,
      userJid,
      cooldownKey: "tebakwarna",
      bet,
      netDelta,
      xpGained,
      note: `tebakwarna_${landedColor}_${won ? "win" : "lose"}`,
      nowMs,
    });

    return {
      pickedColor,
      landedColor,
      won,
      isJackpotGold,
      bet,
      netDelta: settled.deltaApplied,
      xpGained,
      currentMoney: settled.currentMoney,
    };
  }

  // ======================== 4. DUEL POIN & SABUNG PET ========================

  async createPointDuel(
    groupJid: string,
    challengerJid: string,
    opponentJid: string,
    betPoints: number,
    nowMs = Date.now(),
  ): Promise<PendingPointDuel> {
    this.sweepPointDuels(nowMs);
    const normA = normalizeUserJid(challengerJid);
    const normB = normalizeUserJid(opponentJid);
    if (!normA || !normB || normA === normB) {
      throw new AppUserError("Tidak bisa menantang duel poin diri sendiri!");
    }
    if (!Number.isInteger(betPoints) || betPoints < POINT_DUEL_MIN_BET || betPoints > POINT_DUEL_MAX_BET) {
      throw new AppUserError(
        `Taruhan duel poin harus antara ${String(POINT_DUEL_MIN_BET)} sampai ${POINT_DUEL_MAX_BET.toLocaleString("id-ID")} Poin.`,
      );
    }

    const existing = this.pendingPointDuels.get(groupJid);
    if (existing && existing.expiresAt > nowMs) {
      throw new AppUserError(
        "Masih ada tantangan duel poin aktif di grup ini. Tunggu diterima atau ditolak dulu!",
      );
    }

    const [profA, profB] = await Promise.all([
      this.profileRepo.findOrCreate(groupJid, normA),
      this.profileRepo.findOrCreate(groupJid, normB),
    ]);
    if (profA.pointsBalance < betPoints) {
      throw new AppUserError(
        `Poinmu tidak cukup (${profA.pointsBalance.toLocaleString("id-ID")} < ${betPoints.toLocaleString("id-ID")} Poin).`,
      );
    }
    if (profB.pointsBalance < betPoints) {
      throw new AppUserError("Poin lawan tidak cukup untuk menerima taruhan ini.");
    }

    evictOldestIfNeeded(this.pendingPointDuels, MAX_ACTIVE_GROUPS);
    const pending: PendingPointDuel = {
      groupJid,
      challengerJid: normA,
      opponentJid: normB,
      betPoints,
      expiresAt: nowMs + POINT_DUEL_TTL_MS,
    };
    this.pendingPointDuels.set(groupJid, pending);
    return pending;
  }

  rejectPointDuel(groupJid: string, actorJid: string, nowMs = Date.now()): PendingPointDuel {
    this.sweepPointDuels(nowMs);
    const pending = this.pendingPointDuels.get(groupJid);
    if (!pending || pending.expiresAt <= nowMs) {
      this.pendingPointDuels.delete(groupJid);
      throw new AppUserError("Tidak ada tantangan duel poin yang sedang menunggu.");
    }
    const normActor = normalizeUserJid(actorJid);
    if (normActor !== pending.challengerJid && normActor !== pending.opponentJid) {
      throw new AppUserError("Hanya penantang atau lawan yang bisa membatalkan duel poin.");
    }
    this.pendingPointDuels.delete(groupJid);
    return pending;
  }

  async acceptPointDuel(
    groupJid: string,
    acceptorJid: string,
    nowMs = Date.now(),
  ): Promise<PointDuelResolution> {
    this.sweepPointDuels(nowMs);
    const pending = this.pendingPointDuels.get(groupJid);
    if (!pending || pending.expiresAt <= nowMs) {
      this.pendingPointDuels.delete(groupJid);
      throw new AppUserError("Tidak ada tantangan duel poin aktif atau waktu sudah habis.");
    }

    const normAcceptor = normalizeUserJid(acceptorJid);
    if (normAcceptor !== pending.opponentJid) {
      throw new AppUserError("Hanya member yang ditantang yang bisa menerima duel poin ini.");
    }

    this.pendingPointDuels.delete(groupJid);

    const challengerRoll = this.random.intBetween(1, 100);
    let opponentRoll = this.random.intBetween(1, 100);
    if (challengerRoll === opponentRoll) {
      opponentRoll = opponentRoll >= 100 ? 99 : opponentRoll + 1;
    }

    const challengerWon = challengerRoll > opponentRoll;
    const winnerJid = challengerWon ? pending.challengerJid : pending.opponentJid;
    const loserJid = challengerWon ? pending.opponentJid : pending.challengerJid;
    const bet = pending.betPoints;
    const winnerXp = 24;
    const loserXp = 9;
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const winner = await this.profileRepo.findOrCreate(groupJid, winnerJid, tx);
      const loser = await this.profileRepo.findOrCreate(groupJid, loserJid, tx);

      if (winner.pointsBalance < bet || loser.pointsBalance < bet) {
        throw new AppUserError("Saldo poin salah satu pemain sudah tidak cukup untuk duel.");
      }

      const debitLoser = await tx.groupMemberProfile.updateMany({
        where: { id: loser.id, pointsBalance: { gte: bet } },
        data: {
          pointsBalance: { decrement: bet },
          experience: { increment: loserXp },
        },
      });
      if (debitLoser.count === 0) {
        throw new AppUserError("Saldo poin lawan berubah saat memproses duel.");
      }

      const safeCredit = Math.min(bet, Math.max(0, MAX_SAFE_ECONOMY_INT - winner.pointsBalance));
      const creditWinner = await tx.groupMemberProfile.updateMany({
        where: { id: winner.id, pointsBalance: { gte: bet } },
        data: {
          pointsBalance: { increment: safeCredit },
          totalPointsEarned: { increment: safeCredit },
          experience: { increment: winnerXp },
        },
      });
      if (creditWinner.count === 0) {
        throw new AppUserError("Saldo poin pemenang tidak memenuhi taruhan.");
      }

      const updatedWinner = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: winner.id },
      });
      const updatedLoser = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: loser.id },
      });

      await this.txRepo.create(
        {
          profileId: loser.id,
          groupJid,
          userJid: loserJid,
          targetUserJid: winnerJid,
          asset: MemberTransactionAsset.POINT,
          type: MemberTransactionType.DUEL_STAKE,
          amount: -bet,
          balanceBefore: loser.pointsBalance,
          balanceAfter: updatedLoser.pointsBalance,
          correlationId,
          note: "duelpoin_loss",
        },
        tx,
      );
      await this.txRepo.create(
        {
          profileId: winner.id,
          groupJid,
          userJid: winnerJid,
          targetUserJid: loserJid,
          asset: MemberTransactionAsset.POINT,
          type: MemberTransactionType.DUEL_WIN,
          amount: safeCredit,
          balanceBefore: winner.pointsBalance,
          balanceAfter: updatedWinner.pointsBalance,
          correlationId,
          note: "duelpoin_win",
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
        betPoints: bet,
        winnerPoints: updatedWinner.pointsBalance,
        loserPoints: updatedLoser.pointsBalance,
        winnerXp,
        loserXp,
      };
    });
  }

  async fightPetArena(
    groupJid: string,
    challengerJid: string,
    opponentJid: string,
    bet: bigint,
    nowMs = Date.now(),
  ): Promise<PetArenaResult> {
    const normA = normalizeUserJid(challengerJid);
    const normB = normalizeUserJid(opponentJid);
    if (!normA || !normB || normA === normB) {
      throw new AppUserError("Tidak bisa sabung pet melawan diri sendiri!");
    }
    if (bet < PET_ARENA_MIN_BET || bet > PET_ARENA_MAX_BET) {
      throw new AppUserError(
        `Taruhan sabung pet antara ${formatRupiah(PET_ARENA_MIN_BET)} sampai ${formatRupiah(PET_ARENA_MAX_BET)}.`,
      );
    }

    const rollA = this.random.intBetween(10, 45);
    const rollB = this.random.intBetween(10, 45);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profA = await this.profileRepo.findOrCreate(groupJid, normA, tx);
      const profB = await this.profileRepo.findOrCreate(groupJid, normB, tx);

      const stateA = parseRpgState(profA.rpgState);
      const stateB = parseRpgState(profB.rpgState);

      const cdRem = getRemainingCooldownMs(stateA, "sabungpet", PET_ARENA_COOLDOWN_MS, nowMs);
      if (cdRem > 0) {
        throw new AppUserError(
          `Pet kamu sedang istirahat! Bisa *.sabungpet* lagi dalam *${formatRemainingDuration(cdRem)}*.`,
        );
      }

      const petA = getStrongestPet(stateA);
      if (!petA) {
        throw new AppUserError(
          "Kamu belum punya Pet! Dapatkan dulu lewat *.open* peti atau kalahkan *.fightkucing*.",
        );
      }
      const petB = getStrongestPet(stateB);
      if (!petB) {
        throw new AppUserError("Lawan belum memiliki Pet di kandangnya (.kandang). Cari penantang lain!");
      }

      if (profA.moneyBalance < bet) {
        throw new AppUserError(
          `Dompetmu kurang untuk taruhan ${formatRupiah(bet)} (dompet: ${formatRupiah(profA.moneyBalance)}).`,
        );
      }
      if (profB.moneyBalance < bet) {
        throw new AppUserError("Dompet lawan belum cukup untuk taruhan sabung pet ini.");
      }

      const powerA = petA.level * 25 + Math.floor(petA.exp / 20) + rollA;
      let powerB = petB.level * 25 + Math.floor(petB.exp / 20) + rollB;
      if (powerA === powerB) {
        powerB += 1;
      }

      const aWon = powerA > powerB;
      const winnerProf = aWon ? profA : profB;
      const loserProf = aWon ? profB : profA;
      const winnerStateBase = aWon ? stateA : stateB;
      const loserStateBase = aWon ? stateB : stateA;
      const winnerPet = aWon ? petA : petB;
      const loserPet = aWon ? petB : petA;

      const winPetExpGain = 60;
      const losePetExpGain = 20;

      // Update winner pet EXP & auto level-up
      let newWinLevel = winnerPet.level;
      let newWinExp = winnerPet.exp + winPetExpGain;
      let winnerPetLeveledUp = false;
      const needed = winnerPet.level * 100;
      if (newWinExp >= needed && newWinLevel < MAX_PET_LEVEL) {
        newWinExp -= needed;
        newWinLevel += 1;
        winnerPetLeveledUp = true;
      }

      let nextWinnerState = withPetState(winnerStateBase, winnerPet.id, {
        level: newWinLevel,
        exp: newWinExp,
        hunger: Math.max(10, winnerStateBase.pets[winnerPet.id].hunger - 10),
      });
      let nextLoserState = withPetState(loserStateBase, loserPet.id, {
        level: loserPet.level,
        exp: loserPet.exp + losePetExpGain,
        hunger: Math.max(10, loserStateBase.pets[loserPet.id].hunger - 15),
      });

      if (aWon) {
        nextWinnerState = withUpdatedCooldown(nextWinnerState, "sabungpet", nowMs);
      } else {
        nextLoserState = withUpdatedCooldown(nextLoserState, "sabungpet", nowMs);
      }

      const debitLoser = await tx.groupMemberProfile.updateMany({
        where: { id: loserProf.id, moneyBalance: { gte: bet } },
        data: {
          moneyBalance: { decrement: bet },
          experience: { increment: 12 },
          rpgState: serializeRpgState(nextLoserState),
        },
      });
      if (debitLoser.count === 0) {
        throw new AppUserError("Saldo salah satu pemain berubah saat sabung pet.");
      }

      const credit = clampMoneyCredit(winnerProf.moneyBalance, bet);
      const updatedWinner = await tx.groupMemberProfile.update({
        where: { id: winnerProf.id },
        data: {
          moneyBalance: { increment: credit },
          totalMoneyEarned: { increment: credit },
          experience: { increment: 30 },
          rpgState: serializeRpgState(nextWinnerState),
        },
      });
      const updatedLoser = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: loserProf.id },
      });

      await this.txRepo.create(
        {
          profileId: loserProf.id,
          groupJid,
          userJid: loserProf.userJid,
          targetUserJid: winnerProf.userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.DUEL_STAKE,
          amount: -bet,
          balanceBefore: loserProf.moneyBalance,
          balanceAfter: updatedLoser.moneyBalance,
          correlationId,
          note: "sabungpet_loss",
        },
        tx,
      );
      await this.txRepo.create(
        {
          profileId: winnerProf.id,
          groupJid,
          userJid: winnerProf.userJid,
          targetUserJid: loserProf.userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.DUEL_WIN,
          amount: credit,
          balanceBefore: winnerProf.moneyBalance,
          balanceAfter: updatedWinner.moneyBalance,
          correlationId,
          note: "sabungpet_win",
        },
        tx,
      );

      return {
        challengerJid: normA,
        opponentJid: normB,
        challengerPet: {
          id: petA.id,
          label: PET_LABELS[petA.id],
          level: petA.level,
          power: powerA,
        },
        opponentPet: {
          id: petB.id,
          label: PET_LABELS[petB.id],
          level: petB.level,
          power: powerB,
        },
        winnerJid: winnerProf.userJid,
        loserJid: loserProf.userJid,
        bet,
        winnerPetExpGained: winPetExpGain,
        winnerPetLeveledUp,
        winnerPetNewLevel: newWinLevel,
        winnerMoney: updatedWinner.moneyBalance,
        loserMoney: updatedLoser.moneyBalance,
      };
    });
  }

  // ======================== 5. TOKO POIN & SEDEKAH ========================

  async buyXpWithPoints(
    groupJid: string,
    userJid: string,
    pointsToSpend: number,
  ): Promise<BuyXpResult> {
    if (
      !Number.isInteger(pointsToSpend) ||
      pointsToSpend < POINT_SHOP_MIN_XP_POINTS ||
      pointsToSpend > POINT_SHOP_MAX_XP_POINTS
    ) {
      throw new AppUserError(
        `Masukkan jumlah poin antara ${String(POINT_SHOP_MIN_XP_POINTS)} sampai ${POINT_SHOP_MAX_XP_POINTS.toLocaleString("id-ID")} Poin. Contoh: .belixp 50`,
      );
    }

    const normUser = normalizeUserJid(userJid);
    const xpGained = pointsToSpend * POINT_SHOP_XP_PER_POINT;
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      if (profile.pointsBalance < pointsToSpend) {
        throw new AppUserError(
          `Poinmu tidak cukup! Butuh ${pointsToSpend.toLocaleString("id-ID")} Poin, saldomu: ${profile.pointsBalance.toLocaleString("id-ID")} Poin.`,
        );
      }

      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, pointsBalance: { gte: pointsToSpend } },
        data: {
          pointsBalance: { decrement: pointsToSpend },
          experience: { increment: xpGained },
        },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Saldo poin tidak mencukupi saat membeli XP.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid: normUser,
          asset: MemberTransactionAsset.POINT,
          type: MemberTransactionType.RPG_LOSS,
          amount: -pointsToSpend,
          balanceBefore: profile.pointsBalance,
          balanceAfter: updated.pointsBalance,
          correlationId,
          note: `tokopoin_belixp_${String(xpGained)}`,
        },
        tx,
      );
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid: normUser,
          asset: MemberTransactionAsset.EXPERIENCE,
          type: MemberTransactionType.RPG_EARN,
          amount: xpGained,
          balanceBefore: profile.experience,
          balanceAfter: updated.experience,
          correlationId,
          note: "tokopoin_belixp",
        },
        tx,
      );

      return {
        pointsSpent: pointsToSpend,
        xpGained,
        currentPoints: updated.pointsBalance,
        currentXp: updated.experience,
      };
    });
  }

  async buyCrateWithPoints(
    groupJid: string,
    userJid: string,
    crate: PointShopCrateKey,
    quantity = 1,
  ): Promise<BuyCratePointResult> {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      throw new AppUserError("Jumlah beli peti sekaligus harus antara 1 sampai 10.");
    }

    const normUser = normalizeUserJid(userJid);
    const unitPrice = POINT_SHOP_CRATE_PRICES[crate];
    const totalCost = unitPrice * quantity;
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      if (profile.pointsBalance < totalCost) {
        throw new AppUserError(
          `Poinmu tidak cukup! Harga ${String(quantity)}x ${crate.toUpperCase()} Crate = ${totalCost.toLocaleString("id-ID")} Poin, saldomu: ${profile.pointsBalance.toLocaleString("id-ID")} Poin.`,
        );
      }

      const nextState = withCrateDelta(parseRpgState(profile.rpgState), crate, quantity);
      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, pointsBalance: { gte: totalCost } },
        data: {
          pointsBalance: { decrement: totalCost },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Saldo poin tidak mencukupi saat membeli peti.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid: normUser,
          asset: MemberTransactionAsset.POINT,
          type: MemberTransactionType.RPG_LOSS,
          amount: -totalCost,
          balanceBefore: profile.pointsBalance,
          balanceAfter: updated.pointsBalance,
          correlationId,
          note: `tokopoin_belikotak_${crate}x${String(quantity)}`,
        },
        tx,
      );

      return {
        crate,
        quantity,
        pointsSpent: totalCost,
        currentPoints: updated.pointsBalance,
        ownedCrates: nextState.crates[crate],
      };
    });
  }

  async donateToTreasury(
    groupJid: string,
    userJid: string,
    amount: bigint,
    nowMs = Date.now(),
  ): Promise<SedekahResult> {
    if (amount < SEDEKAH_MIN_AMOUNT || amount > SEDEKAH_MAX_AMOUNT) {
      throw new AppUserError(
        `Nominal sedekah antara ${formatRupiah(SEDEKAH_MIN_AMOUNT)} sampai ${formatRupiah(SEDEKAH_MAX_AMOUNT)}.`,
      );
    }

    const normUser = normalizeUserJid(userJid);
    const correlationId = generateCorrelationId();
    // Anti-inflation balanced XP: 15..90 XP
    const units = Number(minBigInt(15n, amount / 500_000n));
    const xpGained = Math.max(15, Math.min(90, units * 6));

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      const state = parseRpgState(profile.rpgState);
      const cdRem = getRemainingCooldownMs(state, "sedekah", SEDEKAH_COOLDOWN_MS, nowMs);
      if (cdRem > 0) {
        throw new AppUserError(
          `Kamu baru saja bersedekah. Bisa *.sedekah* lagi dalam *${formatRemainingDuration(cdRem)}*.`,
        );
      }

      if (profile.moneyBalance < amount) {
        throw new AppUserError(
          `Dompetmu kurang! Saldo dompet: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const nextState = withUpdatedCooldown(withDonatedAdded(state, amount), "sedekah", nowMs);
      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: amount } },
        data: {
          moneyBalance: { decrement: amount },
          experience: { increment: xpGained },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup saat bersedekah.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      let nextTreasury = DEFAULT_GROUP_TREASURY + amount;
      if (tx.tenantGroup) {
        const tenant = await tx.tenantGroup.findUnique({ where: { groupJid } });
        const curTreasury = tenant?.treasuryBalance ?? DEFAULT_GROUP_TREASURY;
        nextTreasury = minBigInt(MAX_SAFE_MONEY_BIGINT, curTreasury + amount);
        if (tenant) {
          await tx.tenantGroup.update({
            where: { groupJid },
            data: { treasuryBalance: nextTreasury },
          });
        }
      }

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid: normUser,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.GIFT_SENT,
          amount: -amount,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: "sedekah_kas_grup",
        },
        tx,
      );

      return {
        amountDonated: amount,
        xpGained,
        totalDonatedAllTime: BigInt(nextState.totalDonated),
        currentMoney: updated.moneyBalance,
        treasuryBalance: nextTreasury,
      };
    });
  }

  // ======================== INTERNAL HELPERS ========================

  private validateArenaBet(bet: bigint): void {
    if (bet < ARENA_MIN_BET || bet > ARENA_MAX_BET) {
      throw new AppUserError(
        `Taruhan arena harus antara ${formatRupiah(ARENA_MIN_BET)} sampai ${formatRupiah(ARENA_MAX_BET)}.`,
      );
    }
  }

  private async settleArenaBet(input: {
    groupJid: string;
    userJid: string;
    cooldownKey: string;
    bet: bigint;
    netDelta: bigint;
    xpGained: number;
    note: string;
    nowMs: number;
  }): Promise<{ currentMoney: bigint; deltaApplied: bigint }> {
    const normUser = normalizeUserJid(input.userJid);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(input.groupJid, normUser, tx);
      const state = parseRpgState(profile.rpgState);
      const cdRem = getRemainingCooldownMs(state, input.cooldownKey, ARENA_COOLDOWN_MS, input.nowMs);
      if (cdRem > 0) {
        throw new AppUserError(
          `Tunggu *${formatRemainingDuration(cdRem)}* sebelum bertaruh lagi!`,
        );
      }
      if (profile.moneyBalance < input.bet) {
        throw new AppUserError(
          `Uang dompet kurang! Taruhan: ${formatRupiah(input.bet)}, dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const deltaApplied =
        input.netDelta > 0n
          ? clampMoneyCredit(profile.moneyBalance, input.netDelta)
          : input.netDelta;
      const nextState = withUpdatedCooldown(state, input.cooldownKey, input.nowMs);

      const updateData: Record<string, unknown> = {
        experience: { increment: input.xpGained },
        rpgState: serializeRpgState(nextState),
      };
      if (deltaApplied > 0n) {
        updateData.moneyBalance = { increment: deltaApplied };
        updateData.totalMoneyEarned = { increment: deltaApplied };
      } else if (deltaApplied < 0n) {
        updateData.moneyBalance = { decrement: absBigInt(deltaApplied) };
      }

      const res = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: input.bet } },
        data: updateData,
      });
      if (res.count === 0) {
        throw new AppUserError("Saldo dompet berubah saat memproses taruhan.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      if (deltaApplied !== 0n) {
        await this.txRepo.create(
          {
            profileId: profile.id,
            groupJid: input.groupJid,
            userJid: normUser,
            asset: MemberTransactionAsset.MONEY,
            type: deltaApplied > 0n ? MemberTransactionType.GAME_REWARD : MemberTransactionType.RPG_LOSS,
            amount: deltaApplied,
            balanceBefore: profile.moneyBalance,
            balanceAfter: updated.moneyBalance,
            correlationId,
            note: input.note,
          },
          tx,
        );
      }

      return { currentMoney: updated.moneyBalance, deltaApplied };
    });
  }

  private getOrCreateLottery(groupJid: string): GroupLotteryState {
    let state = this.lotteries.get(groupJid);
    if (!state) {
      evictOldestIfNeeded(this.lotteries, MAX_ACTIVE_GROUPS);
      state = {
        groupJid,
        roundNumber: 1,
        jackpotPool: LOTTERY_BASE_SEED_POOL,
        tickets: [],
        lastWinningNumber: null,
        lastWinners: [],
        lastPayoutEach: 0n,
        lastOutcome: null,
      };
      this.lotteries.set(groupJid, state);
    }
    return state;
  }

  private computeRandomBigIntSlice(
    remaining: bigint,
    remainingQuota: number,
    minUnit: bigint,
  ): bigint {
    if (remainingQuota <= 1) return remaining;
    const reserve = minUnit * BigInt(remainingQuota - 1);
    const maxAllowed = remaining - reserve;
    if (maxAllowed <= minUnit) return minUnit;

    const avg = remaining / BigInt(remainingQuota);
    const low = avg / 3n > minUnit ? avg / 3n : minUnit;
    const highCandidate = (avg * 17n) / 10n;
    const high = highCandidate < maxAllowed ? highCandidate : maxAllowed;
    if (high <= low) return low;

    // Random percentage 0..1000 between low and high using BigInt-safe math
    const pct = BigInt(this.random.intBetween(0, 1000));
    const raw = low + ((high - low) * pct) / 1000n;
    // Round to nearest 1.000 Rp for clean display
    const rounded = (raw / 1_000n) * 1_000n;
    return rounded < minUnit ? minUnit : rounded > maxAllowed ? maxAllowed : rounded;
  }

  private computeRandomIntSlice(remaining: number, remainingQuota: number): number {
    if (remainingQuota <= 1) return remaining;
    const maxAllowed = remaining - (remainingQuota - 1);
    if (maxAllowed <= 1) return 1;
    const avg = Math.floor(remaining / remainingQuota);
    const low = Math.max(1, Math.floor(avg * 0.4));
    const high = Math.min(maxAllowed, Math.max(low, Math.ceil(avg * 1.6)));
    return this.random.intBetween(low, high);
  }

  private sweepPointDuels(nowMs: number): void {
    for (const [k, d] of this.pendingPointDuels.entries()) {
      if (d.expiresAt <= nowMs) {
        this.pendingPointDuels.delete(k);
      }
    }
  }
}

export const arenaGiveawayShopService = new ArenaGiveawayShopService();
