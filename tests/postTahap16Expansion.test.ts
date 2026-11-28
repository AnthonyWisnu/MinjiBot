import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";

import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupClan,
  type GroupMemberProfile,
  type TenantGroup,
} from "@prisma/client";

import { commandRouter } from "../src/commands/index";
import { canManageGroupEconomyControl } from "../src/commands/rpg/groupEconomyControl.command";
import {
  clearGroupXpEventCacheForTests,
  getActiveGroupXpMultiplier,
  syncGroupXpEventFromTenantState,
} from "../src/services/group/groupXpEvent.cache";
import { eventBannerService } from "../src/services/media/eventBanner.service";
import { MemberEconomyService } from "../src/services/member/memberEconomy.service";
import { ProfileCardService } from "../src/services/member/profileCard.service";
import { PROFILE_THEME_CATALOG } from "../src/services/member/profileThemes";
import { featureSearchService } from "../src/services/menu/featureSearch.service";
import { MenuService, menuService } from "../src/services/menu/menu.service";
import { ArenaGiveawayShopService } from "../src/services/rpg/arenaGiveawayShop.service";
import {
  GroupEconomyControlService,
  parseXpEventDurationMs,
  parseXpEventMultiplier,
} from "../src/services/rpg/groupEconomyControl.service";
import { PoliticsClanAnalyticsService } from "../src/services/rpg/politicsClanAnalytics.service";
import { RaidFarmBuffBountyService } from "../src/services/rpg/raidFarmBuffBounty.service";
import { PET_EXPEDITION_DURATION_MS } from "../src/services/rpg/rpgCatalog";
import { RpgInfiniteService } from "../src/services/rpg/rpgInfinite.service";
import {
  createDefaultRpgState,
  getFeaturedPet,
  parseRpgState,
  serializeRpgState,
  withPetState,
  type MemberRpgState,
} from "../src/services/rpg/rpgState";
import { buildCommandContext, buildMemberProfile, buildTenantGroup } from "./helpers/factories";

const GROUP_JID = "120363999000999999@g.us";
const USER_A = "628111100001@s.whatsapp.net";
const USER_B = "628111100002@s.whatsapp.net";
const USER_C = "628111100003@s.whatsapp.net";

