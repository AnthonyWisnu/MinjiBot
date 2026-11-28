import { test } from "node:test";
import assert from "node:assert/strict";

import type { GroupMemberProfile, TenantGroup } from "@prisma/client";

import { commandRouter } from "../src/commands";
import { DailyClaimService } from "../src/services/member/dailyClaim.service";
import {
  DAILY_TRANSFER_OUT_BASE,
  DAILY_TRANSFER_OUT_PER_LEVEL,
  WalletBankService,
} from "../src/services/member/walletBank.service";
import {
  AUTO_WEALTH_TAX_THRESHOLD,
  computeAutoWealthTax,
} from "../src/services/rpg/autoWealthTax";
import {
  RaidFarmBuffBountyService,
  WORLD_BOSS_MAX_CRIT_DAMAGE_PER_HIT,
  WORLD_BOSS_MAX_DAMAGE_PER_HIT,
} from "../src/services/rpg/raidFarmBuffBounty.service";
import { RpgEconomyService } from "../src/services/rpg/rpgEconomy.service";
import { RpgExpansionService } from "../src/services/rpg/rpgExpansion.service";
import { PROPERTY_HARVEST_TAX_PERCENT, PROPERTY_MAP } from "../src/services/rpg/rpgExpansionCatalog";
import {
  calculatePlayerCombatPower,
  RpgInfiniteService,
} from "../src/services/rpg/rpgInfinite.service";
import {
  createDefaultRpgState,
  parseRpgState,
  serializeRpgState,
  withItemsDelta,
  withPetState,
  withToolState,
} from "../src/services/rpg/rpgState";
import { InvalidAmountError } from "../src/types/memberEconomy";
import { buildMemberProfile, buildTenantGroup } from "./helpers/factories";

const GROUP_JID = "120363999000@g.us";
const USER_A = "628111111111@s.whatsapp.net";
const USER_B = "628222222222@s.whatsapp.net";

