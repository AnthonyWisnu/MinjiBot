import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupMemberProfile,
  type Prisma,
  type TenantGroup,
} from "@prisma/client";

import { AppUserError } from "../../errors/appUserError";
import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { GroupMemberTransactionRepository } from "../../repositories/groupMemberTransaction.repository";
import { prisma } from "../../repositories/prismaClient";
import {
  clampMoneyCredit,
  formatRemainingDuration,
  formatRupiah,
  MAX_SAFE_MONEY_BIGINT,
  minBigInt,
  percentOfBigInt,
} from "../../utils/currency";
import { normalizeUserJid } from "../../utils/jid";
import { generateCorrelationId } from "../member/memberEconomy.service";
import { defaultRandom, type RandomProvider } from "../member/randomProvider";
import { DEFAULT_GROUP_TREASURY } from "./rpgEconomy.service";
import { calculatePlayerCombatPower } from "./rpgInfinite.service";
import {
  BUFF_KEYS,
  getRemainingCooldownMs,
  getRemainingJailMs,
  getRemainingUgdMs,
  getSpentSkillPoints,
  getTotalSkillPointsForLevel,
  isBuffActive,
  isInsuranceActive,
  MAX_FARM_PLOTS,
  MAX_PLAYER_HP,
  MAX_SKILL_STAT,
  parseRpgState,
  serializeRpgState,
  SKILL_KEYS,
  withBossRaidStatsDelta,
  withBuffUntil,
  withCrateDelta,
  withFarm,
  withHp,
  withItemDelta,
  withSkills,
  withUgdUntil,
  withUpdatedCooldown,
  type BuffKey,
  type CrateType,
  type FarmPlotState,
  type SkillKey,
} from "./rpgState";

const MAX_ACTIVE_GROUPS = 100;
const MAX_BOUNTIES_PER_GROUP = 20;

export const WORLD_BOSS_TTL_MS = 3 * 60 * 60 * 1000;
export const WORLD_BOSS_RESPAWN_COOLDOWN_MS = 60 * 60 * 1000;
export const WORLD_BOSS_ATTACK_COOLDOWN_MS = 4 * 60 * 1000;
export const WORLD_BOSS_MIN_HP = 15;
export const WORLD_BOSS_HISTORY_LIMIT = 5;

export const SKILL_RESET_COST = 5_000_000n;

export const FARM_WATER_SPEEDUP_PERCENT = 35;
export const COMMODITY_EPOCH_MS = 15 * 60 * 1000;

export const BUFF_DURATION_MS = 60 * 60 * 1000;
export const BUFF_MAX_STACK_MS = 6 * 60 * 60 * 1000;

export const BOUNTY_MIN_AMOUNT = 2_000_000n;
export const BOUNTY_MAX_AMOUNT = 500_000_000n;
export const BOUNTY_TTL_MS = 24 * 60 * 60 * 1000;
export const BOUNTY_HUNT_COOLDOWN_MS = 20 * 60 * 1000;
export const BOUNTY_FAIL_PENALTY = 500_000n;
export const BOUNTY_UGD_MS = 5 * 60 * 1000;
export const BOUNTY_TAX_PERCENT = 5;

export interface WorldBossSpec {
  id: string;
  name: string;
  title: string;
  maxHp: number;
  rewardPool: bigint;
  baseXp: number;
  crateDrop: CrateType;
}

export const WORLD_BOSS_CATALOG: readonly WorldBossSpec[] = [
  {
    id: "naga_obsidian",
    name: "Naga Obsidian Purba",
    title: "Penguasa Kawah Gelap",
    maxHp: 12_000,
    rewardPool: 75_000_000n,
    baseXp: 300,
    crateDrop: "mythic",
  },
  {
    id: "titan_petir",
    name: "Titan Petir Langit",
    title: "Penjaga Badai Abadi",
    maxHp: 16_000,
    rewardPool: 105_000_000n,
    baseXp: 400,
    crateDrop: "mythic",
  },
  {
    id: "leviathan_palung",
    name: "Leviathan Palung Gelap",
    title: "Monster Samudra Dalam",
    maxHp: 20_000,
    rewardPool: 135_000_000n,
    baseXp: 500,
    crateDrop: "mythic",
  },
  {
    id: "kaisar_iblis",
    name: "Kaisar Iblis Kawah Merah",
    title: "Tiran Neraka Api",
    maxHp: 25_000,
    rewardPool: 180_000_000n,
    baseXp: 650,
    crateDrop: "legendary",
  },
  {
    id: "mecha_kraken",
    name: "Mecha Kraken Cyber",
    title: "Mesin Penghancur Kota",
    maxHp: 30_000,
    rewardPool: 225_000_000n,
    baseXp: 800,
    crateDrop: "legendary",
  },
  {
    id: "dewa_phoenix",
    name: "Dewa Phoenix Abadi",
    title: "Burung Api Legendaris",
    maxHp: 40_000,
    rewardPool: 300_000_000n,
    baseXp: 1_000,
    crateDrop: "legendary",
  },
] as const;

export interface SkillSpec {
  key: SkillKey;
  label: string;
  effect: string;
}

export const SKILL_SPECS: Record<SkillKey, SkillSpec> = {
  str: {
    key: "str",
    label: "Strength (STR)",
    effect: "+6% Power tempur & damage World Boss per poin",
  },
  agi: {
    key: "agi",
    label: "Agility (AGI)",
    effect: "+1,5% Crit Boss & +10 Power buru Bounty per poin",
  },
  luk: {
    key: "luk",
    label: "Luck (LUK)",
    effect: "+2% bonus panen ladang ekstra & multiplier Crit Boss",
  },
  int: {
    key: "int",
    label: "Intelligence (INT)",
    effect: "+3% bonus XP dari Raid Boss, Ladang & Bounty",
  },
  cha: {
    key: "cha",
    label: "Charisma (CHA)",
    effect: "+1,5% harga jual panen komoditas (.jualsemua, maks +30%)",
  },
};

export interface FarmCropSpec {
  id: string;
  label: string;
  minLevel: number;
  seedPrice: bigint;
  growMinutes: number;
  minYield: number;
  maxYield: number;
  baseMarketPrice: bigint;
  seedOffset: number;
}

export const FARM_CROP_CATALOG: readonly FarmCropSpec[] = [
  {
    id: "padi",
    label: "Padi Organik",
    minLevel: 1,
    seedPrice: 300_000n,
    growMinutes: 15,
    minYield: 3,
    maxYield: 5,
    baseMarketPrice: 180_000n,
    seedOffset: 101,
  },
  {
    id: "jagung",
    label: "Jagung Manis",
    minLevel: 1,
    seedPrice: 600_000n,
    growMinutes: 25,
    minYield: 3,
    maxYield: 5,
    baseMarketPrice: 340_000n,
    seedOffset: 211,
  },
  {
    id: "kopi",
    label: "Biji Kopi Gayo",
    minLevel: 5,
    seedPrice: 1_500_000n,
    growMinutes: 45,
    minYield: 3,
    maxYield: 6,
    baseMarketPrice: 750_000n,
    seedOffset: 307,
  },
  {
    id: "kakao",
    label: "Kakao Premium",
    minLevel: 10,
    seedPrice: 3_000_000n,
    growMinutes: 60,
    minYield: 3,
    maxYield: 6,
    baseMarketPrice: 1_450_000n,
    seedOffset: 409,
  },
  {
    id: "sawit",
    label: "Sawit Emas",
    minLevel: 18,
    seedPrice: 6_000_000n,
    growMinutes: 90,
    minYield: 4,
    maxYield: 7,
    baseMarketPrice: 2_600_000n,
    seedOffset: 521,
  },
  {
    id: "truffle",
    label: "Truffle Hitam",
    minLevel: 30,
    seedPrice: 15_000_000n,
    growMinutes: 120,
    minYield: 3,
    maxYield: 6,
    baseMarketPrice: 6_500_000n,
    seedOffset: 631,
  },
] as const;

export const FARM_CROP_MAP = new Map<string, FarmCropSpec>(
  FARM_CROP_CATALOG.map((c) => [c.id, c]),
);

export interface BlackMarketBuffSpec {
  id: BuffKey;
  itemKey: string;
  label: string;
  price: bigint;
  durationMinutes: number;
  effect: string;
}

