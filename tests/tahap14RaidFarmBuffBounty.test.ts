import assert from "node:assert/strict";
import test from "node:test";
import type { GroupMemberProfile, TenantGroup } from "@prisma/client";

import { commandRouter } from "../src/commands";
import { KUIS_REWARD } from "../src/services/game/gameReward.constants";
import { menuService } from "../src/services/menu/menu.service";
import {
  BLACK_MARKET_CATALOG,
  BOUNTY_MIN_AMOUNT,
  FARM_CROP_CATALOG,
  getCommodityMarketQuotesAt,
  RaidFarmBuffBountyService,
  SKILL_RESET_COST,
  WORLD_BOSS_CATALOG,
} from "../src/services/rpg/raidFarmBuffBounty.service";
import { DEFAULT_GROUP_TREASURY } from "../src/services/rpg/rpgEconomy.service";
import { calculatePlayerCombatPower } from "../src/services/rpg/rpgInfinite.service";
import { createDefaultRpgState, parseRpgState, serializeRpgState } from "../src/services/rpg/rpgState";

function createHarness(
  initial: Partial<GroupMemberProfile>[] = [],
  opts: { fixedInt?: (min: number, max: number) => number; fixedChance?: boolean } = {},
) {
  const profiles = new Map<string, GroupMemberProfile>();
  let seq = 1;
  let treasuryBalance = DEFAULT_GROUP_TREASURY;

  const makeProfile = (p: Partial<GroupMemberProfile>): GroupMemberProfile => ({
    id: p.id ?? `p_${String(seq++)}`,
    groupJid: p.groupJid ?? "120@g.us",
    userJid: p.userJid ?? "6281@s.whatsapp.net",
    pointsBalance: p.pointsBalance ?? 100,
    limitBalance: p.limitBalance ?? 100,
    reservedLimit: p.reservedLimit ?? 0,
    experience: p.experience ?? 5_000,
    moneyBalance: p.moneyBalance ?? 100_000_000n,
    bankBalance: p.bankBalance ?? 0n,
    totalMoneyEarned: p.totalMoneyEarned ?? 100_000_000n,
    level: p.level ?? 10,
    totalPointsEarned: p.totalPointsEarned ?? 100,
    totalLimitsEarned: p.totalLimitsEarned ?? 100,
    totalGamesPlayed: p.totalGamesPlayed ?? 0,
    totalGamesWon: p.totalGamesWon ?? 0,
    currentStreak: p.currentStreak ?? 0,
    longestStreak: p.longestStreak ?? 0,
    lastDailyClaimAt: null,
    lastWeeklyClaimAt: null,
    lastMonthlyClaimAt: null,
    rpgState: p.rpgState ?? null,
    partnerJid: null,
    partnerSince: null,
    messageCount: p.messageCount ?? 0,
    lastActiveAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  for (const item of initial) {
    const built = makeProfile(item);
    profiles.set(built.id, built);
  }

  const findOrCreate = (groupJid: string, userJid: string): Promise<GroupMemberProfile> => {
    for (const p of profiles.values()) {
      if (p.groupJid === groupJid && p.userJid === userJid) return Promise.resolve(p);
    }
    const built = makeProfile({ groupJid, userJid });
    profiles.set(built.id, built);
    return Promise.resolve(built);
  };

  const findByGroupAndUser = (
    groupJid: string,
    userJid: string,
  ): Promise<GroupMemberProfile | null> => {
    for (const p of profiles.values()) {
      if (p.groupJid === groupJid && p.userJid === userJid) return Promise.resolve(p);
    }
    return Promise.resolve(null);
  };

  const applyData = (target: GroupMemberProfile, data: Record<string, unknown>) => {
    const next = { ...target };
    for (const k of ["moneyBalance", "bankBalance", "totalMoneyEarned"] as const) {
      const val = data[k] as { increment?: bigint; decrement?: bigint } | bigint | undefined;
      if (typeof val === "bigint") next[k] = val;
      else if (val && typeof val === "object") {
        if (val.increment !== undefined) next[k] = next[k] + val.increment;
        if (val.decrement !== undefined) next[k] = next[k] - val.decrement;
      }
    }
    for (const k of ["experience", "pointsBalance", "limitBalance"] as const) {
      const val = data[k] as { increment?: number; decrement?: number } | number | undefined;
      if (typeof val === "number") next[k] = val;
      else if (val && typeof val === "object") {
        if (val.increment !== undefined) next[k] = next[k] + val.increment;
        if (val.decrement !== undefined) next[k] = next[k] - val.decrement;
      }
    }
    if ("rpgState" in data) {
      next.rpgState = data.rpgState as GroupMemberProfile["rpgState"];
    }
    profiles.set(next.id, next);
    return next;
  };

  const tx = {
    groupMemberProfile: {
      updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const found = profiles.get(args.where.id as string);
        if (!found) return Promise.resolve({ count: 0 });
        const cond = args.where.moneyBalance as { gte?: bigint } | undefined;
        if (cond?.gte !== undefined && found.moneyBalance < cond.gte) {
          return Promise.resolve({ count: 0 });
        }
        applyData(found, args.data);
        return Promise.resolve({ count: 1 });
      },
      findUniqueOrThrow: (args: { where: Record<string, unknown> }) => {
        const found = profiles.get(args.where.id as string);
        if (!found) throw new Error("Not found");
        return Promise.resolve(found);
      },
      update: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const found = profiles.get(args.where.id as string);
        if (!found) throw new Error("Not found");
        return Promise.resolve(applyData(found, args.data));
      },
    },
    tenantGroup: {
      findUnique: () =>
        Promise.resolve({
          groupJid: "120@g.us",
          treasuryBalance,
        } as unknown as TenantGroup),
      update: (args: { data: Record<string, unknown> }) => {
        if (typeof args.data.treasuryBalance === "bigint") {
          treasuryBalance = args.data.treasuryBalance;
        }
        return Promise.resolve({
          groupJid: "120@g.us",
          treasuryBalance,
        } as unknown as TenantGroup);
      },
    },
  };

  const service = new RaidFarmBuffBountyService(
    { findOrCreate, findByGroupAndUser },
    { create: () => Promise.resolve({}) },
    {
      intBetween: (min, max) => (opts.fixedInt ? opts.fixedInt(min, max) : min),
      chance: () => opts.fixedChance ?? true,
    },
    {
      $transaction: async <T>(fn: (txArg: typeof tx) => Promise<T>): Promise<T> => fn(tx),
    },
  );

  return { service, profiles, getTreasury: () => treasuryBalance };
}

