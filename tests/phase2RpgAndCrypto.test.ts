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

function createInMemoryRpgHarness(
  initialProfiles: GroupMemberProfile[],
  initialTreasury = 50_000_000n,
) {
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
          moneyBalance: 500_000n,
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

  const applyData = (
    prof: GroupMemberProfile,
    data: Record<string, unknown>,
  ): GroupMemberProfile => {
    const next = { ...prof };
    const moneyOp = data.moneyBalance as { increment?: bigint; decrement?: bigint } | undefined;
    if (moneyOp?.increment) next.moneyBalance += moneyOp.increment;
    if (moneyOp?.decrement) next.moneyBalance -= moneyOp.decrement;
    const totalMoneyOp = data.totalMoneyEarned as { increment?: bigint } | undefined;
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
          update: (args: { data: { treasuryBalance?: bigint } }) => {
            if (typeof args.data.treasuryBalance === "bigint") {
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
            const moneyGuard = args.where.moneyBalance as { gte?: bigint } | undefined;
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

void test("RpgEconomyService: job run credits Sultan money & XP and enforces cooldown", async () => {
  const harness = createInMemoryRpgHarness([
    buildMemberProfile({
      id: "p1",
      groupJid: "120@g.us",
      userJid: "u1@s.whatsapp.net",
      moneyBalance: 1_000_000n,
      level: 1,
    }),
  ]);
  const service = new RpgEconomyService(
    harness.profileRepo,
    harness.txRepo,
    { intBetween: (min) => min, chance: () => false },
    harness.db,
  );

  const now = new Date("2026-11-28T05:00:00Z");
  const res = await service.runJob("120@g.us", "u1@s.whatsapp.net", "kerja", now);
  assert.equal(res.moneyGained, 900_000n);
  assert.equal(res.currentMoney, 1_900_000n);

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
        moneyBalance: 10_000_000n,
      }),
    ],
    50_000_000n,
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
  assert.equal(res.amountDelta, -2_000_000n);
  assert.equal(res.currentMoney, 8_000_000n);
  assert.equal(res.jailMinutes, 10);
  assert.equal(harness.getTenant().treasuryBalance, 52_000_000n);

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
        moneyBalance: 2_000_000n,
      }),
      buildMemberProfile({
        id: "p2",
        groupJid: "120@g.us",
        userJid: "628222@s.whatsapp.net",
        moneyBalance: 10_000_000n,
        bankBalance: 50_000_000n,
      }),
    ],
    50_000_000n,
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
  assert.equal(tax.taxCollected, 600_000n); // 6% of 10_000_000
  assert.equal(tax.collectorShare, 240_000n);
  assert.equal(tax.treasuryShare, 360_000n);
  assert.equal(tax.targetMoney, 9_400_000n);

  const rob = await successService.robMember(
    "120@g.us",
    "628111@s.whatsapp.net",
    "628222@s.whatsapp.net",
    now,
  );
  assert.equal(rob.success, true);
  assert.equal(rob.amountMoved, 940_000n); // 10% of remaining 9_400_000 wallet (bank untouched!)
  assert.equal(rob.victimMoney, 8_460_000n);
  assert.equal(harness.profiles.get("120@g.us:628222@s.whatsapp.net")?.bankBalance, 50_000_000n);
});

void test("RpgEconomyService: bansos gives poverty bonus and casino settles dice fairly", async () => {
  const harness = createInMemoryRpgHarness([
    buildMemberProfile({
      id: "p1",
      groupJid: "120@g.us",
      userJid: "628111@s.whatsapp.net",
      moneyBalance: 1_000_000n,
      bankBalance: 0n,
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
  assert.equal(bansos.moneyGained, 5_500_000n); // 2.5jt base + 3jt poverty bonus

  const casino = await service.playCasino("120@g.us", "628111@s.whatsapp.net", 1_000_000n, now);
  assert.equal(casino.outcome, "jackpot");
  assert.equal(casino.netDelta, 1_500_000n);
  assert.equal(casino.currentMoney, 8_000_000n);
});

void test("CryptoMarketService: deterministic prices, buy, portfolio, and sell all with BigInt", async () => {
  const btc = CRYPTO_COINS[0];
  assert.ok(btc);
  assert.equal(computeCoinPriceAtEpoch(btc, 5000), computeCoinPriceAtEpoch(btc, 5000));

  const harness = createInMemoryRpgHarness([
    buildMemberProfile({
      id: "p1",
      groupJid: "120@g.us",
      userJid: "628111@s.whatsapp.net",
      moneyBalance: 200_000_000n,
    }),
  ]);

  const crypto = new CryptoMarketService(harness.profileRepo, harness.txRepo, harness.db);
  const now = new Date("2026-11-28T05:00:00Z");

  const bought = await crypto.buyCrypto("120@g.us", "628111@s.whatsapp.net", "MINJI", 3, now);
  assert.equal(bought.symbol, "MINJI");
  assert.equal(bought.newHolding, 3);
  assert.equal(bought.currentMoney, 200_000_000n - bought.totalMoney);

  const porto = await crypto.getPortfolio("120@g.us", "628111@s.whatsapp.net", now);
  assert.equal(porto.items.length, 1);
  assert.equal(porto.totalValue, bought.totalMoney);

  const sold = await crypto.sellCrypto("120@g.us", "628111@s.whatsapp.net", "MINJI", "all", now);
  assert.equal(sold.units, 3);
  assert.equal(sold.newHolding, 0);
  assert.equal(sold.currentMoney, 200_000_000n);
});

void test("DuelService: challenge creation, acceptance, and atomic pot transfer with BigInt", async () => {
  const harness = createInMemoryRpgHarness([
    buildMemberProfile({
      id: "p1",
      groupJid: "120@g.us",
      userJid: "628111@s.whatsapp.net",
      moneyBalance: 5_000_000n,
    }),
    buildMemberProfile({
      id: "p2",
      groupJid: "120@g.us",
      userJid: "628222@s.whatsapp.net",
      moneyBalance: 5_000_000n,
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

  await duel.createChallenge("120@g.us", "628111@s.whatsapp.net", "628222@s.whatsapp.net", 1_500_000n);
  const res = await duel.acceptChallenge("120@g.us", "628222@s.whatsapp.net");
  assert.equal(res.winnerJid, "628111@s.whatsapp.net");
  assert.equal(res.winnerMoney, 6_500_000n);
  assert.equal(res.loserMoney, 3_500_000n);
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
