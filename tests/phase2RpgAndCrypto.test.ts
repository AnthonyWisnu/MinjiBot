import assert from "node:assert/strict";
import test from "node:test";
import type { GroupMemberProfile, TenantGroup } from "@prisma/client";

import { commandRouter } from "../src/commands";
import { AppUserError } from "../src/errors/appUserError";
import {
  computeCoinPriceAtEpoch,
  CRYPTO_COINS,
  CryptoMarketService,
} from "../src/services/rpg/cryptoMarket.service";
import { DuelService } from "../src/services/rpg/duel.service";
import { RpgEconomyService } from "../src/services/rpg/rpgEconomy.service";
import {
  getRemainingCooldownMs,
  getRemainingJailMs,
  parseRpgState,
  withJailUntil,
  withUpdatedCooldown,
  withUpdatedCryptoHolding,
} from "../src/services/rpg/rpgState";
import { buildMemberProfile, buildTenantGroup } from "./helpers/factories";

function createInMemoryRpgHarness(initialProfiles: GroupMemberProfile[], initialTreasury = 500_000) {
  const profiles = new Map<string, GroupMemberProfile>();
  for (const p of initialProfiles) {
    profiles.set(`${p.groupJid}:${p.userJid}`, { ...p });
  }
  let tenant: TenantGroup = buildTenantGroup({
    groupJid: "120@g.us",
    treasuryBalance: initialTreasury,
  });
  const txLogs: unknown[] = [];

  const profileRepo = {
    findOrCreate: (groupJid: string, userJid: string) => {
      const key = `${groupJid}:${userJid}`;
      let found = profiles.get(key);
      if (!found) {
        found = buildMemberProfile({
          id: `prof_${userJid}`,
          groupJid,
          userJid,
          moneyBalance: 25_000,
        });
        profiles.set(key, found);
      }
      return Promise.resolve({ ...found });
    },
    findByGroupAndUser: (groupJid: string, userJid: string) => {
      const found = profiles.get(`${groupJid}:${userJid}`);
      return Promise.resolve(found ? { ...found } : null);
    },
  };

  const txRepo = {
    create: (data: unknown) => {
      txLogs.push(data);
      return Promise.resolve(data);
    },
  };

  const findById = (id: string): [string, GroupMemberProfile] => {
    for (const [key, prof] of profiles.entries()) {
      if (prof.id === id) return [key, prof];
    }
    throw new Error(`Profile ${id} not found`);
  };

  const applyData = (prof: GroupMemberProfile, data: Record<string, unknown>): GroupMemberProfile => {
    const next = { ...prof };
    const moneyOp = data.moneyBalance as { increment?: number; decrement?: number } | undefined;
    if (moneyOp?.increment) next.moneyBalance += moneyOp.increment;
    if (moneyOp?.decrement) next.moneyBalance -= moneyOp.decrement;
    const totalMoneyOp = data.totalMoneyEarned as { increment?: number } | undefined;
    if (totalMoneyOp?.increment) next.totalMoneyEarned += totalMoneyOp.increment;
    const xpOp = data.experience as { increment?: number } | undefined;
    if (xpOp?.increment) next.experience += xpOp.increment;
    if ("rpgState" in data) {
      next.rpgState = data.rpgState as GroupMemberProfile["rpgState"];
    }
    return next;
  };

  const db = {
    tenantGroup: {
      findUnique: () => Promise.resolve({ ...tenant }),
    },
    $transaction: <T>(fn: (tx: never) => Promise<T>) =>
      fn({
        tenantGroup: {
          findUnique: () => Promise.resolve({ ...tenant }),
          update: (args: { data: { treasuryBalance?: number } }) => {
            if (typeof args.data.treasuryBalance === "number") {
              tenant = { ...tenant, treasuryBalance: args.data.treasuryBalance };
            }
            return Promise.resolve({ ...tenant });
          },
        },
        groupMemberProfile: {
          update: (args: { where: { id: string }; data: Record<string, unknown> }) => {
            const [key, prof] = findById(args.where.id);
            const updated = applyData(prof, args.data);
            profiles.set(key, updated);
            return Promise.resolve({ ...updated });
          },
          updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            const [key, prof] = findById(String(args.where.id));
            const moneyGuard = args.where.moneyBalance as { gte?: number } | undefined;
            if (moneyGuard?.gte !== undefined && prof.moneyBalance < moneyGuard.gte) {
              return Promise.resolve({ count: 0 });
            }
            const updated = applyData(prof, args.data);
            profiles.set(key, updated);
            return Promise.resolve({ count: 1 });
          },
          findUniqueOrThrow: (args: { where: { id: string } }) => {
            const [, prof] = findById(args.where.id);
            return Promise.resolve({ ...prof });
          },
        },
      } as never),
  };

  return { profiles, getTenant: () => tenant, profileRepo, txRepo, db, txLogs };
}