void test("Tahap 14: all 20 primary commands + aliases registered, 20T default treasury, and 60% money / 100% points-XP policy", () => {
  const expected = [
    "worldboss",
    "wb",
    "raidboss",
    "serangboss",
    "hitboss",
    "raid",
    "statusboss",
    "cekboss",
    "hpboss",
    "topdamage",
    "bossdmg",
    "damagelog",
    "skill",
    "skilltree",
    "statskill",
    "upskill",
    "addskill",
    "resetskill",
    "resetsp",
    "ladang",
    "kebun",
    "farm",
    "tanam",
    "plant",
    "siram",
    "waterfarm",
    "panenladang",
    "harvest",
    "pasarharga",
    "hargakomoditas",
    "jualsemua",
    "jualpanen",
    "blackmarket",
    "bm",
    "belibuff",
    "buybuff",
    "buffaktif",
    "buff",
    "gunakan",
    "usebuff",
    "bounty",
    "buronan",
    "sayembara",
    "listbounty",
    "daftarbounty",
    "burubounty",
    "huntbounty",
  ];
  for (const cmd of expected) {
    assert.equal(commandRouter.has(cmd), true, `Command .${cmd} harus terdaftar`);
  }

  // Verify default Kas Negara = 20 Triliun
  assert.equal(DEFAULT_GROUP_TREASURY, 20_000_000_000_000n);
  // Verify Money = 60% (600k) while Points/XP = 100% (10 pts / 40 XP)
  assert.equal(KUIS_REWARD.CORRECT_MONEY, 600_000n);
  assert.equal(KUIS_REWARD.CORRECT_POINTS, 10);
  assert.equal(KUIS_REWARD.CORRECT_XP, 40);

  // Verify searchable catalog includes Tahap 14 section
  const catalog = menuService.getSearchableCatalog();
  assert.ok(catalog.some((e) => e.primaryCommand === "worldboss"));
  assert.ok(catalog.some((e) => e.primaryCommand === "burubounty"));
  assert.ok(WORLD_BOSS_CATALOG.length >= 6);
  assert.ok(FARM_CROP_CATALOG.length >= 6);
  assert.ok(BLACK_MARKET_CATALOG.length >= 4);
});