function createFullHarness(
  seedProfiles: Partial<GroupMemberProfile>[] = [],
  initialTreasury = 20_000_000_000_000n,
) {
  const profiles = new Map<string, GroupMemberProfile>();
  const txLogs: Array<Record<string, unknown>> = [];
  let tenant: TenantGroup = buildTenantGroup({
    groupJid: GROUP_JID,
    treasuryBalance: initialTreasury,
    worldBossState: null,
    groupEventState: null,
  });

  for (let i = 0; i < seedProfiles.length; i += 1) {
    const p = buildMemberProfile({
      id: `prof-${String(i + 1)}`,
      groupJid: GROUP_JID,
      userJid: i === 0 ? USER_A : USER_B,
      ...seedProfiles[i],
    });
    profiles.set(`${p.groupJid}:${p.userJid}`, p);
  }

  const findOrCreate = (groupJid: string, userJid: string): Promise<GroupMemberProfile> => {
    const key = `${groupJid}:${userJid}`;
    const existing = profiles.get(key);
    if (existing) return Promise.resolve({ ...existing });
    const created = buildMemberProfile({
      id: `prof-${String(profiles.size + 1)}`,
      groupJid,
      userJid,
    });
    profiles.set(key, created);
    return Promise.resolve({ ...created });
  };

  const applyUpdateData = (target: GroupMemberProfile, data: Record<string, unknown>): GroupMemberProfile => {
    const next: GroupMemberProfile = { ...target };
    for (const field of ["moneyBalance", "bankBalance", "totalMoneyEarned"] as const) {
      const val = data[field] as { increment?: bigint; decrement?: bigint } | bigint | undefined;
      if (typeof val === "bigint") next[field] = val;
      else if (val && typeof val === "object") {
        if (val.increment !== undefined) next[field] += val.increment;
        if (val.decrement !== undefined) next[field] -= val.decrement;
      }
    }
    for (const field of [
      "pointsBalance",
      "totalPointsEarned",
      "limitBalance",
      "totalLimitsEarned",
      "experience",
    ] as const) {
      const val = data[field] as { increment?: number; decrement?: number } | number | undefined;
      if (typeof val === "number") next[field] = val;
      else if (val && typeof val === "object") {
        if (val.increment !== undefined) next[field] += val.increment;
        if (val.decrement !== undefined) next[field] -= val.decrement;
      }
    }
    if (typeof data.currentStreak === "number") next.currentStreak = data.currentStreak;
    if (typeof data.longestStreak === "number") next.longestStreak = data.longestStreak;
    if (data.lastDailyClaimAt instanceof Date || data.lastDailyClaimAt === null) {
      next.lastDailyClaimAt = data.lastDailyClaimAt;
    }
    if ("rpgState" in data) {
      next.rpgState = data.rpgState as GroupMemberProfile["rpgState"];
    }
    profiles.set(`${next.groupJid}:${next.userJid}`, next);
    return { ...next };
  };

  const matchesWhere = (p: GroupMemberProfile, where: Record<string, unknown>): boolean => {
    if (typeof where.id === "string" && p.id !== where.id) return false;
    const moneyCond = where.moneyBalance as { gte?: bigint } | undefined;
    if (moneyCond?.gte !== undefined && p.moneyBalance < moneyCond.gte) return false;
    const bankCond = where.bankBalance as { gte?: bigint } | undefined;
    if (bankCond?.gte !== undefined && p.bankBalance < bankCond.gte) return false;
    if (Array.isArray(where.OR)) {
      const orMatched = where.OR.some((clause: Record<string, unknown>) => {
        if ("lastDailyClaimAt" in clause) {
          const cond = clause.lastDailyClaimAt as { lt?: Date } | null;
          if (cond === null) return p.lastDailyClaimAt === null;
          if (cond && typeof cond === "object" && cond.lt instanceof Date) {
            return p.lastDailyClaimAt !== null && p.lastDailyClaimAt < cond.lt;
          }
        }
        return false;
      });
      if (!orMatched) return false;
    }
    return true;
  };

  const findById = (id: unknown): GroupMemberProfile | undefined =>
    Array.from(profiles.values()).find((p) => p.id === id);

  const txObj = {
    groupMemberProfile: {
      findUniqueOrThrow: (args: { where: Record<string, unknown> }) => {
        const found = findById(args.where.id);
        if (!found) return Promise.reject(new Error("Profile not found"));
        return Promise.resolve({ ...found });
      },
      update: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const found = findById(args.where.id);
        if (!found) return Promise.reject(new Error("Profile not found"));
        return Promise.resolve(applyUpdateData(found, args.data));
      },
      updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const found = findById(args.where.id);
        if (!found || !matchesWhere(found, args.where)) {
          return Promise.resolve({ count: 0 });
        }
        applyUpdateData(found, args.data);
        return Promise.resolve({ count: 1 });
      },
    },
    tenantGroup: {
      findUnique: () => Promise.resolve({ ...tenant }),
      update: (args: { data: Record<string, unknown> }) => {
        if (typeof args.data.treasuryBalance === "bigint") {
          tenant = { ...tenant, treasuryBalance: args.data.treasuryBalance };
        }
        if ("worldBossState" in args.data) {
          tenant = {
            ...tenant,
            worldBossState: args.data.worldBossState as TenantGroup["worldBossState"],
          };
        }
        return Promise.resolve({ ...tenant });
      },
    },
    groupMemberTransaction: {
      createMany: (args: { data: Record<string, unknown>[] }) => {
        txLogs.push(...args.data);
        return Promise.resolve({ count: args.data.length });
      },
    },
  };

  const profileRepo = {
    findOrCreate: (g: string, u: string) => findOrCreate(g, u),
    findByGroupAndUser: (g: string, u: string) => Promise.resolve(profiles.get(`${g}:${u}`) ?? null),
    updateBalances: (id: string, data: Record<string, unknown>) => {
      const found = findById(id);
      if (!found) return Promise.reject(new Error("Profile not found"));
      return Promise.resolve(applyUpdateData(found, data));
    },
  };

  const txRepo = {
    create: (data: Record<string, unknown>) => {
      txLogs.push(data);
      return Promise.resolve(data);
    },
  };

  const db = {
    $transaction: <T>(fn: (tx: typeof txObj) => Promise<T>): Promise<T> => fn(txObj),
    tenantGroup: txObj.tenantGroup,
  };

  return {
    profiles,
    txLogs,
    getTenant: () => tenant,
    profileRepo,
    txRepo,
    db,
  };
}

