import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupClan,
  type GroupMemberProfile,
  type GroupMemberTransaction,
  type Prisma,
  type TenantGroup,
} from "@prisma/client";

import { AppUserError } from "../../errors/appUserError";
import {
  readGroupEventSection,
  writeGroupEventSection,
} from "../group/groupEventState.store";
import { applyGroupXpEvent } from "../group/groupXpEvent.cache";
import {
  GroupClanRepository,
  parseClanMembers,
} from "../../repositories/groupClan.repository";
import { GroupMemberProfileRepository } from "../../repositories/groupMemberProfile.repository";
import { GroupMemberTransactionRepository } from "../../repositories/groupMemberTransaction.repository";
import { prisma } from "../../repositories/prismaClient";
import {
  clampMoneyCredit,
  formatRemainingDuration,
  formatRupiah,
  minBigInt,
  percentOfBigInt,
} from "../../utils/currency";
import { normalizeUserJid } from "../../utils/jid";
import { calculateReachableLevel, xpRequiredForLevel } from "../member/level.service";
import { generateCorrelationId } from "../member/memberEconomy.service";
import { defaultRandom, type RandomProvider } from "../member/randomProvider";
import {
  nextRankThreshold,
  rankProgress,
  resolveRank,
  type MemberRank,
} from "../member/rank.service";
import {
  CAREER_CATALOG,
  CAREER_MAP,
  PRESTIGE_MIN_PLAYER_LEVEL,
  STARTUP_MIN_PLAYER_LEVEL,
} from "./careerPrestigeCatalog";
import { careerPrestigeService, type TopPrestigeEntry } from "./careerPrestige.service";
import {
  BUDGET_COOLDOWN_MS,
  CLAN_BUFF_COOLDOWN_MS,
  CLAN_WAR_COOLDOWN_MS,
  COUP_GROUP_COOLDOWN_MS,
} from "./cooldownCatalog";
import { BUFF_MAX_STACK_MS, FARM_CROP_CATALOG } from "./raidFarmBuffBounty.service";

export { BUDGET_COOLDOWN_MS, CLAN_BUFF_COOLDOWN_MS, CLAN_WAR_COOLDOWN_MS, COUP_GROUP_COOLDOWN_MS };
import { DEFAULT_GROUP_TREASURY } from "./rpgEconomy.service";
import { PROPERTY_CATALOG } from "./rpgExpansionCatalog";
import { calculatePlayerCombatPower } from "./rpgInfinite.service";
import {
  getRemainingCooldownMs,
  getRemainingJailMs,
  getSpentSkillPoints,
  getTotalSkillPointsForLevel,
  MAX_PLAYER_HP,
  parseRpgState,
  serializeRpgState,
  withBuffUntil,
  withHp,
  withJailUntil,
  withUpdatedCooldown,
} from "./rpgState";

const MAX_POLITICS_GROUPS = 100;
const MAX_CLAN_WAR_COOLDOWNS_PER_GROUP = 50;

export const ELECTION_DURATION_MS = 24 * 60 * 60 * 1000;
export const ELECTION_MAX_CANDIDATES = 8;
export const CANDIDATE_MIN_LEVEL = 5;
export const CANDIDATE_REGISTRATION_FEE = 10_000_000n;
export const VOTE_PARTICIPATION_XP = 50;
export const PRESIDENCY_TERM_MS = 7 * 24 * 60 * 60 * 1000;
export const PRESIDENCY_INAUGURATION_XP = 250;

export const BUDGET_MIN_AMOUNT = 2_000_000n;
export const BUDGET_DEFAULT_AMOUNT = 8_000_000n;
export const BUDGET_MAX_AMOUNT = 30_000_000n;
export const BUDGET_MAX_RECIPIENTS = 15;

export const COUP_MIN_LEVEL = 10;
export const COUP_COST = 15_000_000n;
export const COUP_SUCCESS_RATE = 0.35;
export const COUP_FAIL_JAIL_MS = 15 * 60 * 1000;
export const COUP_SUCCESS_XP = 200;

export const CLAN_MAX_LEVEL = 10;
export const CLAN_UPGRADE_BASE_COST = 25_000_000n;
export const CLAN_POWER_BONUS_PER_LEVEL_PERCENT = 8;
export const CLAN_WAR_LOOT_PERCENT = 12;
export const CLAN_WAR_MAX_LOOT = 50_000_000n;
export const CLAN_WAR_WIN_BONUS_MONEY = 1_500_000n;
export const CLAN_WAR_WIN_BONUS_XP = 120;

export const HISTORY_DEFAULT_LIMIT = 10;
export const HISTORY_MAX_LIMIT = 20;

export interface ElectionCandidate {
  userJid: string;
  slogan: string;
  registeredAt: number;
}

export interface GroupElectionSession {
  groupJid: string;
  startedByJid: string;
  startedAt: number;
  endsAt: number;
  candidates: ElectionCandidate[];
  votes: Map<string, string>; // voterJid -> candidateJid
}

export interface GroupPresidency {
  groupJid: string;
  presidentJid: string;
  slogan: string;
  electedAt: number;
  termEndsAt: number;
  totalDistributed: bigint;
  lastBudgetAt: number;
  coupsRepelled: number;
  viaCoup: boolean;
}

export interface ElectionCandidateSummary {
  index: number;
  userJid: string;
  slogan: string;
  votes: number;
  percent: number;
}

export interface ElectionInspectResult {
  mode: "started" | "active" | "auto_finalized" | "president_serving";
  remainingMs: number;
  totalVotes: number;
  candidates: ElectionCandidateSummary[];
  president: GroupPresidency | null;
  winnerJid: string | null;
  winnerVotes: number;
  winnerXpBonus: number;
}

export interface ElectionFinalizeResult {
  winnerJid: string | null;
  winnerSlogan: string;
  winnerVotes: number;
  totalVotes: number;
  termEndsAt: number;
  xpAwarded: number;
  ranking: ElectionCandidateSummary[];
}

export interface RegisterCandidateResult {
  candidateJid: string;
  slogan: string;
  feePaid: bigint;
  candidateNumber: number;
  totalCandidates: number;
  currentMoney: bigint;
  treasuryBalance: bigint;
}

export interface CastVoteResult {
  voterJid: string;
  candidateJid: string;
  candidateVotes: number;
  totalVotes: number;
  xpGained: number;
}

export interface PresidentStatusSnapshot {
  president: GroupPresidency | null;
  termRemainingMs: number;
  budgetCooldownMs: number;
  coupCooldownMs: number;
  treasuryBalance: bigint;
  hasActiveElection: boolean;
  electionRemainingMs: number;
}

export interface DistributeBudgetResult {
  presidentJid: string;
  requestedAmount: bigint;
  distributedTotal: bigint;
  perMember: bigint;
  recipients: string[];
  remainingTreasury: bigint;
  totalPresidentDistributed: bigint;
}

export interface CoupResult {
  success: boolean;
  challengerJid: string;
  formerPresidentJid: string;
  costPaid: bigint;
  currentMoney: bigint;
  treasuryBalance: bigint;
  jailMinutes: number;
  xpGained: number;
  termEndsAt: number;
  coupsRepelled: number;
}

export interface ClanUpgradeResult {
  clanName: string;
  oldLevel: number;
  newLevel: number;
  costPaid: bigint;
  remainingTreasury: bigint;
  warPowerBonusPercent: number;
  buffDurationMinutes: number;
}

export interface ClanBuffResult {
  clanName: string;
  clanLevel: number;
  hpAfter: number;
  xpGained: number;
  buffMinutesAdded: number;
  jamuRemainingMs: number;
}

export interface ClanWarResult {
  attackerClanName: string;
  defenderClanName: string;
  attackerLevel: number;
  defenderLevel: number;
  attackerMemberCount: number;
  defenderMemberCount: number;
  attackerPower: number;
  defenderPower: number;
  attackerWon: boolean;
  winnerClanName: string;
  loserClanName: string;
  winnerWarWins: number;
  treasuryLoot: bigint;
  winnerTreasuryAfter: bigint;
  loserTreasuryAfter: bigint;
  memberBonusMoney: bigint;
  memberBonusXp: number;
  rewardedMemberJids: string[];
  attackerMvpJid: string | null;
  defenderMvpJid: string | null;
}

export interface PlayerCompareMetrics {
  userJid: string;
  level: number;
  rank: MemberRank;
  experience: number;
  totalCash: bigint;
  wallet: bigint;
  bank: bigint;
  combatPower: number;
  prestige: number;
  careerTitle: string;
  startupLabel: string;
  gamesWon: number;
  gamesPlayed: number;
  winRatePercent: number;
  longestStreak: number;
  totalDonated: bigint;
  propertyCount: number;
  uniqueCardCount: number;
  clanName: string | null;
}

export interface ComparePlayersResult {
  left: PlayerCompareMetrics;
  right: PlayerCompareMetrics;
  leftWins: number;
  rightWins: number;
  ties: number;
  overallWinnerJid: string | null;
}

export interface TargetRankMilestone {
  label: string;
  requiredLevel: number;
  levelsAway: number;
}

export interface TargetRankResult {
  userJid: string;
  currentLevel: number;
  reachableLevel: number;
  experience: number;
  currentLevelXp: number;
  nextLevelXp: number;
  xpToNextLevel: number;
  levelProgressPercent: number;
  currentRank: MemberRank;
  nextRank: MemberRank | null;
  xpToNextRank: number;
  rankProgressPercent: number;
  estimatedKuisRuns: number;
  estimatedKerjaRuns: number;
  estimatedBossRuns: number;
  upcomingMilestones: TargetRankMilestone[];
}

export interface TransactionHistoryItem {
  id: string;
  createdAt: Date;
  asset: MemberTransactionAsset;
  type: MemberTransactionType;
  label: string;
  amount: bigint;
  note: string | null;
}

export interface TransactionHistoryResult {
  userJid: string;
  limit: number;
  entries: TransactionHistoryItem[];
}