void test("rpgState helpers parse, cooldown, jail, and update crypto holdings safely", () => {
  const empty = parseRpgState(null);
  assert.deepEqual(empty, { cooldowns: {}, jailedUntil: 0, crypto: {} });

  const now = 1_000_000;
  const cd = withUpdatedCooldown(empty, "kerja", now);
  assert.equal(getRemainingCooldownMs(cd, "kerja", 60_000, now + 10_000), 50_000);
  assert.equal(getRemainingCooldownMs(cd, "kerja", 60_000, now + 60_000), 0);

  const jailed = withJailUntil(cd, now + 30_000);
  assert.equal(getRemainingJailMs(jailed, now + 5_000), 25_000);

  const held = withUpdatedCryptoHolding(jailed, "minji", 4);
  assert.equal(held.crypto.MINJI, 4);
  const cleared = withUpdatedCryptoHolding(held, "MINJI", 0);
  assert.equal(cleared.crypto.MINJI, undefined);
});

void test("RpgEconomyService: job run credits money & XP and enforces cooldown", async () => {
  const harness = createInMemoryRpgHarness([
    buildMemberProfile({ id: "p1", groupJid: "120@g.us", userJid: "u1@s.whatsapp.net", moneyBalance: 10_000 }),
  ]);
  const service = new RpgEconomyService(
    harness.profileRepo,
    harness.txRepo,
    { intBetween: (min) => min, chance: () => false },
    harness.db,
  );

  const now = new Date("2026-11-28T05:00:00Z");
  const res = await service.runJob("120@g.us", "u1@s.whatsapp.net", "kerja", now);
  assert.equal(res.moneyGained, 8_000);
  assert.equal(res.currentMoney, 18_000);

  await assert.rejects(
    () => service.runJob("120@g.us", "u1@s.whatsapp.net", "kerja", new Date(now.getTime() + 10_000)),
    AppUserError,
  );
});

void test("RpgEconomyService: korupsi OTT fines wallet into group treasury and jails actor", async () => {
  const harness = createInMemoryRpgHarness(
    [
      buildMemberProfile({
        id: "p1",
        groupJid: "120@g.us",
        userJid: "u1@s.whatsapp.net",
        moneyBalance: 100_000,
      }),
    ],
    500_000,
  );

  const failService = new RpgEconomyService(
    harness.profileRepo,
    harness.txRepo,
    { intBetween: (min) => min, chance: () => false },
    harness.db,
  );

  const now = new Date("2026-11-28T05:00:00Z");
  const res = await failService.runCorruption("120@g.us", "u1@s.whatsapp.net", false, now);
  assert.equal(res.success, false);
  assert.equal(res.amountDelta, -20_000);
  assert.equal(res.currentMoney, 80_000);
  assert.equal(res.jailMinutes, 10);
  assert.equal(harness.getTenant().treasuryBalance, 520_000);

  // While jailed, cannot rob
  await assert.rejects(
    () => failService.robMember("120@g.us", "u1@s.whatsapp.net", "u2@s.whatsapp.net", now),
    /masih di dalam sel/,
  );
});

void test("RpgEconomyService: pajak splits tax between collector and treasury; maling steals from wallet only", async () => {
  const harness = createInMemoryRpgHarness(
    [
      buildMemberProfile({
        id: "p1",
        groupJid: "120@g.us",
        userJid: "628111@s.whatsapp.net",
        moneyBalance: 20_000,
      }),
      buildMemberProfile({
        id: "p2",
        groupJid: "120@g.us",
        userJid: "628222@s.whatsapp.net",
        moneyBalance: 100_000,
        bankBalance: 500_000,
      }),
    ],
    500_000,
  );

  const successService = new RpgEconomyService(
    harness.profileRepo,
    harness.txRepo,
    { intBetween: (min) => min, chance: () => true },
    harness.db,
  );

  const now = new Date("2026-11-28T05:00:00Z");
  const tax = await successService.collectTax(
    "120@g.us",
    "628111@s.whatsapp.net",
    "628222@s.whatsapp.net",
    now,
  );
  assert.equal(tax.success, true);
  assert.equal(tax.taxCollected, 6_000); // 6% of 100_000
  assert.equal(tax.collectorShare, 2_400);
  assert.equal(tax.treasuryShare, 3_600);
  assert.equal(tax.targetMoney, 94_000);

  const rob = await successService.robMember(
    "120@g.us",
    "628111@s.whatsapp.net",
    "628222@s.whatsapp.net",
    now,
  );
  assert.equal(rob.success, true);
  assert.equal(rob.amountMoved, 9_400); // 10% of remaining 94_000 wallet (bank untouched!)
  assert.equal(rob.victimMoney, 84_600);
  assert.equal(harness.profiles.get("120@g.us:628222@s.whatsapp.net")?.bankBalance, 500_000);
});

