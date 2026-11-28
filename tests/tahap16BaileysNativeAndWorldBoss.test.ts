import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GroupMemberProfile, TenantGroup } from "@prisma/client";

import { commandRouter } from "../src/commands/index";
import { ANIME_ROLEPLAY_SPECS } from "../src/services/fun/animeRoleplay.service";
import {
  BaileysNativeService,
  buildVCard,
  classifyCommandUx,
  parseEphemeralDurationSeconds,
  parseEventCommandInput,
  parsePinDurationSeconds,
} from "../src/services/group/baileysNative.service";
import { menuService } from "../src/services/menu/menu.service";
import {
  RaidFarmBuffBountyService,
  WORLD_BOSS_RESPAWN_COOLDOWN_MS,
  WORLD_BOSS_TTL_MS,
} from "../src/services/rpg/raidFarmBuffBounty.service";
import {
  createDefaultRpgState,
  parseRpgState,
  serializeRpgState,
} from "../src/services/rpg/rpgState";

const GROUP_JID = "120363999000161616@g.us";
const USER_1 = "628111111111@s.whatsapp.net";
const USER_2 = "628222222222@s.whatsapp.net";

function createPersistentBossHarness() {
  const profiles = new Map<string, GroupMemberProfile>();
  let persistedWorldBossState: unknown = null;
  let seq = 1;

  const makeProfile = (userJid: string): GroupMemberProfile => {
    const state = createDefaultRpgState();
    state.tools.sword = { level: 10, durability: 100 };
    state.pets.phonix = { level: 20, exp: 0, hunger: 100 };
    state.skills.str = 50;
    const now = new Date();
    return {
      id: `p_${String(seq++)}`,
      groupJid: GROUP_JID,
      userJid,
      pointsBalance: 100,
      limitBalance: 100,
      reservedLimit: 0,
      experience: 5_000,
      moneyBalance: 100_000_000n,
      bankBalance: 0n,
      totalMoneyEarned: 100_000_000n,
      level: 50,
      totalPointsEarned: 100,
      totalLimitsEarned: 100,
      totalGamesPlayed: 0,
      totalGamesWon: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastDailyClaimAt: null,
      lastWeeklyClaimAt: null,
      lastMonthlyClaimAt: null,
      rpgState: serializeRpgState(state),
      messageCount: 10,
      lastActiveAt: now,
      createdAt: now,
      updatedAt: now,
    };
  };

  profiles.set(USER_1, makeProfile(USER_1));
  profiles.set(USER_2, makeProfile(USER_2));

  const profileRepo = {
    findOrCreate: async (_g: string, userJid: string) => {
      const existing = profiles.get(userJid);
      if (existing) return existing;
      const created = makeProfile(userJid);
      profiles.set(userJid, created);
      return created;
    },
    findByGroupAndUser: async (_g: string, userJid: string) => profiles.get(userJid) ?? null,
    listTopByBossDamage: async (_g: string, limit = 10) =>
      Array.from(profiles.values())
        .map((p) => {
          const st = parseRpgState(p.rpgState);
          return {
            profile: p,
            totalDamage: st.bossDamageTotal,
            bossKills: st.bossKills,
            bossMvpCount: st.bossMvpCount,
          };
        })
        .filter((e) => e.totalDamage > 0)
        .sort((a, b) => b.totalDamage - a.totalDamage)
        .slice(0, limit),
  };

  const applyData = (target: GroupMemberProfile, data: Record<string, unknown>) => {
    const next = { ...target };
    for (const k of ["moneyBalance", "bankBalance", "totalMoneyEarned"] as const) {
      const val = data[k] as { increment?: bigint; decrement?: bigint } | bigint | undefined;
      if (typeof val === "bigint") next[k] = val;
      else if (val && typeof val === "object") {
        if (val.increment !== undefined) next[k] += val.increment;
        if (val.decrement !== undefined) next[k] -= val.decrement;
      }
    }
    const xp = data.experience as { increment?: number } | number | undefined;
    if (typeof xp === "number") next.experience = xp;
    else if (xp && typeof xp === "object" && xp.increment !== undefined) {
      next.experience += xp.increment;
    }
    if ("rpgState" in data) {
      next.rpgState = data.rpgState as GroupMemberProfile["rpgState"];
    }
    profiles.set(next.userJid, next);
    return next;
  };

  const tenantGroupMock = {
    findUnique: async () =>
      ({
        groupJid: GROUP_JID,
        treasuryBalance: 20_000_000_000_000n,
        worldBossState: persistedWorldBossState,
      }) as unknown as TenantGroup,
    update: async (args: { data: Record<string, unknown> }) => {
      if ("worldBossState" in args.data) {
        persistedWorldBossState = args.data.worldBossState;
      }
      return {
        groupJid: GROUP_JID,
        treasuryBalance: 20_000_000_000_000n,
        worldBossState: persistedWorldBossState,
      } as unknown as TenantGroup;
    },
  };

  const tx = {
    groupMemberProfile: {
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const found = Array.from(profiles.values()).find((p) => p.id === args.where.id);
        if (!found) return { count: 0 };
        applyData(found, args.data);
        return { count: 1 };
      },
      findUniqueOrThrow: async (args: { where: Record<string, unknown> }) => {
        const found = Array.from(profiles.values()).find((p) => p.id === args.where.id);
        if (!found) throw new Error("Not found");
        return found;
      },
      update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const found = Array.from(profiles.values()).find((p) => p.id === args.where.id);
        if (!found) throw new Error("Not found");
        return applyData(found, args.data);
      },
    },
    tenantGroup: tenantGroupMock,
  };

  const createServiceInstance = () =>
    new RaidFarmBuffBountyService(
      profileRepo,
      { create: async () => ({}) },
      { intBetween: (min) => min, chance: () => false },
      {
        $transaction: async <T>(fn: (txArg: typeof tx) => Promise<T>): Promise<T> => fn(tx),
        tenantGroup: tenantGroupMock,
      },
    );

  return { createServiceInstance, profiles, getPersisted: () => persistedWorldBossState };
}

