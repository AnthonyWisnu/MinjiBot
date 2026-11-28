import assert from "node:assert/strict";
import test from "node:test";
import type { GroupMemberProfile } from "@prisma/client";

import { commandRouter } from "../src/commands";
import {
  AI_COOLDOWN_MS,
  ARENA_COOLDOWN_MS,
  ATTACK_COOLDOWN_MS,
  BOUNTY_HUNT_COOLDOWN_MS,
  BUDGET_COOLDOWN_MS,
  BUSINESS_COOLDOWN_MS,
  CAREER_SHIFT_COOLDOWN_MS,
  CLAN_BUFF_COOLDOWN_MS,
  CLAN_WAR_COOLDOWN_MS,
  COUP_GROUP_COOLDOWN_MS,
  DUNGEON_COOLDOWN_MS,
  GROUP_STATUS_COOLDOWN_MS,
  INFINITE_RPG_COOLDOWNS_MS,
  MENFESS_COOLDOWN_MS,
  NPC_DATE_COOLDOWN_MS,
  NPC_ROLL_COOLDOWN_MS,
  PET_ARENA_COOLDOWN_MS,
  PET_EXPEDITION_DURATION_MS,
  PROPERTY_MIN_HARVEST_MS,
  RPG_COOLDOWNS_MS,
  SEDEKAH_COOLDOWN_MS,
  STARTUP_DIVIDEND_COOLDOWN_MS,
  WORLD_BOSS_ATTACK_COOLDOWN_MS,
  WORLD_BOSS_RESPAWN_COOLDOWN_MS,
} from "../src/services/rpg/cooldownCatalog";
import { RpgEconomyService, rpgEconomyService } from "../src/services/rpg/rpgEconomy.service";
import { createDefaultRpgState, serializeRpgState } from "../src/services/rpg/rpgState";
import { buildCommandContext } from "./helpers/factories";

void test("Cooldown 3x rebalance catalog sets expected hardened anti-spam durations", () => {
  assert.equal(RPG_COOLDOWNS_MS.mulung, 18 * 60 * 1000);
  assert.equal(RPG_COOLDOWNS_MS.kerja, 30 * 60 * 1000);
  assert.equal(RPG_COOLDOWNS_MS.ojek, 30 * 60 * 1000);
  assert.equal(RPG_COOLDOWNS_MS.nambang, 60 * 60 * 1000);
  assert.equal(RPG_COOLDOWNS_MS.berburu, 60 * 60 * 1000);
  assert.equal(RPG_COOLDOWNS_MS.mancing, 60 * 60 * 1000);
  assert.equal(RPG_COOLDOWNS_MS.korupsi, 90 * 60 * 1000);
  assert.equal(RPG_COOLDOWNS_MS.megakorupsi, 6 * 60 * 60 * 1000);
  assert.equal(RPG_COOLDOWNS_MS.pajak, 3 * 60 * 60 * 1000);
  assert.equal(RPG_COOLDOWNS_MS.maling, 2 * 60 * 60 * 1000);
  assert.equal(RPG_COOLDOWNS_MS.bansos, 18 * 60 * 60 * 1000);
  assert.equal(RPG_COOLDOWNS_MS.casino, 30 * 1000);

  assert.equal(INFINITE_RPG_COOLDOWNS_MS.adventure, 48 * 60 * 1000);
  assert.equal(INFINITE_RPG_COOLDOWNS_MS.nebang, 30 * 60 * 1000);
  assert.equal(INFINITE_RPG_COOLDOWNS_MS.berkebon, 30 * 60 * 1000);
  assert.equal(INFINITE_RPG_COOLDOWNS_MS.fight_boss, 45 * 60 * 1000);

  assert.equal(PET_EXPEDITION_DURATION_MS, 90 * 60 * 1000);
  assert.equal(CAREER_SHIFT_COOLDOWN_MS, 3 * 60 * 60 * 1000);
  assert.equal(STARTUP_DIVIDEND_COOLDOWN_MS, 18 * 60 * 60 * 1000);
  assert.equal(PROPERTY_MIN_HARVEST_MS, 60 * 60 * 1000);
  assert.equal(BUSINESS_COOLDOWN_MS, 3 * 60 * 60 * 1000);
  assert.equal(ATTACK_COOLDOWN_MS, 90 * 60 * 1000);
  assert.equal(DUNGEON_COOLDOWN_MS, 2 * 60 * 60 * 1000);
  assert.equal(WORLD_BOSS_ATTACK_COOLDOWN_MS, 24 * 60 * 1000);
  assert.equal(WORLD_BOSS_RESPAWN_COOLDOWN_MS, 3 * 60 * 60 * 1000);
  assert.equal(BOUNTY_HUNT_COOLDOWN_MS, 60 * 60 * 1000);
  assert.equal(ARENA_COOLDOWN_MS, 30 * 1000);
  assert.equal(PET_ARENA_COOLDOWN_MS, 12 * 60 * 1000);
  assert.equal(SEDEKAH_COOLDOWN_MS, 60 * 60 * 1000);
  assert.equal(BUDGET_COOLDOWN_MS, 36 * 60 * 60 * 1000);
  assert.equal(COUP_GROUP_COOLDOWN_MS, 18 * 60 * 60 * 1000);
  assert.equal(CLAN_BUFF_COOLDOWN_MS, 3 * 60 * 60 * 1000);
  assert.equal(CLAN_WAR_COOLDOWN_MS, 90 * 60 * 1000);
  assert.equal(NPC_ROLL_COOLDOWN_MS, 15 * 60 * 1000);
  assert.equal(NPC_DATE_COOLDOWN_MS, 6 * 60 * 60 * 1000);
  assert.equal(AI_COOLDOWN_MS, 45 * 1000);
  assert.equal(MENFESS_COOLDOWN_MS, 15 * 60 * 1000);
  assert.equal(GROUP_STATUS_COOLDOWN_MS, 90 * 1000);
});