export interface PlayerStatisticsResult {
  userJid: string;
  customTitle: string | null;
  level: number;
  rank: MemberRank;
  experience: number;
  prestige: number;
  combatPower: number;
  hp: number;
  unspentSkillPoints: number;
  totalSkillPoints: number;
  wallet: bigint;
  bank: bigint;
  totalCash: bigint;
  totalMoneyEarned: bigint;
  totalDonated: bigint;
  pointsBalance: number;
  limitBalance: number;
  gamesPlayed: number;
  gamesWon: number;
  winRatePercent: number;
  currentStreak: number;
  longestStreak: number;
  messageCount: number;
  propertyUnits: number;
  uniqueCards: number;
  achievementsCount: number;
  careerLabel: string;
  startupLabel: string;
  clanLabel: string;
  wealthRank: number;
  xpRank: number;
  levelRank: number;
}

export interface HallOfFameSnapshot {
  president: GroupPresidency | null;
  richest: { userJid: string; totalCash: bigint } | null;
  topXp: { userJid: string; experience: number; rank: MemberRank } | null;
  topLevel: { userJid: string; level: number } | null;
  topPrestige: TopPrestigeEntry | null;
  topGamesWon: { userJid: string; gamesWon: number } | null;
  topDonated: { userJid: string; totalDonated: bigint } | null;
  topStreak: { userJid: string; longestStreak: number } | null;
  topClan: { name: string; level: number; warWins: number; treasuryBalance: bigint; memberCount: number } | null;
}

interface PoliticsProfileStore {
  findOrCreate(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile>;
  findByGroupAndUser(groupJid: string, userJid: string, tx?: unknown): Promise<GroupMemberProfile | null>;
  listRecentActiveProfiles(groupJid: string, excludeUserJid: string, limit?: number): Promise<GroupMemberProfile[]>;
  listByGroupAndUsers(groupJid: string, userJids: string[], tx?: unknown): Promise<GroupMemberProfile[]>;
  listTopByWealth(groupJid: string, limit?: number): Promise<GroupMemberProfile[]>;
  listTopByExperience(groupJid: string, limit?: number): Promise<GroupMemberProfile[]>;
  listTopByLevel(groupJid: string, limit?: number): Promise<GroupMemberProfile[]>;
  listTopByGamesWon(groupJid: string, limit?: number): Promise<GroupMemberProfile[]>;
  listTopByDonated(groupJid: string, limit?: number): Promise<{ profile: GroupMemberProfile; totalDonated: bigint }[]>;
  listTopByStreak(groupJid: string, limit?: number): Promise<GroupMemberProfile[]>;
  getPositionByWealth(groupJid: string, userJid: string): Promise<number>;
  getPositionByExperience(groupJid: string, userJid: string): Promise<number>;
  getPositionByLevel(groupJid: string, userJid: string): Promise<number>;
}

interface PoliticsTxStore {
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
  listByProfile(profileId: string, limit?: number): Promise<GroupMemberTransaction[]>;
}

interface PoliticsClanStore {
  findBySlug(groupJid: string, slug: string): Promise<GroupClan | null>;
  listByGroup(groupJid: string): Promise<GroupClan[]>;
  findByMember(groupJid: string, userJid: string): Promise<GroupClan | null>;
  update(
    id: string,
    data: {
      leaderJid?: string;
      memberJids?: string[];
      treasuryBalance?: bigint | { increment?: bigint; decrement?: bigint };
      level?: number | { increment: number };
      warWins?: number | { increment: number };
    },
  ): Promise<GroupClan>;
}

interface PoliticsPrestigeStore {
  listTopPrestige(groupJid: string, limit?: number): Promise<TopPrestigeEntry[]>;
}

interface PoliticsTx {
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
    updateMany?(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  groupClan?: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    findUniqueOrThrow(args: { where: { id: string } }): Promise<GroupClan>;
  };
}

interface PoliticsDb {
  $transaction<T>(fn: (tx: PoliticsTx) => Promise<T>): Promise<T>;
  tenantGroup?: {
    findUnique(args: { where: { groupJid: string } }): Promise<TenantGroup | null>;
    update?(args: {
      where: { groupJid: string };
      data: Record<string, unknown>;
    }): Promise<TenantGroup>;
  };
}

const TRANSACTION_TYPE_LABELS: Record<MemberTransactionType, string> = {
  INITIAL_BALANCE: "Modal Awal",
  DAILY_REWARD: "Klaim Harian",
  WEEKLY_REWARD: "Bonus Mingguan",
  MONTHLY_REWARD: "Bonus Bulanan",
  LEVEL_UP_REWARD: "Naik Level",
  DEFAULT_LIMIT_TOPUP: "Topup Limit",
  GAME_REWARD: "Hadiah Game/XP",
  LIMIT_PURCHASE_POINT_DEBIT: "Beli Limit (Poin)",
  LIMIT_PURCHASE_LIMIT_CREDIT: "Beli Limit (+)",
  GIFT_SENT: "Kirim Hadiah",
  GIFT_RECEIVED: "Terima Hadiah",
  BANK_DEPOSIT: "Setor ATM",
  BANK_WITHDRAW: "Tarik ATM",
  EXCHANGE_DEBIT: "Tukar Poin (-)",
  EXCHANGE_CREDIT: "Tukar Poin (+)",
  RPG_EARN: "Penghasilan RPG",
  RPG_LOSS: "Biaya/Belanja RPG",
  TAX_DEBIT: "Potongan Pajak",
  TAX_CREDIT: "Setoran Pajak",
  ROB_DEBIT: "Dirampok/Denda",
  ROB_CREDIT: "Hasil Rampok",
  BANSOS_REWARD: "Bansos/Anggaran",
  CRYPTO_BUY: "Beli Kripto",
  CRYPTO_SELL: "Jual Kripto",
  DUEL_STAKE: "Taruhan Duel",
  DUEL_WIN: "Menang Duel",
  FEATURE_RESERVE: "Reservasi Fitur",
  FEATURE_CONSUME: "Pakai Fitur",
  FEATURE_REFUND: "Refund Fitur",
  SUPER_OWNER_ADD: "Admin Tambah",
  SUPER_OWNER_SET: "Admin Atur",
  CORRECTION: "Penyesuaian",
};

export function slugifyClanTarget(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getClanUpgradeCost(currentLevel: number): bigint {
  const safe = Math.max(1, Math.floor(currentLevel));
  return CLAN_UPGRADE_BASE_COST * BigInt(safe) * BigInt(safe);
}

export function getClanBuffDurationMinutes(clanLevel: number): number {
  return 15 + Math.max(1, clanLevel) * 5;
}

export function getClanBuffXp(clanLevel: number): number {
  return 40 + Math.max(1, clanLevel) * 15;
}

export function getTransactionTypeLabel(type: MemberTransactionType): string {
  return TRANSACTION_TYPE_LABELS[type];
}

function getNextRankName(current: MemberRank): MemberRank | null {
  switch (current) {
    case "Warrior":
      return "Elite";
    case "Elite":
      return "Master";
    case "Master":
      return "Grandmaster";
    case "Grandmaster":
      return "Epic";
    case "Epic":
      return "Legend";
    case "Legend":
      return "Mythic";
    case "Mythic":
    case "Immortal [MAX]":
      return null;
  }
}

function pruneMapOldest<K, V>(map: Map<K, V>, maxEntries: number): void {
  while (map.size > maxEntries) {
    const firstKey = map.keys().next().value;
    if (firstKey === undefined) break;
    map.delete(firstKey);
  }
}

function summarizeElectionCandidates(session: GroupElectionSession): ElectionCandidateSummary[] {
  const tally = new Map<string, number>();
  for (const candidate of session.candidates) {
    tally.set(candidate.userJid, 0);
  }
  for (const candidateJid of session.votes.values()) {
    if (tally.has(candidateJid)) {
      tally.set(candidateJid, (tally.get(candidateJid) ?? 0) + 1);
    }
  }
  const totalVotes = session.votes.size;
  return session.candidates
    .map((candidate, idx) => {
      const votes = tally.get(candidate.userJid) ?? 0;
      const percent = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
      return {
        index: idx + 1,
        userJid: candidate.userJid,
        slogan: candidate.slogan,
        votes,
        percent,
        registeredAt: candidate.registeredAt,
      };
    })
    .sort((a, b) => {
      if (b.votes !== a.votes) return b.votes - a.votes;
      return a.registeredAt - b.registeredAt;
    })
    .map(({ registeredAt: _ignored, ...rest }) => rest);
}

function parsePersistedPoliticsSection(
  groupJid: string,
  raw: unknown,
): {
  election: GroupElectionSession | null;
  presidency: GroupPresidency | null;
  lastCoupAt: number;
  clanWarCooldowns: Map<string, number>;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { election: null, presidency: null, lastCoupAt: 0, clanWarCooldowns: new Map() };
  }
  const obj = raw as Record<string, unknown>;

  let election: GroupElectionSession | null = null;
  if (obj.election && typeof obj.election === "object" && !Array.isArray(obj.election)) {
    const e = obj.election as Record<string, unknown>;
    if (
      typeof e.startedByJid === "string" &&
      typeof e.startedAt === "number" &&
      Number.isFinite(e.startedAt) &&
      typeof e.endsAt === "number" &&
      Number.isFinite(e.endsAt)
    ) {
      const candidates: ElectionCandidate[] = [];
      if (Array.isArray(e.candidates)) {
        for (const item of e.candidates) {
          if (candidates.length >= ELECTION_MAX_CANDIDATES) break;
          if (!item || typeof item !== "object" || Array.isArray(item)) continue;
          const c = item as Record<string, unknown>;
          if (typeof c.userJid === "string" && typeof c.slogan === "string") {
            candidates.push({
              userJid: c.userJid,
              slogan: c.slogan.slice(0, 60),
              registeredAt:
                typeof c.registeredAt === "number" && Number.isFinite(c.registeredAt)
                  ? Math.floor(c.registeredAt)
                  : Math.floor(e.startedAt),
            });
          }
        }
      }
      const votes = new Map<string, string>();
      if (e.votes && typeof e.votes === "object" && !Array.isArray(e.votes)) {
        for (const [voter, cand] of Object.entries(e.votes as Record<string, unknown>)) {
          if (typeof cand === "string" && cand.length > 0) {
            votes.set(voter, cand);
          }
        }
      }
      election = {
        groupJid,
        startedByJid: e.startedByJid,
        startedAt: Math.floor(e.startedAt),
        endsAt: Math.floor(e.endsAt),
        candidates,
        votes,
      };
    }
  }

  let presidency: GroupPresidency | null = null;
  if (obj.presidency && typeof obj.presidency === "object" && !Array.isArray(obj.presidency)) {
    const p = obj.presidency as Record<string, unknown>;
    if (
      typeof p.presidentJid === "string" &&
      p.presidentJid.length > 0 &&
      typeof p.termEndsAt === "number" &&
      Number.isFinite(p.termEndsAt)
    ) {
      const totalDistributed =
        typeof p.totalDistributed === "string" && /^\d+$/.test(p.totalDistributed)
          ? BigInt(p.totalDistributed)
          : 0n;
      presidency = {
        groupJid,
        presidentJid: p.presidentJid,
        slogan: typeof p.slogan === "string" ? p.slogan.slice(0, 60) : "",
        electedAt:
          typeof p.electedAt === "number" && Number.isFinite(p.electedAt)
            ? Math.floor(p.electedAt)
            : 0,
        termEndsAt: Math.floor(p.termEndsAt),
        totalDistributed,
        lastBudgetAt:
          typeof p.lastBudgetAt === "number" && Number.isFinite(p.lastBudgetAt)
            ? Math.floor(p.lastBudgetAt)
            : 0,
        coupsRepelled:
          typeof p.coupsRepelled === "number" && Number.isInteger(p.coupsRepelled) && p.coupsRepelled >= 0
            ? p.coupsRepelled
            : 0,
        viaCoup: p.viaCoup === true,
      };
    }
  }

  const lastCoupAt =
    typeof obj.lastCoupAt === "number" && Number.isFinite(obj.lastCoupAt) && obj.lastCoupAt > 0
      ? Math.floor(obj.lastCoupAt)
      : 0;

  const clanWarCooldowns = new Map<string, number>();
  if (
    obj.clanWarCooldowns &&
    typeof obj.clanWarCooldowns === "object" &&
    !Array.isArray(obj.clanWarCooldowns)
  ) {
    for (const [clanId, ts] of Object.entries(obj.clanWarCooldowns as Record<string, unknown>)) {
      if (clanWarCooldowns.size >= 50) break;
      if (clanId.length > 0 && typeof ts === "number" && Number.isFinite(ts) && ts > 0) {
        clanWarCooldowns.set(clanId, Math.floor(ts));
      }
    }
  }

  return { election, presidency, lastCoupAt, clanWarCooldowns };
}

function serializePersistedPoliticsSection(
  election: GroupElectionSession | null,
  presidency: GroupPresidency | null,
  lastCoupAt: number,
  clanWarCooldowns: Map<string, number> | undefined,
  nowMs?: number,
): Prisma.InputJsonValue {
  const votesObj: Record<string, string> = {};
  if (election) {
    for (const [voter, cand] of election.votes.entries()) {
      votesObj[voter] = cand;
    }
  }

  const warCooldownObj: Record<string, number> = {};
  if (clanWarCooldowns) {
    for (const [clanId, ts] of clanWarCooldowns.entries()) {
      if (nowMs !== undefined && nowMs - ts >= CLAN_WAR_COOLDOWN_MS) {
        continue;
      }
      warCooldownObj[clanId] = Math.floor(ts);
    }
  }

  return {
    election: election
      ? {
          startedByJid: election.startedByJid,
          startedAt: election.startedAt,
          endsAt: election.endsAt,
          candidates: election.candidates.map((c) => ({
            userJid: c.userJid,
            slogan: c.slogan,
            registeredAt: c.registeredAt,
          })),
          votes: votesObj,
        }
      : null,
    presidency: presidency
      ? {
          presidentJid: presidency.presidentJid,
          slogan: presidency.slogan,
          electedAt: presidency.electedAt,
          termEndsAt: presidency.termEndsAt,
          totalDistributed: presidency.totalDistributed.toString(),
          lastBudgetAt: presidency.lastBudgetAt,
          coupsRepelled: presidency.coupsRepelled,
          viaCoup: presidency.viaCoup,
        }
      : null,
    lastCoupAt: Math.max(0, Math.floor(lastCoupAt)),
    clanWarCooldowns: warCooldownObj,
  };
}

export class PoliticsClanAnalyticsService {
  private readonly elections = new Map<string, GroupElectionSession>();
  private readonly presidencies = new Map<string, GroupPresidency>();
  private readonly coupCooldowns = new Map<string, number>();
  private readonly hydratedPoliticsGroups = new Set<string>();
  private readonly clanWarCooldownsByGroup = new Map<string, Map<string, number>>();