void test("Tahap 14: Skill Tree upgrade, real combat power boost, and reset fee sink", async () => {
  const { service, profiles } = createHarness([
    {
      groupJid: "120@g.us",
      userJid: "6281@s.whatsapp.net",
      level: 5, // 10 SP available
      moneyBalance: 20_000_000n,
    },
  ]);

  const before = await service.getSkillOverview("120@g.us", "6281@s.whatsapp.net");
  assert.equal(before.totalSkillPoints, 10);
  assert.equal(before.freeSkillPoints, 10);

  const up = await service.upgradeSkill("120@g.us", "6281@s.whatsapp.net", "str", 5);
  assert.equal(up.newStatValue, 5);
  assert.equal(up.freeSkillPoints, 5);
  assert.ok(up.combatPower > before.combatPower);

  // Cannot overspend SP
  await assert.rejects(
    () => service.upgradeSkill("120@g.us", "6281@s.whatsapp.net", "agi", 6),
    /tidak cukup/,
  );

  // Reset costs SKILL_RESET_COST and refunds all spent SP
  const reset = await service.resetSkills("120@g.us", "6281@s.whatsapp.net");
  assert.equal(reset.costPaid, SKILL_RESET_COST);
  assert.equal(reset.refundedPoints, 5);
  assert.equal(reset.currentMoney, 20_000_000n - SKILL_RESET_COST);

  const prof = Array.from(profiles.values())[0];
  assert.ok(prof);
  assert.equal(parseRpgState(prof.rpgState).skills.str, 0);
});

void test("Tahap 14: Ladang plant, water speedup, harvest, deterministic market, and sellAll with CHA & buff", async () => {
  const t0 = 1_760_000_000_000;
  const { service } = createHarness([
    {
      groupJid: "120@g.us",
      userJid: "6281@s.whatsapp.net",
      level: 10,
      moneyBalance: 100_000_000n,
    },
  ]);

  // Upgrade CHA for better selling price & buy/use Jimat Cuan
  await service.upgradeSkill("120@g.us", "6281@s.whatsapp.net", "cha", 4, t0);
  await service.buyBlackMarketBuff("120@g.us", "6281@s.whatsapp.net", "jimatcuan", 1);
  const used = await service.useBlackMarketBuff("120@g.us", "6281@s.whatsapp.net", "jimatcuan", t0);
  assert.ok(used.activeRemainingMs > 0);

  // Verify crop level gate (Lv.10 cannot plant Lv.30 truffle)
  await assert.rejects(
    () => service.plantCrop("120@g.us", "6281@s.whatsapp.net", "truffle", 1, t0),
    /Level 30/,
  );

  const planted = await service.plantCrop("120@g.us", "6281@s.whatsapp.net", "padi", 2, t0);
  assert.equal(planted.plantedCount, 2);
  assert.equal(planted.usedPlots, 2);

  // Water reduces remaining time by 35% (15m -> 9.75m)
  const watered = await service.waterFarm("120@g.us", "6281@s.whatsapp.net", t0 + 60_000);
  assert.equal(watered.wateredCount, 2);
  assert.ok(watered.xpGained > 0);

  // Cannot harvest before ready
  await assert.rejects(
    () => service.harvestFarm("120@g.us", "6281@s.whatsapp.net", t0 + 2 * 60_000),
    /Belum ada tanaman/,
  );

  // Ready after 12 minutes (since watered cut 14m * 0.65 = 9.1m)
  const tReady = t0 + 12 * 60 * 1000;
  const harv = await service.harvestFarm("120@g.us", "6281@s.whatsapp.net", tReady);
  assert.equal(harv.harvestedPlots, 2);
  assert.ok((harv.yielded.padi ?? 0) >= 6);

  // Deterministic market check
  const m1 = getCommodityMarketQuotesAt(tReady);
  const m2 = getCommodityMarketQuotesAt(tReady);
  assert.equal(m1.quotes[0]?.price, m2.quotes[0]?.price);

  // Sell all with CHA (+6%) and Jimat Cuan (+25%)
  const sold = await service.sellAllHarvest("120@g.us", "6281@s.whatsapp.net", tReady);
  assert.equal(sold.chaBonusPercent, 6);
  assert.equal(sold.buffBonusPercent, 25);
  assert.ok(sold.totalReceived > sold.baseTotal);
});