function createSharedPersistenceHarness() {
  const profiles = new Map<string, GroupMemberProfile>();
  const clans: GroupClan[] = [];
  const ledger: {
    asset: MemberTransactionAsset;
    type: MemberTransactionType;
    amount: bigint;
  }[] = [];

  let tenant: TenantGroup = buildTenantGroup({
    groupJid: GROUP_JID,
    treasuryBalance: 20_000_000_000_000n,
    worldBossState: null,
    groupEventState: null,
  });

  const seedProfile = (
    userJid: string,
    overrides: Partial<GroupMemberProfile> = {},
    statePatch?: Partial<MemberRpgState>,
  ): GroupMemberProfile => {
    const base = createDefaultRpgState();
    const merged: MemberRpgState = {
      ...base,
      ...statePatch,
      pets: { ...base.pets, ...(statePatch?.pets ?? {}) },
      items: { ...base.items, ...(statePatch?.items ?? {}) },
      skills: { ...base.skills, ...(statePatch?.skills ?? {}) },
      buffs: { ...base.buffs, ...(statePatch?.buffs ?? {}) },
      insurances: { ...base.insurances, ...(statePatch?.insurances ?? {}) },
    };
    const p = buildMemberProfile({
      id: `prof-${userJid}`,
      groupJid: GROUP_JID,
      userJid,
      level: 20,
      experience: 12_000,
      moneyBalance: 500_000_000n,
      bankBalance: 100_000_000n,
      totalMoneyEarned: 600_000_000n,
      rpgState: serializeRpgState(merged),
      ...overrides,
    });
    profiles.set(userJid, p);
    return p;
  };

  const findOrCreate = (groupJid: string, userJid: string): Promise<GroupMemberProfile> => {
    const existing = profiles.get(userJid);
    if (existing) return Promise.resolve(existing);
    return Promise.resolve(seedProfile(userJid, { groupJid }));
  };

  const applyProfileData = (
    target: GroupMemberProfile,
    data: Record<string, unknown>,
  ): GroupMemberProfile => {
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
    profiles.set(next.userJid, next);
    return next;
  };

  const tenantGroupMock = {
    findUnique: (args: { where: { groupJid: string } }) =>
      Promise.resolve(args.where.groupJid === GROUP_JID ? { ...tenant } : null),
    update: (args: { where: { groupJid: string }; data: Record<string, unknown> }) => {
      if (args.where.groupJid !== GROUP_JID) {
        return Promise.reject(new Error("Tenant not found"));
      }
      const next = { ...tenant };
      const tb = args.data.treasuryBalance as
        | { increment?: bigint; decrement?: bigint }
        | bigint
        | undefined;
      if (typeof tb === "bigint") next.treasuryBalance = tb;
      else if (tb && typeof tb === "object") {
        if (tb.increment !== undefined) next.treasuryBalance = next.treasuryBalance + tb.increment;
        if (tb.decrement !== undefined) next.treasuryBalance = next.treasuryBalance - tb.decrement;
      }
      if ("worldBossState" in args.data) {
        next.worldBossState = args.data.worldBossState as TenantGroup["worldBossState"];
      }
      if ("groupEventState" in args.data) {
        next.groupEventState = args.data.groupEventState as TenantGroup["groupEventState"];
      }
      tenant = next;
      return Promise.resolve({ ...tenant });
    },
    updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const cond = args.where.treasuryBalance as { gte?: bigint } | undefined;
      if (cond?.gte !== undefined && tenant.treasuryBalance < cond.gte) {
        return Promise.resolve({ count: 0 });
      }
      const tb = args.data.treasuryBalance as { decrement?: bigint } | undefined;
      if (tb?.decrement !== undefined) {
        tenant = { ...tenant, treasuryBalance: tenant.treasuryBalance - tb.decrement };
      }
      return Promise.resolve({ count: 1 });
    },
  };

  const tx = {
    groupMemberProfile: {
      update: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const found = Array.from(profiles.values()).find((p) => p.id === args.where.id);
        if (!found) return Promise.reject(new Error("Profile not found"));
        return Promise.resolve(applyProfileData(found, args.data));
      },
      updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const found = Array.from(profiles.values()).find((p) => p.id === args.where.id);
        if (!found) return Promise.resolve({ count: 0 });
        const moneyCond = args.where.moneyBalance as { gte?: bigint } | undefined;
        if (moneyCond?.gte !== undefined && found.moneyBalance < moneyCond.gte) {
          return Promise.resolve({ count: 0 });
        }
        applyProfileData(found, args.data);
        return Promise.resolve({ count: 1 });
      },
      findUniqueOrThrow: (args: { where: Record<string, unknown> }) => {
        const found = Array.from(profiles.values()).find((p) => p.id === args.where.id);
        if (!found) return Promise.reject(new Error("Profile not found"));
        return Promise.resolve(found);
      },
    },
    tenantGroup: tenantGroupMock,
  };

  const db = {
    $transaction: <T>(fn: (txArg: typeof tx) => Promise<T>): Promise<T> => fn(tx),
    tenantGroup: tenantGroupMock,
  };

  const profileRepo = {
    findOrCreate,
    findByGroupAndUser: (_g: string, u: string) => Promise.resolve(profiles.get(u) ?? null),
    findActiveByUser: (u: string) => {
      const p = profiles.get(u);
      return Promise.resolve(p ? [p] : []);
    },
    listAllByGroup: () => Promise.resolve(Array.from(profiles.values())),
    listRecentActiveProfiles: (_g: string, exclude: string, limit = 10) =>
      Promise.resolve(
        Array.from(profiles.values())
          .filter((p) => p.userJid !== exclude)
          .slice(0, limit),
      ),
    listByGroupAndUsers: (_g: string, users: string[]) =>
      Promise.resolve(Array.from(profiles.values()).filter((p) => users.includes(p.userJid))),
    listTopByWealth: () => Promise.resolve(Array.from(profiles.values())),
    listTopByExperience: () => Promise.resolve(Array.from(profiles.values())),
    listTopByLevel: () => Promise.resolve(Array.from(profiles.values())),
    listTopByGamesWon: () => Promise.resolve(Array.from(profiles.values())),
    listTopByDonated: () => Promise.resolve([]),
    listTopByStreak: () => Promise.resolve(Array.from(profiles.values())),
    getPositionByWealth: () => Promise.resolve(1),
    getPositionByExperience: () => Promise.resolve(1),
    getPositionByLevel: () => Promise.resolve(1),
  };

  const txRepo = {
    create: (data: {
      asset: MemberTransactionAsset;
      type: MemberTransactionType;
      amount: number | bigint;
    }) => {
      ledger.push({
        asset: data.asset,
        type: data.type,
        amount: typeof data.amount === "bigint" ? data.amount : BigInt(data.amount),
      });
      return Promise.resolve({});
    },
    findByIdempotencyKey: () => Promise.resolve(null),
    listByProfile: () => Promise.resolve([]),
    listMoneyTransactionsSince: () =>
      Promise.resolve(
        ledger.filter(
          (l) => l.asset === MemberTransactionAsset.MONEY || l.asset === MemberTransactionAsset.BANK,
        ),
      ),
  };

  const clanRepo = {
    findBySlug: () => Promise.resolve(null),
    listByGroup: () => Promise.resolve([...clans]),
    findByMember: () => Promise.resolve(null),
    update: () => Promise.reject(new Error("Unused")),
  };

  const tenantRepo = {
    findByGroupJid: () => Promise.resolve({ ...tenant }),
  };

  const deterministicRandom = {
    intBetween: (min: number, _max: number) => min,
    chance: () => true,
  };

  return {
    profiles,
    clans,
    ledger,
    seedProfile,
    getTenant: () => tenant,
    db,
    profileRepo,
    txRepo,
    clanRepo,
    tenantRepo,
    deterministicRandom,
  };
}

