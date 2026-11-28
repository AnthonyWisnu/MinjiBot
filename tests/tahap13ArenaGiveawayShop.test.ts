import assert from "node:assert/strict";
import test from "node:test";
import type { GroupMemberProfile, TenantGroup } from "@prisma/client";

import { commandRouter } from "../src/commands";
import { LeaderboardService } from "../src/services/member/leaderboard.service";
import {
  ArenaGiveawayShopService,
  LOTTERY_BASE_SEED_POOL,
  LOTTERY_TICKET_PRICE,
  POINT_SHOP_CRATE_PRICES,
  POINT_SHOP_XP_PER_POINT,
} from "../src/services/rpg/arenaGiveawayShop.service";
import {
  createDefaultRpgState,
  parseRpgState,
  serializeRpgState,
  withPetState,
} from "../src/services/rpg/rpgState";
import { buildMemberProfile, buildTenantGroup } from "./helpers/factories";

function createArenaHarness(initial: Partial<GroupMemberProfile>[] = []) {
  const profiles = new Map<string, GroupMemberProfile>();
  let seq = 1;
  let tenant: TenantGroup = buildTenantGroup({
    groupJid: "120@g.us",
    treasuryBalance: 50_000_000n,
  });

  for (const item of initial) {
    const built = buildMemberProfile({
      id: item.id ?? `p_${String(seq++)}`,
      groupJid: item.groupJid ?? "120@g.us",
      userJid: item.userJid ?? `62800${String(seq)}@s.whatsapp.net`,
      moneyBalance: item.moneyBalance ?? 100_000_000n,
      pointsBalance: item.pointsBalance ?? 1_000,
      experience: item.experience ?? 1_000,
      level: item.level ?? 5,
      ...item,
    });
    profiles.set(built.id, built);
  }

  const findOrCreate = async (groupJid: string, userJid: string): Promise<GroupMemberProfile> => {
    for (const p of profiles.values()) {
      if (p.groupJid === groupJid && p.userJid === userJid) return p;
    }
    const built = buildMemberProfile({
      id: `p_${String(seq++)}`,
      groupJid,
      userJid,
      moneyBalance: 100_000_000n,
      pointsBalance: 1_000,
    });
    profiles.set(built.id, built);
    return Promise.resolve(built);
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
    for (const k of [
      "pointsBalance",
      "totalPointsEarned",
      "experience",
      "limitBalance",
      "totalLimitsEarned",
    ] as const) {
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
      update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const found = profiles.get(args.where.id as string);
        if (!found) throw new Error("Profile not found");
        return Promise.resolve(applyData(found, args.data));
      },
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const found = profiles.get(args.where.id as string);
        if (!found) return Promise.resolve({ count: 0 });
        const moneyCond = args.where.moneyBalance as { gte?: bigint } | undefined;
        if (moneyCond?.gte !== undefined && found.moneyBalance < moneyCond.gte) {
          return Promise.resolve({ count: 0 });
        }
        const ptsCond = args.where.pointsBalance as { gte?: number } | undefined;
        if (ptsCond?.gte !== undefined && found.pointsBalance < ptsCond.gte) {
          return Promise.resolve({ count: 0 });
        }
        applyData(found, args.data);
        return Promise.resolve({ count: 1 });
      },
      findUniqueOrThrow: async (args: { where: Record<string, unknown> }) => {
        const found = profiles.get(args.where.id as string);
        if (!found) throw new Error("Profile not found");
        return Promise.resolve(found);
      },
    },
    tenantGroup: {
      findUnique: async () => Promise.resolve({ ...tenant }),
      update: async (args: { data: { treasuryBalance?: bigint } }) => {
        if (typeof args.data.treasuryBalance === "bigint") {
          tenant = { ...tenant, treasuryBalance: args.data.treasuryBalance };
        }
        return Promise.resolve({ ...tenant });
      },
    },
  };

  const profileRepo = {
    findOrCreate,
    listRecentActiveProfiles: async (groupJid: string, excludeUserJid: string, limit = 10) => {
      return Promise.resolve(
        Array.from(profiles.values())
          .filter((p) => p.groupJid === groupJid && p.userJid !== excludeUserJid)
          .slice(0, limit),
      );
    },
  };

  const db = {
    $transaction: async <T,>(fn: (arg: typeof tx) => Promise<T>) => fn(tx),
  };

  return { profiles, getTenant: () => tenant, profileRepo, db };
}

