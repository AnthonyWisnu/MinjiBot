import assert from "node:assert/strict";
import test from "node:test";
import type { GroupMemberProfile, GroupRedeemCode } from "@prisma/client";
import sharp from "sharp";

import { commandRouter } from "../src/commands";
import { LiveCryptoService } from "../src/services/info/liveCrypto.service";
import { gachaCardService } from "../src/services/media/gachaCard.service";
import { CryptoMarketService } from "../src/services/rpg/cryptoMarket.service";
import { RpgExpansionService } from "../src/services/rpg/rpgExpansion.service";
import {
  GACHA_CARDS,
  GACHA_PULL_PRICE,
  PROPERTY_MAP,
} from "../src/services/rpg/rpgExpansionCatalog";
import { parseRpgState, serializeRpgState, createDefaultRpgState } from "../src/services/rpg/rpgState";

function createInMemoryHarness(initialProfiles: Partial<GroupMemberProfile>[] = []) {
  const profiles = new Map<string, GroupMemberProfile>();
  const redeemCodes = new Map<string, GroupRedeemCode>();
  let idSeq = 1;

  for (const partial of initialProfiles) {
    const groupJid = partial.groupJid ?? "120363@g.us";
    const userJid = partial.userJid ?? "628111@s.whatsapp.net";
    const id = partial.id ?? `prof_${String(idSeq++)}`;
    profiles.set(id, {
      id,
      groupJid,
      userJid,
      pointsBalance: partial.pointsBalance ?? 0,
      limitBalance: partial.limitBalance ?? 100,
      reservedLimit: partial.reservedLimit ?? 0,
      experience: partial.experience ?? 0,
      moneyBalance: partial.moneyBalance ?? 500_000_000n,
      bankBalance: partial.bankBalance ?? 0n,
      totalMoneyEarned: partial.totalMoneyEarned ?? 500_000_000n,
      level: partial.level ?? 1,
      totalPointsEarned: partial.totalPointsEarned ?? 0,
      totalLimitsEarned: partial.totalLimitsEarned ?? 100,
      totalGamesPlayed: partial.totalGamesPlayed ?? 0,
      totalGamesWon: partial.totalGamesWon ?? 0,
      currentStreak: partial.currentStreak ?? 0,
      longestStreak: partial.longestStreak ?? 0,
      lastDailyClaimAt: partial.lastDailyClaimAt ?? null,
      lastWeeklyClaimAt: partial.lastWeeklyClaimAt ?? null,
      lastMonthlyClaimAt: partial.lastMonthlyClaimAt ?? null,
      rpgState: partial.rpgState ?? null,
      partnerJid: partial.partnerJid ?? null,
      partnerSince: partial.partnerSince ?? null,
      messageCount: partial.messageCount ?? 0,
      lastActiveAt: partial.lastActiveAt ?? new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const findOrCreate = async (groupJid: string, userJid: string): Promise<GroupMemberProfile> => {
    for (const p of profiles.values()) {
      if (p.groupJid === groupJid && p.userJid === userJid) {
        return p;
      }
    }
    const id = `prof_${String(idSeq++)}`;
    const created: GroupMemberProfile = {
      id,
      groupJid,
      userJid,
      pointsBalance: 0,
      limitBalance: 100,
      reservedLimit: 0,
      experience: 0,
      moneyBalance: 500_000_000n,
      bankBalance: 0n,
      totalMoneyEarned: 500_000_000n,
      level: 1,
      totalPointsEarned: 0,
      totalLimitsEarned: 100,
      totalGamesPlayed: 0,
      totalGamesWon: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastDailyClaimAt: null,
      lastWeeklyClaimAt: null,
      lastMonthlyClaimAt: null,
      rpgState: null,
      partnerJid: null,
      partnerSince: null,
      messageCount: 0,
      lastActiveAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    profiles.set(id, created);
    return Promise.resolve(created);
  };

  const applyProfileData = (target: GroupMemberProfile, data: Record<string, unknown>) => {
    const next = { ...target };
    const applyBigInt = (key: "moneyBalance" | "bankBalance" | "totalMoneyEarned") => {
      const val = data[key] as { increment?: bigint; decrement?: bigint } | bigint | undefined;
      if (typeof val === "bigint") {
        next[key] = val;
      } else if (val && typeof val === "object") {
        if (val.increment !== undefined) next[key] = next[key] + val.increment;
        if (val.decrement !== undefined) next[key] = next[key] - val.decrement;
      }
    };
    const applyNum = (
      key: "limitBalance" | "totalLimitsEarned" | "experience" | "pointsBalance" | "totalPointsEarned",
    ) => {
      const val = data[key] as { increment?: number; decrement?: number } | number | undefined;
      if (typeof val === "number") {
        next[key] = val;
      } else if (val && typeof val === "object") {
        if (val.increment !== undefined) next[key] = next[key] + val.increment;
        if (val.decrement !== undefined) next[key] = next[key] - val.decrement;
      }
    };
    applyBigInt("moneyBalance");
    applyBigInt("bankBalance");
    applyBigInt("totalMoneyEarned");
    applyNum("limitBalance");
    applyNum("totalLimitsEarned");
    applyNum("experience");
    applyNum("pointsBalance");
    applyNum("totalPointsEarned");
    if ("rpgState" in data) {
      next.rpgState = data.rpgState as GroupMemberProfile["rpgState"];
    }
    profiles.set(next.id, next);
    return next;
  };

  const tx = {
    groupMemberProfile: {
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const id = args.where.id as string;
        const found = profiles.get(id);
        if (!found) return Promise.resolve({ count: 0 });
        const moneyCond = args.where.moneyBalance as { gte?: bigint } | undefined;
        if (moneyCond?.gte !== undefined && found.moneyBalance < moneyCond.gte) {
          return Promise.resolve({ count: 0 });
        }
        applyProfileData(found, args.data);
        return Promise.resolve({ count: 1 });
      },
      findUniqueOrThrow: async (args: { where: Record<string, unknown> }) => {
        const found = profiles.get(args.where.id as string);
        if (!found) throw new Error("Profile not found");
        return Promise.resolve(found);
      },
      update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const found = profiles.get(args.where.id as string);
        if (!found) throw new Error("Profile not found");
        return Promise.resolve(applyProfileData(found, args.data));
      },
    },
  };

  const redeemRepo = {
    findByGroupAndCode: async (groupJid: string, code: string) => {
      return Promise.resolve(redeemCodes.get(`${groupJid}:${code.toUpperCase()}`) ?? null);
    },
    listByGroup: async (groupJid: string) => {
      return Promise.resolve(Array.from(redeemCodes.values()).filter((r) => r.groupJid === groupJid));
    },
    create: async (data: {
      groupJid: string;
      code: string;
      rewardLimit: number;
      rewardMoney: bigint;
      rewardPoints?: number;
      maxClaims: number;
      createdBy: string;
      expiresAt?: Date | null;
    }) => {
      const rec: GroupRedeemCode = {
        id: `rc_${String(idSeq++)}`,
        groupJid: data.groupJid,
        code: data.code.toUpperCase(),
        rewardLimit: data.rewardLimit,
        rewardMoney: data.rewardMoney,
        rewardPoints: data.rewardPoints ?? 0,
        maxClaims: data.maxClaims,
        claimedByJids: [],
        createdBy: data.createdBy,
        expiresAt: data.expiresAt ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      redeemCodes.set(`${rec.groupJid}:${rec.code}`, rec);
      return Promise.resolve(rec);
    },
    updateClaimedBy: async (id: string, claimedByJids: string[]) => {
      for (const [k, rec] of redeemCodes.entries()) {
        if (rec.id === id) {
          const next = { ...rec, claimedByJids };
          redeemCodes.set(k, next);
          return Promise.resolve(next);
        }
      }
      throw new Error("Redeem code not found");
    },
  };

  const service = new RpgExpansionService(
    { findOrCreate },
    { create: () => Promise.resolve({}) },
    redeemRepo,
    new CryptoMarketService({ findOrCreate }, { create: () => Promise.resolve({}) }, {
      $transaction: async <T,>(fn: (arg: typeof tx) => Promise<T>) => fn(tx),
    }),
    { $transaction: async <T,>(fn: (arg: typeof tx) => Promise<T>) => fn(tx) },
  );

  return { service, profiles, redeemCodes };
}

void test("Tahap 9: all 21 expansion commands & aliases are registered in commandRouter", () => {
  const expected = [
    "misi",
    "quest",
    "klaimmisi",
    "achievement",
    "lencana",
    "properti",
    "beliproperti",
    "jualproperti",
    "panen",
    "collect",
    "gaji",
    "deposito",
    "depo",
    "cairdeposito",
    "saham",
    "belisaham",
    "jualsaham",
    "portofolio",
    "hargakripto",
    "gachakartu",
    "pullcard",
    "koleksi",
    "trade",
    "barter",
    "buatkode",
    "redeem",
    "listkode",
  ];
  for (const cmd of expected) {
    assert.equal(commandRouter.has(cmd), true, `Command .${cmd} harus terdaftar`);
  }
});

void test("Tahap 9: Daily Quest completion, claim, and double-claim guard", async () => {
  const now = new Date("2026-11-28T05:00:00.000Z"); // 12:00 WIB
  const baseState = createDefaultRpgState();
  baseState.cooldowns.kerja = now.getTime() - 60_000;
  baseState.cooldowns.nambang = now.getTime() - 30_000;

  const { service } = createInMemoryHarness([
    {
      groupJid: "120@g.us",
      userJid: "6281@s.whatsapp.net",
      moneyBalance: 10_000_000n,
      limitBalance: 10,
      lastDailyClaimAt: now,
      lastActiveAt: now,
      messageCount: 12,
      rpgState: serializeRpgState(baseState) as never,
    },
  ]);

  const overview = await service.getDailyQuests("120@g.us", "6281@s.whatsapp.net", now);
  assert.equal(overview.claimableCount, 4);

  const claimed = await service.claimDailyQuests("120@g.us", "6281@s.whatsapp.net", now);
  assert.equal(claimed.claimedQuests.length, 4);
  assert.equal(claimed.totalMoney, 66_000_000n);
  assert.equal(claimed.totalLimit, 15);
  assert.equal(claimed.currentLimit, 25);

  await assert.rejects(
    () => service.claimDailyQuests("120@g.us", "6281@s.whatsapp.net", now),
    /sudah kamu klaim/,
  );
});

void test("Tahap 9: Properties buy, passive harvest after 2 hours, and 65% sell refund", async () => {
  const t0 = new Date("2026-11-28T01:00:00.000Z");
  const t2h = new Date(t0.getTime() + 2 * 60 * 60 * 1000);
  const { service } = createInMemoryHarness([
    { groupJid: "120@g.us", userJid: "6281@s.whatsapp.net", moneyBalance: 200_000_000n },
  ]);

  const warung = PROPERTY_MAP.get("warung");
  assert.ok(warung);

  const bought = await service.buyProperty("120@g.us", "6281@s.whatsapp.net", "warung", 2, t0);
  assert.equal(bought.ownedAfter, 2);
  assert.equal(bought.totalMoney, warung.price * 2n);

  // Lv.1 cannot buy Lv.55 Pulau Resort
  await assert.rejects(
    () => service.buyProperty("120@g.us", "6281@s.whatsapp.net", "pulau", 1, t0),
    /Level 55/,
  );

  // Immediately harvesting before 10 min should be rejected
  await assert.rejects(
    () => service.harvestProperties("120@g.us", "6281@s.whatsapp.net", new Date(t0.getTime() + 60_000)),
    /belum siap dipanen/,
  );

  // After 2 hours: 2 warung * 1.5jt/jam * 2 jam = 6jt
  const harvested = await service.harvestProperties("120@g.us", "6281@s.whatsapp.net", t2h);
  assert.equal(harvested.harvestedMoney, warung.incomePerHour * 4n);

  const sold = await service.sellProperty("120@g.us", "6281@s.whatsapp.net", "warung", 1, t2h);
  assert.equal(sold.ownedAfter, 1);
  assert.equal(sold.totalMoney, (warung.price * 65n) / 100n);
});

void test("Tahap 9: Rank Salary, Deposito interest, and IDX Stock buy/sell/portfolio", async () => {
  const day1 = new Date("2026-11-28T03:00:00.000Z");
  const day4 = new Date(day1.getTime() + 3 * 24 * 60 * 60 * 1000);
  const { service } = createInMemoryHarness([
    {
      groupJid: "120@g.us",
      userJid: "6281@s.whatsapp.net",
      moneyBalance: 500_000_000n,
      experience: 45_000, // Epic rank
    },
  ]);

  // Salary for Epic = Rp 120jt (60% money) + 6 Limit (100% non-money)
  const sal = await service.claimSalary("120@g.us", "6281@s.whatsapp.net", day1);
  assert.equal(sal.rank, "Epic");
  assert.equal(sal.money, 120_000_000n);
  assert.equal(sal.limit, 6);
  await assert.rejects(
    () => service.claimSalary("120@g.us", "6281@s.whatsapp.net", day1),
    /sudah diambil/,
  );

  // Deposito Rp 100jt for 3 days @ 5%/day = +15jt interest
  await service.openDeposito("120@g.us", "6281@s.whatsapp.net", 100_000_000n, day1);
  const depOut = await service.withdrawDeposito("120@g.us", "6281@s.whatsapp.net", day4);
  assert.equal(depOut.daysHeld, 3);
  assert.equal(depOut.interest, 15_000_000n);
  assert.equal(depOut.totalReceived, 115_000_000n);

  // Stocks buy & sell
  const buyRes = await service.buyStock("120@g.us", "6281@s.whatsapp.net", "BBCA", 5, day4);
  assert.equal(buyRes.remainingLots, 5);
  const pf = await service.getFullPortfolio("120@g.us", "6281@s.whatsapp.net", day4);
  assert.equal(pf.stocks.length, 1);
  assert.ok(pf.netWorth > 0n);

  const sellRes = await service.sellStock("120@g.us", "6281@s.whatsapp.net", "BBCA", "all", day4);
  assert.equal(sellRes.remainingLots, 0);
});

void test("Tahap 9: Gacha Card pull, Sharp 600x840 PNG rendering, Achievements, Trade, and Redeem", async () => {
  const { service, profiles } = createInMemoryHarness([
    {
      groupJid: "120@g.us",
      userJid: "6281@s.whatsapp.net",
      moneyBalance: 300_000_000n,
      level: 5,
      messageCount: 150,
    },
    {
      groupJid: "120@g.us",
      userJid: "6282@s.whatsapp.net",
      moneyBalance: 10_000_000n,
    },
  ]);

  // Pull guaranteed UR (randomValue = 0.01)
  const pull = await service.pullGachaCard("120@g.us", "6281@s.whatsapp.net", 0.01);
  assert.equal(pull.card.rarity, "UR");
  assert.equal(pull.isNew, true);
  assert.equal(pull.cost, GACHA_PULL_PRICE);

  // Visual card renders valid 600x840 PNG via Sharp
  const pngBuffer = await gachaCardService.renderCard({
    card: pull.card,
    ownerLabel: "Sultan Minji",
    isNew: true,
    ownedCopies: 1,
  });
  const meta = await sharp(pngBuffer).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 600);
  assert.equal(meta.height, 840);

  // Achievements should unlock jutawan, petualang, raja_kartu_ur, aktif_grup
  const ach = await service.getAchievements("120@g.us", "6281@s.whatsapp.net");
  const unlockedIds = new Set(ach.unlocked.map((a) => a.id));
  assert.ok(unlockedIds.has("jutawan"));
  assert.ok(unlockedIds.has("petualang"));
  assert.ok(unlockedIds.has("raja_kartu_ur"));
  assert.ok(unlockedIds.has("aktif_grup"));
  assert.ok(ach.bonusLimit > 0);

  // Trade the UR card by serial number to 6282
  const tradeRes = await service.tradeItem(
    "120@g.us",
    "6281@s.whatsapp.net",
    "6282@s.whatsapp.net",
    pull.card.serial,
    1,
  );
  assert.equal(tradeRes.itemType, "card");
  assert.equal(tradeRes.senderRemaining, 0);
  assert.equal(tradeRes.recipientTotal, 1);

  // Verify rpgState persistence roundtrip
  const recipientProf = Array.from(profiles.values()).find(
    (p) => p.userJid === "6282@s.whatsapp.net",
  );
  assert.ok(recipientProf);
  const parsedState = parseRpgState(recipientProf.rpgState);
  assert.equal(parsedState.cards[pull.card.id], 1);

  // Redeem code creation, claim, and double-claim prevention
  await service.createRedeemCode("120@g.us", "6281@s.whatsapp.net", "SULTAN99", 10, 50_000_000n, 1);
  const redeemed = await service.redeemCode("120@g.us", "6282@s.whatsapp.net", "sultan99");
  assert.equal(redeemed.rewardLimit, 10);
  assert.equal(redeemed.rewardMoney, 50_000_000n);
  assert.equal(redeemed.claimsUsed, 1);

  await assert.rejects(
    () => service.redeemCode("120@g.us", "6282@s.whatsapp.net", "SULTAN99"),
    /sudah pernah mengklaim/,
  );
  await assert.rejects(
    () => service.redeemCode("120@g.us", "6281@s.whatsapp.net", "SULTAN99"),
    /Kuota klaim.*habis/,
  );
  assert.equal(GACHA_CARDS.length, 20);
});

void test("Tahap 9: LiveCryptoService fetches CoinGecko prices and caches for 60s", async () => {
  let calls = 0;
  const mockFetch = (async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          bitcoin: { idr: 1_550_000_000, usd: 96500, usd_24h_change: 2.34 },
        }),
    };
  }) as unknown as typeof fetch;

  const svc = new LiveCryptoService(mockFetch);
  const first = await svc.getPrices("btc");
  const second = await svc.getPrices("btc");

  assert.equal(calls, 1);
  assert.equal(first.length, 1);
  assert.equal(first[0]?.symbol, "BTC");
  assert.equal(first[0]?.idr, 1_550_000_000);
  assert.equal(second[0]?.usd, 96500);
});