  constructor(
    private readonly profileRepo: PoliticsProfileStore = new GroupMemberProfileRepository(),
    private readonly txRepo: PoliticsTxStore = new GroupMemberTransactionRepository(),
    private readonly clanRepo: PoliticsClanStore = new GroupClanRepository(),
    private readonly prestigeService: PoliticsPrestigeStore = careerPrestigeService,
    private readonly random: RandomProvider = defaultRandom,
    private readonly db: PoliticsDb = prisma,
  ) {}

  resetStateForTests(): void {
    this.elections.clear();
    this.presidencies.clear();
    this.coupCooldowns.clear();
    this.hydratedPoliticsGroups.clear();
    this.clanWarCooldownsByGroup.clear();
  }

  private async hydratePoliticsState(groupJid: string): Promise<void> {
    if (this.hydratedPoliticsGroups.has(groupJid)) return;
    this.hydratedPoliticsGroups.add(groupJid);

    const raw = await readGroupEventSection(this.db.tenantGroup, groupJid, "politics");
    if (!raw) return;

    const parsed = parsePersistedPoliticsSection(groupJid, raw);
    if (parsed.election) {
      this.elections.set(groupJid, parsed.election);
      pruneMapOldest(this.elections, MAX_POLITICS_GROUPS);
    }
    if (parsed.presidency) {
      this.presidencies.set(groupJid, parsed.presidency);
      pruneMapOldest(this.presidencies, MAX_POLITICS_GROUPS);
    }
    if (parsed.lastCoupAt > 0) {
      this.coupCooldowns.set(groupJid, parsed.lastCoupAt);
      pruneMapOldest(this.coupCooldowns, MAX_POLITICS_GROUPS);
    }
    if (parsed.clanWarCooldowns.size > 0) {
      this.clanWarCooldownsByGroup.set(groupJid, parsed.clanWarCooldowns);
      pruneMapOldest(this.clanWarCooldownsByGroup, MAX_POLITICS_GROUPS);
    }
  }

  private async persistPoliticsState(groupJid: string, nowMs?: number): Promise<void> {
    const payload = serializePersistedPoliticsSection(
      this.elections.get(groupJid) ?? null,
      this.presidencies.get(groupJid) ?? null,
      this.coupCooldowns.get(groupJid) ?? 0,
      this.clanWarCooldownsByGroup.get(groupJid),
      nowMs,
    );
    await writeGroupEventSection(this.db.tenantGroup, groupJid, "politics", payload);
  }

  getActivePresident(groupJid: string, now: Date = new Date()): GroupPresidency | null {
    const current = this.presidencies.get(groupJid);
    if (!current) return null;
    if (current.termEndsAt <= now.getTime()) {
      this.presidencies.delete(groupJid);
      return null;
    }
    return current;
  }

  getActiveElection(groupJid: string): GroupElectionSession | null {
    return this.elections.get(groupJid) ?? null;
  }

  private async getTreasuryBalance(groupJid: string): Promise<bigint> {
    if (!this.db.tenantGroup) {
      return DEFAULT_GROUP_TREASURY;
    }
    const tenant = await this.db.tenantGroup.findUnique({ where: { groupJid } });
    return tenant?.treasuryBalance ?? DEFAULT_GROUP_TREASURY;
  }

  private async creditTreasuryInTx(tx: PoliticsTx, groupJid: string, amount: bigint): Promise<bigint> {
    if (!tx.tenantGroup || amount <= 0n) {
      return DEFAULT_GROUP_TREASURY;
    }
    const tenant = await tx.tenantGroup.findUnique({ where: { groupJid } });
    const before = tenant?.treasuryBalance ?? DEFAULT_GROUP_TREASURY;
    const credit = clampMoneyCredit(before, amount);
    if (tenant && credit > 0n) {
      const updated = await tx.tenantGroup.update({
        where: { groupJid },
        data: { treasuryBalance: { increment: credit } },
      });
      return updated.treasuryBalance;
    }
    return before + credit;
  }

  private async grantXpInTx(
    tx: PoliticsTx,
    groupJid: string,
    userJid: string,
    xpAmount: number,
    note: string,
    correlationId: string,
  ): Promise<GroupMemberProfile> {
    const effectiveXp = applyGroupXpEvent(groupJid, xpAmount);
    const profile = await this.profileRepo.findOrCreate(groupJid, userJid, tx);
    const updated = await tx.groupMemberProfile.update({
      where: { id: profile.id },
      data: { experience: { increment: effectiveXp } },
    });
    await this.txRepo.create(
      {
        profileId: profile.id,
        groupJid,
        userJid,
        asset: MemberTransactionAsset.EXPERIENCE,
        type: MemberTransactionType.GAME_REWARD,
        amount: effectiveXp,
        balanceBefore: profile.experience,
        balanceAfter: updated.experience,
        correlationId,
        note,
      },
      tx,
    );
    return updated;
  }

  // ==================== 1. PEMILU & PRESIDEN GRUP ====================