void describe("Prioritas 1: Persistensi Event Jangka Panjang (Pemilu/Presiden, Lotere, Bounty, XP Event)", () => {
  void it("Pemilu, Presiden, Lotere, Bounty, dan Event XP bertahan setelah restart & tidak saling menimpa", async () => {
    clearGroupXpEventCacheForTests();
    const h = createSharedPersistenceHarness();
    h.seedProfile(USER_A);
    h.seedProfile(USER_B);
    h.seedProfile(USER_C);
    const now = new Date("2026-11-28T10:00:00Z");

    // 1. Politics: start election, register candidate, cast vote, finalize -> President
    const politics1 = new PoliticsClanAnalyticsService(
      h.profileRepo,
      h.txRepo,
      h.clanRepo,
      { listTopPrestige: () => Promise.resolve([]) },
      h.deterministicRandom,
      h.db,
    );
    await politics1.inspectOrStartElection(GROUP_JID, USER_A, now);
    await politics1.registerCandidate(GROUP_JID, USER_A, "Anti Inflasi!", now);
    await politics1.castVote(GROUP_JID, USER_B, USER_A, now);
    await politics1.finalizeElection(GROUP_JID, true, now);
    await politics1.distributeBudget(GROUP_JID, USER_A, 10_000_000n, now);

    // 2. Lottery: buy 2 tickets
    const arena1 = new ArenaGiveawayShopService(
      h.profileRepo,
      h.txRepo,
      h.deterministicRandom,
      h.db,
    );
    await arena1.buyLotteryTicket(GROUP_JID, USER_A, 42);
    await arena1.buyLotteryTicket(GROUP_JID, USER_B, 77);

    // 3. Bounty: post bounty on USER_C
    const raid1 = new RaidFarmBuffBountyService(
      h.profileRepo,
      h.txRepo,
      h.deterministicRandom,
      h.db,
    );
    await raid1.postBounty(GROUP_JID, USER_A, USER_C, 15_000_000n, now.getTime());

    // 4. XP Event: activate 2x XP
    const econ1 = new GroupEconomyControlService(
      h.profileRepo,
      h.txRepo,
      h.tenantRepo,
      h.clanRepo,
      h.db,
    );
    await econ1.startXpEvent(GROUP_JID, USER_A, 60 * 60 * 1000, 2, now);

    // ---- SIMULASI RESTART BOT (instansiasi baru semua service!) ----
    clearGroupXpEventCacheForTests();

    const politics2 = new PoliticsClanAnalyticsService(
      h.profileRepo,
      h.txRepo,
      h.clanRepo,
      { listTopPrestige: () => Promise.resolve([]) },
      h.deterministicRandom,
      h.db,
    );
    const presAfterRestart = await politics2.getPresidentStatus(GROUP_JID, now);
    assert.ok(presAfterRestart.president);
    assert.equal(presAfterRestart.president.presidentJid, USER_A);
    assert.equal(presAfterRestart.president.slogan, "Anti Inflasi!");
    assert.equal(presAfterRestart.president.totalDistributed, 10_000_000n);
    assert.ok(presAfterRestart.budgetCooldownMs > 0);

    const arena2 = new ArenaGiveawayShopService(
      h.profileRepo,
      h.txRepo,
      h.deterministicRandom,
      h.db,
    );
    const lotteryAfterRestart = await arena2.loadLotteryOverview(GROUP_JID);
    assert.equal(lotteryAfterRestart.tickets.length, 2);
    assert.equal(lotteryAfterRestart.tickets[0]?.number, 42);
    assert.equal(lotteryAfterRestart.tickets[1]?.number, 77);
    assert.equal(lotteryAfterRestart.jackpotPool, 10_000_000n);

    const raid2 = new RaidFarmBuffBountyService(
      h.profileRepo,
      h.txRepo,
      h.deterministicRandom,
      h.db,
    );
    const bountiesAfterRestart = await raid2.loadBounties(GROUP_JID, now.getTime() + 1_000);
    assert.equal(bountiesAfterRestart.length, 1);
    assert.equal(bountiesAfterRestart[0]?.targetJid, USER_C);
    assert.equal(bountiesAfterRestart[0]?.amount, 15_000_000n);

    const econ2 = new GroupEconomyControlService(
      h.profileRepo,
      h.txRepo,
      h.tenantRepo,
      h.clanRepo,
      h.db,
    );
    const xpAfterRestart = await econ2.getXpEventStatus(GROUP_JID, now);
    assert.ok(xpAfterRestart);
    assert.equal(xpAfterRestart.multiplier, 2);
    assert.equal(getActiveGroupXpMultiplier(GROUP_JID, now.getTime()), 2);

    clearGroupXpEventCacheForTests();
  });
});