describe("World Boss Persistence, Auto-Spawn & All-Time TopDamage", () => {
  it("auto-spawn saat .serangboss, bertahan lintas restart bot, mencatat boss kabur & all-time damage, dan tidak kosong saat boss baru 0 hit", async () => {
    const h = createPersistentBossHarness();
    const svc1 = h.createServiceInstance();
    const t0 = 1_780_000_000_000;

    // 1. Opsi A: Langsung .serangboss tanpa .worldboss -> auto-spawn & langsung pukul
    const hit1 = await svc1.attackWorldBoss(GROUP_JID, USER_1, t0);
    assert.equal(hit1.autoSpawned, true);
    assert.equal(hit1.defeated, false);
    assert.ok(hit1.damageDealt > 0);
    assert.ok(h.getPersisted() !== null);

    // 2. Simulasikan restart/deploy bot (instance baru dengan RAM kosong!)
    const svcAfterRestart = h.createServiceInstance();
    const status = await svcAfterRestart.getWorldBossStatus(GROUP_JID, t0 + 60_000);
    assert.ok(status.active !== null, "Boss aktif harus tetap ada setelah bot restart");
    assert.equal(status.active.currentHp, hit1.bossHpAfter);
    assert.equal(status.topDamagers[0]?.userJid, USER_1);

    // 3. Simulasikan boss kabur setelah 3 jam (TTL habis) -> masuk history & damage tetap tercatat di All-Time!
    const tExpired = t0 + WORLD_BOSS_TTL_MS + 10_000;
    const topAfterEscape = await svcAfterRestart.getTopBossDamage(GROUP_JID, tExpired);
    assert.ok(topAfterEscape !== null);
    assert.equal(topAfterEscape.source, "last");
    assert.equal(topAfterEscape.outcome, "escaped");
    assert.equal(topAfterEscape.rankings[0]?.userJid, USER_1);
    assert.equal(topAfterEscape.allTimeTop[0]?.userJid, USER_1);
    assert.equal(topAfterEscape.allTimeTop[0]?.totalDamage, hit1.damageDealt);

    // 4. Munculkan boss baru (0 hit) -> .topdamage tetap fallback ke boss terakhir + info boss baru menunggu!
    const spawnedFresh = await svcAfterRestart.inspectOrSpawnWorldBoss(GROUP_JID, tExpired + 1_000);
    assert.equal(spawnedFresh.spawned, true);

    const topWhileNewBossZeroHits = await svcAfterRestart.getTopBossDamage(GROUP_JID, tExpired + 2_000);
    assert.ok(topWhileNewBossZeroHits !== null);
    assert.equal(topWhileNewBossZeroHits.source, "last");
    assert.equal(topWhileNewBossZeroHits.activeBossPendingName, spawnedFresh.boss.spec.name);
    assert.ok(topWhileNewBossZeroHits.allTimeTop.length >= 1);

    // 5. Kalahkan boss baru hingga tumbang -> history bertambah & respawn cooldown 1 jam aktif
    let t = tExpired + 3_000;
    let defeated = false;
    for (let i = 0; i < 12 && !defeated; i += 1) {
      const attacker = i % 2 === 0 ? USER_1 : USER_2;
      const res = await svcAfterRestart.attackWorldBoss(GROUP_JID, attacker, t);
      defeated = res.defeated;
      t += 260_000;
    }
    assert.equal(defeated, true);

    const svc3 = h.createServiceInstance();
    const hist = await svc3.getWorldBossHistory(GROUP_JID, t);
    assert.equal(hist.length, 2);
    assert.equal(hist[0]?.outcome, "defeated");
    assert.equal(hist[1]?.outcome, "escaped");

    // Tidak bisa auto-spawn saat cooldown 1 jam belum habis
    await assert.rejects(() => svc3.attackWorldBoss(GROUP_JID, USER_1, t + 10_000), /istirahat/i);
    // Setelah 1 jam lewat -> bisa auto-spawn lagi!
    const nextAuto = await svc3.attackWorldBoss(
      GROUP_JID,
      USER_1,
      t + WORLD_BOSS_RESPAWN_COOLDOWN_MS + 10_000,
    );
    assert.equal(nextAuto.autoSpawned, true);
  });
});