  async inspectOrStartElection(
    groupJid: string,
    actorJid: string,
    now: Date = new Date(),
  ): Promise<ElectionInspectResult> {
    await this.hydratePoliticsState(groupJid);
    const nowMs = now.getTime();
    const activeElection = this.elections.get(groupJid);

    if (activeElection) {
      if (nowMs >= activeElection.endsAt) {
        const fin = await this.finalizeElection(groupJid, true, now);
        return {
          mode: "auto_finalized",
          remainingMs: 0,
          totalVotes: fin.totalVotes,
          candidates: fin.ranking,
          president: this.getActivePresident(groupJid, now),
          winnerJid: fin.winnerJid,
          winnerVotes: fin.winnerVotes,
          winnerXpBonus: fin.xpAwarded,
        };
      }

      return {
        mode: "active",
        remainingMs: activeElection.endsAt - nowMs,
        totalVotes: activeElection.votes.size,
        candidates: summarizeElectionCandidates(activeElection),
        president: this.getActivePresident(groupJid, now),
        winnerJid: null,
        winnerVotes: 0,
        winnerXpBonus: 0,
      };
    }

    const activePres = this.getActivePresident(groupJid, now);
    if (activePres) {
      return {
        mode: "president_serving",
        remainingMs: activePres.termEndsAt - nowMs,
        totalVotes: 0,
        candidates: [],
        president: activePres,
        winnerJid: activePres.presidentJid,
        winnerVotes: 0,
        winnerXpBonus: 0,
      };
    }

    const session: GroupElectionSession = {
      groupJid,
      startedByJid: normalizeUserJid(actorJid),
      startedAt: nowMs,
      endsAt: nowMs + ELECTION_DURATION_MS,
      candidates: [],
      votes: new Map<string, string>(),
    };
    this.elections.set(groupJid, session);
    pruneMapOldest(this.elections, MAX_POLITICS_GROUPS);
    await this.persistPoliticsState(groupJid);

    return {
      mode: "started",
      remainingMs: ELECTION_DURATION_MS,
      totalVotes: 0,
      candidates: [],
      president: null,
      winnerJid: null,
      winnerVotes: 0,
      winnerXpBonus: 0,
    };
  }