void test("Tahap 13: all 25 new commands & aliases are registered in commandRouter", () => {
  const expected = [
    "danakaget",
    "daget",
    "angpao",
    "ambilkaget",
    "klaimkaget",
    "poinkaget",
    "droppoin",
    "ambilpoin",
    "traktir",
    "lotere",
    "togelgrup",
    "belitiket",
    "undilotere",
    "jackpot",
    "balapkuda",
    "kuda",
    "balapsiput",
    "siput",
    "aduayam",
    "sabungayam",
    "tebakwarna",
    "twarna",
    "duelpoin",
    "terimaduelpoin",
    "tolakduelpoin",
    "sabungpet",
    "adupet",
    "tokopoin",
    "pointshop",
    "belixp",
    "belikotak",
    "belicrate",
    "sedekah",
    "donasi",
    "amal",
    "topdermawan",
    "topdonatur",
    "toplevel",
    "toplvl",
    "topstreak",
    "topdaily",
    "topmenang",
    "topwin",
  ];
  for (const cmd of expected) {
    assert.equal(commandRouter.has(cmd), true, `Command .${cmd} harus terdaftar`);
  }
});

void test("Tahap 13: Dana Kaget, Poin Kaget, and Traktir split balances atomically and track totalDonated", async () => {
  const h = createArenaHarness([
    { userJid: "6281@s.whatsapp.net", moneyBalance: 50_000_000n, pointsBalance: 500 },
    { userJid: "6282@s.whatsapp.net", moneyBalance: 1_000_000n, pointsBalance: 10 },
    { userJid: "6283@s.whatsapp.net", moneyBalance: 1_000_000n, pointsBalance: 10 },
  ]);
  const service = new ArenaGiveawayShopService(
    h.profileRepo,
    { create: () => Promise.resolve({}) },
    { intBetween: (min) => min, chance: () => true },
    h.db,
  );

  // 1. Dana Kaget Rp 10jt for 2 recipients
  await service.createDanaKaget("120@g.us", "6281@s.whatsapp.net", 10_000_000n, 2, 1_000);
  await assert.rejects(
    () => service.claimDanaKaget("120@g.us", "6281@s.whatsapp.net", 2_000),
    /Pembuat Dana Kaget/,
  );

  const c1 = await service.claimDanaKaget("120@g.us", "6282@s.whatsapp.net", 2_000);
  assert.equal(c1.finished, false);
  await assert.rejects(
    () => service.claimDanaKaget("120@g.us", "6282@s.whatsapp.net", 3_000),
    /sudah kebagian/,
  );

  const c2 = await service.claimDanaKaget("120@g.us", "6283@s.whatsapp.net", 3_000);
  assert.equal(c2.finished, true);
  assert.equal(c1.amountWon + c2.amountWon, 10_000_000n);

  // 2. Poin Kaget 200 pts for 2 recipients
  await service.createPoinKaget("120@g.us", "6281@s.whatsapp.net", 200, 2, 4_000);
  const p1 = await service.claimPoinKaget("120@g.us", "6282@s.whatsapp.net", 5_000);
  const p2 = await service.claimPoinKaget("120@g.us", "6283@s.whatsapp.net", 6_000);
  assert.equal(p2.finished, true);
  assert.equal(p1.pointsWon + p2.pointsWon, 200);

  // 3. Traktir Rp 6jt split to 2 active members = Rp 3jt each
  const tr = await service.treatActiveMembers("120@g.us", "6281@s.whatsapp.net", 6_000_000n);
  assert.equal(tr.recipients.length, 2);
  assert.equal(tr.shareEach, 3_000_000n);

  const donor = Array.from(h.profiles.values()).find((p) => p.userJid === "6281@s.whatsapp.net");
  assert.ok(donor);
  assert.equal(BigInt(parseRpgState(donor.rpgState).totalDonated), 16_000_000n);
});