describe("Tahap 16: Baileys v7 Native Powerhouse & 15 Anime SFW", () => {
  it("mendaftarkan 12 command Baileys Native + 15 command nekos.best SFW tanpa menambah ekspresi solo", () => {
    const nativeCommands = [
      "buatevent",
      "pinpesan",
      "unpinpesan",
      "react",
      "lokasi",
      "kontakowner",
      "buatkontak",
      "setnamagrup",
      "setdeskripsigrup",
      "setppgrup",
      "revokelink",
      "pesansementara",
    ];
    const anime15 = [
      "gendong",
      "suapin",
      "gandeng",
      "salaman",
      "kabedon",
      "cium",
      "kecup",
      "pangku",
      "gelitik",
      "tembakdor",
      "ciumanjauh",
      "waifu",
      "husbando",
      "neko",
      "kitsune",
    ];

    for (const cmd of [...nativeCommands, ...anime15]) {
      assert.equal(commandRouter.has(cmd), true, `Command .${cmd} harus terdaftar`);
    }

    const catalog = menuService.getSearchableCatalog();
    for (const cmd of [...nativeCommands, ...anime15]) {
      assert.equal(
        catalog.some((e) => e.primaryCommand === cmd),
        true,
        `Command .${cmd} harus terdaftar di katalog menu`,
      );
    }

    // Pastikan 23 lama + 15 baru = tepat 38 spec (tanpa 25 ekspresi solo)
    assert.equal(ANIME_ROLEPLAY_SPECS.length, 38);
    for (const excludedSolo of ["sleep", "yawn", "pout", "lurk", "tableflip", "confused"]) {
      assert.equal(commandRouter.has(excludedSolo), false, `Ekspresi solo .${excludedSolo} tidak boleh ditambahkan`);
    }
  });

  it("mem-parsing input Event WIB, Pin, Pesan Sementara, vCard, UX Classifier, dan Geocoding Nominatim", async () => {
    const now = new Date("2026-11-28T05:00:00Z"); // 12:00 WIB

    const evRel = parseEventCommandInput("Mabar Ranked | +2j | Discord", now);
    assert.equal(evRel.title, "Mabar Ranked");
    assert.equal(evRel.locationName, "Discord");
    assert.equal(evRel.startDate.getTime(), now.getTime() + 2 * 60 * 60 * 1000);

    const evDate = parseEventCommandInput("Bukber | 25/12/2026 18:30 | Cafe Kota", now);
    assert.equal(evDate.startDate.toISOString(), "2026-12-25T11:30:00.000Z"); // 18:30 WIB = 11:30 UTC

    assert.throws(() => parseEventCommandInput("Event Lama | 01/01/2020 10:00", now), /masa lalu/i);

    assert.equal(parsePinDurationSeconds("24j"), 86400);
    assert.equal(parsePinDurationSeconds(undefined), 604800);
    assert.equal(parsePinDurationSeconds("30h"), 2592000);

    assert.equal(parseEphemeralDurationSeconds("off"), 0);
    assert.equal(parseEphemeralDurationSeconds("24j"), 86400);
    assert.equal(parseEphemeralDurationSeconds("7h"), 604800);
    assert.equal(parseEphemeralDurationSeconds("90h"), 7776000);

    const card = buildVCard("Admin:Test\nBaru", "0812-3456-7890");
    assert.equal(card.displayName, "Admin Test Baru");
    assert.equal(card.phoneDigits, "6281234567890");
    assert.match(card.vcard, /waid=6281234567890:\+6281234567890/);

    assert.deepEqual(classifyCommandUx("ai"), { autoReact: true, presence: "composing" });
    assert.deepEqual(classifyCommandUx("play"), { autoReact: true, presence: "recording" });
    assert.deepEqual(classifyCommandUx("menu"), { autoReact: false, presence: null });

    let fetchCalls = 0;
    const geoSvc = new BaileysNativeService(async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify([
          {
            name: "Monas",
            display_name: "Monumen Nasional, Gambir, Jakarta Pusat",
            lat: "-6.1753924",
            lon: "106.8271528",
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const loc1 = await geoSvc.geocodeLocation("Monas Jakarta");
    const loc2 = await geoSvc.geocodeLocation("monas jakarta");
    assert.equal(loc1.name, "Monas");
    assert.equal(loc1.latitude, -6.1753924);
    assert.equal(loc2.longitude, 106.8271528);
    assert.equal(fetchCalls, 1, "Hasil geocode kedua harus dilayani dari LRU cache");
  });
});
