import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupClan,
  type GroupMemberProfile,
  type GroupMemberTransaction,
  type TenantGroup,
} from "@prisma/client";

import { commandRouter } from "../src/commands/index";
import { menuService } from "../src/services/menu/menu.service";
import {
  BUDGET_COOLDOWN_MS,
  CANDIDATE_REGISTRATION_FEE,
  CLAN_WAR_WIN_BONUS_MONEY,
  CLAN_WAR_WIN_BONUS_XP,
  COUP_COST,
  COUP_GROUP_COOLDOWN_MS,
  COUP_SUCCESS_XP,
  ELECTION_DURATION_MS,
  getClanUpgradeCost,
  PoliticsClanAnalyticsService,
  PRESIDENCY_INAUGURATION_XP,
  VOTE_PARTICIPATION_XP,
} from "../src/services/rpg/politicsClanAnalytics.service";
import {
  createDefaultRpgState,
  parseRpgState,
  serializeRpgState,
  type MemberRpgState,
} from "../src/services/rpg/rpgState";

const GROUP_JID = "120363999000151515@g.us";
const USER_A = "628111111111@s.whatsapp.net";
const USER_B = "628222222222@s.whatsapp.net";
const USER_C = "628333333333@s.whatsapp.net";
const USER_D = "628444444444@s.whatsapp.net";