void test("Tahap 14: World Boss Raid spawn, multi-player attack, kill distribution, and respawn cooldown", async () => {
  const t0 = 1_760_100_000_000;
  const strongState = createDefaultRpgState();
  strongState.tools.sword = { level: 10, durability: 100 };
  strongState.pets.phonix = { level: 20, exp: 0, hunger: 100 };
  strongState.skills.str = 50;
  strongState.buffs.jamukuat = t0 + 3_600_000;

  const { service, profiles } = createHarness(
    [
      {
        groupJid: "120@g.us",
        userJid: "6281@s.whatsapp.net",
        level: 50,
        moneyBalance: 10_000_000n,
        rpgState: serializeRpgState(strongState) as never,
      },
      {
        groupJid: "120@g.us",
        userJid: "6282@s.whatsapp.net",
        level: 50,
        moneyBalance: 10_000_000n,
        rpgState: serializeRpgState(strongState) as never,
      },
    ],
    { fixedInt: (_min, max) => max, fixedChance: true },
  );

  // Verify jamukuat + STR boost combat power
  assert.ok(calculatePlayerCombatPower(50, strongState, undefined, t0) > 5_000);

  const spawned = service.inspectOrSpawnWorldBoss("120@g.us", t0);
  assert.equal(spawned.spawned, true);

  // Attack until defeated (alternating players advancing time past 4m cooldown)
  let t = t0;
  let defeated = false;
  let lastResult = null;
  for (let turn = 0; turn < 10 && !defeated; turn += 1) {
    const attacker = turn % 2 === 0 ? "6281@s.whatsapp.net" : "6282@s.whatsapp.net";
    const res = await service.attackWorldBoss("120@g.us", attacker, t);
    lastResult = res;
    defeated = res.defeated;
    t += 250_000;
  }

  assert.equal(defeated, true);
  assert.ok(lastResult && lastResult.distributions.length >= 1);
  assert.ok(lastResult.totalPoolPaid > 0n);

  // Top damage log persists after defeat
  const log = service.getTopBossDamage("120@g.us", t);
  assert.ok(log && !log.isActive && log.rankings.length >= 1);

  // Immediate respawn blocked by 30m respawn cooldown
  assert.throws(() => service.inspectOrSpawnWorldBoss("120@g.us", t), /muncul dalam/);

  // Verify winner received money
  const p1 = Array.from(profiles.values()).find((p) => p.userJid === "6281@s.whatsapp.net");
  assert.ok(p1 && p1.moneyBalance > 10_000_000n);
});

void test("Tahap 14: Bounty board escrow, stacking, hunt victory with 5% treasury tax & UGD, and anti-self", async () => {
  const t0 = 1_760_200_000_000;
  const hunterState = createDefaultRpgState();
  hunterState.tools.sword = { level: 8, durability: 100 };
  hunterState.skills.agi = 20;

  const { service, profiles, getTreasury } = createHarness(
    [
      {
        groupJid: "120@g.us",
        userJid: "6281@s.whatsapp.net", // poster
        moneyBalance: 50_000_000n,
      },
      {
        groupJid: "120@g.us",
        userJid: "6282@s.whatsapp.net", // target
        level: 1,
        moneyBalance: 10_000_000n,
      },
      {
        groupJid: "120@g.us",
        userJid: "6283@s.whatsapp.net", // hunter
        level: 30,
        moneyBalance: 5_000_000n,
        rpgState: serializeRpgState(hunterState) as never,
      },
    ],
    { fixedInt: (min) => min, fixedChance: false },
  );

  // Reject self bounty
  await assert.rejects(
    () => service.postBounty("120@g.us", "6281@s.whatsapp.net", "6281@s.whatsapp.net", 5_000_000n, t0),
    /diri sendiri/,
  );

  // Reject below min
  await assert.rejects(
    () =>
      service.postBounty(
        "120@g.us",
        "6281@s.whatsapp.net",
        "6282@s.whatsapp.net",
        BOUNTY_MIN_AMOUNT - 1n,
        t0,
      ),
    /Nominal sayembara/,
  );

  // Post & stack bounty (5jt + 5jt = 10jt)
  await service.postBounty("120@g.us", "6281@s.whatsapp.net", "6282@s.whatsapp.net", 5_000_000n, t0);
  const stacked = await service.postBounty(
    "120@g.us",
    "6281@s.whatsapp.net",
    "6282@s.whatsapp.net",
    5_000_000n,
    t0 + 1_000,
  );
  assert.equal(stacked.totalBounty, 10_000_000n);
  assert.equal(stacked.posterMoney, 40_000_000n);
  assert.equal(service.listBounties("120@g.us", t0 + 2_000).length, 1);

  // Strong hunter catches target -> 9.5jt net reward, 500k tax into 20T Kas Negara, target sent to UGD
  const hunt = await service.huntBounty(
    "120@g.us",
    "6283@s.whatsapp.net",
    "6282@s.whatsapp.net",
    t0 + 5_000,
  );
  assert.equal(hunt.won, true);
  assert.equal(hunt.netReward, 9_500_000n);
  assert.equal(hunt.taxPaid, 500_000n);
  assert.equal(hunt.targetSentToUgd, true);
  assert.equal(getTreasury(), DEFAULT_GROUP_TREASURY + 500_000n);
  assert.equal(service.listBounties("120@g.us", t0 + 6_000).length, 0);

  const targetProf = Array.from(profiles.values()).find((p) => p.userJid === "6282@s.whatsapp.net");
  assert.ok(targetProf && parseRpgState(targetProf.rpgState).ugdUntil > t0 + 5_000);
});
