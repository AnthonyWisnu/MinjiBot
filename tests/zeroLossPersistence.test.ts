import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MemberTransactionAsset,
  MemberTransactionType,
  type GroupClan,
  type GroupMemberProfile,
  type TenantGroup,
} from "@prisma/client";

import { OpenRouterService } from "../src/services/ai/openRouter.service";
import { SocialEconomyService } from "../src/services/fun/socialEconomy.service";
import { GroupToolsService } from "../src/services/group/groupTools.service";
import {
  ArenaGiveawayShopService,
  DANA_KAGET_TTL_MS,
} from "../src/services/rpg/arenaGiveawayShop.service";
import { PoliticsClanAnalyticsService } from "../src/services/rpg/politicsClanAnalytics.service";
import { createDefaultRpgState, serializeRpgState } from "../src/services/rpg/rpgState";
import { buildMemberProfile, buildTenantGroup } from "./helpers/factories";

const GROUP_JID = "120363888777666555@g.us";
const USER_A = "628222200001@s.whatsapp.net";
const USER_B = "628222200002@s.whatsapp.net";
const USER_C = "628222200003@s.whatsapp.net";

function createZeroLossHarness() {
  const profiles = new Map<string, GroupMemberProfile>();
  const clans = new Map<string, GroupClan>();
  const idempotencyKeys = new Set<string>();
  const ledger: {
    asset: MemberTransactionAsset;
    type: MemberTransactionType;
    amount: bigint;
    idempotencyKey?: string;
    note?: string;
  }[] = [];

  let tenant: TenantGroup = buildTenantGroup({
    groupJid: GROUP_JID,
    treasuryBalance: 5_000_000_000n,
    groupEventState: null,
  });

  const seedProfile = (
    userJid: string,
    overrides: Partial<GroupMemberProfile> = {},
  ): GroupMemberProfile => {
    const p = buildMemberProfile({
      id: `prof-${userJid}`,
      groupJid: GROUP_JID,
      userJid,
      level: 15,
      experience: 5_000,
      pointsBalance: 500,
      moneyBalance: 100_000_000n,
      bankBalance: 0n,
      totalMoneyEarned: 100_000_000n,
      rpgState: serializeRpgState(createDefaultRpgState()),
      ...overrides,
    });
    profiles.set(userJid, p);
    return p;
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
    findMany: () =>
      Promise.resolve(
        tenant.groupEventState !== null
          ? [{ groupJid: tenant.groupJid, groupEventState: tenant.groupEventState }]
          : [],
      ),
    update: (args: { where: { groupJid: string }; data: Record<string, unknown> }) => {
      if (args.where.groupJid !== GROUP_JID) {
        return Promise.reject(new Error("Tenant not found"));
      }
      const next = { ...tenant };
      if ("groupEventState" in args.data) {
        next.groupEventState = args.data.groupEventState as TenantGroup["groupEventState"];
      }
      tenant = next;
      return Promise.resolve({ ...tenant });
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
        const ptsCond = args.where.pointsBalance as { gte?: number } | undefined;
        if (ptsCond?.gte !== undefined && found.pointsBalance < ptsCond.gte) {
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
    findOrCreate: (groupJid: string, userJid: string) => {
      const existing = profiles.get(userJid);
      if (existing) return Promise.resolve(existing);
      return Promise.resolve(seedProfile(userJid, { groupJid }));
    },
    findByGroupAndUser: (_g: string, u: string) => Promise.resolve(profiles.get(u) ?? null),
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
      idempotencyKey?: string;
      note?: string;
    }) => {
      if (data.idempotencyKey) {
        idempotencyKeys.add(data.idempotencyKey);
      }
      ledger.push({
        asset: data.asset,
        type: data.type,
        amount: typeof data.amount === "bigint" ? data.amount : BigInt(data.amount),
        idempotencyKey: data.idempotencyKey,
        note: data.note,
      });
      return Promise.resolve({});
    },
    findByIdempotencyKey: (key: string) =>
      Promise.resolve(idempotencyKeys.has(key) ? { idempotencyKey: key } : null),
    listByProfile: () => Promise.resolve([]),
  };

  const clanRepo = {
    findBySlug: (_g: string, slug: string) =>
      Promise.resolve(Array.from(clans.values()).find((c) => c.slug === slug) ?? null),
    listByGroup: () => Promise.resolve(Array.from(clans.values())),
    countByGroup: () => Promise.resolve(clans.size),
    findByMember: (_g: string, u: string) =>
      Promise.resolve(
        Array.from(clans.values()).find(
          (c) => Array.isArray(c.memberJids) && c.memberJids.includes(u),
        ) ?? null,
      ),
    create: (data: {
      groupJid: string;
      name: string;
      slug: string;
      leaderJid: string;
      memberJids: string[];
    }) => {
      const c: GroupClan = {
        id: `clan-${data.slug}`,
        groupJid: data.groupJid,
        name: data.name,
        slug: data.slug,
        leaderJid: data.leaderJid,
        memberJids: data.memberJids,
        treasuryBalance: 50_000_000n,
        level: 1,
        warWins: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      clans.set(c.id, c);
      return Promise.resolve(c);
    },
    update: (
      id: string,
      data: {
        leaderJid?: string;
        memberJids?: string[];
        treasuryBalance?: bigint | { increment?: bigint; decrement?: bigint };
        level?: number | { increment: number };
        warWins?: number | { increment: number };
      },
    ) => {
      const existing = clans.get(id);
      if (!existing) return Promise.reject(new Error("Clan not found"));
      const next = { ...existing };
      if (data.leaderJid !== undefined) next.leaderJid = data.leaderJid;
      if (data.memberJids !== undefined) next.memberJids = data.memberJids;
      if (typeof data.treasuryBalance === "bigint") next.treasuryBalance = data.treasuryBalance;
      else if (data.treasuryBalance) {
        if (data.treasuryBalance.increment !== undefined) {
          next.treasuryBalance += data.treasuryBalance.increment;
        }
        if (data.treasuryBalance.decrement !== undefined) {
          next.treasuryBalance -= data.treasuryBalance.decrement;
        }
      }
      if (typeof data.warWins === "number") next.warWins = data.warWins;
      else if (data.warWins) next.warWins += data.warWins.increment;
      clans.set(id, next);
      return Promise.resolve(next);
    },
    deleteById: (id: string) => {
      clans.delete(id);
      return Promise.resolve();
    },
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
    tenantGroupMock,
    db,
    profileRepo,
    txRepo,
    clanRepo,
    deterministicRandom,
  };
}

void describe("Zero-Loss Persistence Hardening (Anti Hilang Data Saat Restart)", () => {
  void it("Dana Kaget & Poin Kaget bertahan setelah restart, bisa diklaim, dan auto-refund sisa secara idempoten saat kedaluwarsa", async () => {
    const h = createZeroLossHarness();
    h.seedProfile(USER_A, { moneyBalance: 100_000_000n, pointsBalance: 500 });
    h.seedProfile(USER_B, { moneyBalance: 10_000_000n, pointsBalance: 100 });
    h.seedProfile(USER_C, { moneyBalance: 10_000_000n, pointsBalance: 100 });

    const t0 = 1_795_830_000_000;
    const arena1 = new ArenaGiveawayShopService(h.profileRepo, h.txRepo, h.deterministicRandom, h.db);

    // USER_A buat Dana Kaget 10jt untuk 3 orang & Poin Kaget 300 poin untuk 3 orang
    await arena1.createDanaKaget(GROUP_JID, USER_A, 10_000_000n, 3, t0);
    await arena1.createPoinKaget(GROUP_JID, USER_A, 300, 3, t0);

    assert.equal(h.profiles.get(USER_A)?.moneyBalance, 90_000_000n);
    assert.equal(h.profiles.get(USER_A)?.pointsBalance, 200);

    // ---- SIMULASI RESTART BOT ----
    const arena2 = new ArenaGiveawayShopService(h.profileRepo, h.txRepo, h.deterministicRandom, h.db);

    // USER_B klaim setelah restart -> tetap bisa ambil sisa drop yang tersimpan di PostgreSQL!
    const claimedDana = await arena2.claimDanaKaget(GROUP_JID, USER_B, t0 + 60_000);
    const claimedPoin = await arena2.claimPoinKaget(GROUP_JID, USER_B, t0 + 60_000);
    assert.equal(claimedDana.remainingQuota, 2);
    assert.equal(claimedPoin.remainingQuota, 2);
    assert.ok(claimedDana.amountWon > 0n);
    assert.ok(claimedPoin.pointsWon > 0);
    const expectedMoneyRefund = claimedDana.remainingAmount;
    const expectedPointsRefund = claimedPoin.remainingPoints;
    assert.ok(expectedMoneyRefund > 0n);
    assert.ok(expectedPointsRefund > 0);

    // ---- SIMULASI RESTART LAGI SETELAH 30 MENIT (EXPIRED) ----
    const arena3 = new ArenaGiveawayShopService(h.profileRepo, h.txRepo, h.deterministicRandom, h.db);
    const expiredAt = t0 + DANA_KAGET_TTL_MS + 1_000;

    // Sweeper startup/periodik otomatis mengembalikan sisa ke pembuat!
    const sweep1 = await arena3.reconcileExpiredDropsAcrossGroups(expiredAt);
    assert.equal(sweep1.groupsChecked, 1);
    assert.equal(sweep1.refundedDrops, 2);
    assert.equal(h.profiles.get(USER_A)?.moneyBalance, 90_000_000n + expectedMoneyRefund);
    assert.equal(h.profiles.get(USER_A)?.pointsBalance, 200 + expectedPointsRefund);

    // Pastikan total uang konservasi 100% (tidak ada uang hilang):
    // USER_A awal 100jt + USER_B awal 10jt = 110jt
    const totalMoneyAfter =
      (h.profiles.get(USER_A)?.moneyBalance ?? 0n) + (h.profiles.get(USER_B)?.moneyBalance ?? 0n);
    assert.equal(totalMoneyAfter, 110_000_000n);
    const totalPointsAfter =
      (h.profiles.get(USER_A)?.pointsBalance ?? 0) + (h.profiles.get(USER_B)?.pointsBalance ?? 0);
    assert.equal(totalPointsAfter, 600);

    // Panggil sweeper ulang (atau jika crash sebelum hapus state) -> IDEMPOTEN, tidak double refund!
    const sweep2 = await arena3.reconcileExpiredDropsAcrossGroups(expiredAt + 10_000);
    assert.equal(sweep2.refundedDrops, 0);
    assert.equal(h.profiles.get(USER_A)?.moneyBalance, 90_000_000n + expectedMoneyRefund);
    assert.equal(h.profiles.get(USER_A)?.pointsBalance, 200 + expectedPointsRefund);
  });

  void it("Absen (.mulaiabsen/.absen) dan Voting (.mulaivote/.upvote) bertahan setelah restart", async () => {
    const h = createZeroLossHarness();
    const now = new Date("2026-11-28T09:00:00Z");

    const tools1 = new GroupToolsService(undefined, h.tenantGroupMock);
    await tools1.startAttendancePersisted(GROUP_JID, USER_A, "Rapat Malam", now.getTime());
    await tools1.markAttendancePersisted(GROUP_JID, USER_A, now);
    await tools1.startVotePersisted(GROUP_JID, USER_A, "Nobar Akhir Pekan?", now.getTime());
    await tools1.castVotePersisted(GROUP_JID, USER_A, "up", now.getTime());

    // ---- SIMULASI RESTART ----
    const tools2 = new GroupToolsService(undefined, h.tenantGroupMock);
    const markB = await tools2.markAttendancePersisted(GROUP_JID, USER_B, now);
    assert.equal(markB.alreadyPresent, false);
    assert.equal(markB.session.title, "Rapat Malam");
    assert.equal(markB.session.entries.length, 2);

    const voteAfter = await tools2.castVotePersisted(GROUP_JID, USER_B, "down", now.getTime() + 1_000);
    assert.equal(voteAfter.topic, "Nobar Akhir Pekan?");
    assert.equal(voteAfter.upvoters.size, 1);
    assert.equal(voteAfter.downvoters.size, 1);
  });

  void it("Sesi Lelang (.lelang + .bid) bertahan setelah restart sampai diselesaikan (.lelang selesai)", async () => {
    const h = createZeroLossHarness();
    h.seedProfile(USER_A, { moneyBalance: 50_000_000n });
    h.seedProfile(USER_B, { moneyBalance: 50_000_000n });
    const t0 = 1_795_830_000_000;

    const social1 = new SocialEconomyService(h.profileRepo, h.txRepo, h.clanRepo, h.db);
    await social1.openAuctionPersisted(GROUP_JID, USER_A, "Pedang Naga Emas", 5_000_000n, t0);
    await social1.placeBid(GROUP_JID, USER_B, 10_000_000n, t0 + 10_000);

    // ---- SIMULASI RESTART ----
    const social2 = new SocialEconomyService(h.profileRepo, h.txRepo, h.clanRepo, h.db);
    const loaded = await social2.loadAuction(GROUP_JID, t0 + 20_000);
    assert.ok(loaded);
    assert.equal(loaded.itemName, "Pedang Naga Emas");
    assert.equal(loaded.currentBid, 10_000_000n);
    assert.equal(loaded.highestBidderJid, USER_B);

    const closed = await social2.closeAuction(GROUP_JID, USER_A, false, t0 + 30_000);
    assert.equal(closed.settled, true);
    assert.equal(closed.session.highestBidderJid, USER_B);
    assert.equal(closed.session.currentBid, 10_000_000n);
    assert.equal(h.profiles.get(USER_A)?.moneyBalance, 60_000_000n);
    assert.equal(h.profiles.get(USER_B)?.moneyBalance, 40_000_000n);

    // Setelah selesai, tidak muncul lagi pada restart berikutnya
    const social3 = new SocialEconomyService(h.profileRepo, h.txRepo, h.clanRepo, h.db);
    assert.equal(await social3.loadAuction(GROUP_JID, t0 + 40_000), null);
  });

  void it("Cooldown Perang Geng (.gengwar 30 menit) tetap ditegakkan setelah restart", async () => {
    const h = createZeroLossHarness();
    h.seedProfile(USER_A);
    h.seedProfile(USER_B);
    await h.clanRepo.create({
      groupJid: GROUP_JID,
      name: "Elang",
      slug: "elang",
      leaderJid: USER_A,
      memberJids: [USER_A],
    });
    await h.clanRepo.create({
      groupJid: GROUP_JID,
      name: "Harimau",
      slug: "harimau",
      leaderJid: USER_B,
      memberJids: [USER_B],
    });

    const t0 = new Date("2026-11-28T10:00:00Z");
    const pol1 = new PoliticsClanAnalyticsService(
      h.profileRepo,
      h.txRepo,
      h.clanRepo,
      { listTopPrestige: () => Promise.resolve([]) },
      h.deterministicRandom,
      h.db,
    );
    await pol1.startClanWar(GROUP_JID, USER_A, "Harimau", t0);

    // ---- SIMULASI RESTART ----
    const pol2 = new PoliticsClanAnalyticsService(
      h.profileRepo,
      h.txRepo,
      h.clanRepo,
      { listTopPrestige: () => Promise.resolve([]) },
      h.deterministicRandom,
      h.db,
    );
    await assert.rejects(
      () => pol2.startClanWar(GROUP_JID, USER_A, "Harimau", new Date(t0.getTime() + 5 * 60_000)),
      /memulihkan stamina/i,
    );
  });

  void it("Kuota harian AI per grup (OpenRouterService) bertahan setelah restart dan tersinkronisasi dari TenantGroup", async () => {
    const h = createZeroLossHarness();
    const fakeFetch: typeof fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Halo dari Minji AI!" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const now = new Date("2026-11-28T10:00:00Z");
    const ai1 = new OpenRouterService({
      apiKey: "test-key",
      model: "test/model",
      dailyQuotaPerGroup: 2,
      fetchFn: fakeFetch,
      tenantClient: h.tenantGroupMock,
    });

    const res1 = await ai1.ask({
      groupJid: GROUP_JID,
      userJid: USER_A,
      prompt: "Halo",
      persona: "assistant",
      bypassCooldown: true,
      now,
    });
    assert.equal(res1.remainingGroupQuota, 1);

    // ---- SIMULASI RESTART (instance baru) ----
    const ai2 = new OpenRouterService({
      apiKey: "test-key",
      model: "test/model",
      dailyQuotaPerGroup: 2,
      fetchFn: fakeFetch,
      tenantClient: h.tenantGroupMock,
    });

    // Sync via tenantGroup.groupEventState (seperti di messageHandler.ts)
    ai2.syncDailyUsageFromTenantState(GROUP_JID, h.getTenant().groupEventState, now);
    assert.equal(ai2.getRemainingGroupQuota(GROUP_JID, now), 1);

    const res2 = await ai2.ask({
      groupJid: GROUP_JID,
      userJid: USER_B,
      prompt: "Tanya kedua",
      persona: "assistant",
      bypassCooldown: true,
      now,
    });
    assert.equal(res2.remainingGroupQuota, 0);

    // Restart lagi -> kuota sudah 2/2 -> ditolak meski RAM kosong!
    const ai3 = new OpenRouterService({
      apiKey: "test-key",
      model: "test/model",
      dailyQuotaPerGroup: 2,
      fetchFn: fakeFetch,
      tenantClient: h.tenantGroupMock,
    });
    await assert.rejects(
      () =>
        ai3.ask({
          groupJid: GROUP_JID,
          userJid: USER_C,
          prompt: "Tanya ketiga",
          persona: "assistant",
          bypassCooldown: true,
          now,
        }),
      /Kuota AI harian grup ini sudah habis/i,
    );
  });
});