export const BLACK_MARKET_CATALOG: readonly BlackMarketBuffSpec[] = [
  {
    id: "jamukuat",
    itemKey: "bm_jamukuat",
    label: "Jamu Kuat Sakti",
    price: 8_000_000n,
    durationMinutes: 60,
    effect: "+35% Combat Power & damage World Boss selama 60 menit",
  },
  {
    id: "jimatcuan",
    itemKey: "bm_jimatcuan",
    label: "Jimat Cuan Maut",
    price: 12_000_000n,
    durationMinutes: 60,
    effect: "+25% uang hadiah World Boss & jual panen ladang selama 60 menit",
  },
  {
    id: "ramuanxp",
    itemKey: "bm_ramuanxp",
    label: "Ramuan Fokus XP",
    price: 10_000_000n,
    durationMinutes: 60,
    effect: "+50% bonus XP dari World Boss, Ladang & Bounty selama 60 menit",
  },
  {
    id: "perisaibaja",
    itemKey: "bm_perisaibaja",
    label: "Perisai Baja Hitam",
    price: 9_000_000n,
    durationMinutes: 60,
    effect: "-40% damage HP saat Raid Boss & +25% pertahanan saat diburu Bounty",
  },
] as const;

export const BLACK_MARKET_MAP = new Map<BuffKey, BlackMarketBuffSpec>(
  BLACK_MARKET_CATALOG.map((b) => [b.id, b]),
);

export interface ActiveWorldBoss {
  groupJid: string;
  spec: WorldBossSpec;
  currentHp: number;
  spawnedAt: number;
  expiresAt: number;
  damageByUser: Map<string, number>;
  hitsCount: number;
}

export interface DefeatedBossRecord {
  bossId?: string;
  bossName: string;
  maxHp: number;
  remainingHp?: number;
  outcome: "defeated" | "escaped";
  defeatedAt: number;
  finisherJid: string | null;
  rankings: { userJid: string; damage: number; sharePercent: number }[];
}

export interface AllTimeBossDamageEntry {
  userJid: string;
  totalDamage: number;
  bossKills: number;
  bossMvpCount: number;
}

export interface TopBossDamageResult {
  source: "active" | "last" | "alltime";
  isActive: boolean;
  bossName: string;
  outcome?: "defeated" | "escaped";
  currentHp: number;
  maxHp: number;
  activeBossPendingName: string | null;
  rankings: { userJid: string; damage: number; sharePercent: number }[];
  allTimeTop: AllTimeBossDamageEntry[];
}

export interface WorldBossInspectResult {
  spawned: boolean;
  boss: ActiveWorldBoss;
  topDamagers: { userJid: string; damage: number; sharePercent: number }[];
  remainingMs: number;
}

export interface WorldBossRewardDistribution {
  userJid: string;
  damage: number;
  sharePercent: number;
  moneyGained: bigint;
  xpGained: number;
  crateGained: CrateType | null;
  isMvp: boolean;
  isFinisher: boolean;
}

export interface WorldBossAttackResult {
  autoSpawned: boolean;
  bossName: string;
  damageDealt: number;
  isCrit: boolean;
  bossHpAfter: number;
  bossMaxHp: number;
  hpLost: number;
  hpAfter: number;
  participationXp: number;
  defeated: boolean;
  distributions: WorldBossRewardDistribution[];
  totalPoolPaid: bigint;
}

export interface SkillOverviewResult {
  level: number;
  totalSkillPoints: number;
  spentSkillPoints: number;
  freeSkillPoints: number;
  skills: Record<SkillKey, number>;
  combatPower: number;
}

export interface SkillUpgradeResult {
  stat: SkillKey;
  statLabel: string;
  added: number;
  newStatValue: number;
  freeSkillPoints: number;
  combatPower: number;
}

export interface SkillResetResult {
  costPaid: bigint;
  refundedPoints: number;
  currentMoney: bigint;
}

export interface CommodityQuote {
  crop: FarmCropSpec;
  price: bigint;
  changePercent: number;
  trend: "NAIK" | "TURUN" | "STABIL";
}

export interface FarmOverviewResult {
  maxPlots: number;
  plots: {
    cropId: string;
    label: string;
    watered: boolean;
    ready: boolean;
    remainingMs: number;
  }[];
  harvest: {
    cropId: string;
    label: string;
    qty: number;
    unitPrice: bigint;
    subtotal: bigint;
  }[];
  estimatedSellTotal: bigint;
}

export interface PlantCropResult {
  crop: FarmCropSpec;
  plantedCount: number;
  totalCost: bigint;
  currentMoney: bigint;
  usedPlots: number;
  maxPlots: number;
}

export interface WaterFarmResult {
  wateredCount: number;
  xpGained: number;
}

export interface HarvestFarmResult {
  harvestedPlots: number;
  yielded: Record<string, number>;
  xpGained: number;
}

export interface SellHarvestResult {
  itemsSold: { cropId: string; label: string; qty: number; subtotal: bigint }[];
  baseTotal: bigint;
  chaBonusPercent: number;
  buffBonusPercent: number;
  totalReceived: bigint;
  currentMoney: bigint;
}

export interface BlackMarketOverviewResult {
  items: {
    spec: BlackMarketBuffSpec;
    ownedQty: number;
    activeRemainingMs: number;
  }[];
  currentMoney: bigint;
}

export interface BuyBuffResult {
  spec: BlackMarketBuffSpec;
  quantity: number;
  totalCost: bigint;
  ownedAfter: number;
  currentMoney: bigint;
}

export interface UseBuffResult {
  spec: BlackMarketBuffSpec;
  remainingOwned: number;
  activeRemainingMs: number;
}

export interface BountyEntry {
  groupJid: string;
  targetJid: string;
  amount: bigint;
  postersCount: number;
  lastPosterJid: string;
  createdAt: number;
  expiresAt: number;
}

export interface PostBountyResult {
  targetJid: string;
  addedAmount: bigint;
  totalBounty: bigint;
  posterMoney: bigint;
  expiresAt: number;
}

export interface HuntBountyResult {
  won: boolean;
  hunterJid: string;
  targetJid: string;
  hunterPower: number;
  targetPower: number;
  grossBounty: bigint;
  netReward: bigint;
  taxPaid: bigint;
  xpGained: number;
  targetSentToUgd: boolean;
  targetProtectedByBpjs: boolean;
  hunterHpAfter: number;
  failPenaltyPaid: bigint;
  hunterMoneyAfter: bigint;
}

interface RaidProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
  findByGroupAndUser(
    groupJid: string,
    userJid: string,
    tx?: unknown,
  ): Promise<GroupMemberProfile | null>;
  listTopByBossDamage?(
    groupJid: string,
    limit?: number,
  ): Promise<
    {
      profile: GroupMemberProfile;
      totalDamage: number;
      bossKills: number;
      bossMvpCount: number;
    }[]
  >;
}

interface RaidTxStore {
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

interface RaidTx {
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
    findUnique(args: { where: { groupJid: string } }): Promise<TenantGroup | null>;
    update(args: {
      where: { groupJid: string };
      data: Record<string, unknown>;
    }): Promise<TenantGroup>;
  };
}

interface RaidDb {
  $transaction<T>(fn: (tx: RaidTx) => Promise<T>): Promise<T>;
  tenantGroup?: {
    findUnique(args: { where: { groupJid: string } }): Promise<TenantGroup | null>;
    update(args: {
      where: { groupJid: string };
      data: Record<string, unknown>;
    }): Promise<TenantGroup>;
  };
}