function makeProfile(
  userJid: string,
  overrides: Partial<GroupMemberProfile> = {},
  statePatch?: Partial<MemberRpgState>,
): GroupMemberProfile {
  const baseState = createDefaultRpgState();
  const mergedState: MemberRpgState = {
    ...baseState,
    ...statePatch,
    skills: { ...baseState.skills, ...(statePatch?.skills ?? {}) },
    buffs: { ...baseState.buffs, ...(statePatch?.buffs ?? {}) },
    tools: { ...baseState.tools, ...(statePatch?.tools ?? {}) },
    pets: { ...baseState.pets, ...(statePatch?.pets ?? {}) },
    insurances: { ...baseState.insurances, ...(statePatch?.insurances ?? {}) },
  };
  const now = new Date();
  return {
    id: `prof-${userJid}`,
    groupJid: GROUP_JID,
    userJid,
    pointsBalance: 200,
    limitBalance: 100,
    reservedLimit: 0,
    moneyBalance: 500_000_000n,
    bankBalance: 100_000_000n,
    level: 15,
    experience: 4_500,
    currentStreak: 3,
    longestStreak: 7,
    lastDailyClaimAt: null,
    lastWeeklyClaimAt: null,
    lastMonthlyClaimAt: null,
    totalPointsEarned: 200,
    totalLimitsEarned: 100,
    totalMoneyEarned: 600_000_000n,
    totalGamesPlayed: 20,
    totalGamesWon: 12,
    messageCount: 150,
    lastActiveAt: now,
    rpgState: serializeRpgState(mergedState),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeClan(overrides: Partial<GroupClan> = {}): GroupClan {
  const now = new Date();
  return {
    id: "clan-alpha",
    groupJid: GROUP_JID,
    name: "Alpha Squad",
    slug: "alpha-squad",
    leaderJid: USER_A,
    memberJids: [USER_A, USER_B],
    treasuryBalance: 500_000_000n,
    level: 1,
    warWins: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

interface HarnessOptions {
  profiles?: GroupMemberProfile[];
  clans?: GroupClan[];
  treasury?: bigint;
  fixedRandom?: number;
  transactions?: GroupMemberTransaction[];
}

function createHarness(opts: HarnessOptions = {}) {
  const profileMap = new Map<string, GroupMemberProfile>(
    (opts.profiles ?? []).map((p) => [p.userJid, p]),
  );
  const clanMap = new Map<string, GroupClan>((opts.clans ?? []).map((c) => [c.id, c]));
  const ledger: GroupMemberTransaction[] = [...(opts.transactions ?? [])];
  let treasuryBalance = opts.treasury ?? 20_000_000_000_000n;
  let fixedRandom = opts.fixedRandom ?? 0.5;

  const getOrMake = (userJid: string): GroupMemberProfile => {
    const existing = profileMap.get(userJid);
    if (existing) return existing;
    const created = makeProfile(userJid);
    profileMap.set(userJid, created);
    return created;
  };

  const applyProfileData = (target: GroupMemberProfile, data: Record<string, unknown>): GroupMemberProfile => {
    const next = { ...target };
    const applyBigIntField = (key: "moneyBalance" | "bankBalance" | "totalMoneyEarned") => {
      const val = data[key];
      if (typeof val === "bigint") {
        next[key] = val;
      } else if (val && typeof val === "object") {
        const rec = val as { increment?: bigint; decrement?: bigint };
        if (rec.increment !== undefined) next[key] += rec.increment;
        if (rec.decrement !== undefined) next[key] -= rec.decrement;
      }
    };
    const applyNumField = (key: "experience" | "level" | "pointsBalance" | "limitBalance") => {
      const val = data[key];
      if (typeof val === "number") {
        next[key] = val;
      } else if (val && typeof val === "object") {
        const rec = val as { increment?: number; decrement?: number };
        if (rec.increment !== undefined) next[key] += rec.increment;
        if (rec.decrement !== undefined) next[key] -= rec.decrement;
      }
    };
    applyBigIntField("moneyBalance");
    applyBigIntField("bankBalance");
    applyBigIntField("totalMoneyEarned");
    applyNumField("experience");
    applyNumField("level");
    applyNumField("pointsBalance");
    applyNumField("limitBalance");
    if (data.rpgState !== undefined) {
      next.rpgState = data.rpgState as GroupMemberProfile["rpgState"];
    }
    profileMap.set(next.userJid, next);
    return next;
  };

  const applyClanData = (target: GroupClan, data: Record<string, unknown>): GroupClan => {
    const next = { ...target };
    const tb = data.treasuryBalance;
    if (typeof tb === "bigint") {
      next.treasuryBalance = tb;
    } else if (tb && typeof tb === "object") {
      const rec = tb as { increment?: bigint; decrement?: bigint };
      if (rec.increment !== undefined) next.treasuryBalance += rec.increment;
      if (rec.decrement !== undefined) next.treasuryBalance -= rec.decrement;
    }
    const lvl = data.level;
    if (typeof lvl === "number") next.level = lvl;
    else if (lvl && typeof lvl === "object" && "increment" in lvl) {
      next.level += (lvl as { increment: number }).increment;
    }
    const wins = data.warWins;
    if (typeof wins === "number") next.warWins = wins;
    else if (wins && typeof wins === "object" && "increment" in wins) {
      next.warWins += (wins as { increment: number }).increment;
    }
    clanMap.set(next.id, next);
    return next;
  };

  const profileRepo = {
    findOrCreate: async (_g: string, userJid: string) => getOrMake(userJid),
    findByGroupAndUser: async (_g: string, userJid: string) => profileMap.get(userJid) ?? null,
    listRecentActiveProfiles: async (_g: string, excludeUserJid: string, limit = 10) =>
      Array.from(profileMap.values())
        .filter((p) => p.userJid !== excludeUserJid)
        .slice(0, limit),
    listByGroupAndUsers: async (_g: string, userJids: string[]) =>
      userJids
        .map((j) => profileMap.get(j))
        .filter((p): p is GroupMemberProfile => p !== undefined),
    listTopByWealth: async (_g: string, limit = 10) =>
      Array.from(profileMap.values())
        .sort((a, b) => {
          const diff = b.moneyBalance + b.bankBalance - (a.moneyBalance + a.bankBalance);
          return diff > 0n ? 1 : diff < 0n ? -1 : 0;
        })
        .slice(0, limit),
    listTopByExperience: async (_g: string, limit = 10) =>
      Array.from(profileMap.values())
        .sort((a, b) => b.experience - a.experience)
        .slice(0, limit),
    listTopByLevel: async (_g: string, limit = 10) =>
      Array.from(profileMap.values())
        .sort((a, b) => b.level - a.level || b.experience - a.experience)
        .slice(0, limit),
    listTopByGamesWon: async (_g: string, limit = 10) =>
      Array.from(profileMap.values())
        .filter((p) => p.totalGamesWon > 0)
        .sort((a, b) => b.totalGamesWon - a.totalGamesWon)
        .slice(0, limit),
    listTopByDonated: async (_g: string, limit = 10) =>
      Array.from(profileMap.values())
        .map((p) => ({ profile: p, totalDonated: BigInt(parseRpgState(p.rpgState).totalDonated) }))
        .filter((e) => e.totalDonated > 0n)
        .sort((a, b) => (b.totalDonated > a.totalDonated ? 1 : b.totalDonated < a.totalDonated ? -1 : 0))
        .slice(0, limit),
    listTopByStreak: async (_g: string, limit = 10) =>
      Array.from(profileMap.values())
        .filter((p) => p.longestStreak > 0)
        .sort((a, b) => b.longestStreak - a.longestStreak)
        .slice(0, limit),
    getPositionByWealth: async (_g: string, userJid: string) => {
      const sorted = Array.from(profileMap.values()).sort((a, b) => {
        const diff = b.moneyBalance + b.bankBalance - (a.moneyBalance + a.bankBalance);
        return diff > 0n ? 1 : diff < 0n ? -1 : 0;
      });
      const idx = sorted.findIndex((p) => p.userJid === userJid);
      return idx >= 0 ? idx + 1 : 0;
    },
    getPositionByExperience: async (_g: string, userJid: string) => {
      const sorted = Array.from(profileMap.values()).sort((a, b) => b.experience - a.experience);
      const idx = sorted.findIndex((p) => p.userJid === userJid);
      return idx >= 0 ? idx + 1 : 0;
    },
    getPositionByLevel: async (_g: string, userJid: string) => {
      const sorted = Array.from(profileMap.values()).sort((a, b) => b.level - a.level);
      const idx = sorted.findIndex((p) => p.userJid === userJid);
      return idx >= 0 ? idx + 1 : 0;
    },
  };

  const txRepo = {
    create: async (data: {
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
    }) => {
      const row: GroupMemberTransaction = {
        id: `tx-${String(ledger.length + 1)}`,
        profileId: data.profileId,
        groupJid: data.groupJid,
        userJid: data.userJid,
        actorJid: data.actorJid ?? null,
        targetUserJid: data.targetUserJid ?? null,
        asset: data.asset,
        type: data.type,
        amount: BigInt(data.amount),
        balanceBefore: data.balanceBefore !== undefined ? BigInt(data.balanceBefore) : null,
        balanceAfter: data.balanceAfter !== undefined ? BigInt(data.balanceAfter) : null,
        feature: null,
        correlationId: data.correlationId ?? null,
        idempotencyKey: null,
        note: data.note ?? null,
        createdAt: new Date(),
      };
      ledger.unshift(row);
      return row;
    },
    listByProfile: async (profileId: string, limit = 20) =>
      ledger.filter((t) => t.profileId === profileId).slice(0, limit),
  };

  const clanRepo = {
    findBySlug: async (_g: string, slug: string) =>
      Array.from(clanMap.values()).find((c) => c.slug === slug) ?? null,
    listByGroup: async () => Array.from(clanMap.values()),
    findByMember: async (_g: string, userJid: string) =>
      Array.from(clanMap.values()).find(
        (c) => Array.isArray(c.memberJids) && c.memberJids.includes(userJid),
      ) ?? null,
    update: async (
      id: string,
      data: {
        leaderJid?: string;
        memberJids?: string[];
        treasuryBalance?: bigint | { increment?: bigint; decrement?: bigint };
        level?: number | { increment: number };
        warWins?: number | { increment: number };
      },
    ) => {
      const current = clanMap.get(id);
      if (!current) throw new Error("Clan not found");
      return applyClanData(current, data as Record<string, unknown>);
    },
  };

  const prestigeService = {
    listTopPrestige: async (_g: string, limit = 10) =>
      Array.from(profileMap.values())
        .map((p) => ({
          userJid: p.userJid,
          prestige: parseRpgState(p.rpgState).prestige,
          level: p.level,
          netCash: p.moneyBalance + p.bankBalance,
        }))
        .filter((e) => e.prestige > 0)
        .sort((a, b) => b.prestige - a.prestige || b.level - a.level)
        .slice(0, limit),
  };

  const makeTenant = (): TenantGroup =>
    ({
      id: "tenant-1",
      groupJid: GROUP_JID,
      tenantCode: "GRP-15",
      treasuryBalance,
    }) as TenantGroup;

  const db = {
    tenantGroup: {
      findUnique: async () => makeTenant(),
    },
    $transaction: async <T>(fn: (tx: never) => Promise<T>): Promise<T> => {
      const tx = {
        groupMemberProfile: {
          updateMany: async (args: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => {
            const target = Array.from(profileMap.values()).find((p) => p.id === args.where.id);
            if (!target) return { count: 0 };
            const mbFilter = args.where.moneyBalance as { gte?: bigint } | undefined;
            if (mbFilter?.gte !== undefined && target.moneyBalance < mbFilter.gte) {
              return { count: 0 };
            }
            applyProfileData(target, args.data);
            return { count: 1 };
          },
          findUniqueOrThrow: async (args: { where: Record<string, unknown> }) => {
            const target = Array.from(profileMap.values()).find((p) => p.id === args.where.id);
            if (!target) throw new Error("Profile not found");
            return target;
          },
          update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            const target = Array.from(profileMap.values()).find((p) => p.id === args.where.id);
            if (!target) throw new Error("Profile not found");
            return applyProfileData(target, args.data);
          },
        },
        tenantGroup: {
          findUnique: async () => makeTenant(),
          update: async (args: { data: Record<string, unknown> }) => {
            const tb = args.data.treasuryBalance as { increment?: bigint; decrement?: bigint } | undefined;
            if (tb?.increment !== undefined) treasuryBalance += tb.increment;
            if (tb?.decrement !== undefined) treasuryBalance -= tb.decrement;
            return makeTenant();
          },
          updateMany: async (args: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => {
            const tbWhere = args.where.treasuryBalance as { gte?: bigint } | undefined;
            if (tbWhere?.gte !== undefined && treasuryBalance < tbWhere.gte) {
              return { count: 0 };
            }
            const tbData = args.data.treasuryBalance as { increment?: bigint; decrement?: bigint } | undefined;
            if (tbData?.increment !== undefined) treasuryBalance += tbData.increment;
            if (tbData?.decrement !== undefined) treasuryBalance -= tbData.decrement;
            return { count: 1 };
          },
        },
        groupClan: {
          updateMany: async (args: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => {
            const target = clanMap.get(String(args.where.id));
            if (!target) return { count: 0 };
            const tbWhere = args.where.treasuryBalance as { gte?: bigint } | undefined;
            if (tbWhere?.gte !== undefined && target.treasuryBalance < tbWhere.gte) {
              return { count: 0 };
            }
            if (typeof args.where.level === "number" && target.level !== args.where.level) {
              return { count: 0 };
            }
            applyClanData(target, args.data);
            return { count: 1 };
          },
          findUniqueOrThrow: async (args: { where: { id: string } }) => {
            const target = clanMap.get(args.where.id);
            if (!target) throw new Error("Clan not found");
            return target;
          },
        },
      };
      return fn(tx as never);
    },
  };

  const service = new PoliticsClanAnalyticsService(
    profileRepo,
    txRepo,
    clanRepo,
    prestigeService,
    {
      intBetween: (min: number, max: number) => Math.round(min + (max - min) * fixedRandom),
      chance: (probability: number) => fixedRandom < probability,
    },
    db,
  );

  return {
    service,
    profileMap,
    clanMap,
    ledger,
    getTreasury: () => treasuryBalance,
    setRandom: (v: number) => {
      fixedRandom = v;
    },
  };
}

describe("Tahap 15: Politik Grup, Geng War & Analisis Progres", () => {
  it("mendaftarkan seluruh 14 command utama & alias di CommandRouter serta katalog Menu", () => {
    const primaryCommands = [
      "pemilu",
      "daftarcalon",
      "coblos",
      "presiden",
      "bagianggaran",
      "kudeta",
      "gengupgrade",
      "gengbuff",
      "gengwar",
      "bandingkan",
      "targetrank",
      "riwayat",
      "statistik",
      "halloffame",
    ];
    const sampleAliases = [
      "pilpres",
      "capres",
      "votecapres",
      "istana",
      "subsidi",
      "gulingkan",
      "upgradegeng",
      "buffgeng",
      "peranggeng",
      "compare",
      "vs",
      "cekrank",
      "mutasi",
      "statku",
      "hof",
      "kehormatan",
    ];

    for (const cmd of [...primaryCommands, ...sampleAliases]) {
      assert.equal(commandRouter.has(cmd), true, `Command .${cmd} harus terdaftar`);
    }

    const catalog = menuService.getSearchableCatalog();
    for (const cmd of primaryCommands) {
      assert.equal(
        catalog.some((entry) => entry.primaryCommand === cmd),
        true,
        `Command .${cmd} harus muncul di katalog menu`,
      );
    }
  });

  it("menjalankan siklus Pemilu lengkap: mulai -> daftar calon -> coblos (+50 XP) -> lantik -> bagianggaran", async () => {
    const h = createHarness({
      profiles: [
        makeProfile(USER_A, { moneyBalance: 100_000_000n, level: 10, experience: 3_000 }),
        makeProfile(USER_B, { moneyBalance: 50_000_000n, level: 8, experience: 2_000 }),
        makeProfile(USER_C, { moneyBalance: 10_000_000n, level: 5, experience: 1_000 }),
      ],
      treasury: 1_000_000_000n,
    });
    const t0 = new Date("2026-11-28T05:00:00Z");

    const started = await h.service.inspectOrStartElection(GROUP_JID, USER_A, t0);
    assert.equal(started.mode, "started");

    const regA = await h.service.registerCandidate(GROUP_JID, USER_A, "Subsidi rata untuk semua!", t0);
    assert.equal(regA.candidateNumber, 1);
    assert.equal(regA.feePaid, CANDIDATE_REGISTRATION_FEE);
    assert.equal(h.profileMap.get(USER_A)?.moneyBalance, 100_000_000n - CANDIDATE_REGISTRATION_FEE);
    assert.equal(h.getTreasury(), 1_000_000_000n + CANDIDATE_REGISTRATION_FEE);

    await h.service.registerCandidate(GROUP_JID, USER_B, "Anti pajak tinggi", t0);

    const voteC = await h.service.castVote(GROUP_JID, USER_C, 1, t0);
    assert.equal(voteC.candidateJid, USER_A);
    assert.equal(voteC.xpGained, VOTE_PARTICIPATION_XP);
    assert.equal(h.profileMap.get(USER_C)?.experience, 1_000 + VOTE_PARTICIPATION_XP);

    await assert.rejects(() => h.service.castVote(GROUP_JID, USER_C, USER_B, t0), /sudah menggunakan hak suara/i);

    const fin = await h.service.finalizeElection(GROUP_JID, true, t0);
    assert.equal(fin.winnerJid, USER_A);
    assert.equal(fin.winnerVotes, 1);
    assert.equal(fin.xpAwarded, PRESIDENCY_INAUGURATION_XP);
    assert.equal(h.profileMap.get(USER_A)?.experience, 3_000 + PRESIDENCY_INAUGURATION_XP);

    // Non-president tidak boleh bagianggaran
    await assert.rejects(
      () => h.service.distributeBudget(GROUP_JID, USER_B, 20_000_000n, t0),
      /Hanya Presiden Grup/i,
    );

    const budget = await h.service.distributeBudget(GROUP_JID, USER_A, 20_000_000n, t0);
    assert.equal(budget.recipients.length, 2);
    assert.equal(budget.perMember, 10_000_000n);
    assert.equal(h.profileMap.get(USER_C)?.moneyBalance, 20_000_000n);

    // Cooldown 12 jam
    await assert.rejects(
      () => h.service.distributeBudget(GROUP_JID, USER_A, 10_000_000n, new Date(t0.getTime() + 60_000)),
      /Tunggu/i,
    );
    const budget2 = await h.service.distributeBudget(
      GROUP_JID,
      USER_A,
      10_000_000n,
      new Date(t0.getTime() + BUDGET_COOLDOWN_MS + 1000),
    );
    assert.equal(budget2.distributedTotal, 10_000_000n);
  });

  it("menangani kudeta gagal (masuk penjara 15 menit) dan kudeta berhasil (ganti presiden)", async () => {
    const h = createHarness({
      profiles: [
        makeProfile(USER_A, { moneyBalance: 200_000_000n, level: 12, experience: 3_000 }),
        makeProfile(USER_B, { moneyBalance: 200_000_000n, level: 12, experience: 2_500 }),
      ],
      treasury: 500_000_000n,
      fixedRandom: 0.9, // fail (> 0.35)
    });
    const t0 = new Date("2026-11-28T06:00:00Z");

    await h.service.inspectOrStartElection(GROUP_JID, USER_A, t0);
    await h.service.registerCandidate(GROUP_JID, USER_A, "Maju terus", t0);
    await h.service.finalizeElection(GROUP_JID, true, new Date(t0.getTime() + ELECTION_DURATION_MS + 1000));

    const tFail = new Date(t0.getTime() + ELECTION_DURATION_MS + 5_000);
    const failed = await h.service.attemptCoup(GROUP_JID, USER_B, tFail);
    assert.equal(failed.success, false);
    assert.equal(failed.jailMinutes, 15);
    assert.equal(failed.coupsRepelled, 1);
    assert.equal(h.profileMap.get(USER_B)?.moneyBalance, 200_000_000n - COUP_COST);
    const stateB = parseRpgState(h.profileMap.get(USER_B)?.rpgState);
    assert.ok(stateB.jailedUntil > tFail.getTime());

    // Setelah cooldown kudeta & bebas penjara -> roll < 0.35 berhasil!
    h.setRandom(0.1);
    const tSuccess = new Date(tFail.getTime() + COUP_GROUP_COOLDOWN_MS + 60_000);
    const succeeded = await h.service.attemptCoup(GROUP_JID, USER_B, tSuccess);
    assert.equal(succeeded.success, true);
    assert.equal(succeeded.xpGained, COUP_SUCCESS_XP);
    assert.equal(h.service.getActivePresident(GROUP_JID, tSuccess)?.presidentJid, USER_B);
    assert.equal(h.service.getActivePresident(GROUP_JID, tSuccess)?.viaCoup, true);
  });

  it("menjalankan Upgrade Geng, Buff Geng, dan Perang Geng dengan rampasan kas & bonus member", async () => {
    const clanA = makeClan({
      id: "clan-a",
      name: "Garuda Merah",
      slug: "garuda-merah",
      leaderJid: USER_A,
      memberJids: [USER_A, USER_B],
      treasuryBalance: 400_000_000n,
      level: 1,
      warWins: 0,
    });
    const clanB = makeClan({
      id: "clan-b",
      name: "Elang Biru",
      slug: "elang-biru",
      leaderJid: USER_C,
      memberJids: [USER_C],
      treasuryBalance: 200_000_000n,
      level: 1,
      warWins: 0,
    });

    const h = createHarness({
      profiles: [
        makeProfile(
          USER_A,
          { level: 25, moneyBalance: 50_000_000n, experience: 5_000 },
          { hp: 40, tools: { sword: { level: 5, durability: 100 }, armor: { level: 3, durability: 100 }, pickaxe: { level: 0, durability: 0 }, fishingrod: { level: 0, durability: 0 } } },
        ),
        makeProfile(USER_B, { level: 20, moneyBalance: 50_000_000n, experience: 4_000 }),
        makeProfile(USER_C, { level: 5, moneyBalance: 50_000_000n, experience: 500 }),
      ],
      clans: [clanA, clanB],
      fixedRandom: 0.5,
    });

    const t0 = new Date("2026-11-28T07:00:00Z");
    const upgradeCost = getClanUpgradeCost(1);
    const up = await h.service.upgradeClan(GROUP_JID, USER_A);
    assert.equal(up.oldLevel, 1);
    assert.equal(up.newLevel, 2);
    assert.equal(up.costPaid, upgradeCost);
    assert.equal(h.clanMap.get("clan-a")?.level, 2);
    assert.equal(h.clanMap.get("clan-a")?.treasuryBalance, 400_000_000n - upgradeCost);

    const buff = await h.service.claimClanBuff(GROUP_JID, USER_A, t0);
    assert.equal(buff.hpAfter, 100);
    assert.equal(buff.buffMinutesAdded, 25); // 15 + 2*5
    assert.equal(buff.xpGained, 70); // 40 + 2*15
    assert.ok(parseRpgState(h.profileMap.get(USER_A)?.rpgState).buffs.jamukuat > t0.getTime());

    const war = await h.service.startClanWar(GROUP_JID, USER_A, "Elang Biru", t0);
    assert.equal(war.attackerWon, true);
    assert.equal(war.winnerClanName, "Garuda Merah");
    assert.equal(war.winnerWarWins, 1);
    assert.equal(war.treasuryLoot, 24_000_000n); // 12% of 200jt
    assert.equal(war.rewardedMemberJids.length, 2);
    assert.equal(h.profileMap.get(USER_B)?.moneyBalance, 50_000_000n + CLAN_WAR_WIN_BONUS_MONEY);
    assert.equal(h.profileMap.get(USER_B)?.experience, 4_000 + CLAN_WAR_WIN_BONUS_XP);
  });

  it("menyediakan analisis Head-to-Head (.bandingkan), Target Rank, Riwayat Mutasi, Statistik, & Hall of Fame", async () => {
    const clanTop = makeClan({
      id: "clan-top",
      name: "Naga Emas",
      slug: "naga-emas",
      leaderJid: USER_A,
      memberJids: [USER_A, USER_D],
      treasuryBalance: 900_000_000n,
      level: 4,
      warWins: 5,
    });
    const profA = makeProfile(
      USER_A,
      {
        level: 16,
        experience: 16_000,
        moneyBalance: 1_000_000_000n,
        bankBalance: 500_000_000n,
        totalGamesWon: 40,
        totalGamesPlayed: 50,
        longestStreak: 14,
      },
      { prestige: 2, totalDonated: "250000000", career: { jobId: "programmer", level: 3, shiftsDone: 15 } },
    );
    const profB = makeProfile(
      USER_B,
      {
        level: 4,
        experience: 600,
        moneyBalance: 20_000_000n,
        bankBalance: 10_000_000n,
        totalGamesWon: 2,
        totalGamesPlayed: 10,
        longestStreak: 2,
      },
      { prestige: 0, totalDonated: "0" },
    );
    const sampleTx: GroupMemberTransaction = {
      id: "tx-seed-1",
      profileId: profA.id,
      groupJid: GROUP_JID,
      userJid: USER_A,
      actorJid: null,
      targetUserJid: null,
      asset: MemberTransactionAsset.MONEY,
      type: MemberTransactionType.RPG_EARN,
      amount: 3_000_000n,
      balanceBefore: 997_000_000n,
      balanceAfter: 1_000_000_000n,
      feature: null,
      correlationId: "corr-1",
      idempotencyKey: null,
      note: "kerja",
      createdAt: new Date("2026-11-28T03:30:00Z"),
    };

    const h = createHarness({
      profiles: [profA, profB],
      clans: [clanTop],
      transactions: [sampleTx],
    });

    const cmp = await h.service.comparePlayers(GROUP_JID, USER_A, USER_B);
    assert.equal(cmp.overallWinnerJid, USER_A);
    assert.equal(cmp.leftWins, 7);
    assert.equal(cmp.rightWins, 0);

    const target = await h.service.getTargetRank(GROUP_JID, USER_B);
    assert.equal(target.currentRank, "Warrior");
    assert.equal(target.nextRank, "Elite");
    assert.equal(target.xpToNextRank, 400);
    assert.ok(target.upcomingMilestones.length > 0);
    assert.equal(target.upcomingMilestones.some((m) => m.requiredLevel === 20), true); // Startup Lv.20

    const hist = await h.service.getTransactionHistory(GROUP_JID, USER_A, 5);
    assert.equal(hist.entries.length, 1);
    assert.equal(hist.entries[0]?.label, "Penghasilan RPG");
    assert.equal(hist.entries[0]?.amount, 3_000_000n);

    const stat = await h.service.getPlayerStatistics(GROUP_JID, USER_A);
    assert.equal(stat.rank, "Grandmaster");
    assert.equal(stat.winRatePercent, 80);
    assert.equal(stat.wealthRank, 1);
    assert.match(stat.clanLabel, /Naga Emas/);

    const hof = await h.service.getHallOfFame(GROUP_JID);
    assert.equal(hof.richest?.userJid, USER_A);
    assert.equal(hof.topPrestige?.prestige, 2);
    assert.equal(hof.topClan?.name, "Naga Emas");
    assert.equal(hof.topClan?.warWins, 5);
  });
});