void test("RpgEconomyService.getCooldownSummary exposes complete per-member cooldowns across all categories", async () => {
  const now = new Date("2026-11-28T05:00:00.000Z"); // 12:00 WIB (12h left to midnight WIB)
  const nowMs = now.getTime();
  const state = createDefaultRpgState();
  state.cooldowns.kerja = nowMs - 5 * 60 * 1000; // 25m remaining
  state.cooldowns.casino = nowMs - 10 * 1000; // 20s remaining
  state.cooldowns.spin_day = 20261128; // claimed today WIB
  state.lastSalaryDateKey = "2026-11-28"; // claimed today WIB
  state.properties.warung = 2;
  state.lastPropertyHarvestAt = nowMs - 10 * 60 * 1000; // 50m left on 1h harvest CD
  state.startup = { name: "PT Minji", level: 2, employees: 3, lastDividendAt: nowMs - 60 * 60 * 1000 }; // 17h left
  state.petExpedition = { pet: "kucing", zoneId: "lembah_bambu", startedAt: nowMs - 60_000, endsAt: nowMs + 89 * 60 * 1000 };
  state.farm.plots = [{ cropId: "padi", plantedAt: nowMs - 60_000, readyAt: nowMs + 44 * 60 * 1000, watered: false }];
  state.npcRomance.partners = [
    {
      characterKey: "hutao",
      name: "Hu Tao",
      sourceTitle: "Genshin Impact",
      kind: "game",
      gender: "female",
      relation: "istri",
      affectionLevel: 5,
      affectionExp: 100,
      startedAt: nowMs - 86_400_000,
      marriedAt: nowMs - 43_200_000,
      lastDateAt: nowMs - 60 * 60 * 1000, // 5h left
      imageUrl: null,
    },
  ];
  state.npcRomance.primaryKey = "hutao";

  const mockProfile: GroupMemberProfile = {
    id: "p1",
    groupJid: "120@g.us",
    userJid: "628111@s.whatsapp.net",
    pointsBalance: 100,
    limitBalance: 100,
    reservedLimit: 0,
    experience: 500,
    level: 5,
    moneyBalance: 10_000_000n,
    bankBalance: 0n,
    totalMoneyEarned: 10_000_000n,
    totalPointsEarned: 100,
    totalLimitsEarned: 100,
    currentStreak: 1,
    longestStreak: 1,
    lastDailyClaimAt: new Date("2026-11-28T01:00:00.000Z"), // same WIB day (08:00 WIB)
    lastWeeklyClaimAt: new Date(nowMs - 2 * 24 * 60 * 60 * 1000), // 5d remaining
    lastMonthlyClaimAt: new Date(nowMs - 5 * 24 * 60 * 60 * 1000), // 25d remaining
    rpgState: serializeRpgState(state) as never,
    messageCount: 10,
    lastActiveAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const service = new RpgEconomyService(
    { findOrCreate: async () => mockProfile },
    { create: async () => ({}) },
    { intBetween: (min) => min, chance: () => false },
    { $transaction: async (fn) => fn({} as never) },
  );

  const summary = await service.getCooldownSummary("120@g.us", "628111@s.whatsapp.net", now, {
    menfess: 12 * 60 * 1000,
    ai: 30 * 1000,
  });

  assert.equal(summary.entries.length, 42);
  const byKey = new Map(summary.entries.map((e) => [e.key, e]));

  assert.equal(byKey.get("kerja")?.remainingMs, 25 * 60 * 1000);
  assert.equal(byKey.get("casino")?.remainingMs, 20 * 1000);
  assert.equal(byKey.get("daily")?.remainingMs, 12 * 60 * 60 * 1000);
  assert.equal(byKey.get("gaji")?.remainingMs, 12 * 60 * 60 * 1000);
  assert.equal(byKey.get("spin_day")?.remainingMs, 12 * 60 * 60 * 1000);
  assert.equal(byKey.get("weekly")?.remainingMs, 5 * 24 * 60 * 60 * 1000);
  assert.equal(byKey.get("monthly")?.remainingMs, 25 * 24 * 60 * 60 * 1000);
  assert.equal(byKey.get("panen")?.remainingMs, 50 * 60 * 1000);
  assert.equal(byKey.get("startup_dividend")?.remainingMs, 17 * 60 * 60 * 1000);
  assert.equal(byKey.get("pet_expedition")?.remainingMs, 89 * 60 * 1000);
  assert.equal(byKey.get("panenladang")?.remainingMs, 44 * 60 * 1000);
  assert.equal(byKey.get("npc_date")?.remainingMs, 5 * 60 * 60 * 1000);
  assert.equal(byKey.get("menfess")?.remainingMs, 12 * 60 * 1000);
  assert.equal(byKey.get("ai")?.remainingMs, 30 * 1000);
  assert.equal(summary.farmSummary?.plantedCount, 1);
  assert.equal(summary.farmSummary?.readyCount, 0);
});

void test(".cooldown and .cd command render complete summary and support targeting another member", async () => {
  assert.equal(commandRouter.has("cooldown"), true);
  assert.equal(commandRouter.has("cd"), true);

  let capturedTargetUser = "";
  const originalGetCooldownSummary = rpgEconomyService.getCooldownSummary.bind(rpgEconomyService);
  rpgEconomyService.getCooldownSummary = async (groupJid, userJid) => {
    capturedTargetUser = userJid;
    const svc = new RpgEconomyService(
      {
        findOrCreate: async () =>
          ({
            id: "mock-p2",
            groupJid,
            userJid,
            pointsBalance: 100,
            limitBalance: 100,
            reservedLimit: 0,
            experience: 0,
            level: 1,
            moneyBalance: 500_000n,
            bankBalance: 0n,
            totalMoneyEarned: 500_000n,
            totalPointsEarned: 100,
            totalLimitsEarned: 100,
            currentStreak: 0,
            longestStreak: 0,
            lastDailyClaimAt: new Date(),
            lastWeeklyClaimAt: null,
            lastMonthlyClaimAt: null,
            rpgState: serializeRpgState({
              ...createDefaultRpgState(),
              cooldowns: { kerja: Date.now() - 60_000 },
            }) as never,
            messageCount: 1,
            lastActiveAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          }) as GroupMemberProfile,
      },
      { create: async () => ({}) },
      { intBetween: (min) => min, chance: () => false },
      { $transaction: async (fn) => fn({} as never) },
    );
    return svc.getCooldownSummary(groupJid, userJid, new Date(), { menfess: 0, ai: 0 });
  };

  try {
    const ctx = buildCommandContext({
      commandName: "cd",
      text: ".cd @628555555555",
      mentionedJids: ["628555555555@s.whatsapp.net"],
    });
    await commandRouter.handle(ctx);

    assert.equal(capturedTargetUser, "628555555555@s.whatsapp.net");
    const reply = ctx.replies[0] ?? "";
    assert.match(reply, /STATUS COOLDOWN LENGKAP/);
    assert.match(reply, /@628555555555/);
    assert.match(reply, /Sedang Cooldown/);
    assert.match(reply, /\.kerja/);
    assert.match(reply, /\.daily/);
    assert.match(reply, /Kerja & Bisnis/);
    assert.match(reply, /Klaim Berkala/);
    assert.match(reply, /Petualangan & RPG/);
    assert.match(reply, /Kriminal & PvP/);
    assert.match(reply, /Arena, Sosial & AI/);
  } finally {
    rpgEconomyService.getCooldownSummary = originalGetCooldownSummary;
  }
});