void test("Durability & .repair: 0% durability disables combat/gathering bonuses and .repair restores them", async () => {
  assert.equal(commandRouter.has("repair"), true);
  assert.equal(commandRouter.has("perbaikialat"), true);

  let state = createDefaultRpgState();
  state = withToolState(state, "sword", { level: 5, durability: 60 });
  state = withToolState(state, "armor", { level: 3, durability: 0 });
  state = withToolState(state, "pickaxe", { level: 4, durability: 0 });
  state = withItemsDelta(state, { besi: 20, batu: 20, kayu: 20 });

  // 0% durability disables armor & sword bonuses cleanly
  const brokenState = withToolState(state, "sword", { level: 5, durability: 0 });
  const baseOnlyPower = calculatePlayerCombatPower(10, createDefaultRpgState());
  const brokenPower = calculatePlayerCombatPower(10, brokenState);
  assert.equal(brokenPower, baseOnlyPower);

  const activeSwordPower = calculatePlayerCombatPower(10, state);
  assert.ok(activeSwordPower > brokenPower);

  const h = createFullHarness([
    {
      userJid: USER_A,
      level: 10,
      moneyBalance: 50_000_000n,
      rpgState: serializeRpgState(state),
    },
  ]);

  const rpg = new RpgInfiniteService(
    h.profileRepo as never,
    h.txRepo as never,
    { intBetween: (min) => min, chance: () => false },
    h.db as never,
  );

  // Pickaxe at 0% durability grants zero tool bonus (280rb * 1.09 Lv.10 = 305.200n, without +60% Lv.4 bonus!)
  const gatherRes = await rpg.runGathering(GROUP_JID, USER_A, "nebang", new Date("2026-11-28T06:00:00Z"));
  assert.equal(gatherRes.moneyGained, 305_200n);

  // Single tool repair (.repair sword) repairs only sword
  const repSword = await rpg.repairTools(GROUP_JID, USER_A, "sword");
  assert.equal(repSword.repaired.length, 1);
  assert.equal(repSword.repaired[0]?.toolId, "sword");
  assert.equal(repSword.repaired[0]?.durabilityBefore, 60);
  assert.equal(repSword.repaired[0]?.durabilityAfter, 100);
  assert.ok(repSword.totalMoneyCost > 0n);

  // Repair all remaining damaged tools (.repair all)
  const repAll = await rpg.repairTools(GROUP_JID, USER_A, "all");
  assert.equal(repAll.repaired.length, 2); // armor + pickaxe

  // Subsequent .repair all rejects because all tools are 100%
  await assert.rejects(() => rpg.repairTools(GROUP_JID, USER_A, "all"), /prima/i);
});

void test("Boss anti-1-hit & shared cooldown: Solo Boss <=82% win cap, min HP drain, and World Boss <=2800/3400 hit cap", async () => {
  const t0 = 1_785_000_000_000;
  let maxedState = createDefaultRpgState();
  maxedState = withToolState(maxedState, "sword", { level: 10, durability: 100 });
  maxedState = withToolState(maxedState, "armor", { level: 10, durability: 100 });
  maxedState = withPetState(maxedState, "phonix", { level: 20, exp: 0, hunger: 100 });
  maxedState.skills.str = 50;
  maxedState.buffs.jamukuat = t0 + 3_600_000;

  const h = createFullHarness([
    {
      userJid: USER_A,
      level: 99,
      moneyBalance: 100_000_000n,
      rpgState: serializeRpgState(maxedState),
    },
  ]);

  const seenWinProbs: number[] = [];
  const rpg = new RpgInfiniteService(
    h.profileRepo as never,
    h.txRepo as never,
    {
      intBetween: (_min, max) => max,
      chance: (prob: number) => {
        seenWinProbs.push(prob);
        return false; // prove even a maxed character can lose!
      },
    },
    h.db as never,
  );

  // Fight Phonix as maxed Lv.99 -> chance strictly capped <= 0.82, takes real HP drain >= 24 (on lose), drains dur -4
  const phonixRes = await rpg.fightBoss(GROUP_JID, USER_A, "phonix", new Date(t0));
  assert.equal(phonixRes.won, false);
  assert.ok((seenWinProbs[0] ?? 1) <= 0.82, `Expected win prob <= 0.82, got ${String(seenWinProbs[0])}`);
  assert.ok(phonixRes.hpLost >= 24);
  assert.equal(phonixRes.swordDurabilityAfter, 96);
  assert.equal(phonixRes.armorDurabilityAfter, 96);

  // Shared 15m cooldown blocks switching to .fightkucing right after .fightphonix
  await assert.rejects(
    () => rpg.fightBoss(GROUP_JID, USER_A, "kucing", new Date(t0 + 60_000)),
    /menantang boss lagi dalam/i,
  );

  // World Boss hard hit cap <= 3400 crit / <= 2800 non-crit + >= 14 HP drain even for Lv.99
  const raid = new RaidFarmBuffBountyService(
    h.profileRepo as never,
    h.txRepo as never,
    { intBetween: (_min, max) => max, chance: () => false }, // non-crit max roll
    h.db as never,
  );
  const nonCritHit = await raid.attackWorldBoss(GROUP_JID, USER_A, t0);
  assert.ok(
    nonCritHit.damageDealt <= WORLD_BOSS_MAX_DAMAGE_PER_HIT,
    `Expected <= ${String(WORLD_BOSS_MAX_DAMAGE_PER_HIT)}, got ${String(nonCritHit.damageDealt)}`,
  );
  assert.ok(nonCritHit.hpLost >= 14);

  const raidCrit = new RaidFarmBuffBountyService(
    h.profileRepo as never,
    h.txRepo as never,
    { intBetween: (_min, max) => max, chance: () => true }, // crit max roll
    h.db as never,
  );
  // Restore HP cleanly first for next cooldown hit check
  const pA = h.profiles.get(`${GROUP_JID}:${USER_A}`);
  assert.ok(pA);
  const stNow = parseRpgState(pA.rpgState);
  stNow.hp = 100;
  pA.rpgState = serializeRpgState(stNow) as never;

  const critHit = await raidCrit.attackWorldBoss(GROUP_JID, USER_A, t0 + 9 * 60_000);
  assert.ok(
    critHit.damageDealt <= WORLD_BOSS_MAX_CRIT_DAMAGE_PER_HIT,
    `Expected <= ${String(WORLD_BOSS_MAX_CRIT_DAMAGE_PER_HIT)}, got ${String(critHit.damageDealt)}`,
  );
});

