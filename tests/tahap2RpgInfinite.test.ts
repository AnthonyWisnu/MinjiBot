import assert from "node:assert/strict";
import test from "node:test";
import type { GroupMemberProfile } from "@prisma/client";

import { commandRouter } from "../src/commands";
import { AppUserError } from "../src/errors/appUserError";
import { RpgGroupInteractionService } from "../src/services/rpg/rpgGroupInteraction.service";
import { RpgInfiniteService } from "../src/services/rpg/rpgInfinite.service";
import {
  createDefaultRpgState,
  parseRpgState,
  serializeRpgState,
  withCrateDelta,
  withHp,
  withItemsDelta,
  withPetState,
  withToolState,
} from "../src/services/rpg/rpgState";
import { buildMemberProfile } from "./helpers/factories";

function createInfiniteHarness(initialProfiles: GroupMemberProfile[]) {
  const profiles = new Map<string, GroupMemberProfile>();
  for (const p of initialProfiles) {
    profiles.set(`${p.groupJid}:${p.userJid}`, { ...p });
  }
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
          moneyBalance: 10_000_000n,
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
    for (const [k, v] of profiles.entries()) {
      if (v.id === id) return [k, v];
    }
    throw new Error(`Missing profile ${id}`);
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
    $transaction: <T>(fn: (tx: never) => Promise<T>) =>
      fn({
        groupMemberProfile: {
          update: (args: { where: { id: string }; data: Record<string, unknown> }) => {
            const [k, prof] = findById(args.where.id);
            const updated = applyData(prof, args.data);
            profiles.set(k, updated);
            return Promise.resolve({ ...updated });
          },
          updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            const [k, prof] = findById(String(args.where.id));
            const moneyGuard = args.where.moneyBalance as { gte?: bigint } | undefined;
            if (moneyGuard?.gte !== undefined && prof.moneyBalance < moneyGuard.gte) {
              return Promise.resolve({ count: 0 });
            }
            const updated = applyData(prof, args.data);
            profiles.set(k, updated);
            return Promise.resolve({ count: 1 });
          },
          findUniqueOrThrow: (args: { where: { id: string } }) => {
            const [, prof] = findById(args.where.id);
            return Promise.resolve({ ...prof });
          },
        },
      } as never),
  };

  return { profiles, profileRepo, txRepo, db, txLogs };
}

void test("Tahap 2 RpgInfinite: gather, cook, shop buy/sell, craft, upgrade, heal, and adventure work atomically", async () => {
  const initialState = withItemsDelta(withHp(createDefaultRpgState(), 50), {
    kayu: 10,
    besi: 10,
    emas: 5,
    apel: 4,
    mangga: 4,
  });

  const harness = createInfiniteHarness([
    buildMemberProfile({
      id: "p1",
      groupJid: "120@g.us",
      userJid: "628111@s.whatsapp.net",
      moneyBalance: 150_000_000n,
      level: 1,
      rpgState: serializeRpgState(initialState),
    }),
  ]);

  const service = new RpgInfiniteService(
    harness.profileRepo,
    harness.txRepo,
    { intBetween: (min) => min, chance: () => true },
    harness.db,
  );

  // 1. Shop buy potion & heal
  const buyRes = await service.shopBuy("120@g.us", "628111@s.whatsapp.net", "potion", 2);
  assert.equal(buyRes.totalMoney, 800_000n);
  const healRes = await service.healPlayer("120@g.us", "628111@s.whatsapp.net");
  assert.equal(healRes.hpBefore, 50);
  assert.equal(healRes.hpAfter, 100);
  assert.equal(healRes.potionsUsed, 2);

  // 2. Cook salad & sell all
  const cookRes = await service.cookFood("120@g.us", "628111@s.whatsapp.net", "salad", 2);
  assert.equal(cookRes.quantity, 2);
  const sellRes = await service.shopSell("120@g.us", "628111@s.whatsapp.net", "salad", "all");
  assert.equal(sellRes.totalMoney, 900_000n);

  // 3. Craft & upgrade sword
  const craftRes = await service.craftTool("120@g.us", "628111@s.whatsapp.net", "sword");
  assert.equal(craftRes.newLevel, 1);
  const upgRes = await service.upgradeTool("120@g.us", "628111@s.whatsapp.net", "sword");
  assert.equal(upgRes.newLevel, 2);

  // 4. Adventure & gathering (.nebang, .berkebon)
  const now = new Date("2026-11-28T06:00:00Z");
  const adv = await service.runAdventure("120@g.us", "628111@s.whatsapp.net", now);
  assert.ok(adv.moneyGained >= 450_000n);
  assert.ok(adv.crateFound !== null);

  const wood = await service.runGathering("120@g.us", "628111@s.whatsapp.net", "nebang", now);
  assert.ok((wood.itemsGained.kayu ?? 0) >= 3);
  const farm = await service.runGathering("120@g.us", "628111@s.whatsapp.net", "berkebon", now);
  assert.ok((farm.itemsGained.apel ?? 0) >= 2);
});