void describe("Prioritas 3: Pengayaan Sistem Pet (.petshop, .telurpet, .ekspedisipet, Kartu .profile & .flex)", () => {
  void it("Adopsi pet starter, gacha telur + kompensasi max, dan siklus ekspedisi pet berjalan atomik", async () => {
    clearGroupXpEventCacheForTests();
    const h = createSharedPersistenceHarness();
    h.seedProfile(USER_A, { level: 20, moneyBalance: 500_000_000n });
    const rpg = new RpgInfiniteService(h.profileRepo, h.txRepo, h.deterministicRandom, h.db);

    // 1. Adopsi langsung kucing
    const adopted = await rpg.adoptPet(GROUP_JID, USER_A, "kucing");
    assert.equal(adopted.pet, "kucing");
    assert.equal(adopted.pricePaid, 60_000_000n);

    // Tolak adopsi ulang kucing
    await assert.rejects(() => rpg.adoptPet(GROUP_JID, USER_A, "kucing"), /sudah memiliki pet/i);

    // Tolak adopsi langsung pet mitos (naga)
    await assert.rejects(() => rpg.adoptPet(GROUP_JID, USER_A, "naga"), /tidak dijual langsung/i);

    // 2. Tetaskan telur biasa -> deterministicRandom returns min (roll=1 => kucing), duplikat naik Lv.2!
    const hatched = await rpg.hatchPetEgg(GROUP_JID, USER_A, "biasa");
    assert.equal(hatched.pet, "kucing");
    assert.equal(hatched.outcome, "leveled_up");
    assert.equal(hatched.oldLevel, 1);
    assert.equal(hatched.newLevel, 2);

    // Tetaskan telur saat kucing sudah Lv.20 -> kompensasi item
    const profNow = h.profiles.get(USER_A);
    assert.ok(profNow);
    const maxState = withPetState(parseRpgState(profNow.rpgState), "kucing", {
      level: 20,
      exp: 0,
      hunger: 100,
    });
    profNow.rpgState = serializeRpgState(maxState);
    const comp = await rpg.hatchPetEgg(GROUP_JID, USER_A, "biasa");
    assert.equal(comp.outcome, "max_compensated");
    assert.equal(comp.bonusItems.ramuanpet, 3);
    assert.equal(comp.bonusItems.makananpet, 5);

    // 3. Ekspedisi Pet
    const t0 = new Date("2026-11-28T10:00:00Z");
    const started = await rpg.startPetExpedition(GROUP_JID, USER_A, "kucing", t0);
    assert.equal(started.pet, "kucing");
    assert.equal(started.hungerAfter, 80);

    // Klaim terlalu cepat ditolak
    await assert.rejects(
      () => rpg.claimPetExpedition(GROUP_JID, USER_A, new Date(t0.getTime() + 60_000)),
      /masih menjelajah/i,
    );

    // Klaim setelah 30 menit berhasil & memberi pakan + material + uang + XP
    const claimed = await rpg.claimPetExpedition(
      GROUP_JID,
      USER_A,
      new Date(t0.getTime() + PET_EXPEDITION_DURATION_MS + 1_000),
    );
    assert.equal(claimed.pet, "kucing");
    assert.ok((claimed.itemsFound.makananpet ?? 0) >= 1);
    assert.ok(claimed.moneyGained > 0n);
    assert.ok(claimed.xpGained > 0);
    assert.ok(claimed.petExpGained > 0);

    const statusAfter = await rpg.getPetExpeditionStatus(GROUP_JID, USER_A, t0);
    assert.equal(statusAfter.active, null);

    // 4. Featured pet helper memilih pet level tertinggi
    const stateAfter = parseRpgState(h.profiles.get(USER_A)?.rpgState);
    const featured = getFeaturedPet(stateAfter);
    assert.ok(featured);
    assert.equal(featured.id, "kucing");
    assert.equal(featured.level, 20);
  });

  void it("ProfileCardService dan EventBannerService merender Pet Andalan & Tema Kustom dengan valid", async () => {
    const profileCard = new ProfileCardService();
    const prof = buildMemberProfile({
      groupJid: GROUP_JID,
      userJid: USER_A,
      experience: 15_500,
      pointsBalance: 3500,
      limitBalance: 85,
      currentStreak: 12,
      totalGamesPlayed: 40,
      totalGamesWon: 28,
    });

    const profilePng = await profileCard.generateCard({
      view: { profile: prof, rank: "Grandmaster", createdAtWib: "2026-11-28" },
      label: "Sultan Minji",
      phone: "628111100001",
      role: "Admin Grup",
      avatarBuffer: null,
      themeId: "celestial",
      featuredPet: { label: "Naga", level: 12 },
      customTitle: "Kaisar Grup",
    });
    const meta1 = await sharp(profilePng).metadata();
    assert.equal(meta1.format, "png");
    assert.equal(meta1.width, 800);
    assert.equal(meta1.height, 450);

    const flexPng = await eventBannerService.renderSultanBlackCard({
      memberName: "Sultan Minji",
      customTitle: "Kaisar Grup",
      rank: "Grandmaster",
      level: 30,
      prestige: 3,
      netWorth: 2_500_000_000n,
      cashBalance: 500_000_000n,
      bankBalance: 1_000_000_000n,
      investAndAssetValue: 1_000_000_000n,
      wealthPosition: 1,
      avatarBuffer: null,
      themeId: "sakura",
      featuredPet: { label: "Phonix", level: 15 },
    });
    const meta2 = await sharp(flexPng).metadata();
    assert.equal(meta2.format, "png");
    assert.equal(meta2.width, 700);
    assert.equal(meta2.height, 420);
  });
});