void test("Anti-exploit guards: .megakorupsi debits Bank when wallet=0 & .transfer enforces daily WIB cap", async () => {
  const h = createFullHarness([
    {
      userJid: USER_A,
      level: 10, // transfer cap = 15M + 10*500k = 20M/hari WIB
      moneyBalance: 0n, // wallet deliberately emptied via .atmall!
      bankBalance: 100_000_000n,
    },
    {
      userJid: USER_B,
      level: 1,
      moneyBalance: 0n,
      bankBalance: 0n,
    },
  ]);

  const econ = new RpgEconomyService(
    h.profileRepo as never,
    h.txRepo as never,
    { intBetween: (min) => min, chance: () => false }, // OTT KPK triggered!
    h.db as never,
  );

  const now = new Date("2026-11-28T05:00:00.000Z");
  const kor = await econ.runCorruption(GROUP_JID, USER_A, true, now);
  assert.equal(kor.success, false);
  // 35% of 100M = 35M (< 40M max cap) auto-debited from Bank!
  assert.equal(kor.amountDelta, -35_000_000n);
  const afterKpk = h.profiles.get(`${GROUP_JID}:${USER_A}`);
  assert.equal(afterKpk?.bankBalance, 65_000_000n);
  assert.ok(
    h.txLogs.some((l) => l.asset === "BANK" && l.note === "megakorupsi_ott_bank_autodebit"),
  );

  // Give USER_A wallet cash & verify daily .transfer cap = 15M + 10*500k = 20M
  if (afterKpk) {
    afterKpk.moneyBalance = 50_000_000n;
  }
  const walletSvc = new WalletBankService(h.profileRepo as never, h.txRepo as never, h.db as never);
  const expectedCap = DAILY_TRANSFER_OUT_BASE + 10n * DAILY_TRANSFER_OUT_PER_LEVEL; // 20M
  await walletSvc.transferMoney(GROUP_JID, USER_A, USER_B, expectedCap - 5_000_000n, now);

  // Exceeding cap on same WIB day fails
  await assert.rejects(
    () => walletSvc.transferMoney(GROUP_JID, USER_A, USER_B, 5_000_001n, now),
    InvalidAmountError,
  );

  // Next WIB day resets transfer quota cleanly
  const nextDay = new Date("2026-11-29T05:00:00.000Z");
  const nextDayTf = await walletSvc.transferMoney(GROUP_JID, USER_A, USER_B, 10_000_000n, nextDay);
  assert.equal(nextDayTf.amount, 10_000_000n);
});