void test("RpgEconomyService: bansos gives poverty bonus and casino settles dice fairly", async () => {
  const harness = createInMemoryRpgHarness([
    buildMemberProfile({
      id: "p1",
      groupJid: "120@g.us",
      userJid: "628111@s.whatsapp.net",
      moneyBalance: 10_000,
      bankBalance: 0,
    }),
  ]);

  let diceIdx = 0;
  const diceRolls = [6, 6, 2, 3]; // Player double 6 (jackpot!) vs dealer 5
  const service = new RpgEconomyService(
    harness.profileRepo,
    harness.txRepo,
    {
      intBetween: (min, max) => {
        if (min === 1 && max === 6) {
          const val = diceRolls[diceIdx % diceRolls.length] ?? 4;
          diceIdx += 1;
          return val;
        }
        return min;
      },
      chance: () => false,
    },
    harness.db,
  );

  const now = new Date("2026-11-28T05:00:00Z");
  const bansos = await service.claimBansos("120@g.us", "628111@s.whatsapp.net", now);
  assert.equal(bansos.povertyBonus, true);
  assert.equal(bansos.wasSkimmed, false);
  assert.equal(bansos.moneyGained, 50_000); // 25k base + 25k poverty bonus

  const casino = await service.playCasino("120@g.us", "628111@s.whatsapp.net", 10_000, now);
  assert.equal(casino.outcome, "jackpot");
  assert.equal(casino.netDelta, 15_000);
  assert.equal(casino.currentMoney, 75_000);
});

void test("CryptoMarketService: deterministic prices, buy, portfolio, and sell all", async () => {
  const btc = CRYPTO_COINS[0];
  assert.ok(btc);
  assert.equal(computeCoinPriceAtEpoch(btc, 5000), computeCoinPriceAtEpoch(btc, 5000));

  const harness = createInMemoryRpgHarness([
    buildMemberProfile({
      id: "p1",
      groupJid: "120@g.us",
      userJid: "628111@s.whatsapp.net",
      moneyBalance: 200_000,
    }),
  ]);

  const crypto = new CryptoMarketService(harness.profileRepo, harness.txRepo, harness.db);
  const now = new Date("2026-11-28T05:00:00Z");

  const bought = await crypto.buyCrypto("120@g.us", "628111@s.whatsapp.net", "MINJI", 3, now);
  assert.equal(bought.symbol, "MINJI");
  assert.equal(bought.newHolding, 3);
  assert.equal(bought.currentMoney, 200_000 - bought.totalMoney);

  const porto = await crypto.getPortfolio("120@g.us", "628111@s.whatsapp.net", now);
  assert.equal(porto.items.length, 1);
  assert.equal(porto.totalValue, bought.totalMoney);

  const sold = await crypto.sellCrypto("120@g.us", "628111@s.whatsapp.net", "MINJI", "all", now);
  assert.equal(sold.units, 3);
  assert.equal(sold.newHolding, 0);
  assert.equal(sold.currentMoney, 200_000);
});

void test("DuelService: challenge creation, acceptance, and atomic pot transfer", async () => {
  const harness = createInMemoryRpgHarness([
    buildMemberProfile({
      id: "p1",
      groupJid: "120@g.us",
      userJid: "628111@s.whatsapp.net",
      moneyBalance: 50_000,
    }),
    buildMemberProfile({
      id: "p2",
      groupJid: "120@g.us",
      userJid: "628222@s.whatsapp.net",
      moneyBalance: 50_000,
    }),
  ]);

  const rolls = [88, 42];
  let idx = 0;
  const duel = new DuelService(
    harness.profileRepo,
    harness.txRepo,
    {
      intBetween: () => rolls[idx++] ?? 50,
      chance: () => false,
    },
    harness.db,
  );

  await duel.createChallenge("120@g.us", "628111@s.whatsapp.net", "628222@s.whatsapp.net", 15_000);
  const res = await duel.acceptChallenge("120@g.us", "628222@s.whatsapp.net");
  assert.equal(res.winnerJid, "628111@s.whatsapp.net");
  assert.equal(res.winnerMoney, 65_000);
  assert.equal(res.loserMoney, 35_000);
});

void test("Phase 2 commands are registered in commandRouter", () => {
  for (const cmd of [
    "kerja",
    "work",
    "ojek",
    "mulung",
    "nambang",
    "berburu",
    "hunt",
    "mancing",
    "korupsi",
    "megakorupsi",
    "pajak",
    "kas",
    "maling",
    "rob",
    "bansos",
    "casino",
    "judi",
    "duel",
    "terimaduel",
    "tolakduel",
    "crypto",
    "cooldown",
  ]) {
    assert.equal(commandRouter.has(cmd), true, `Command .${cmd} harus terdaftar`);
  }
});