function deterministicFloat(epoch: number, seedOffset: number): number {
  const x = Math.sin(epoch * 12.9898 + seedOffset * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function getCommodityMarketQuotesAt(nowMs: number = Date.now()): {
  quotes: CommodityQuote[];
  nextRefreshMs: number;
} {
  const epoch = Math.floor(nowMs / COMMODITY_EPOCH_MS);
  const nextRefreshMs = (epoch + 1) * COMMODITY_EPOCH_MS - nowMs;

  const quotes: CommodityQuote[] = FARM_CROP_CATALOG.map((crop) => {
    const curFactor = 0.75 + deterministicFloat(epoch, crop.seedOffset) * 0.7; // 0.75..1.45
    const prevFactor = 0.75 + deterministicFloat(epoch - 1, crop.seedOffset) * 0.7;
    const price = (crop.baseMarketPrice * BigInt(Math.round(curFactor * 100))) / 100n;
    const changePercent = Math.round(((curFactor - prevFactor) / prevFactor) * 100);
    const trend: CommodityQuote["trend"] =
      changePercent > 2 ? "NAIK" : changePercent < -2 ? "TURUN" : "STABIL";
    return { crop, price, changePercent, trend };
  });

  return { quotes, nextRefreshMs };
}

function evictOldestIfNeeded<K, V>(map: Map<K, V>, maxEntries: number): void {
  while (map.size > maxEntries) {
    const firstKey = map.keys().next().value;
    if (firstKey === undefined) break;
    map.delete(firstKey);
  }
}

function buildDamageRankings(
  damageByUser: Map<string, number>,
): { userJid: string; damage: number; sharePercent: number }[] {
  let total = 0;
  for (const dmg of damageByUser.values()) {
    total += dmg;
  }
  const entries = Array.from(damageByUser.entries())
    .filter(([, dmg]) => dmg > 0)
    .sort((a, b) => b[1] - a[1]);

  return entries.map(([userJid, damage]) => ({
    userJid,
    damage,
    sharePercent: total > 0 ? Math.round((damage / total) * 1000) / 10 : 0,
  }));
}

function applyXpMultipliers(baseXp: number, intStat: number, hasXpBuff: boolean): number {
  const intMult = 1 + intStat * 0.03;
  const buffMult = hasXpBuff ? 1.5 : 1;
  return Math.max(1, Math.round(baseXp * intMult * buffMult));
}

const WORLD_BOSS_SPEC_MAP = new Map<string, WorldBossSpec>(
  WORLD_BOSS_CATALOG.map((spec) => [spec.id, spec]),
);

function parsePersistedWorldBossState(
  groupJid: string,
  raw: unknown,
): {
  active: ActiveWorldBoss | null;
  respawnAt: number;
  history: DefeatedBossRecord[];
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { active: null, respawnAt: 0, history: [] };
  }
  const obj = raw as Record<string, unknown>;

  let active: ActiveWorldBoss | null = null;
  if (obj.active && typeof obj.active === "object" && !Array.isArray(obj.active)) {
    const a = obj.active as Record<string, unknown>;
    const specId = typeof a.specId === "string" ? a.specId : "";
    const spec = WORLD_BOSS_SPEC_MAP.get(specId);
    if (
      spec &&
      typeof a.currentHp === "number" &&
      Number.isFinite(a.currentHp) &&
      typeof a.spawnedAt === "number" &&
      typeof a.expiresAt === "number"
    ) {
      const damageByUser = new Map<string, number>();
      if (a.damageByUser && typeof a.damageByUser === "object" && !Array.isArray(a.damageByUser)) {
        for (const [jid, dmg] of Object.entries(a.damageByUser as Record<string, unknown>)) {
          if (typeof dmg === "number" && Number.isFinite(dmg) && dmg > 0) {
            damageByUser.set(jid, Math.floor(dmg));
          }
        }
      }
      active = {
        groupJid,
        spec,
        currentHp: Math.max(0, Math.min(spec.maxHp, Math.floor(a.currentHp))),
        spawnedAt: Math.floor(a.spawnedAt),
        expiresAt: Math.floor(a.expiresAt),
        damageByUser,
        hitsCount:
          typeof a.hitsCount === "number" && Number.isFinite(a.hitsCount) && a.hitsCount >= 0
            ? Math.floor(a.hitsCount)
            : 0,
      };
    }
  }

  const respawnAt =
    typeof obj.respawnAt === "number" && Number.isFinite(obj.respawnAt) && obj.respawnAt > 0
      ? Math.floor(obj.respawnAt)
      : 0;

  const history: DefeatedBossRecord[] = [];
  if (Array.isArray(obj.history)) {
    for (const item of obj.history) {
      if (history.length >= WORLD_BOSS_HISTORY_LIMIT) break;
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      if (typeof rec.bossName !== "string" || typeof rec.maxHp !== "number") continue;
      const rankings: { userJid: string; damage: number; sharePercent: number }[] = [];
      if (Array.isArray(rec.rankings)) {
        for (const r of rec.rankings) {
          if (!r || typeof r !== "object" || Array.isArray(r)) continue;
          const rr = r as Record<string, unknown>;
          if (typeof rr.userJid === "string" && typeof rr.damage === "number") {
            rankings.push({
              userJid: rr.userJid,
              damage: Math.floor(rr.damage),
              sharePercent: typeof rr.sharePercent === "number" ? rr.sharePercent : 0,
            });
          }
        }
      }
      history.push({
        bossId: typeof rec.bossId === "string" ? rec.bossId : undefined,
        bossName: rec.bossName,
        maxHp: Math.floor(rec.maxHp),
        remainingHp: typeof rec.remainingHp === "number" ? Math.floor(rec.remainingHp) : 0,
        outcome: rec.outcome === "escaped" ? "escaped" : "defeated",
        defeatedAt:
          typeof rec.defeatedAt === "number" && Number.isFinite(rec.defeatedAt)
            ? Math.floor(rec.defeatedAt)
            : 0,
        finisherJid: typeof rec.finisherJid === "string" ? rec.finisherJid : null,
        rankings,
      });
    }
  }

  return { active, respawnAt, history };
}

function serializePersistedWorldBossState(
  active: ActiveWorldBoss | null,
  respawnAt: number,
  history: DefeatedBossRecord[],
): Prisma.InputJsonValue {
  const damageObj: Record<string, number> = {};
  if (active) {
    for (const [jid, dmg] of active.damageByUser.entries()) {
      if (dmg > 0) damageObj[jid] = dmg;
    }
  }

  return {
    active: active
      ? {
          specId: active.spec.id,
          currentHp: active.currentHp,
          spawnedAt: active.spawnedAt,
          expiresAt: active.expiresAt,
          hitsCount: active.hitsCount,
          damageByUser: damageObj,
        }
      : null,
    respawnAt: Math.max(0, Math.floor(respawnAt)),
    history: history.slice(0, WORLD_BOSS_HISTORY_LIMIT).map((h) => ({
      bossId: h.bossId ?? null,
      bossName: h.bossName,
      maxHp: h.maxHp,
      remainingHp: h.remainingHp ?? 0,
      outcome: h.outcome,
      defeatedAt: h.defeatedAt,
      finisherJid: h.finisherJid,
      rankings: h.rankings.slice(0, 15).map((r) => ({
        userJid: r.userJid,
        damage: r.damage,
        sharePercent: r.sharePercent,
      })),
    })),
  };
}

export class RaidFarmBuffBountyService {
  private readonly activeBossByGroup = new Map<string, ActiveWorldBoss>();
  private readonly bossHistoryByGroup = new Map<string, DefeatedBossRecord[]>();
  private readonly bossRespawnAtByGroup = new Map<string, number>();
  private readonly hydratedBossGroups = new Set<string>();
  private readonly bountiesByGroup = new Map<string, Map<string, BountyEntry>>();

  constructor(
    private readonly profileRepo: RaidProfileStore = new GroupMemberProfileRepository(),
    private readonly txRepo: RaidTxStore = new GroupMemberTransactionRepository(),
    private readonly random: RandomProvider = defaultRandom,
    private readonly db: RaidDb = prisma,
  ) {}

  private async hydrateGroupBossState(groupJid: string): Promise<void> {
    if (this.hydratedBossGroups.has(groupJid)) return;
    this.hydratedBossGroups.add(groupJid);

    if (!this.db.tenantGroup) return;
    try {
      const tenant = await this.db.tenantGroup.findUnique({ where: { groupJid } });
      if (!tenant?.worldBossState) return;
      const parsed = parsePersistedWorldBossState(groupJid, tenant.worldBossState);
      if (parsed.active) {
        this.activeBossByGroup.set(groupJid, parsed.active);
        evictOldestIfNeeded(this.activeBossByGroup, MAX_ACTIVE_GROUPS);
      }
      if (parsed.respawnAt > 0) {
        this.bossRespawnAtByGroup.set(groupJid, parsed.respawnAt);
        evictOldestIfNeeded(this.bossRespawnAtByGroup, MAX_ACTIVE_GROUPS);
      }
      if (parsed.history.length > 0) {
        this.bossHistoryByGroup.set(groupJid, parsed.history);
        evictOldestIfNeeded(this.bossHistoryByGroup, MAX_ACTIVE_GROUPS);
      }
    } catch {
      // Abaikan jika gagal membaca state boss dari DB; fallback aman ke state in-memory
    }
  }

  private async persistGroupBossState(groupJid: string, tx?: RaidTx): Promise<void> {
    const tenantClient = tx?.tenantGroup ?? this.db.tenantGroup;
    if (!tenantClient) return;
    const payload = serializePersistedWorldBossState(
      this.activeBossByGroup.get(groupJid) ?? null,
      this.bossRespawnAtByGroup.get(groupJid) ?? 0,
      this.bossHistoryByGroup.get(groupJid) ?? [],
    );
    try {
      await tenantClient.update({
        where: { groupJid },
        data: { worldBossState: payload },
      });
    } catch {
      // Abaikan jika tenant mock belum dibuat di unit test
    }
  }

  private pushBossHistory(groupJid: string, record: DefeatedBossRecord): void {
    const prev = this.bossHistoryByGroup.get(groupJid) ?? [];
    const next = [record, ...prev].slice(0, WORLD_BOSS_HISTORY_LIMIT);
    this.bossHistoryByGroup.set(groupJid, next);
    evictOldestIfNeeded(this.bossHistoryByGroup, MAX_ACTIVE_GROUPS);
  }

  private createFreshWorldBoss(groupJid: string, nowMs: number): ActiveWorldBoss {
    const idx = this.random.intBetween(0, WORLD_BOSS_CATALOG.length - 1);
    const spec = WORLD_BOSS_CATALOG[idx] ?? WORLD_BOSS_CATALOG[0];
    if (!spec) {
      throw new AppUserError("Katalog World Boss tidak tersedia.");
    }

    const boss: ActiveWorldBoss = {
      groupJid,
      spec,
      currentHp: spec.maxHp,
      spawnedAt: nowMs,
      expiresAt: nowMs + WORLD_BOSS_TTL_MS,
      damageByUser: new Map<string, number>(),
      hitsCount: 0,
    };
    this.activeBossByGroup.set(groupJid, boss);
    evictOldestIfNeeded(this.activeBossByGroup, MAX_ACTIVE_GROUPS);
    return boss;
  }

  // ======================== 1. WORLD BOSS RAID ========================

  async inspectOrSpawnWorldBoss(
    groupJid: string,
    nowMs: number = Date.now(),
  ): Promise<WorldBossInspectResult> {
    await this.hydrateGroupBossState(groupJid);
    const expiredChanged = this.sweepBosses(nowMs);
    if (expiredChanged) {
      await this.persistGroupBossState(groupJid);
    }

    const existing = this.activeBossByGroup.get(groupJid);
    if (existing && existing.currentHp > 0 && existing.expiresAt > nowMs) {
      return {
        spawned: false,
        boss: existing,
        topDamagers: buildDamageRankings(existing.damageByUser),
        remainingMs: existing.expiresAt - nowMs,
      };
    }

    const respawnAt = this.bossRespawnAtByGroup.get(groupJid) ?? 0;
    if (respawnAt > nowMs) {
      throw new AppUserError(
        `World Boss baru saja dikalahkan! Boss berikutnya muncul dalam *${formatRemainingDuration(respawnAt - nowMs)}*.`,
      );
    }

    const boss = this.createFreshWorldBoss(groupJid, nowMs);
    await this.persistGroupBossState(groupJid);

    return {
      spawned: true,
      boss,
      topDamagers: [],
      remainingMs: WORLD_BOSS_TTL_MS,
    };
  }

  async getWorldBossStatus(
    groupJid: string,
    nowMs: number = Date.now(),
  ): Promise<{
    active: ActiveWorldBoss | null;
    topDamagers: { userJid: string; damage: number; sharePercent: number }[];
    remainingMs: number;
    respawnRemainingMs: number;
    lastDefeated: DefeatedBossRecord | null;
    history: DefeatedBossRecord[];
  }> {
    await this.hydrateGroupBossState(groupJid);
    const expiredChanged = this.sweepBosses(nowMs);
    if (expiredChanged) {
      await this.persistGroupBossState(groupJid);
    }

    const active = this.activeBossByGroup.get(groupJid) ?? null;
    const respawnAt = this.bossRespawnAtByGroup.get(groupJid) ?? 0;
    const history = this.bossHistoryByGroup.get(groupJid) ?? [];
    return {
      active,
      topDamagers: active ? buildDamageRankings(active.damageByUser) : [],
      remainingMs: active ? Math.max(0, active.expiresAt - nowMs) : 0,
      respawnRemainingMs: Math.max(0, respawnAt - nowMs),
      lastDefeated: history[0] ?? null,
      history,
    };
  }

  async getAllTimeTopBossDamage(
    groupJid: string,
    limit = 10,
  ): Promise<AllTimeBossDamageEntry[]> {
    if (!this.profileRepo.listTopByBossDamage) {
      return [];
    }
    const rows = await this.profileRepo.listTopByBossDamage(groupJid, limit);
    return rows.map((row) => ({
      userJid: row.profile.userJid,
      totalDamage: row.totalDamage,
      bossKills: row.bossKills,
      bossMvpCount: row.bossMvpCount,
    }));
  }

  async getWorldBossHistory(
    groupJid: string,
    nowMs: number = Date.now(),
  ): Promise<DefeatedBossRecord[]> {
    await this.hydrateGroupBossState(groupJid);
    const expiredChanged = this.sweepBosses(nowMs);
    if (expiredChanged) {
      await this.persistGroupBossState(groupJid);
    }
    return this.bossHistoryByGroup.get(groupJid) ?? [];
  }

  async getTopBossDamage(
    groupJid: string,
    nowMs: number = Date.now(),
  ): Promise<TopBossDamageResult | null> {
    await this.hydrateGroupBossState(groupJid);
    const expiredChanged = this.sweepBosses(nowMs);
    if (expiredChanged) {
      await this.persistGroupBossState(groupJid);
    }

    const active = this.activeBossByGroup.get(groupJid);
    const history = this.bossHistoryByGroup.get(groupJid) ?? [];
    const allTimeTop = await this.getAllTimeTopBossDamage(groupJid, 5);

    if (active && active.damageByUser.size > 0) {
      return {
        source: "active",
        isActive: true,
        bossName: active.spec.name,
        currentHp: active.currentHp,
        maxHp: active.spec.maxHp,
        activeBossPendingName: null,
        rankings: buildDamageRankings(active.damageByUser),
        allTimeTop,
      };
    }

    const last = history[0];
    if (last && last.rankings.length > 0) {
      return {
        source: "last",
        isActive: false,
        bossName: last.bossName,
        outcome: last.outcome,
        currentHp: last.remainingHp ?? 0,
        maxHp: last.maxHp,
        activeBossPendingName: active ? active.spec.name : null,
        rankings: last.rankings,
        allTimeTop,
      };
    }

    if (allTimeTop.length > 0) {
      return {
        source: "alltime",
        isActive: Boolean(active),
        bossName: active ? active.spec.name : "All-Time Raid",
        currentHp: active ? active.currentHp : 0,
        maxHp: active ? active.spec.maxHp : 0,
        activeBossPendingName: active ? active.spec.name : null,
        rankings: [],
        allTimeTop,
      };
    }

    return null;
  }

  async attackWorldBoss(
    groupJid: string,
    userJid: string,
    nowMs: number = Date.now(),
  ): Promise<WorldBossAttackResult> {
    await this.hydrateGroupBossState(groupJid);
    const expiredChanged = this.sweepBosses(nowMs);
    if (expiredChanged) {
      await this.persistGroupBossState(groupJid);
    }

    const normUser = normalizeUserJid(userJid);
    if (!normUser) {
      throw new AppUserError("Identitas pengguna tidak valid.");
    }

    let boss = this.activeBossByGroup.get(groupJid);
    let autoSpawned = false;
    if (!boss || boss.currentHp <= 0 || boss.expiresAt <= nowMs) {
      const respawnAt = this.bossRespawnAtByGroup.get(groupJid) ?? 0;
      if (respawnAt > nowMs) {
        throw new AppUserError(
          `World Boss sedang istirahat! Boss baru muncul dalam *${formatRemainingDuration(respawnAt - nowMs)}*.`,
        );
      }
      boss = this.createFreshWorldBoss(groupJid, nowMs);
      autoSpawned = true;
    }

    const activeBoss = boss;
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      const state = parseRpgState(profile.rpgState);

      const jailRem = getRemainingJailMs(state, nowMs);
      if (jailRem > 0) {
        throw new AppUserError(
          `Kamu sedang di penjara (*${formatRemainingDuration(jailRem)}*)! Tidak bisa ikut raid.`,
        );
      }
      const ugdRem = getRemainingUgdMs(state, nowMs);
      if (ugdRem > 0) {
        throw new AppUserError(
          `Kamu sedang dirawat di UGD (*${formatRemainingDuration(ugdRem)}*)! Pulihkan diri dulu.`,
        );
      }
      if (state.hp < WORLD_BOSS_MIN_HP) {
        throw new AppUserError(
          `HP terlalu rendah (${String(state.hp)}/${String(MAX_PLAYER_HP)})! Gunakan *.heal* sebelum menyerang World Boss.`,
        );
      }

      const cdRem = getRemainingCooldownMs(state, "worldboss_hit", WORLD_BOSS_ATTACK_COOLDOWN_MS, nowMs);
      if (cdRem > 0) {
        throw new AppUserError(
          `Tenagamu masih pulih! Serang World Boss lagi dalam *${formatRemainingDuration(cdRem)}*.`,
        );
      }

      const power = calculatePlayerCombatPower(profile.level, state, undefined, nowMs);
      const variancePct = this.random.intBetween(180, 260);
      const critChance = Math.min(0.45, 0.1 + state.skills.agi * 0.015);
      const isCrit = this.random.chance(critChance);
      const critMult = isCrit ? 1.6 + state.skills.luk * 0.01 : 1;

      const rawDamage = Math.round(((power * variancePct) / 100 + state.skills.str * 15) * critMult);
      const damageDealt = Math.max(50, Math.min(activeBoss.currentHp, rawDamage));

      const rawCounter = this.random.intBetween(8, 18);
      const armorMitigation = Math.min(8, state.tools.armor.level);
      const afterArmor = Math.max(3, rawCounter - armorMitigation);
      const hpLost = isBuffActive(state, "perisaibaja", nowMs)
        ? Math.max(2, Math.round(afterArmor * 0.6))
        : afterArmor;
      const hpAfter = Math.max(1, state.hp - hpLost);

      const participationXp = applyXpMultipliers(
        45,
        state.skills.int,
        isBuffActive(state, "ramuanxp", nowMs),
      );

      let updatedState = withUpdatedCooldown(withHp(state, hpAfter), "worldboss_hit", nowMs);
      updatedState = withBossRaidStatsDelta(updatedState, { damageDelta: damageDealt });

      await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          experience: { increment: participationXp },
          rpgState: serializeRpgState(updatedState),
        },
      });

      activeBoss.currentHp = Math.max(0, activeBoss.currentHp - damageDealt);
      activeBoss.hitsCount += 1;
      activeBoss.damageByUser.set(normUser, (activeBoss.damageByUser.get(normUser) ?? 0) + damageDealt);

      if (activeBoss.currentHp > 0) {
        await this.persistGroupBossState(groupJid, tx);
        return {
          autoSpawned,
          bossName: activeBoss.spec.name,
          damageDealt,
          isCrit,
          bossHpAfter: activeBoss.currentHp,
          bossMaxHp: activeBoss.spec.maxHp,
          hpLost,
          hpAfter,
          participationXp,
          defeated: false,
          distributions: [],
          totalPoolPaid: 0n,
        };
      }

      // Boss defeated! Distribute pool proportionally by damage share
      const rankings = buildDamageRankings(activeBoss.damageByUser);
      const totalDamage = rankings.reduce((acc, r) => acc + r.damage, 0);
      const distributions: WorldBossRewardDistribution[] = [];
      let totalPoolPaid = 0n;

      for (let i = 0; i < rankings.length; i += 1) {
        const entry = rankings[i];
        if (!entry) continue;
        const memberProf = await this.profileRepo.findOrCreate(groupJid, entry.userJid, tx);
        const memberState = parseRpgState(memberProf.rpgState);
        const isMvp = i === 0;
        const isFinisher = entry.userJid === normUser;

        const baseShare =
          totalDamage > 0
            ? (activeBoss.spec.rewardPool * BigInt(entry.damage)) / BigInt(totalDamage)
            : activeBoss.spec.rewardPool;
        const mvpBonus = isMvp ? percentOfBigInt(baseShare, 15) : 0n;
        const lukBonus =
          memberState.skills.luk > 0
            ? percentOfBigInt(baseShare, Math.min(20, memberState.skills.luk))
            : 0n;
        const buffBonus = isBuffActive(memberState, "jimatcuan", nowMs)
          ? percentOfBigInt(baseShare + mvpBonus + lukBonus, 25)
          : 0n;

        const grossMoney = baseShare + mvpBonus + lukBonus + buffBonus;
        const moneyGained = clampMoneyCredit(memberProf.moneyBalance, grossMoney);

        const rawXp = activeBoss.spec.baseXp + (isMvp ? 120 : 0) + (isFinisher ? 150 : 0);
        const xpGained = applyXpMultipliers(
          rawXp,
          memberState.skills.int,
          isBuffActive(memberState, "ramuanxp", nowMs),
        );

        const crateGained: CrateType = i < 3 ? activeBoss.spec.crateDrop : "common";
        let nextMemberState = withCrateDelta(memberState, crateGained, 1);
        nextMemberState = withBossRaidStatsDelta(nextMemberState, {
          killsDelta: 1,
          mvpDelta: isMvp ? 1 : 0,
        });

        const updatedMember = await tx.groupMemberProfile.update({
          where: { id: memberProf.id },
          data: {
            moneyBalance: { increment: moneyGained },
            totalMoneyEarned: { increment: moneyGained },
            experience: { increment: xpGained },
            rpgState: serializeRpgState(nextMemberState),
          },
        });

        if (moneyGained > 0n) {
          await this.txRepo.create(
            {
              profileId: memberProf.id,
              groupJid,
              userJid: entry.userJid,
              asset: MemberTransactionAsset.MONEY,
              type: MemberTransactionType.RPG_EARN,
              amount: moneyGained,
              balanceBefore: memberProf.moneyBalance,
              balanceAfter: updatedMember.moneyBalance,
              correlationId,
              note: `worldboss_${activeBoss.spec.id}`,
            },
            tx,
          );
        }

        totalPoolPaid += moneyGained;
        distributions.push({
          userJid: entry.userJid,
          damage: entry.damage,
          sharePercent: entry.sharePercent,
          moneyGained,
          xpGained,
          crateGained,
          isMvp,
          isFinisher,
        });
      }

      this.activeBossByGroup.delete(groupJid);
      this.bossRespawnAtByGroup.set(groupJid, nowMs + WORLD_BOSS_RESPAWN_COOLDOWN_MS);
      this.pushBossHistory(groupJid, {
        bossId: activeBoss.spec.id,
        bossName: activeBoss.spec.name,
        maxHp: activeBoss.spec.maxHp,
        remainingHp: 0,
        outcome: "defeated",
        defeatedAt: nowMs,
        finisherJid: normUser,
        rankings,
      });
      evictOldestIfNeeded(this.bossRespawnAtByGroup, MAX_ACTIVE_GROUPS);
      await this.persistGroupBossState(groupJid, tx);

      return {
        autoSpawned,
        bossName: activeBoss.spec.name,
        damageDealt,
        isCrit,
        bossHpAfter: 0,
        bossMaxHp: activeBoss.spec.maxHp,
        hpLost,
        hpAfter,
        participationXp,
        defeated: true,
        distributions,
        totalPoolPaid,
      };
    });
  }

  // ======================== 2. SKILL TREE ========================

  async getSkillOverview(
    groupJid: string,
    userJid: string,
    nowMs: number = Date.now(),
  ): Promise<SkillOverviewResult> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);
    const totalSkillPoints = getTotalSkillPointsForLevel(profile.level);
    const spentSkillPoints = getSpentSkillPoints(state);
    const freeSkillPoints = Math.max(0, totalSkillPoints - spentSkillPoints);

    return {
      level: Math.max(1, profile.level),
      totalSkillPoints,
      spentSkillPoints,
      freeSkillPoints,
      skills: { ...state.skills },
      combatPower: calculatePlayerCombatPower(profile.level, state, undefined, nowMs),
    };
  }

  async upgradeSkill(
    groupJid: string,
    userJid: string,
    rawStat: string,
    amount = 1,
    nowMs: number = Date.now(),
  ): Promise<SkillUpgradeResult> {
    const key = rawStat.trim().toLowerCase() as SkillKey;
    if (!SKILL_KEYS.includes(key)) {
      throw new AppUserError("Stat tidak dikenal. Pilih salah satu: *str*, *agi*, *luk*, *int*, *cha*.");
    }
    if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_SKILL_STAT) {
      throw new AppUserError(`Jumlah poin skill harus antara 1 sampai ${String(MAX_SKILL_STAT)}.`);
    }

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const totalSp = getTotalSkillPointsForLevel(profile.level);
      const spentSp = getSpentSkillPoints(state);
      const freeSp = Math.max(0, totalSp - spentSp);

      if (freeSp < amount) {
        throw new AppUserError(
          `Skill Point kamu tidak cukup! Sisa SP: *${String(freeSp)}* (naikkan level lewat *.levelup* untuk dapat +2 SP/level).`,
        );
      }

      const currentVal = state.skills[key];
      if (currentVal + amount > MAX_SKILL_STAT) {
        throw new AppUserError(
          `Stat *${key.toUpperCase()}* maksimal ${String(MAX_SKILL_STAT)} (saat ini: ${String(currentVal)}).`,
        );
      }

      const nextSkills: Record<SkillKey, number> = {
        ...state.skills,
        [key]: currentVal + amount,
      };
      const nextState = withSkills(state, nextSkills);

      await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: { rpgState: serializeRpgState(nextState) },
      });

      return {
        stat: key,
        statLabel: SKILL_SPECS[key].label,
        added: amount,
        newStatValue: nextState.skills[key],
        freeSkillPoints: freeSp - amount,
        combatPower: calculatePlayerCombatPower(profile.level, nextState, undefined, nowMs),
      };
    });
  }

  async resetSkills(groupJid: string, userJid: string): Promise<SkillResetResult> {
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const spentSp = getSpentSkillPoints(state);

      if (spentSp <= 0) {
        throw new AppUserError("Semua stat skill kamu masih 0, tidak perlu di-reset.");
      }

      if (profile.moneyBalance < SKILL_RESET_COST) {
        throw new AppUserError(
          `Biaya reset skill adalah *${formatRupiah(SKILL_RESET_COST)}*, dompetmu baru ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const nextState = withSkills(state, { str: 0, agi: 0, luk: 0, int: 0, cha: 0 });
      const res = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: SKILL_RESET_COST } },
        data: {
          moneyBalance: { decrement: SKILL_RESET_COST },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (res.count === 0) {
        throw new AppUserError("Saldo dompet tidak mencukupi untuk reset skill.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -SKILL_RESET_COST,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: "skill_reset",
        },
        tx,
      );

      return {
        costPaid: SKILL_RESET_COST,
        refundedPoints: spentSp,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  // ======================== 3. LADANG & PASAR KOMODITAS ========================

  async getFarmOverview(
    groupJid: string,
    userJid: string,
    nowMs: number = Date.now(),
  ): Promise<FarmOverviewResult> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);
    const { quotes } = getCommodityMarketQuotesAt(nowMs);
    const priceById = new Map<string, bigint>(quotes.map((q) => [q.crop.id, q.price]));

    const plots = state.farm.plots.map((p) => {
      const spec = FARM_CROP_MAP.get(p.cropId);
      const remainingMs = Math.max(0, p.readyAt - nowMs);
      return {
        cropId: p.cropId,
        label: spec?.label ?? p.cropId,
        watered: p.watered,
        ready: remainingMs === 0,
        remainingMs,
      };
    });

    let estimatedSellTotal = 0n;
    const harvest = Object.entries(state.farm.harvest)
      .filter(([, qty]) => qty > 0)
      .map(([cropId, qty]) => {
        const spec = FARM_CROP_MAP.get(cropId);
        const unitPrice = priceById.get(cropId) ?? spec?.baseMarketPrice ?? 100_000n;
        const subtotal = unitPrice * BigInt(qty);
        estimatedSellTotal += subtotal;
        return {
          cropId,
          label: spec?.label ?? cropId,
          qty,
          unitPrice,
          subtotal,
        };
      });

    return {
      maxPlots: MAX_FARM_PLOTS,
      plots,
      harvest,
      estimatedSellTotal,
    };
  }

  async plantCrop(
    groupJid: string,
    userJid: string,
    rawCropId: string,
    quantity = 1,
    nowMs: number = Date.now(),
  ): Promise<PlantCropResult> {
    const crop = FARM_CROP_MAP.get(rawCropId.trim().toLowerCase());
    if (!crop) {
      const ids = FARM_CROP_CATALOG.map((c) => c.id).join(", ");
      throw new AppUserError(`Bibit "${rawCropId}" tidak dikenal. Bibit tersedia: ${ids}.`);
    }
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_FARM_PLOTS) {
      throw new AppUserError(`Jumlah petak tanam harus antara 1 sampai ${String(MAX_FARM_PLOTS)}.`);
    }

    const totalCost = crop.seedPrice * BigInt(quantity);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const playerLevel = Math.max(1, profile.level);
      if (playerLevel < crop.minLevel) {
        throw new AppUserError(
          `Menanam *${crop.label}* membutuhkan minimal *Level ${String(crop.minLevel)}* (levelmu saat ini Lv.${String(playerLevel)}). Naikkan lewat *.levelup*!`,
        );
      }
      const state = parseRpgState(profile.rpgState);
      const freeSlots = MAX_FARM_PLOTS - state.farm.plots.length;

      if (freeSlots < quantity) {
        throw new AppUserError(
          `Petak ladang kosong hanya *${String(freeSlots)}* dari ${String(MAX_FARM_PLOTS)}. Panen dulu lewat *.panenladang*!`,
        );
      }
      if (profile.moneyBalance < totalCost) {
        throw new AppUserError(
          `Uang dompet kurang! Biaya ${String(quantity)}x bibit ${crop.label} = *${formatRupiah(totalCost)}*, dompetmu ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const growMs = crop.growMinutes * 60 * 1000;
      const newPlots: FarmPlotState[] = [...state.farm.plots];
      for (let i = 0; i < quantity; i += 1) {
        newPlots.push({
          cropId: crop.id,
          plantedAt: nowMs,
          readyAt: nowMs + growMs,
          watered: false,
        });
      }

      const nextState = withFarm(state, { plots: newPlots, harvest: state.farm.harvest });
      const res = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: totalCost } },
        data: {
          moneyBalance: { decrement: totalCost },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (res.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup untuk membeli bibit.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
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
          note: `farm_plant_${crop.id}`,
        },
        tx,
      );

      return {
        crop,
        plantedCount: quantity,
        totalCost,
        currentMoney: updated.moneyBalance,
        usedPlots: nextState.farm.plots.length,
        maxPlots: MAX_FARM_PLOTS,
      };
    });
  }

  async waterFarm(
    groupJid: string,
    userJid: string,
    nowMs: number = Date.now(),
  ): Promise<WaterFarmResult> {
    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);

      let wateredCount = 0;
      const nextPlots = state.farm.plots.map((p) => {
        if (!p.watered && p.readyAt > nowMs) {
          wateredCount += 1;
          const remaining = p.readyAt - nowMs;
          const reduced = Math.floor((remaining * (100 - FARM_WATER_SPEEDUP_PERCENT)) / 100);
          return { ...p, watered: true, readyAt: nowMs + reduced };
        }
        return p;
      });

      if (wateredCount === 0) {
        throw new AppUserError(
          "Tidak ada tanaman yang perlu disiram (semua sudah disiram, sudah siap panen, atau ladang kosong).",
        );
      }

      const xpGained = applyXpMultipliers(
        25 * wateredCount,
        state.skills.int,
        isBuffActive(state, "ramuanxp", nowMs),
      );
      const nextState = withFarm(state, { plots: nextPlots, harvest: state.farm.harvest });

      await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          experience: { increment: xpGained },
          rpgState: serializeRpgState(nextState),
        },
      });

      return { wateredCount, xpGained };
    });
  }

  async harvestFarm(
    groupJid: string,
    userJid: string,
    nowMs: number = Date.now(),
  ): Promise<HarvestFarmResult> {
    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);

      const remainingPlots: FarmPlotState[] = [];
      const yielded: Record<string, number> = {};
      let harvestedPlots = 0;

      for (const plot of state.farm.plots) {
        if (plot.readyAt <= nowMs) {
          harvestedPlots += 1;
          const spec = FARM_CROP_MAP.get(plot.cropId);
          const baseQty = spec
            ? this.random.intBetween(spec.minYield, spec.maxYield)
            : 3;
          const extraLuckChance = Math.min(0.6, state.skills.luk * 0.02);
          const bonus = this.random.chance(extraLuckChance) ? 1 : 0;
          yielded[plot.cropId] = (yielded[plot.cropId] ?? 0) + baseQty + bonus;
        } else {
          remainingPlots.push(plot);
        }
      }

      if (harvestedPlots === 0) {
        throw new AppUserError(
          "Belum ada tanaman yang siap dipanen! Cek waktu tumbuh di *.ladang* atau percepat dengan *.siram*.",
        );
      }

      const nextHarvest: Record<string, number> = { ...state.farm.harvest };
      for (const [cropId, qty] of Object.entries(yielded)) {
        nextHarvest[cropId] = (nextHarvest[cropId] ?? 0) + qty;
      }

      const xpGained = applyXpMultipliers(
        40 * harvestedPlots,
        state.skills.int,
        isBuffActive(state, "ramuanxp", nowMs),
      );
      const nextState = withFarm(state, { plots: remainingPlots, harvest: nextHarvest });

      await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          experience: { increment: xpGained },
          rpgState: serializeRpgState(nextState),
        },
      });

      return { harvestedPlots, yielded, xpGained };
    });
  }

  getCommodityMarket(nowMs: number = Date.now()): {
    quotes: CommodityQuote[];
    nextRefreshMs: number;
  } {
    return getCommodityMarketQuotesAt(nowMs);
  }

  async sellAllHarvest(
    groupJid: string,
    userJid: string,
    nowMs: number = Date.now(),
  ): Promise<SellHarvestResult> {
    const { quotes } = getCommodityMarketQuotesAt(nowMs);
    const priceById = new Map<string, bigint>(quotes.map((q) => [q.crop.id, q.price]));
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const entries = Object.entries(state.farm.harvest).filter(([, qty]) => qty > 0);

      if (entries.length === 0) {
        throw new AppUserError(
          "Gudang hasil panen ladangmu kosong! Tanam dulu lewat *.tanam <bibit>* lalu *.panenladang*.",
        );
      }

      let baseTotal = 0n;
      const itemsSold: { cropId: string; label: string; qty: number; subtotal: bigint }[] = [];
      for (const [cropId, qty] of entries) {
        const spec = FARM_CROP_MAP.get(cropId);
        const unitPrice = priceById.get(cropId) ?? spec?.baseMarketPrice ?? 100_000n;
        const subtotal = unitPrice * BigInt(qty);
        baseTotal += subtotal;
        itemsSold.push({
          cropId,
          label: spec?.label ?? cropId,
          qty,
          subtotal,
        });
      }

      const chaBonusPercent = Math.min(30, Math.round(state.skills.cha * 1.5));
      const buffBonusPercent = isBuffActive(state, "jimatcuan", nowMs) ? 25 : 0;
      const gross =
        (baseTotal * BigInt(100 + chaBonusPercent + buffBonusPercent)) / 100n;
      const totalReceived = clampMoneyCredit(profile.moneyBalance, gross);

      const nextState = withFarm(state, { plots: state.farm.plots, harvest: {} });
      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          moneyBalance: { increment: totalReceived },
          totalMoneyEarned: { increment: totalReceived },
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
          amount: totalReceived,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: "farm_sell_all",
        },
        tx,
      );

      return {
        itemsSold,
        baseTotal,
        chaBonusPercent,
        buffBonusPercent,
        totalReceived,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  // ======================== 4. BLACK MARKET BUFFS ========================

  async getBlackMarketOverview(
    groupJid: string,
    userJid: string,
    nowMs: number = Date.now(),
  ): Promise<BlackMarketOverviewResult> {
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid);
    const state = parseRpgState(profile.rpgState);
    const items = BLACK_MARKET_CATALOG.map((spec) => ({
      spec,
      ownedQty: state.items[spec.itemKey] ?? 0,
      activeRemainingMs: Math.max(0, state.buffs[spec.id] - nowMs),
    }));
    return { items, currentMoney: profile.moneyBalance };
  }

  async buyBlackMarketBuff(
    groupJid: string,
    userJid: string,
    rawBuffId: string,
    quantity = 1,
  ): Promise<BuyBuffResult> {
    const key = rawBuffId.trim().toLowerCase() as BuffKey;
    const spec = BLACK_MARKET_MAP.get(key);
    if (!spec) {
      const ids = BUFF_KEYS.join(", ");
      throw new AppUserError(`Item Black Market "${rawBuffId}" tidak ditemukan. Pilihan: ${ids}.`);
    }
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 10) {
      throw new AppUserError("Jumlah pembelian item Black Market harus antara 1 sampai 10.");
    }

    const totalCost = spec.price * BigInt(quantity);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      if (profile.moneyBalance < totalCost) {
        throw new AppUserError(
          `Uang dompet kurang! Harga ${String(quantity)}x ${spec.label} = *${formatRupiah(totalCost)}*, dompetmu ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const state = parseRpgState(profile.rpgState);
      const nextState = withItemDelta(state, spec.itemKey, quantity);
      const res = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: totalCost } },
        data: {
          moneyBalance: { decrement: totalCost },
          rpgState: serializeRpgState(nextState),
        },
      });
      if (res.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup untuk transaksi Black Market.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
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
          note: `bm_buy_${spec.id}`,
        },
        tx,
      );

      return {
        spec,
        quantity,
        totalCost,
        ownedAfter: nextState.items[spec.itemKey] ?? 0,
        currentMoney: updated.moneyBalance,
      };
    });
  }

  async useBlackMarketBuff(
    groupJid: string,
    userJid: string,
    rawBuffId: string,
    nowMs: number = Date.now(),
  ): Promise<UseBuffResult> {
    const key = rawBuffId.trim().toLowerCase() as BuffKey;
    const spec = BLACK_MARKET_MAP.get(key);
    if (!spec) {
      const ids = BUFF_KEYS.join(", ");
      throw new AppUserError(`Buff "${rawBuffId}" tidak dikenal. Pilihan: ${ids}.`);
    }

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
      const state = parseRpgState(profile.rpgState);
      const owned = state.items[spec.itemKey] ?? 0;
      if (owned <= 0) {
        throw new AppUserError(
          `Kamu belum punya *${spec.label}*! Beli dulu di *.belibuff ${spec.id}*.`,
        );
      }

      const baseStart = Math.max(nowMs, state.buffs[spec.id]);
      const cappedUntil = Math.min(nowMs + BUFF_MAX_STACK_MS, baseStart + BUFF_DURATION_MS);
      const nextState = withBuffUntil(withItemDelta(state, spec.itemKey, -1), spec.id, cappedUntil);

      await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: { rpgState: serializeRpgState(nextState) },
      });

      return {
        spec,
        remainingOwned: nextState.items[spec.itemKey] ?? 0,
        activeRemainingMs: Math.max(0, cappedUntil - nowMs),
      };
    });
  }

  // ======================== 5. SAYEMBARA BURONAN (BOUNTY) ========================

  async postBounty(
    groupJid: string,
    posterJid: string,
    targetJid: string,
    amount: bigint,
    nowMs: number = Date.now(),
  ): Promise<PostBountyResult> {
    this.sweepBounties(nowMs);
    const normPoster = normalizeUserJid(posterJid);
    const normTarget = normalizeUserJid(targetJid);
    if (!normPoster || !normTarget || normPoster === normTarget) {
      throw new AppUserError("Tidak bisa memasang sayembara buronan pada diri sendiri.");
    }
    if (amount < BOUNTY_MIN_AMOUNT || amount > BOUNTY_MAX_AMOUNT) {
      throw new AppUserError(
        `Nominal sayembara harus antara *${formatRupiah(BOUNTY_MIN_AMOUNT)}* sampai *${formatRupiah(BOUNTY_MAX_AMOUNT)}*.`,
      );
    }

    const groupBoard = this.bountiesByGroup.get(groupJid) ?? new Map<string, BountyEntry>();
    if (!groupBoard.has(normTarget) && groupBoard.size >= MAX_BOUNTIES_PER_GROUP) {
      throw new AppUserError(
        `Papan buronan grup sudah penuh (${String(MAX_BOUNTIES_PER_GROUP)} target). Buru buronan yang ada dulu!`,
      );
    }

    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const poster = await this.profileRepo.findOrCreate(groupJid, normPoster, tx);
      if (poster.moneyBalance < amount) {
        throw new AppUserError(
          `Uang dompet kurang! Butuh *${formatRupiah(amount)}*, dompetmu ${formatRupiah(poster.moneyBalance)}.`,
        );
      }

      const debit = await tx.groupMemberProfile.updateMany({
        where: { id: poster.id, moneyBalance: { gte: amount } },
        data: { moneyBalance: { decrement: amount } },
      });
      if (debit.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup untuk memasang bounty.");
      }

      const updatedPoster = await tx.groupMemberProfile.findUniqueOrThrow({
        where: { id: poster.id },
      });
      await this.txRepo.create(
        {
          profileId: poster.id,
          groupJid,
          userJid: normPoster,
          targetUserJid: normTarget,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -amount,
          balanceBefore: poster.moneyBalance,
          balanceAfter: updatedPoster.moneyBalance,
          correlationId,
          note: "bounty_post",
        },
        tx,
      );

      const existing = groupBoard.get(normTarget);
      const nextEntry: BountyEntry = existing
        ? {
            ...existing,
            amount: minBigInt(MAX_SAFE_MONEY_BIGINT, existing.amount + amount),
            postersCount: existing.postersCount + 1,
            lastPosterJid: normPoster,
            expiresAt: nowMs + BOUNTY_TTL_MS,
          }
        : {
            groupJid,
            targetJid: normTarget,
            amount,
            postersCount: 1,
            lastPosterJid: normPoster,
            createdAt: nowMs,
            expiresAt: nowMs + BOUNTY_TTL_MS,
          };

      groupBoard.set(normTarget, nextEntry);
      this.bountiesByGroup.set(groupJid, groupBoard);
      evictOldestIfNeeded(this.bountiesByGroup, MAX_ACTIVE_GROUPS);

      return {
        targetJid: normTarget,
        addedAmount: amount,
        totalBounty: nextEntry.amount,
        posterMoney: updatedPoster.moneyBalance,
        expiresAt: nextEntry.expiresAt,
      };
    });
  }

  listBounties(groupJid: string, nowMs: number = Date.now()): BountyEntry[] {
    this.sweepBounties(nowMs);
    const board = this.bountiesByGroup.get(groupJid);
    if (!board || board.size === 0) return [];
    return Array.from(board.values()).sort((a, b) =>
      a.amount === b.amount ? b.expiresAt - a.expiresAt : a.amount < b.amount ? 1 : -1,
    );
  }

  async huntBounty(
    groupJid: string,
    hunterJid: string,
    targetJid: string,
    nowMs: number = Date.now(),
  ): Promise<HuntBountyResult> {
    this.sweepBounties(nowMs);
    const normHunter = normalizeUserJid(hunterJid);
    const normTarget = normalizeUserJid(targetJid);
    if (!normHunter || !normTarget || normHunter === normTarget) {
      throw new AppUserError("Tidak bisa memburu diri sendiri!");
    }

    const board = this.bountiesByGroup.get(groupJid);
    const entry = board?.get(normTarget);
    if (!entry || entry.expiresAt <= nowMs) {
      throw new AppUserError(
        "Target tersebut tidak sedang menjadi buronan. Cek daftar aktif di *.listbounty*.",
      );
    }

    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const hunter = await this.profileRepo.findOrCreate(groupJid, normHunter, tx);
      const target = await this.profileRepo.findOrCreate(groupJid, normTarget, tx);
      const hunterState = parseRpgState(hunter.rpgState);
      const targetState = parseRpgState(target.rpgState);

      const jailRem = getRemainingJailMs(hunterState, nowMs);
      if (jailRem > 0) {
        throw new AppUserError(
          `Kamu sedang di penjara (*${formatRemainingDuration(jailRem)}*)! Tidak bisa berburu bounty.`,
        );
      }
      const ugdRem = getRemainingUgdMs(hunterState, nowMs);
      if (ugdRem > 0) {
        throw new AppUserError(
          `Kamu sedang di UGD (*${formatRemainingDuration(ugdRem)}*)! Pulih dulu sebelum berburu.`,
        );
      }
      if (hunterState.hp < WORLD_BOSS_MIN_HP) {
        throw new AppUserError(
          `HP terlalu rendah (${String(hunterState.hp)}/${String(MAX_PLAYER_HP)})! Ketik *.heal* dulu.`,
        );
      }

      const cdRem = getRemainingCooldownMs(hunterState, "bounty_hunt", BOUNTY_HUNT_COOLDOWN_MS, nowMs);
      if (cdRem > 0) {
        throw new AppUserError(
          `Tunggu *${formatRemainingDuration(cdRem)}* lagi sebelum berburu buronan berikutnya.`,
        );
      }

      const hunterBase =
        calculatePlayerCombatPower(hunter.level, hunterState, undefined, nowMs) +
        hunterState.skills.agi * 10;
      const targetRaw = calculatePlayerCombatPower(target.level, targetState, undefined, nowMs);
      const targetBase = isBuffActive(targetState, "perisaibaja", nowMs)
        ? Math.round(targetRaw * 1.25)
        : targetRaw;

      const hunterRoll = hunterBase + this.random.intBetween(20, 120);
      const targetRoll = targetBase + this.random.intBetween(15, 115);
      const won = hunterRoll >= targetRoll;

      if (won) {
        board?.delete(normTarget);
        const taxPaid = percentOfBigInt(entry.amount, BOUNTY_TAX_PERCENT);
        const netRaw = entry.amount - taxPaid;
        const netReward = clampMoneyCredit(hunter.moneyBalance, netRaw);
        const xpGained = applyXpMultipliers(
          120,
          hunterState.skills.int,
          isBuffActive(hunterState, "ramuanxp", nowMs),
        );

        const nextHunterState = withUpdatedCooldown(hunterState, "bounty_hunt", nowMs);
        const updatedHunter = await tx.groupMemberProfile.update({
          where: { id: hunter.id },
          data: {
            moneyBalance: { increment: netReward },
            totalMoneyEarned: { increment: netReward },
            experience: { increment: xpGained },
            rpgState: serializeRpgState(nextHunterState),
          },
        });

        await this.txRepo.create(
          {
            profileId: hunter.id,
            groupJid,
            userJid: normHunter,
            targetUserJid: normTarget,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.RPG_EARN,
            amount: netReward,
            balanceBefore: hunter.moneyBalance,
            balanceAfter: updatedHunter.moneyBalance,
            correlationId,
            note: "bounty_claim",
          },
          tx,
        );

        if (tx.tenantGroup && taxPaid > 0n) {
          const tenant = await tx.tenantGroup.findUnique({ where: { groupJid } });
          if (tenant) {
            const curTreasury = tenant.treasuryBalance;
            await tx.tenantGroup.update({
              where: { groupJid },
              data: {
                treasuryBalance: minBigInt(
                  MAX_SAFE_MONEY_BIGINT,
                  (curTreasury > 0n ? curTreasury : DEFAULT_GROUP_TREASURY) + taxPaid,
                ),
              },
            });
          }
        }

        const targetProtectedByBpjs = isInsuranceActive(targetState, "bpjs", nowMs);
        let targetSentToUgd = false;
        if (!targetProtectedByBpjs) {
          targetSentToUgd = true;
          const nextTargetState = withUgdUntil(
            withHp(targetState, Math.max(15, targetState.hp - 25)),
            nowMs + BOUNTY_UGD_MS,
          );
          await tx.groupMemberProfile.update({
            where: { id: target.id },
            data: { rpgState: serializeRpgState(nextTargetState) },
          });
        }

        return {
          won: true,
          hunterJid: normHunter,
          targetJid: normTarget,
          hunterPower: hunterRoll,
          targetPower: targetRoll,
          grossBounty: entry.amount,
          netReward,
          taxPaid,
          xpGained,
          targetSentToUgd,
          targetProtectedByBpjs,
          hunterHpAfter: hunterState.hp,
          failPenaltyPaid: 0n,
          hunterMoneyAfter: updatedHunter.moneyBalance,
        };
      }

      // Target escaped!
      const failPenaltyPaid = minBigInt(hunter.moneyBalance, BOUNTY_FAIL_PENALTY);
      const hunterHpAfter = Math.max(5, hunterState.hp - 15);
      const nextHunterState = withUpdatedCooldown(
        withHp(hunterState, hunterHpAfter),
        "bounty_hunt",
        nowMs,
      );

      const updatedHunter = await tx.groupMemberProfile.update({
        where: { id: hunter.id },
        data: {
          ...(failPenaltyPaid > 0n ? { moneyBalance: { decrement: failPenaltyPaid } } : {}),
          experience: { increment: 25 },
          rpgState: serializeRpgState(nextHunterState),
        },
      });

      if (failPenaltyPaid > 0n) {
        await this.txRepo.create(
          {
            profileId: hunter.id,
            groupJid,
            userJid: normHunter,
            targetUserJid: normTarget,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.RPG_LOSS,
            amount: -failPenaltyPaid,
            balanceBefore: hunter.moneyBalance,
            balanceAfter: updatedHunter.moneyBalance,
            correlationId,
            note: "bounty_hunt_fail",
          },
          tx,
        );
      }

      return {
        won: false,
        hunterJid: normHunter,
        targetJid: normTarget,
        hunterPower: hunterRoll,
        targetPower: targetRoll,
        grossBounty: entry.amount,
        netReward: 0n,
        taxPaid: 0n,
        xpGained: 25,
        targetSentToUgd: false,
        targetProtectedByBpjs: false,
        hunterHpAfter,
        failPenaltyPaid,
        hunterMoneyAfter: updatedHunter.moneyBalance,
      };
    });
  }

  private sweepBosses(nowMs: number): boolean {
    let changed = false;
    for (const [gJid, boss] of this.activeBossByGroup.entries()) {
      if (boss.expiresAt <= nowMs || boss.currentHp <= 0) {
        if (boss.currentHp > 0 && boss.damageByUser.size > 0) {
          this.pushBossHistory(gJid, {
            bossId: boss.spec.id,
            bossName: boss.spec.name,
            maxHp: boss.spec.maxHp,
            remainingHp: boss.currentHp,
            outcome: "escaped",
            defeatedAt: nowMs,
            finisherJid: null,
            rankings: buildDamageRankings(boss.damageByUser),
          });
        }
        this.activeBossByGroup.delete(gJid);
        changed = true;
      }
    }
    for (const [gJid, until] of this.bossRespawnAtByGroup.entries()) {
      if (until <= nowMs) {
        this.bossRespawnAtByGroup.delete(gJid);
        changed = true;
      }
    }
    return changed;
  }

  private sweepBounties(nowMs: number): void {
    for (const [gJid, board] of this.bountiesByGroup.entries()) {
      for (const [target, entry] of board.entries()) {
        if (entry.expiresAt <= nowMs) {
          board.delete(target);
        }
      }
      if (board.size === 0) {
        this.bountiesByGroup.delete(gJid);
      }
    }
  }
}

export const raidFarmBuffBountyService = new RaidFarmBuffBountyService();