void test("Lapis 2 Auto-Stabilizer: Property harvest 10% ops tax + Sultan > Rp 2M 1.5%/day auto-wealth tax", async () => {
  assert.equal(computeAutoWealthTax(AUTO_WEALTH_TAX_THRESHOLD), 0n);
  // Rp 4 Miliar total -> excess Rp 2 Miliar -> 1.5% = Rp 30 Juta
  assert.equal(computeAutoWealthTax(4_000_000_000n), 30_000_000n);

  const warung = PROPERTY_MAP.get("warung");
  assert.ok(warung);
  const day1 = new Date("2026-11-28T03:00:00.000Z"); // 10:00 WIB
  const day1Plus2h = new Date(day1.getTime() + 2 * 60 * 60 * 1000);
  const day2 = new Date("2026-11-29T03:00:00.000Z");

  let sSultan = createDefaultRpgState();
  sSultan.properties = { warung: 2 };
  sSultan.lastPropertyHarvestAt = day1.getTime();

  const h = createFullHarness([
    {
      userJid: USER_A,
      level: 30,
      experience: 45_000, // Epic rank
      moneyBalance: 100_000_000n, // Dompet 100 Jt
      bankBalance: 3_900_000_000n, // Bank 3.9 M -> Total 4.0 Miliar!
      rpgState: serializeRpgState(sSultan),
    },
    {
      userJid: USER_B,
      level: 10,
      moneyBalance: 50_000_000n,
      bankBalance: 500_000_000n, // Total 550 Jt (< 2 Miliar -> 0% auto-tax!)
    },
  ]);

  const dailySvc = new DailyClaimService(
    undefined,
    h.profileRepo as never,
    { intBetween: (min) => min, chance: () => false },
    h.db as never,
  );
  const expSvc = new RpgExpansionService(
    h.profileRepo as never,
    h.txRepo as never,
    {} as never,
    {} as never,
    h.db as never,
  );

  // Regular member (< Rp 2M) pays ZERO auto-wealth tax on .daily
  const regDaily = await dailySvc.claimDaily(GROUP_JID, USER_B, day1);
  assert.equal(regDaily.autoWealthTaxPaid, 0n);

  // Sultan (100M + daily + 3.9B bank) pays 1.5% on excess over 2B, debited from Bank first!
  const treasuryBefore = h.getTenant().treasuryBalance;
  const sultanDaily = await dailySvc.claimDaily(GROUP_JID, USER_A, day1);
  assert.ok(sultanDaily.autoWealthTaxPaid > 30_000_000n);
  const expectedAfterDailyTotal =
    100_000_000n + sultanDaily.moneyGained + 3_900_000_000n - sultanDaily.autoWealthTaxPaid;
  const profSultan1 = h.profiles.get(`${GROUP_JID}:${USER_A}`);
  assert.ok(profSultan1);
  assert.equal(profSultan1.moneyBalance + profSultan1.bankBalance, expectedAfterDailyTotal);
  assert.equal(h.getTenant().treasuryBalance, treasuryBefore + sultanDaily.autoWealthTaxPaid);

  // Same WIB day .gaji & .panen do NOT double-charge auto-wealth tax, while .panen still charges 10% Property Ops Tax
  const sal = await expSvc.claimSalary(GROUP_JID, USER_A, day1);
  assert.equal(sal.autoWealthTaxPaid, 0n);

  const treasuryBeforePanen = h.getTenant().treasuryBalance;
  const panen = await expSvc.harvestProperties(GROUP_JID, USER_A, day1Plus2h);
  const expectedGross = warung.incomePerHour * 4n; // 2 warung * 2 jam
  const expectedOpsTax = (expectedGross * BigInt(PROPERTY_HARVEST_TAX_PERCENT)) / 100n;
  assert.equal(panen.grossMoney, expectedGross);
  assert.equal(panen.operationalTax, expectedOpsTax);
  assert.equal(panen.harvestedMoney, expectedGross - expectedOpsTax);
  assert.equal(panen.autoWealthTaxPaid, 0n);
  assert.equal(h.getTenant().treasuryBalance, treasuryBeforePanen + expectedOpsTax);

  // Next WIB day (.daily) triggers Sultan auto-tax once more
  const sultanDailyDay2 = await dailySvc.claimDaily(GROUP_JID, USER_A, day2);
  assert.ok(sultanDailyDay2.autoWealthTaxPaid > 29_000_000n);
});