  async registerCandidate(
    groupJid: string,
    userJid: string,
    rawSlogan?: string,
    now: Date = new Date(),
  ): Promise<RegisterCandidateResult> {
    await this.hydratePoliticsState(groupJid);
    const normUser = normalizeUserJid(userJid);
    const nowMs = now.getTime();
    const session = this.elections.get(groupJid);
    if (!session) {
      throw new AppUserError("Belum ada Pemilu aktif di grup ini. Ketik *.pemilu* untuk membuka kotak suara!");
    }
    if (nowMs >= session.endsAt) {
      throw new AppUserError(
        "Masa pemungutan suara Pemilu sudah berakhir! Ketik *.pemilu* untuk melantik pemenang.",
      );
    }
    if (session.candidates.some((c) => c.userJid === normUser)) {
      throw new AppUserError("Kamu sudah terdaftar sebagai calon Presiden pada Pemilu ini.");
    }
    if (session.candidates.length >= ELECTION_MAX_CANDIDATES) {
      throw new AppUserError(
        `Kuota calon Presiden sudah penuh (maksimal ${String(ELECTION_MAX_CANDIDATES)} kandidat).`,
      );
    }

    const cleanedSlogan = (rawSlogan ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
    const slogan = cleanedSlogan.length > 0 ? cleanedSlogan : "Membangun grup lebih sejahtera & anti-sider!";
    const correlationId = generateCorrelationId();

    const txResult = await this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      const playerLevel = Math.max(1, profile.level);
      if (playerLevel < CANDIDATE_MIN_LEVEL) {
        throw new AppUserError(
          `Syarat daftar calon Presiden minimal Level ${String(CANDIDATE_MIN_LEVEL)} (levelmu saat ini Lv.${String(playerLevel)}).`,
        );
      }
      if (profile.moneyBalance < CANDIDATE_REGISTRATION_FEE) {
        throw new AppUserError(
          `Biaya pendaftaran calon Presiden adalah ${formatRupiah(CANDIDATE_REGISTRATION_FEE)}, dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: CANDIDATE_REGISTRATION_FEE } },
        data: { moneyBalance: { decrement: CANDIDATE_REGISTRATION_FEE } },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup untuk biaya pendaftaran calon Presiden.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid: normUser,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -CANDIDATE_REGISTRATION_FEE,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: "pemilu_daftar_calon",
        },
        tx,
      );

      const treasuryBalance = await this.creditTreasuryInTx(tx, groupJid, CANDIDATE_REGISTRATION_FEE);
      return { currentMoney: updated.moneyBalance, treasuryBalance };
    });

    session.candidates.push({
      userJid: normUser,
      slogan,
      registeredAt: nowMs,
    });
    await this.persistPoliticsState(groupJid);

    return {
      candidateJid: normUser,
      slogan,
      feePaid: CANDIDATE_REGISTRATION_FEE,
      candidateNumber: session.candidates.length,
      totalCandidates: session.candidates.length,
      currentMoney: txResult.currentMoney,
      treasuryBalance: txResult.treasuryBalance,
    };
  }

  async castVote(
    groupJid: string,
    voterJid: string,
    targetCandidateJidOrNumber: string | number,
    now: Date = new Date(),
  ): Promise<CastVoteResult> {
    await this.hydratePoliticsState(groupJid);
    const normVoter = normalizeUserJid(voterJid);
    const nowMs = now.getTime();
    const session = this.elections.get(groupJid);
    if (!session) {
      throw new AppUserError("Belum ada Pemilu aktif di grup ini. Ketik *.pemilu* untuk memulai!");
    }
    if (nowMs >= session.endsAt) {
      throw new AppUserError("Masa pemungutan suara sudah selesai. Ketik *.pemilu* untuk melantik pemenang.");
    }
    if (session.candidates.length === 0) {
      throw new AppUserError("Belum ada calon yang mendaftar. Daftar dulu pakai *.daftarcalon <slogan>*!");
    }
    if (session.votes.has(normVoter)) {
      throw new AppUserError("Kamu sudah menggunakan hak suaramu di Pemilu ini (1 orang = 1 suara).");
    }

    let candidate: ElectionCandidate | undefined;
    if (typeof targetCandidateJidOrNumber === "number") {
      candidate = session.candidates[targetCandidateJidOrNumber - 1];
    } else {
      const normTarget = normalizeUserJid(targetCandidateJidOrNumber);
      candidate = session.candidates.find((c) => c.userJid === normTarget);
    }

    if (!candidate) {
      throw new AppUserError(
        "Target belum terdaftar sebagai calon Presiden. Cek nomor/daftar kandidat di *.pemilu*.",
      );
    }

    const correlationId = generateCorrelationId();
    await this.db.$transaction(async (tx) => {
      await this.grantXpInTx(
        tx,
        groupJid,
        normVoter,
        VOTE_PARTICIPATION_XP,
        "pemilu_vote_bonus",
        correlationId,
      );
    });

    session.votes.set(normVoter, candidate.userJid);
    await this.persistPoliticsState(groupJid);
    let candidateVotes = 0;
    for (const v of session.votes.values()) {
      if (v === candidate.userJid) candidateVotes += 1;
    }

    return {
      voterJid: normVoter,
      candidateJid: candidate.userJid,
      candidateVotes,
      totalVotes: session.votes.size,
      xpGained: VOTE_PARTICIPATION_XP,
    };
  }

  async finalizeElection(
    groupJid: string,
    isPrivileged: boolean,
    now: Date = new Date(),
  ): Promise<ElectionFinalizeResult> {
    await this.hydratePoliticsState(groupJid);
    const nowMs = now.getTime();
    const session = this.elections.get(groupJid);
    if (!session) {
      throw new AppUserError("Tidak ada sesi Pemilu yang sedang berlangsung di grup ini.");
    }
    if (nowMs < session.endsAt && !isPrivileged) {
      throw new AppUserError(
        `Pemilu masih berlangsung (${formatRemainingDuration(session.endsAt - nowMs)} lagi). Hanya Admin/Owner yang dapat melantik lebih awal.`,
      );
    }

    const ranking = summarizeElectionCandidates(session);
    const totalVotes = session.votes.size;
    this.elections.delete(groupJid);

    const winner = ranking[0];
    if (!winner) {
      await this.persistPoliticsState(groupJid);
      return {
        winnerJid: null,
        winnerSlogan: "",
        winnerVotes: 0,
        totalVotes: 0,
        termEndsAt: 0,
        xpAwarded: 0,
        ranking: [],
      };
    }

    const correlationId = generateCorrelationId();
    await this.db.$transaction(async (tx) => {
      await this.grantXpInTx(
        tx,
        groupJid,
        winner.userJid,
        PRESIDENCY_INAUGURATION_XP,
        "presiden_dilantik",
        correlationId,
      );
    });

    const presidency: GroupPresidency = {
      groupJid,
      presidentJid: winner.userJid,
      slogan: winner.slogan,
      electedAt: nowMs,
      termEndsAt: nowMs + PRESIDENCY_TERM_MS,
      totalDistributed: 0n,
      lastBudgetAt: 0,
      coupsRepelled: 0,
      viaCoup: false,
    };
    this.presidencies.set(groupJid, presidency);
    pruneMapOldest(this.presidencies, MAX_POLITICS_GROUPS);
    await this.persistPoliticsState(groupJid);

    return {
      winnerJid: winner.userJid,
      winnerSlogan: winner.slogan,
      winnerVotes: winner.votes,
      totalVotes,
      termEndsAt: presidency.termEndsAt,
      xpAwarded: PRESIDENCY_INAUGURATION_XP,
      ranking,
    };
  }

  async getPresidentStatus(groupJid: string, now: Date = new Date()): Promise<PresidentStatusSnapshot> {
    await this.hydratePoliticsState(groupJid);
    const hadPresident = this.presidencies.has(groupJid);
    const nowMs = now.getTime();
    const president = this.getActivePresident(groupJid, now);
    if (hadPresident && !president) {
      await this.persistPoliticsState(groupJid);
    }
    const treasuryBalance = await this.getTreasuryBalance(groupJid);
    const election = this.elections.get(groupJid);
    const electionRemainingMs = election && election.endsAt > nowMs ? election.endsAt - nowMs : 0;

    let budgetCooldownMs = 0;
    if (president && president.lastBudgetAt > 0) {
      const elapsed = nowMs - president.lastBudgetAt;
      budgetCooldownMs = elapsed >= BUDGET_COOLDOWN_MS ? 0 : BUDGET_COOLDOWN_MS - elapsed;
    }

    const lastCoup = this.coupCooldowns.get(groupJid) ?? 0;
    const coupCooldownMs =
      lastCoup > 0 && nowMs - lastCoup < COUP_GROUP_COOLDOWN_MS
        ? COUP_GROUP_COOLDOWN_MS - (nowMs - lastCoup)
        : 0;

    return {
      president,
      termRemainingMs: president ? Math.max(0, president.termEndsAt - nowMs) : 0,
      budgetCooldownMs,
      coupCooldownMs,
      treasuryBalance,
      hasActiveElection: Boolean(election),
      electionRemainingMs,
    };
  }

  async distributeBudget(
    groupJid: string,
    actorJid: string,
    amount: bigint = BUDGET_DEFAULT_AMOUNT,
    now: Date = new Date(),
  ): Promise<DistributeBudgetResult> {
    await this.hydratePoliticsState(groupJid);
    const normActor = normalizeUserJid(actorJid);
    const nowMs = now.getTime();
    const president = this.getActivePresident(groupJid, now);

    if (!president) {
      throw new AppUserError("Belum ada Presiden Grup aktif. Gelar pemilihan dulu lewat *.pemilu*!");
    }
    if (president.presidentJid !== normActor) {
      throw new AppUserError(
        "Hanya Presiden Grup yang sedang menjabat yang boleh mencairkan Kas Negara lewat *.bagianggaran*.",
      );
    }
    if (president.lastBudgetAt > 0 && nowMs - president.lastBudgetAt < BUDGET_COOLDOWN_MS) {
      const rem = BUDGET_COOLDOWN_MS - (nowMs - president.lastBudgetAt);
      throw new AppUserError(
        `Pencairan anggaran baru saja dilakukan. Tunggu ${formatRemainingDuration(rem)} lagi.`,
      );
    }
    if (amount < BUDGET_MIN_AMOUNT || amount > BUDGET_MAX_AMOUNT) {
      throw new AppUserError(
        `Nominal anggaran harus antara ${formatRupiah(BUDGET_MIN_AMOUNT)} sampai ${formatRupiah(BUDGET_MAX_AMOUNT)}.`,
      );
    }

    const activeProfiles = await this.profileRepo.listRecentActiveProfiles(
      groupJid,
      normActor,
      BUDGET_MAX_RECIPIENTS,
    );
    if (activeProfiles.length === 0) {
      throw new AppUserError("Belum ada warga aktif lain di grup ini yang bisa menerima pembagian anggaran.");
    }

    const perMember = amount / BigInt(activeProfiles.length);
    if (perMember <= 0n) {
      throw new AppUserError("Nominal anggaran terlalu kecil untuk dibagikan ke warga aktif.");
    }
    const totalToDistribute = perMember * BigInt(activeProfiles.length);
    const correlationId = generateCorrelationId();

    const txRes = await this.db.$transaction(async (tx) => {
      let remainingTreasury = DEFAULT_GROUP_TREASURY;
      if (tx.tenantGroup) {
        const tenant = await tx.tenantGroup.findUnique({ where: { groupJid } });
        const treasuryBefore = tenant?.treasuryBalance ?? DEFAULT_GROUP_TREASURY;
        if (treasuryBefore < totalToDistribute) {
          throw new AppUserError(
            `Kas Negara tidak cukup! Saldo Kas Negara: ${formatRupiah(treasuryBefore)}.`,
          );
        }
        if (tenant) {
          if (tx.tenantGroup.updateMany) {
            const deb = await tx.tenantGroup.updateMany({
              where: { groupJid, treasuryBalance: { gte: totalToDistribute } },
              data: { treasuryBalance: { decrement: totalToDistribute } },
            });
            if (deb.count === 0) {
              throw new AppUserError("Kas Negara tidak mencukupi untuk mencairkan anggaran.");
            }
            const refreshed = await tx.tenantGroup.findUnique({ where: { groupJid } });
            remainingTreasury = refreshed?.treasuryBalance ?? treasuryBefore - totalToDistribute;
          } else {
            const upd = await tx.tenantGroup.update({
              where: { groupJid },
              data: { treasuryBalance: { decrement: totalToDistribute } },
            });
            remainingTreasury = upd.treasuryBalance;
          }
        }
      }

      const recipients: string[] = [];
      let distributedActual = 0n;

      for (const candidate of activeProfiles) {
        const fresh = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: candidate.id } });
        const credit = clampMoneyCredit(fresh.moneyBalance, perMember);
        if (credit <= 0n) continue;

        const updated = await tx.groupMemberProfile.update({
          where: { id: fresh.id },
          data: {
            moneyBalance: { increment: credit },
            totalMoneyEarned: { increment: credit },
          },
        });
        await this.txRepo.create(
          {
            profileId: fresh.id,
            groupJid,
            userJid: fresh.userJid,
            actorJid: normActor,
            asset: MemberTransactionAsset.MONEY,
            type: MemberTransactionType.BANSOS_REWARD,
            amount: credit,
            balanceBefore: fresh.moneyBalance,
            balanceAfter: updated.moneyBalance,
            correlationId,
            note: "presiden_bagianggaran",
          },
          tx,
        );
        recipients.push(fresh.userJid);
        distributedActual += credit;
      }

      return { recipients, distributedActual, remainingTreasury };
    });

    president.lastBudgetAt = nowMs;
    president.totalDistributed += txRes.distributedActual;
    await this.persistPoliticsState(groupJid);

    return {
      presidentJid: normActor,
      requestedAmount: amount,
      distributedTotal: txRes.distributedActual,
      perMember,
      recipients: txRes.recipients,
      remainingTreasury: txRes.remainingTreasury,
      totalPresidentDistributed: president.totalDistributed,
    };
  }

  async attemptCoup(
    groupJid: string,
    challengerJid: string,
    now: Date = new Date(),
  ): Promise<CoupResult> {
    await this.hydratePoliticsState(groupJid);
    const normChallenger = normalizeUserJid(challengerJid);
    const nowMs = now.getTime();
    const president = this.getActivePresident(groupJid, now);

    if (!president) {
      throw new AppUserError("Tidak ada Presiden aktif yang bisa dikudeta. Gelar pemilihan lewat *.pemilu*!");
    }
    if (president.presidentJid === normChallenger) {
      throw new AppUserError("Kamu sendiri Presidennya! Tidak bisa mengkudeta dirimu sendiri.");
    }

    const lastCoupAt = this.coupCooldowns.get(groupJid) ?? 0;
    if (lastCoupAt > 0 && nowMs - lastCoupAt < COUP_GROUP_COOLDOWN_MS) {
      const rem = COUP_GROUP_COOLDOWN_MS - (nowMs - lastCoupAt);
      throw new AppUserError(
        `Pasukan pengamanan Istana masih siaga penuh! Kudeta berikutnya bisa dicoba ${formatRemainingDuration(rem)} lagi.`,
      );
    }

    const formerPresidentJid = president.presidentJid;
    const success = this.random.chance(COUP_SUCCESS_RATE);
    const correlationId = generateCorrelationId();

    const txRes = await this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normChallenger, tx);
      const state = parseRpgState(profile.rpgState);
      const jailRem = getRemainingJailMs(state, nowMs);
      if (jailRem > 0) {
        throw new AppUserError(
          `Kamu masih dipenjara (${formatRemainingDuration(jailRem)} lagi). Bebas dulu sebelum merencanakan kudeta!`,
        );
      }

      const playerLevel = Math.max(1, profile.level);
      if (playerLevel < COUP_MIN_LEVEL) {
        throw new AppUserError(
          `Syarat aksi *.kudeta* minimal Level ${String(COUP_MIN_LEVEL)} (levelmu saat ini Lv.${String(playerLevel)}).`,
        );
      }
      if (profile.moneyBalance < COUP_COST) {
        throw new AppUserError(
          `Dana mobilisasi massa kudeta sebesar ${formatRupiah(COUP_COST)}, dompetmu: ${formatRupiah(profile.moneyBalance)}.`,
        );
      }

      const nextState = success ? state : withJailUntil(state, nowMs + COUP_FAIL_JAIL_MS);
      const debitRes = await tx.groupMemberProfile.updateMany({
        where: { id: profile.id, moneyBalance: { gte: COUP_COST } },
        data: {
          moneyBalance: { decrement: COUP_COST },
          ...(success ? { experience: { increment: COUP_SUCCESS_XP } } : {}),
          rpgState: serializeRpgState(nextState),
        },
      });
      if (debitRes.count === 0) {
        throw new AppUserError("Saldo dompet tidak cukup untuk membiayai kudeta.");
      }

      const updated = await tx.groupMemberProfile.findUniqueOrThrow({ where: { id: profile.id } });
      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid: normChallenger,
          targetUserJid: formerPresidentJid,
          asset: MemberTransactionAsset.MONEY,
          type: MemberTransactionType.RPG_LOSS,
          amount: -COUP_COST,
          balanceBefore: profile.moneyBalance,
          balanceAfter: updated.moneyBalance,
          correlationId,
          note: success ? "kudeta_sukses" : "kudeta_gagal",
        },
        tx,
      );

      if (success) {
        await this.txRepo.create(
          {
            profileId: profile.id,
            groupJid,
            userJid: normChallenger,
            asset: MemberTransactionAsset.EXPERIENCE,
            type: MemberTransactionType.GAME_REWARD,
            amount: COUP_SUCCESS_XP,
            balanceBefore: profile.experience,
            balanceAfter: updated.experience,
            correlationId,
            note: "kudeta_berhasil",
          },
          tx,
        );
      }

      const treasuryBalance = await this.creditTreasuryInTx(tx, groupJid, COUP_COST);
      return { currentMoney: updated.moneyBalance, treasuryBalance };
    });

    this.coupCooldowns.set(groupJid, nowMs);
    pruneMapOldest(this.coupCooldowns, MAX_POLITICS_GROUPS);

    if (success) {
      const nextPresidency: GroupPresidency = {
        groupJid,
        presidentJid: normChallenger,
        slogan: "Rezim Baru Hasil Kudeta!",
        electedAt: nowMs,
        termEndsAt: nowMs + PRESIDENCY_TERM_MS,
        totalDistributed: 0n,
        lastBudgetAt: 0,
        coupsRepelled: 0,
        viaCoup: true,
      };
      this.presidencies.set(groupJid, nextPresidency);
      pruneMapOldest(this.presidencies, MAX_POLITICS_GROUPS);
      await this.persistPoliticsState(groupJid);

      return {
        success: true,
        challengerJid: normChallenger,
        formerPresidentJid,
        costPaid: COUP_COST,
        currentMoney: txRes.currentMoney,
        treasuryBalance: txRes.treasuryBalance,
        jailMinutes: 0,
        xpGained: COUP_SUCCESS_XP,
        termEndsAt: nextPresidency.termEndsAt,
        coupsRepelled: 0,
      };
    }

    president.coupsRepelled += 1;
    await this.persistPoliticsState(groupJid);
    return {
      success: false,
      challengerJid: normChallenger,
      formerPresidentJid,
      costPaid: COUP_COST,
      currentMoney: txRes.currentMoney,
      treasuryBalance: txRes.treasuryBalance,
      jailMinutes: Math.round(COUP_FAIL_JAIL_MS / 60_000),
      xpGained: 0,
      termEndsAt: president.termEndsAt,
      coupsRepelled: president.coupsRepelled,
    };
  }

  // ==================== 2. UPGRADE & PERANG GENG ====================

  async upgradeClan(groupJid: string, actorJid: string): Promise<ClanUpgradeResult> {
    const normActor = normalizeUserJid(actorJid);
    const clan = await this.clanRepo.findByMember(groupJid, normActor);
    if (!clan) {
      throw new AppUserError("Kamu belum tergabung dalam geng mana pun. Buat dulu lewat *.geng buat <nama>*!");
    }
    if (clan.leaderJid !== normActor) {
      throw new AppUserError("Hanya Ketua Geng yang berhak melakukan *.gengupgrade*.");
    }

    const currentLevel = Math.max(1, clan.level);
    if (currentLevel >= CLAN_MAX_LEVEL) {
      throw new AppUserError(`Geng *${clan.name}* sudah mencapai level maksimal (Lv.${String(CLAN_MAX_LEVEL)})!`);
    }

    const cost = getClanUpgradeCost(currentLevel);
    if (clan.treasuryBalance < cost) {
      throw new AppUserError(
        `Kas Geng tidak cukup untuk upgrade ke Lv.${String(currentLevel + 1)}. Butuh ${formatRupiah(cost)}, kas saat ini: ${formatRupiah(clan.treasuryBalance)}. Donasi dulu lewat *.geng donasi <jumlah>*!`,
      );
    }

    let updatedClan: GroupClan;
    try {
      updatedClan = await this.db.$transaction(async (tx) => {
        if (tx.groupClan) {
          const res = await tx.groupClan.updateMany({
            where: {
              id: clan.id,
              level: clan.level,
              treasuryBalance: { gte: cost },
            },
            data: {
              treasuryBalance: { decrement: cost },
              level: { increment: 1 },
            },
          });
          if (res.count === 0) {
            throw new AppUserError("Kas Geng tidak cukup atau level geng baru saja berubah.");
          }
          return tx.groupClan.findUniqueOrThrow({ where: { id: clan.id } });
        }
        return this.clanRepo.update(clan.id, {
          treasuryBalance: { decrement: cost },
          level: { increment: 1 },
        });
      });
    } catch (error: unknown) {
      if (error instanceof AppUserError) throw error;
      throw error;
    }

    const newLevel = Math.max(currentLevel + 1, updatedClan.level);
    return {
      clanName: updatedClan.name,
      oldLevel: currentLevel,
      newLevel,
      costPaid: cost,
      remainingTreasury: updatedClan.treasuryBalance,
      warPowerBonusPercent: newLevel * CLAN_POWER_BONUS_PER_LEVEL_PERCENT,
      buffDurationMinutes: getClanBuffDurationMinutes(newLevel),
    };
  }

  async claimClanBuff(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<ClanBuffResult> {
    const normUser = normalizeUserJid(userJid);
    const nowMs = now.getTime();
    const clan = await this.clanRepo.findByMember(groupJid, normUser);
    if (!clan) {
      throw new AppUserError("Kamu belum bergabung di geng mana pun. Gabung dulu lewat *.geng gabung <nama>*!");
    }

    const clanLevel = Math.max(1, clan.level);
    const buffMinutes = getClanBuffDurationMinutes(clanLevel);
    const buffMs = buffMinutes * 60 * 1000;
    const xpGained = getClanBuffXp(clanLevel);
    const correlationId = generateCorrelationId();

    return this.db.$transaction(async (tx) => {
      const profile = await this.profileRepo.findOrCreate(groupJid, normUser, tx);
      const state = parseRpgState(profile.rpgState);
      const remCd = getRemainingCooldownMs(state, "gengbuff", CLAN_BUFF_COOLDOWN_MS, nowMs);
      if (remCd > 0) {
        throw new AppUserError(
          `Buff geng baru saja diklaim. Tunggu ${formatRemainingDuration(remCd)} lagi.`,
        );
      }

      const currentJamuEnd = Math.max(nowMs, state.buffs.jamukuat);
      const nextJamuEnd = Math.min(nowMs + BUFF_MAX_STACK_MS, currentJamuEnd + buffMs);

      let nextState = withHp(state, MAX_PLAYER_HP);
      nextState = withBuffUntil(nextState, "jamukuat", nextJamuEnd);
      nextState = withUpdatedCooldown(nextState, "gengbuff", nowMs);

      const updated = await tx.groupMemberProfile.update({
        where: { id: profile.id },
        data: {
          experience: { increment: xpGained },
          rpgState: serializeRpgState(nextState),
        },
      });

      await this.txRepo.create(
        {
          profileId: profile.id,
          groupJid,
          userJid: normUser,
          asset: MemberTransactionAsset.EXPERIENCE,
          type: MemberTransactionType.GAME_REWARD,
          amount: xpGained,
          balanceBefore: profile.experience,
          balanceAfter: updated.experience,
          correlationId,
          note: `geng_buff_lv${String(clanLevel)}`,
        },
        tx,
      );

      return {
        clanName: clan.name,
        clanLevel,
        hpAfter: MAX_PLAYER_HP,
        xpGained,
        buffMinutesAdded: buffMinutes,
        jamuRemainingMs: Math.max(0, nextJamuEnd - nowMs),
      };
    });
  }

  async startClanWar(
    groupJid: string,
    actorJid: string,
    targetClanQuery: string,
    now: Date = new Date(),
  ): Promise<ClanWarResult> {
    const normActor = normalizeUserJid(actorJid);
    const nowMs = now.getTime();
    const attackerClan = await this.clanRepo.findByMember(groupJid, normActor);
    if (!attackerClan) {
      throw new AppUserError("Kamu belum bergabung di geng mana pun.");
    }
    if (attackerClan.leaderJid !== normActor) {
      throw new AppUserError("Hanya Ketua Geng yang dapat mendeklarasikan *.gengwar*!");
    }

    const cleanedTarget = targetClanQuery.trim();
    if (!cleanedTarget) {
      throw new AppUserError("Sebutkan nama geng lawan. Contoh: *.gengwar Garuda*");
    }

    const slug = slugifyClanTarget(cleanedTarget);
    let defenderClan = slug ? await this.clanRepo.findBySlug(groupJid, slug) : null;
    if (!defenderClan) {
      const allClans = await this.clanRepo.listByGroup(groupJid);
      const lower = cleanedTarget.toLowerCase();
      defenderClan =
        allClans.find((c) => c.name.toLowerCase() === lower || c.name.toLowerCase().includes(lower)) ??
        null;
    }

    if (!defenderClan) {
      throw new AppUserError(
        `Geng *${cleanedTarget}* tidak ditemukan di grup ini. Cek daftar geng lewat *.geng top*.`,
      );
    }
    if (defenderClan.id === attackerClan.id) {
      throw new AppUserError("Tidak bisa mengajak perang gengmu sendiri!");
    }

    await this.hydratePoliticsState(groupJid);
    const groupWarCooldowns = this.clanWarCooldownsByGroup.get(groupJid);
    const lastWarAt = groupWarCooldowns?.get(attackerClan.id) ?? 0;
    if (lastWarAt > 0 && nowMs - lastWarAt < CLAN_WAR_COOLDOWN_MS) {
      const rem = CLAN_WAR_COOLDOWN_MS - (nowMs - lastWarAt);
      throw new AppUserError(
        `Pasukan geng *${attackerClan.name}* masih memulihkan stamina. Perang berikutnya tersedia ${formatRemainingDuration(rem)} lagi.`,
      );
    }

    const attackerMembers = parseClanMembers(attackerClan.memberJids);
    const defenderMembers = parseClanMembers(defenderClan.memberJids);
    const allUserJids = Array.from(new Set([...attackerMembers, ...defenderMembers]));
    const profiles = await this.profileRepo.listByGroupAndUsers(groupJid, allUserJids);
    const profileMap = new Map<string, GroupMemberProfile>(profiles.map((p) => [p.userJid, p]));

    const computeTeamPower = (
      members: string[],
      clanLevel: number,
    ): { power: number; mvpJid: string | null } => {
      let rawSum = 0;
      let bestMemberPower = -1;
      let mvpJid: string | null = members[0] ?? null;

      for (const jid of members) {
        const prof = profileMap.get(jid);
        const memberPower = prof
          ? calculatePlayerCombatPower(Math.max(1, prof.level), parseRpgState(prof.rpgState), undefined, nowMs)
          : 25;
        rawSum += memberPower;
        if (memberPower > bestMemberPower) {
          bestMemberPower = memberPower;
          mvpJid = jid;
        }
      }

      const base = Math.max(100, rawSum);
      const levelMult = 1 + (Math.max(1, clanLevel) * CLAN_POWER_BONUS_PER_LEVEL_PERCENT) / 100;
      const tacticalFactor = this.random.intBetween(85, 115) / 100;
      return {
        power: Math.round(base * levelMult * tacticalFactor),
        mvpJid,
      };
    };

    const atkLevel = Math.max(1, attackerClan.level);
    const defLevel = Math.max(1, defenderClan.level);
    const atkCalc = computeTeamPower(attackerMembers, atkLevel);
    const defCalc = computeTeamPower(defenderMembers, defLevel);

    const attackerWon = atkCalc.power >= defCalc.power;
    const winnerClan = attackerWon ? attackerClan : defenderClan;
    const loserClan = attackerWon ? defenderClan : attackerClan;
    const winnerMembers = attackerWon ? attackerMembers : defenderMembers;

    const rawLoot = percentOfBigInt(loserClan.treasuryBalance, CLAN_WAR_LOOT_PERCENT);
    const treasuryLoot = minBigInt(loserClan.treasuryBalance, minBigInt(rawLoot, CLAN_WAR_MAX_LOOT));
    const safeLootCredit = clampMoneyCredit(winnerClan.treasuryBalance, treasuryLoot);
    const correlationId = generateCorrelationId();

    const txRes = await this.db.$transaction(async (tx) => {
      let winnerAfterTreasury = winnerClan.treasuryBalance + safeLootCredit;
      let loserAfterTreasury = loserClan.treasuryBalance - treasuryLoot;
      let winnerWarWins = winnerClan.warWins + 1;

      if (tx.groupClan) {
        if (treasuryLoot > 0n) {
          const dec = await tx.groupClan.updateMany({
            where: { id: loserClan.id, treasuryBalance: { gte: treasuryLoot } },
            data: { treasuryBalance: { decrement: treasuryLoot } },
          });
          if (dec.count > 0) {
            const refreshedLoser = await tx.groupClan.findUniqueOrThrow({ where: { id: loserClan.id } });
            loserAfterTreasury = refreshedLoser.treasuryBalance;
          } else {
            loserAfterTreasury = loserClan.treasuryBalance;
          }
        }
        await tx.groupClan.updateMany({
          where: { id: winnerClan.id },
          data: {
            warWins: { increment: 1 },
            ...(safeLootCredit > 0n ? { treasuryBalance: { increment: safeLootCredit } } : {}),
          },
        });
        const refreshedWinner = await tx.groupClan.findUniqueOrThrow({ where: { id: winnerClan.id } });
        winnerAfterTreasury = refreshedWinner.treasuryBalance;
        winnerWarWins = refreshedWinner.warWins;
      } else {
        if (treasuryLoot > 0n) {
          const updLoser = await this.clanRepo.update(loserClan.id, {
            treasuryBalance: { decrement: treasuryLoot },
          });
          loserAfterTreasury = updLoser.treasuryBalance;
        }
        const updWinner = await this.clanRepo.update(winnerClan.id, {
          warWins: { increment: 1 },
          ...(safeLootCredit > 0n ? { treasuryBalance: { increment: safeLootCredit } } : {}),
        });
        winnerAfterTreasury = updWinner.treasuryBalance;
        winnerWarWins = updWinner.warWins;
      }

      const rewardedMemberJids: string[] = [];
      for (const memberJid of winnerMembers.slice(0, 15)) {
        const profile = await this.profileRepo.findOrCreate(groupJid, memberJid, tx);
        const safeBonus = clampMoneyCredit(profile.moneyBalance, CLAN_WAR_WIN_BONUS_MONEY);
        const updated = await tx.groupMemberProfile.update({
          where: { id: profile.id },
          data: {
            ...(safeBonus > 0n
              ? {
                  moneyBalance: { increment: safeBonus },
                  totalMoneyEarned: { increment: safeBonus },
                }
              : {}),
            experience: { increment: CLAN_WAR_WIN_BONUS_XP },
          },
        });
        if (safeBonus > 0n) {
          await this.txRepo.create(
            {
              profileId: profile.id,
              groupJid,
              userJid: memberJid,
              asset: MemberTransactionAsset.MONEY,
              type: MemberTransactionType.RPG_EARN,
              amount: safeBonus,
              balanceBefore: profile.moneyBalance,
              balanceAfter: updated.moneyBalance,
              correlationId,
              note: `geng_war_win:${loserClan.slug}`,
            },
            tx,
          );
        }
        await this.txRepo.create(
          {
            profileId: profile.id,
            groupJid,
            userJid: memberJid,
            asset: MemberTransactionAsset.EXPERIENCE,
            type: MemberTransactionType.GAME_REWARD,
            amount: CLAN_WAR_WIN_BONUS_XP,
            balanceBefore: profile.experience,
            balanceAfter: updated.experience,
            correlationId,
            note: `geng_war_win:${loserClan.slug}`,
          },
          tx,
        );
        rewardedMemberJids.push(memberJid);
      }

      return { winnerAfterTreasury, loserAfterTreasury, winnerWarWins, rewardedMemberJids };
    });

    let updatedGroupWarCooldowns = this.clanWarCooldownsByGroup.get(groupJid);
    if (!updatedGroupWarCooldowns) {
      updatedGroupWarCooldowns = new Map<string, number>();
      this.clanWarCooldownsByGroup.set(groupJid, updatedGroupWarCooldowns);
      pruneMapOldest(this.clanWarCooldownsByGroup, MAX_POLITICS_GROUPS);
    }
    updatedGroupWarCooldowns.set(attackerClan.id, nowMs);
    pruneMapOldest(updatedGroupWarCooldowns, MAX_CLAN_WAR_COOLDOWNS_PER_GROUP);
    await this.persistPoliticsState(groupJid, nowMs);

    return {
      attackerClanName: attackerClan.name,
      defenderClanName: defenderClan.name,
      attackerLevel: atkLevel,
      defenderLevel: defLevel,
      attackerMemberCount: attackerMembers.length,
      defenderMemberCount: defenderMembers.length,
      attackerPower: atkCalc.power,
      defenderPower: defCalc.power,
      attackerWon,
      winnerClanName: winnerClan.name,
      loserClanName: loserClan.name,
      winnerWarWins: txRes.winnerWarWins,
      treasuryLoot: safeLootCredit,
      winnerTreasuryAfter: txRes.winnerAfterTreasury,
      loserTreasuryAfter: txRes.loserAfterTreasury,
      memberBonusMoney: CLAN_WAR_WIN_BONUS_MONEY,
      memberBonusXp: CLAN_WAR_WIN_BONUS_XP,
      rewardedMemberJids: txRes.rewardedMemberJids,
      attackerMvpJid: atkCalc.mvpJid,
      defenderMvpJid: defCalc.mvpJid,
    };
  }

  // ==================== 3. ANALISIS PROGRES & HEAD-TO-HEAD ====================

  private buildCompareMetrics(
    profile: GroupMemberProfile,
    clanName: string | null,
    nowMs: number,
  ): PlayerCompareMetrics {
    const state = parseRpgState(profile.rpgState);
    const level = Math.max(1, profile.level);
    const careerSpec = state.career ? CAREER_MAP.get(state.career.jobId) : null;
    const careerTitle =
      careerSpec && state.career
        ? `${careerSpec.title} (Lv.${String(state.career.level)})`
        : "Belum bekerja";
    const startupLabel = state.startup
      ? `${state.startup.name} (Lv.${String(state.startup.level)})`
      : "-";
    const propertyCount = Object.values(state.properties).reduce((sum, n) => sum + n, 0);
    const winRatePercent =
      profile.totalGamesPlayed > 0
        ? Math.round((profile.totalGamesWon / profile.totalGamesPlayed) * 100)
        : 0;

    return {
      userJid: profile.userJid,
      level,
      rank: resolveRank(profile.experience),
      experience: profile.experience,
      totalCash: profile.moneyBalance + profile.bankBalance,
      wallet: profile.moneyBalance,
      bank: profile.bankBalance,
      combatPower: calculatePlayerCombatPower(level, state, undefined, nowMs),
      prestige: state.prestige,
      careerTitle,
      startupLabel,
      gamesWon: profile.totalGamesWon,
      gamesPlayed: profile.totalGamesPlayed,
      winRatePercent,
      longestStreak: profile.longestStreak,
      totalDonated: BigInt(state.totalDonated),
      propertyCount,
      uniqueCardCount: Object.keys(state.cards).length,
      clanName,
    };
  }

  async comparePlayers(
    groupJid: string,
    leftUserJid: string,
    rightUserJid: string,
    now: Date = new Date(),
  ): Promise<ComparePlayersResult> {
    const leftJid = normalizeUserJid(leftUserJid);
    const rightJid = normalizeUserJid(rightUserJid);
    if (leftJid === rightJid) {
      throw new AppUserError("Tag pemain lain untuk dibandingkan! Contoh: *.bandingkan @user*");
    }

    const nowMs = now.getTime();
    const [leftProfile, rightProfile, leftClan, rightClan] = await Promise.all([
      this.profileRepo.findOrCreate(groupJid, leftJid),
      this.profileRepo.findOrCreate(groupJid, rightJid),
      this.clanRepo.findByMember(groupJid, leftJid),
      this.clanRepo.findByMember(groupJid, rightJid),
    ]);

    const left = this.buildCompareMetrics(leftProfile, leftClan?.name ?? null, nowMs);
    const right = this.buildCompareMetrics(rightProfile, rightClan?.name ?? null, nowMs);

    const scoreAxis = (cmp: number): void => {
      if (cmp > 0) leftWins += 1;
      else if (cmp < 0) rightWins += 1;
      else ties += 1;
    };

    let leftWins = 0;
    let rightWins = 0;
    let ties = 0;

    scoreAxis(left.level - right.level);
    scoreAxis(left.experience - right.experience);
    scoreAxis(left.totalCash > right.totalCash ? 1 : left.totalCash < right.totalCash ? -1 : 0);
    scoreAxis(left.combatPower - right.combatPower);
    scoreAxis(left.gamesWon - right.gamesWon);
    scoreAxis(left.prestige - right.prestige);
    scoreAxis(left.totalDonated > right.totalDonated ? 1 : left.totalDonated < right.totalDonated ? -1 : 0);

    const overallWinnerJid = leftWins > rightWins ? leftJid : rightWins > leftWins ? rightJid : null;

    return { left, right, leftWins, rightWins, ties, overallWinnerJid };
  }

  async getTargetRank(groupJid: string, userJid: string): Promise<TargetRankResult> {
    const normUser = normalizeUserJid(userJid);
    const profile = await this.profileRepo.findOrCreate(groupJid, normUser);
    const currentLevel = Math.max(1, profile.level);
    const reachableLevel = calculateReachableLevel(profile.experience);
    const currentLevelXp = xpRequiredForLevel(currentLevel);
    const nextLevelXp = xpRequiredForLevel(currentLevel + 1);
    const xpToNextLevel = Math.max(0, nextLevelXp - profile.experience);
    const levelSpan = Math.max(1, nextLevelXp - currentLevelXp);
    const levelProgressPercent =
      xpToNextLevel === 0
        ? 100
        : Math.max(0, Math.min(99, Math.round(((profile.experience - currentLevelXp) / levelSpan) * 100)));

    const currentRank = resolveRank(profile.experience);
    const nextRank = getNextRankName(currentRank);
    const rp = rankProgress(profile.experience);
    const nextRankXp = nextRankThreshold(profile.experience);
    const xpToNextRank = nextRankXp !== null ? Math.max(0, nextRankXp - profile.experience) : 0;
    const rankProgressPercent =
      rp.next === null
        ? 100
        : Math.max(
            0,
            Math.min(99, Math.round((rp.current / Math.max(1, rp.next - rp.threshold)) * 100)),
          );

    const xpBasis = xpToNextRank > 0 ? xpToNextRank : xpToNextLevel;
    const estimatedKuisRuns = xpBasis > 0 ? Math.ceil(xpBasis / 80) : 0;
    const estimatedKerjaRuns = xpBasis > 0 ? Math.ceil(xpBasis / 55) : 0;
    const estimatedBossRuns = xpBasis > 0 ? Math.ceil(xpBasis / 350) : 0;

    const milestones: TargetRankMilestone[] = [];
    const nextCareer = CAREER_CATALOG.find((c) => c.minLevel > currentLevel);
    if (nextCareer) {
      milestones.push({
        label: `Karir ${nextCareer.title} (.lamar ${nextCareer.id})`,
        requiredLevel: nextCareer.minLevel,
        levelsAway: nextCareer.minLevel - currentLevel,
      });
    }
    if (currentLevel < STARTUP_MIN_PLAYER_LEVEL) {
      milestones.push({
        label: "Buka Startup Unicorn (.buatstartup)",
        requiredLevel: STARTUP_MIN_PLAYER_LEVEL,
        levelsAway: STARTUP_MIN_PLAYER_LEVEL - currentLevel,
      });
    }
    if (currentLevel < PRESTIGE_MIN_PLAYER_LEVEL) {
      milestones.push({
        label: "Prestige / Rebirth (.rebirth)",
        requiredLevel: PRESTIGE_MIN_PLAYER_LEVEL,
        levelsAway: PRESTIGE_MIN_PLAYER_LEVEL - currentLevel,
      });
    }
    const nextProp = PROPERTY_CATALOG.find((p) => p.minLevel > currentLevel);
    if (nextProp) {
      milestones.push({
        label: `Properti ${nextProp.name} (.beliproperti ${nextProp.id})`,
        requiredLevel: nextProp.minLevel,
        levelsAway: nextProp.minLevel - currentLevel,
      });
    }
    const nextCrop = FARM_CROP_CATALOG.find((c) => c.minLevel > currentLevel);
    if (nextCrop) {
      milestones.push({
        label: `Bibit ${nextCrop.label} (.tanam ${nextCrop.id})`,
        requiredLevel: nextCrop.minLevel,
        levelsAway: nextCrop.minLevel - currentLevel,
      });
    }

    milestones.sort((a, b) => a.requiredLevel - b.requiredLevel);

    return {
      userJid: normUser,
      currentLevel,
      reachableLevel,
      experience: profile.experience,
      currentLevelXp,
      nextLevelXp,
      xpToNextLevel,
      levelProgressPercent,
      currentRank,
      nextRank,
      xpToNextRank,
      rankProgressPercent,
      estimatedKuisRuns,
      estimatedKerjaRuns,
      estimatedBossRuns,
      upcomingMilestones: milestones.slice(0, 5),
    };
  }

  async getTransactionHistory(
    groupJid: string,
    userJid: string,
    requestedLimit: number = HISTORY_DEFAULT_LIMIT,
  ): Promise<TransactionHistoryResult> {
    const normUser = normalizeUserJid(userJid);
    const limit = Math.max(1, Math.min(HISTORY_MAX_LIMIT, Math.floor(requestedLimit)));
    const profile = await this.profileRepo.findByGroupAndUser(groupJid, normUser);
    if (!profile) {
      return { userJid: normUser, limit, entries: [] };
    }

    const rows = await this.txRepo.listByProfile(profile.id, limit);
    return {
      userJid: normUser,
      limit,
      entries: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        asset: row.asset,
        type: row.type,
        label: getTransactionTypeLabel(row.type),
        amount: row.amount,
        note: row.note,
      })),
    };
  }

  async getPlayerStatistics(
    groupJid: string,
    userJid: string,
    now: Date = new Date(),
  ): Promise<PlayerStatisticsResult> {
    const normUser = normalizeUserJid(userJid);
    const nowMs = now.getTime();
    const [profile, clan, wealthRank, xpRank, levelRank] = await Promise.all([
      this.profileRepo.findOrCreate(groupJid, normUser),
      this.clanRepo.findByMember(groupJid, normUser),
      this.profileRepo.getPositionByWealth(groupJid, normUser),
      this.profileRepo.getPositionByExperience(groupJid, normUser),
      this.profileRepo.getPositionByLevel(groupJid, normUser),
    ]);

    const state = parseRpgState(profile.rpgState);
    const level = Math.max(1, profile.level);
    const totalSkillPoints = getTotalSkillPointsForLevel(level);
    const spentSkillPoints = getSpentSkillPoints(state);
    const unspentSkillPoints = Math.max(0, totalSkillPoints - spentSkillPoints);
    const careerSpec = state.career ? CAREER_MAP.get(state.career.jobId) : null;
    const careerLabel =
      careerSpec && state.career
        ? `${careerSpec.title} (Lv.${String(state.career.level)}, ${String(state.career.shiftsDone)} shift)`
        : "Belum bekerja (.karir)";
    const startupLabel = state.startup
      ? `${state.startup.name} (Lv.${String(state.startup.level)}, ${String(state.startup.employees)} staf)`
      : "Belum punya (.startup)";
    const clanLabel = clan
      ? `${clan.name} (Lv.${String(Math.max(1, clan.level))}, ${String(clan.warWins)} menang war)`
      : "Belum gabung (.geng)";

    const winRatePercent =
      profile.totalGamesPlayed > 0
        ? Math.round((profile.totalGamesWon / profile.totalGamesPlayed) * 100)
        : 0;
    const propertyUnits = Object.values(state.properties).reduce((sum, n) => sum + n, 0);

    return {
      userJid: normUser,
      customTitle: state.customTitle,
      level,
      rank: resolveRank(profile.experience),
      experience: profile.experience,
      prestige: state.prestige,
      combatPower: calculatePlayerCombatPower(level, state, undefined, nowMs),
      hp: state.hp,
      unspentSkillPoints,
      totalSkillPoints,
      wallet: profile.moneyBalance,
      bank: profile.bankBalance,
      totalCash: profile.moneyBalance + profile.bankBalance,
      totalMoneyEarned: profile.totalMoneyEarned,
      totalDonated: BigInt(state.totalDonated),
      pointsBalance: profile.pointsBalance,
      limitBalance: profile.limitBalance,
      gamesPlayed: profile.totalGamesPlayed,
      gamesWon: profile.totalGamesWon,
      winRatePercent,
      currentStreak: profile.currentStreak,
      longestStreak: profile.longestStreak,
      messageCount: profile.messageCount,
      propertyUnits,
      uniqueCards: Object.keys(state.cards).length,
      achievementsCount: state.achievements.length,
      careerLabel,
      startupLabel,
      clanLabel,
      wealthRank,
      xpRank,
      levelRank,
    };
  }

  // ==================== 4. TAHTA KEHORMATAN (.halloffame) ====================

  async getHallOfFame(groupJid: string, now: Date = new Date()): Promise<HallOfFameSnapshot> {
    await this.hydratePoliticsState(groupJid);
    const [
      topWealthList,
      topXpList,
      topLevelList,
      topPrestigeList,
      topWinsList,
      topDonatedList,
      topStreakList,
      clans,
    ] = await Promise.all([
      this.profileRepo.listTopByWealth(groupJid, 1),
      this.profileRepo.listTopByExperience(groupJid, 1),
      this.profileRepo.listTopByLevel(groupJid, 1),
      this.prestigeService.listTopPrestige(groupJid, 1),
      this.profileRepo.listTopByGamesWon(groupJid, 1),
      this.profileRepo.listTopByDonated(groupJid, 1),
      this.profileRepo.listTopByStreak(groupJid, 1),
      this.clanRepo.listByGroup(groupJid),
    ]);

    const richestProf = topWealthList[0];
    const xpProf = topXpList[0];
    const levelProf = topLevelList[0];
    const winsProf = topWinsList[0];
    const donatedRow = topDonatedList[0];
    const streakProf = topStreakList[0];

    const sortedClans = [...clans].sort((a, b) => {
      if (b.warWins !== a.warWins) return b.warWins - a.warWins;
      if (b.level !== a.level) return b.level - a.level;
      if (b.treasuryBalance > a.treasuryBalance) return 1;
      if (b.treasuryBalance < a.treasuryBalance) return -1;
      return 0;
    });
    const bestClan = sortedClans[0];

    return {
      president: this.getActivePresident(groupJid, now),
      richest: richestProf
        ? { userJid: richestProf.userJid, totalCash: richestProf.moneyBalance + richestProf.bankBalance }
        : null,
      topXp: xpProf
        ? { userJid: xpProf.userJid, experience: xpProf.experience, rank: resolveRank(xpProf.experience) }
        : null,
      topLevel: levelProf ? { userJid: levelProf.userJid, level: Math.max(1, levelProf.level) } : null,
      topPrestige: topPrestigeList[0] ?? null,
      topGamesWon: winsProf ? { userJid: winsProf.userJid, gamesWon: winsProf.totalGamesWon } : null,
      topDonated: donatedRow
        ? { userJid: donatedRow.profile.userJid, totalDonated: donatedRow.totalDonated }
        : null,
      topStreak: streakProf ? { userJid: streakProf.userJid, longestStreak: streakProf.longestStreak } : null,
      topClan: bestClan
        ? {
            name: bestClan.name,
            level: Math.max(1, bestClan.level),
            warWins: bestClan.warWins,
            treasuryBalance: bestClan.treasuryBalance,
            memberCount: parseClanMembers(bestClan.memberJids).length,
          }
        : null,
    };
  }
}

export const politicsClanAnalyticsService = new PoliticsClanAnalyticsService();