void describe("Prioritas 4: Kontrol Inflasi (.ekonomigrup), Tema Profil (.temaprofil), & Double XP (.eventxp)", () => {
  void it("Toko Tema Profil memotong saldo atomik (money sink), auto-equip, dan bisa ganti tema", async () => {
    const h = createSharedPersistenceHarness();
    h.seedProfile(USER_A, { moneyBalance: 200_000_000n });
    const ctrl = new GroupEconomyControlService(
      h.profileRepo,
      h.txRepo,
      h.tenantRepo,
      h.clanRepo,
      h.db,
    );

    assert.equal(PROFILE_THEME_CATALOG.length, 7);
    const bought = await ctrl.buyProfileTheme(GROUP_JID, USER_A, "sakura");
    assert.equal(bought.pricePaid, 80_000_000n);
    assert.equal(bought.currentMoney, 120_000_000n);

    // Tolak beli ulang tema yang sudah dimiliki
    await assert.rejects(() => ctrl.buyProfileTheme(GROUP_JID, USER_A, "sakura"), /sudah memiliki/i);

    // Ganti kembali ke midnight (gratis bawaan), lalu pakai sakura lagi
    await ctrl.equipProfileTheme(GROUP_JID, USER_A, "midnight");
    const ov1 = await ctrl.getProfileThemesOverview(GROUP_JID, USER_A);
    assert.equal(ov1.activeTheme, "midnight");
    assert.ok(ov1.ownedThemes.includes("sakura"));

    await ctrl.equipProfileTheme(GROUP_JID, USER_A, "sakura");
    const ov2 = await ctrl.getProfileThemesOverview(GROUP_JID, USER_A);
    assert.equal(ov2.activeTheme, "sakura");
  });

  void it("Dashboard .ekonomigrup menghitung M2, konsentrasi Top 3, dan arus 24j tanpa bias transfer ATM", async () => {
    const h = createSharedPersistenceHarness();
    h.seedProfile(USER_A, { moneyBalance: 800_000_000n, bankBalance: 200_000_000n });
    h.seedProfile(USER_B, { moneyBalance: 100_000_000n, bankBalance: 0n });
    h.ledger.push(
      { asset: MemberTransactionAsset.MONEY, type: MemberTransactionType.RPG_EARN, amount: 50_000_000n },
      { asset: MemberTransactionAsset.MONEY, type: MemberTransactionType.RPG_LOSS, amount: -25_000_000n },
      // Transfer internal ATM tidak dihitung sebagai inflow/outflow baru
      { asset: MemberTransactionAsset.MONEY, type: MemberTransactionType.BANK_DEPOSIT, amount: -100_000_000n },
    );

    const ctrl = new GroupEconomyControlService(
      h.profileRepo,
      h.txRepo,
      h.tenantRepo,
      h.clanRepo,
      h.db,
    );
    const report = await ctrl.getGroupEconomyReport(GROUP_JID);
    assert.equal(report.totalMembers, 2);
    assert.equal(report.totalMoneySupply, 1_100_000_000n);
    assert.equal(report.inflow24h, 50_000_000n);
    assert.equal(report.outflow24h, 25_000_000n);
    assert.equal(report.netFlow24h, 25_000_000n);
    assert.equal(report.txCount24h, 2);
    assert.equal(report.top3Holders[0]?.userJid, USER_A);
  });

  void it("Happy Hour .eventxp menggandakan XP nyata di MemberEconomyService.creditXp & sync dari TenantGroup", async () => {
    clearGroupXpEventCacheForTests();
    const h = createSharedPersistenceHarness();
    h.seedProfile(USER_A, { experience: 1000 });
    const ctrl = new GroupEconomyControlService(
      h.profileRepo,
      h.txRepo,
      h.tenantRepo,
      h.clanRepo,
      h.db,
    );
    const economy = new MemberEconomyService(h.profileRepo, h.txRepo, h.db, {
      notifyLevelUp: () => Promise.resolve(),
    });

    assert.equal(parseXpEventDurationMs("30m"), 30 * 60 * 1000);
    assert.equal(parseXpEventDurationMs("2j"), 2 * 60 * 60 * 1000);
    assert.equal(parseXpEventMultiplier("3x"), 3);

    const now = new Date();
    await ctrl.startXpEvent(GROUP_JID, USER_A, 60 * 60 * 1000, 2, now);

    // Verifikasi sync cache dari tenantGroup.groupEventState
    clearGroupXpEventCacheForTests();
    syncGroupXpEventFromTenantState(GROUP_JID, h.getTenant().groupEventState, now.getTime());
    assert.equal(getActiveGroupXpMultiplier(GROUP_JID, now.getTime()), 2);

    // creditXp 100 -> jadi +200 XP!
    const updated = await economy.creditXp({
      groupJid: GROUP_JID,
      userJid: USER_A,
      amount: 100,
      type: "GAME_REWARD",
    });
    assert.equal(updated.experience, 1200);

    // Stop event -> XP kembali 1x
    await ctrl.stopXpEvent(GROUP_JID);
    const updated2 = await economy.creditXp({
      groupJid: GROUP_JID,
      userJid: USER_A,
      amount: 100,
      type: "GAME_REWARD",
    });
    assert.equal(updated2.experience, 1300);

    clearGroupXpEventCacheForTests();
  });

  void it("Otorisasi .ekonomigrup dan .eventxp mengizinkan Admin Grup WA, Tenant Admin, Owner, dan Super Owner", async () => {
    const waAdminSocket = {
      groupMetadata: () =>
        Promise.resolve({
          id: GROUP_JID,
          subject: "Grup Uji",
          participants: [
            { id: USER_A, admin: "admin" },
            { id: USER_B, admin: null },
          ],
        }),
    };

    const waAdminCtx = buildCommandContext({
      socket: waAdminSocket as never,
      chatJid: GROUP_JID,
      senderJid: USER_A,
      senderUserJid: USER_A,
      role: "MEMBER",
    });
    assert.equal(await canManageGroupEconomyControl(waAdminCtx), true);

    const regularMemberCtx = buildCommandContext({
      socket: waAdminSocket as never,
      chatJid: GROUP_JID,
      senderJid: USER_B,
      senderUserJid: USER_B,
      role: "MEMBER",
    });
    assert.equal(await canManageGroupEconomyControl(regularMemberCtx), false);

    const tenantAdminCtx = buildCommandContext({
      chatJid: GROUP_JID,
      senderJid: USER_B,
      senderUserJid: USER_B,
      role: "TENANT_ADMIN",
    });
    assert.equal(await canManageGroupEconomyControl(tenantAdminCtx), true);
  });

  void it("Command baru terdaftar di router, menu penuh tetap utuh, dan ditemukan lewat .carifitur", async () => {
    for (const cmd of [
      "petshop",
      "tokopet",
      "telurpet",
      "ekspedisipet",
      "ekonomigrup",
      "inflasi",
      "temaprofil",
      "tema",
      "eventxp",
      "doublexp",
    ]) {
      assert.equal(commandRouter.has(cmd), true, `Command .${cmd} harus terdaftar di router`);
    }

    const catalog = menuService.getSearchableCatalog();
    assert.ok(catalog.some((e) => e.primaryCommand === "petshop"));
    assert.ok(catalog.some((e) => e.primaryCommand === "telurpet"));
    assert.ok(catalog.some((e) => e.primaryCommand === "ekspedisipet"));
    assert.ok(catalog.some((e) => e.primaryCommand === "temaprofil"));
    assert.ok(catalog.some((e) => e.primaryCommand === "ekonomigrup"));
    assert.ok(catalog.some((e) => e.primaryCommand === "eventxp"));

    const searchPet = featureSearchService.search("telur", commandRouter.listCommandEntries());
    assert.ok(searchPet.matches.some((m) => m.primaryCommand === "telurpet"));

    const searchXp = featureSearchService.search("doublexp", commandRouter.listCommandEntries());
    assert.ok(searchXp.matches.some((m) => m.primaryCommand === "eventxp"));

    // Pastikan .menu default tetap menampilkan banyak fitur sekaligus (Prioritas 2 tidak diubah!)
    const offlineMenuService = new MenuService({
      findByGroupJid: () => Promise.resolve(null),
    } as never);
    const fullMenu = await offlineMenuService.buildMenu(
      buildCommandContext({
        isGroup: true,
        args: [],
        tenantGroup: buildTenantGroup({ groupJid: GROUP_JID }),
      }),
    );
    assert.ok(fullMenu.includes(".petshop"));
    assert.ok(fullMenu.includes(".temaprofil"));
    assert.ok(fullMenu.includes(".ekonomigrup"));
    assert.ok(fullMenu.includes(".eventxp"));
    assert.ok(fullMenu.includes("*── [ RPG INFINITE ] ──*"));
    assert.ok(fullMenu.includes("*── [ DOWNLOADER ] ──*"));
  });
});