void test("Tahap 13: Lottery Jackpot win and Rollover mechanics work atomically", async () => {
  const h = createArenaHarness([
    { userJid: "6281@s.whatsapp.net", moneyBalance: 30_000_000n },
    { userJid: "6282@s.whatsapp.net", moneyBalance: 30_000_000n },
  ]);
  // Deterministic winning number = 42
  const service = new ArenaGiveawayShopService(
    h.profileRepo,
    { create: () => Promise.resolve({}) },
    { intBetween: () => 42, chance: () => true },
    h.db,
  );

  const b1 = await service.buyLotteryTicket("120@g.us", "6281@s.whatsapp.net", 42);
  const b2 = await service.buyLotteryTicket("120@g.us", "6282@s.whatsapp.net", 10);
  assert.equal(b1.pricePaid, LOTTERY_TICKET_PRICE);
  assert.equal(b2.jackpotPool, LOTTERY_BASE_SEED_POOL + LOTTERY_TICKET_PRICE * 2n);

  const draw = await service.drawLottery("120@g.us", "6281@s.whatsapp.net", false);
  assert.equal(draw.outcome, "jackpot");
  assert.equal(draw.winningNumber, 42);
  assert.equal(draw.winners.length, 1);
  assert.equal(draw.winners[0]?.userJid, "6281@s.whatsapp.net");
  assert.equal(draw.totalPaid, LOTTERY_BASE_SEED_POOL + LOTTERY_TICKET_PRICE * 2n);
  assert.equal(draw.nextJackpotPool, LOTTERY_BASE_SEED_POOL);
});

void test("Tahap 13: Race, Cockfight, Color Wheel, Point Duel, Pet Arena, Point Shop & Sedekah", async () => {
  const petA = withPetState(createDefaultRpgState(), "naga", { level: 5, exp: 50, hunger: 100 });
  const petB = withPetState(createDefaultRpgState(), "kucing", { level: 2, exp: 0, hunger: 100 });

  const h = createArenaHarness([
    {
      userJid: "6281@s.whatsapp.net",
      moneyBalance: 100_000_000n,
      pointsBalance: 500,
      rpgState: serializeRpgState(petA) as never,
    },
    {
      userJid: "6282@s.whatsapp.net",
      moneyBalance: 100_000_000n,
      pointsBalance: 500,
      rpgState: serializeRpgState(petB) as never,
    },
  ]);

  let rollStep = 0;
  const service = new ArenaGiveawayShopService(
    h.profileRepo,
    { create: () => Promise.resolve({}) },
    {
      intBetween: (min, max) => {
        if (min === 1 && max === 5) return 3; // lane 3 wins race
        if (min === 1 && max === 100) {
          rollStep += 1;
          return rollStep === 1 ? 95 : 20; // emas color wheel & challenger wins duelpoin
        }
        return min;
      },
      chance: () => true,
    },
    h.db,
  );

  // 1. Horse race win (+2.8x profit)
  const race = await service.playRace("120@g.us", "6281@s.whatsapp.net", "kuda", 3, 1_000_000n, 1_000);
  assert.equal(race.won, true);
  assert.equal(race.netDelta, 2_800_000n);

  // 2. Cockfight win (+1x profit)
  const cock = await service.playCockfight("120@g.us", "6281@s.whatsapp.net", "merah", 1_000_000n, 2_000);
  assert.equal(cock.won, true);
  assert.equal(cock.netDelta, 1_000_000n);

  // 3. Color wheel EMAS jackpot (+5x profit)
  const wheel = await service.playColorWheel("120@g.us", "6281@s.whatsapp.net", "emas", 1_000_000n, 3_000);
  assert.equal(wheel.isJackpotGold, true);
  assert.equal(wheel.netDelta, 5_000_000n);

  // 4. Duel Poin
  rollStep = 0;
  await service.createPointDuel("120@g.us", "6281@s.whatsapp.net", "6282@s.whatsapp.net", 100, 4_000);
  const duelRes = await service.acceptPointDuel("120@g.us", "6282@s.whatsapp.net", 5_000);
  assert.equal(duelRes.winnerJid, "6281@s.whatsapp.net");
  assert.equal(duelRes.winnerPoints, 600);
  assert.equal(duelRes.loserPoints, 400);

  // 5. Sabung Pet (Naga Lv.5 beats Kucing Lv.2)
  const petFight = await service.fightPetArena(
    "120@g.us",
    "6281@s.whatsapp.net",
    "6282@s.whatsapp.net",
    2_000_000n,
    6_000,
  );
  assert.equal(petFight.winnerJid, "6281@s.whatsapp.net");
  assert.equal(petFight.winnerPetExpGained, 60);

  // 6. Toko Poin: .belixp & .belikotak
  const xpBuy = await service.buyXpWithPoints("120@g.us", "6281@s.whatsapp.net", 50);
  assert.equal(xpBuy.xpGained, 50 * POINT_SHOP_XP_PER_POINT);

  const crateBuy = await service.buyCrateWithPoints("120@g.us", "6281@s.whatsapp.net", "common", 2);
  assert.equal(crateBuy.pointsSpent, POINT_SHOP_CRATE_PRICES.common * 2);
  assert.equal(crateBuy.ownedCrates, 2);

  // 7. Sedekah adds to treasury & totalDonated
  const sedekah = await service.donateToTreasury("120@g.us", "6281@s.whatsapp.net", 5_000_000n, 7_000);
  assert.equal(sedekah.amountDonated, 5_000_000n);
  assert.equal(h.getTenant().treasuryBalance, 55_000_000n);
});