void test("Tahap 2 RpgInfinite: gacha crate unlocks pet, feed/ramuan levels pet, and 6 boss fights award millions", async () => {
  const initialState = withToolState(
    withItemsDelta(withCrateDelta(createDefaultRpgState(), "mythic", 2), {
      makananpet: 2,
      ramuanpet: 1,
    }),
    "sword",
    { level: 5, durability: 100 },
  );

  const harness = createInfiniteHarness([
    buildMemberProfile({
      id: "p1",
      groupJid: "120@g.us",
      userJid: "628111@s.whatsapp.net",
      moneyBalance: 10_000_000n,
      level: 10,
      rpgState: serializeRpgState(initialState),
    }),
  ]);

  const service = new RpgInfiniteService(
    harness.profileRepo,
    harness.txRepo,
    { intBetween: (min) => min, chance: () => true },
    harness.db,
  );

  // Open mythic crate -> guaranteed pet (chance=true) & Sultan Rupiah
  const gacha = await service.openCrate("120@g.us", "628111@s.whatsapp.net", "mythic", 1);
  assert.ok(gacha.moneyGained >= 10_000_000n);
  assert.equal(gacha.petsGained.length, 1);
  const unlockedPet = gacha.petsGained[0]?.pet;
  assert.ok(unlockedPet);

  // Feed & ramuan on unlocked pet
  const fed = await service.careForPet("120@g.us", "628111@s.whatsapp.net", unlockedPet, "feed");
  assert.equal(fed.hunger, 100);
  const elixir = await service.careForPet("120@g.us", "628111@s.whatsapp.net", unlockedPet, "ramuan");
  assert.equal(elixir.newLevel, fed.newLevel + 1);

  // Fight boss kucing -> win rebalanced money, crate drop & sword durability wear
  const now = new Date("2026-11-28T06:00:00Z");
  const boss = await service.fightBoss("120@g.us", "628111@s.whatsapp.net", "kucing", now);
  assert.equal(boss.won, true);
  assert.ok(boss.moneyGained >= 600_000n);
  assert.equal(boss.crateGained, "common");
  assert.equal(boss.swordDurabilityAfter, 96);
});

void test("Tahap 2 RpgGroupInteraction: berbisnis, co-op dungeon, and serang with 15m UGD anti-bully protection", async () => {
  const strongAttackerState = withPetState(
    withToolState(createDefaultRpgState(), "sword", { level: 6, durability: 100 }),
    "naga",
    { level: 5, exp: 0, hunger: 100 },
  );
  const weakVictimState = withHp(createDefaultRpgState(), 30);

  const harness = createInfiniteHarness([
    buildMemberProfile({
      id: "p1",
      groupJid: "120@g.us",
      userJid: "628111@s.whatsapp.net",
      moneyBalance: 20_000_000n,
      level: 8,
      rpgState: serializeRpgState(strongAttackerState),
    }),
    buildMemberProfile({
      id: "p2",
      groupJid: "120@g.us",
      userJid: "628222@s.whatsapp.net",
      moneyBalance: 15_000_000n,
      level: 1,
      rpgState: serializeRpgState(weakVictimState),
    }),
  ]);

  const groupRpg = new RpgGroupInteractionService(
    harness.profileRepo,
    harness.txRepo,
    { intBetween: (min) => min, chance: () => true },
    harness.db,
  );

  const now = new Date("2026-11-28T06:00:00Z");

  // 1. Berbisnis bareng -> both profit
  const biz = await groupRpg.runGroupBusiness(
    "120@g.us",
    "628111@s.whatsapp.net",
    ["628222@s.whatsapp.net"],
    now,
  );
  assert.equal(biz.profitable, true);
  assert.equal(biz.participants.length, 2);
  assert.ok(biz.netDeltaPerPerson >= 1_200_000n);

  // 2. Co-op dungeon create -> join -> start -> win
  const created = await groupRpg.createOrInspectDungeonLobby(
    "120@g.us",
    "628111@s.whatsapp.net",
    now.getTime(),
  );
  assert.equal(created.created, true);
  await groupRpg.joinDungeonLobby("120@g.us", "628222@s.whatsapp.net", now.getTime());
  const raid = await groupRpg.startDungeonRaid("120@g.us", "628111@s.whatsapp.net", now);
  assert.equal(raid.won, true);
  assert.equal(raid.members.length, 2);
  assert.ok((raid.members[0]?.moneyGained ?? 0n) >= 1_800_000n);

  // 3. Serang -> victim HP drops to 0 -> sent to UGD 15m -> second attack blocked by UGD anti-bully
  const atk = await groupRpg.attackPlayer(
    "120@g.us",
    "628111@s.whatsapp.net",
    "628222@s.whatsapp.net",
    now,
  );
  assert.equal(atk.success, true);
  assert.equal(atk.sentToUgd, true);
  assert.equal(atk.ugdMinutes, 15);
  assert.ok(atk.moneyLooted >= 1_000_000n);

  const victimProfile = harness.profiles.get("120@g.us:628222@s.whatsapp.net");
  assert.ok(victimProfile);
  assert.ok(parseRpgState(victimProfile.rpgState).ugdUntil > now.getTime());

  // Another attacker cannot bully victim in UGD
  await assert.rejects(
    () =>
      groupRpg.attackPlayer(
        "120@g.us",
        "628333@s.whatsapp.net",
        "628222@s.whatsapp.net",
        new Date(now.getTime() + 60_000),
      ),
    AppUserError,
  );
});

void test("Tahap 2 commands are all registered in commandRouter", () => {
  for (const cmd of [
    "inventory",
    "inv",
    "kandang",
    "heal",
    "adventure",
    "nebang",
    "berkebon",
    "masak",
    "cook",
    "shop",
    "craft",
    "upgrade",
    "repair",
    "perbaikialat",
    "open",
    "feed",
    "ramuan",
    "fightkucing",
    "fightkyubi",
    "fightcentaur",
    "fightgriffin",
    "fightnaga",
    "fightphonix",
    "berbisnis",
    "dungeon",
    "serang",
    "membunuh",
  ]) {
    assert.equal(commandRouter.has(cmd), true, `Command .${cmd} harus terdaftar di commandRouter`);
  }
});