void test("Tahap 13: LeaderboardService supports top level, top streak, top games won, and top dermawan", async () => {
  const p1 = buildMemberProfile({
    userJid: "6281@s.whatsapp.net",
    level: 12,
    longestStreak: 14,
    totalGamesWon: 50,
    experience: 12_000,
  });
  const p2 = buildMemberProfile({
    userJid: "6282@s.whatsapp.net",
    level: 5,
    longestStreak: 3,
    totalGamesWon: 10,
    experience: 2_000,
  });

  const lb = new LeaderboardService({
    listTopByExperience: () => Promise.resolve([p1, p2]),
    listTopByPoints: () => Promise.resolve([p1, p2]),
    getPositionByExperience: () => Promise.resolve(1),
    getPositionByPoints: () => Promise.resolve(1),
    listTopByLevel: () => Promise.resolve([p1, p2]),
    getPositionByLevel: () => Promise.resolve(1),
    listTopByStreak: () => Promise.resolve([p1, p2]),
    getPositionByStreak: () => Promise.resolve(1),
    listTopByGamesWon: () => Promise.resolve([p1, p2]),
    getPositionByGamesWon: () => Promise.resolve(1),
    listTopByDonated: () => Promise.resolve([{ profile: p1, totalDonated: 25_000_000n }]),
    getPositionByDonated: () => Promise.resolve(1),
  });

  const topLvl = await lb.getTopLevel("120@g.us", "6281@s.whatsapp.net");
  assert.equal(topLvl.entries[0]?.value, 12);

  const topStreak = await lb.getTopStreak("120@g.us", "6281@s.whatsapp.net");
  assert.equal(topStreak.entries[0]?.value, 14);

  const topWins = await lb.getTopGamesWon("120@g.us", "6281@s.whatsapp.net");
  assert.equal(topWins.entries[0]?.value, 50);

  const topDonated = await lb.getTopDonated("120@g.us", "6281@s.whatsapp.net");
  assert.equal(topDonated.entries[0]?.value, 25_000_000n);
});
