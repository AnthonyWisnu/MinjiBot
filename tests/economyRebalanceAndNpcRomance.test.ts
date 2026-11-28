import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GroupMemberProfile, TenantGroup } from "@prisma/client";

import { commandRouter } from "../src/commands/index";
import { CoupleService } from "../src/services/fun/couple.service";
import {
  CURATED_GAME_CHARACTERS,
  findCuratedGameCharacter,
} from "../src/services/fun/npcCharacterCatalog";
import {
  NPC_COMPAT_THRESHOLD,
  NPC_DATE_COOLDOWN_MS,
  NPC_MARRY_COST,
  NPC_PROPOSE_COST,
  NPC_ROLL_COOLDOWN_MS,
  NPC_SLOT_UPGRADE_COSTS,
  NpcRomanceService,
} from "../src/services/fun/npcRomance.service";
import { SocialEconomyService } from "../src/services/fun/socialEconomy.service";
import { featureSearchService } from "../src/services/menu/featureSearch.service";
import { EXCHANGE_MONEY_PER_POINT } from "../src/services/member/walletBank.service";
import { POINT_SHOP_CRATE_PRICES } from "../src/services/rpg/arenaGiveawayShop.service";
import { CRATE_LOOT_SPECS, SHOP_ITEM_MAP } from "../src/services/rpg/rpgCatalog";
import {
  DEPOSITO_DAILY_INTEREST_PERCENT,
  DEPOSITO_MAX_PRINCIPAL,
  PROPERTY_CATALOG,
} from "../src/services/rpg/rpgExpansionCatalog";
import { RpgExpansionService } from "../src/services/rpg/rpgExpansion.service";
import {
  MAX_DAILY_SHOP_CRATE_BUY,
  RpgInfiniteService,
} from "../src/services/rpg/rpgInfinite.service";
import {
  createDefaultRpgState,
  getPrimaryNpcPartner,
  parseRpgState,
  serializeRpgState,
} from "../src/services/rpg/rpgState";
import { computeLevelMoneyMultiplier } from "../src/utils/currency";
import { buildMemberProfile, buildTenantGroup } from "./helpers/factories";

const GROUP_JID = "120363777111222333@g.us";
const USER_A = "628333300001@s.whatsapp.net";
const USER_B = "628333300002@s.whatsapp.net";

function createTestHarness() {
  const profiles = new Map<string, GroupMemberProfile>();
  let tenant: TenantGroup = buildTenantGroup({
    groupJid: GROUP_JID,
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
      level: 50,
      experience: 50_000,
      moneyBalance: 10_000_000_000n,
      bankBalance: 0n,
      totalMoneyEarned: 10_000_000_000n,
      rpgState: serializeRpgState(createDefaultRpgState()),
      ...overrides,
    });
    profiles.set(userJid, p);
    return p;
  };

  const applyData = (target: GroupMemberProfile, data: Record<string, unknown>): GroupMemberProfile => {
    const next = { ...target };
    for (const k of ["moneyBalance", "bankBalance", "totalMoneyEarned"] as const) {
      const val = data[k] as { increment?: bigint; decrement?: bigint } | bigint | undefined;
      if (typeof val === "bigint") next[k] = val;
      else if (val && typeof val === "object") {
        if (val.increment !== undefined) next[k] += val.increment;
        if (val.decrement !== undefined) next[k] -= val.decrement;
      }
    }
    if (typeof data.experience === "number") next.experience = data.experience;
    else if (data.experience && typeof data.experience === "object") {
      const op = data.experience as { increment?: number };
      if (op.increment !== undefined) next.experience += op.increment;
    }
    if ("partnerJid" in data) next.partnerJid = data.partnerJid as string | null;
    if ("partnerSince" in data) next.partnerSince = data.partnerSince as Date | null;
    if ("rpgState" in data) next.rpgState = data.rpgState as GroupMemberProfile["rpgState"];
    profiles.set(next.userJid, next);
    return next;
  };

  const tenantGroupMock = {
    findUnique: (args: { where: { groupJid: string } }) =>
      Promise.resolve(args.where.groupJid === GROUP_JID ? { ...tenant } : null),
    update: (args: { where: { groupJid: string }; data: Record<string, unknown> }) => {
      if ("groupEventState" in args.data) {
        tenant = {
          ...tenant,
          groupEventState: args.data.groupEventState as TenantGroup["groupEventState"],
        };
      }
      return Promise.resolve({ ...tenant });
    },
  };

  const tx = {
    groupMemberProfile: {
      update: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const found = Array.from(profiles.values()).find((p) => p.id === args.where.id);
        if (!found) return Promise.reject(new Error("Profile not found"));
        return Promise.resolve(applyData(found, args.data));
      },
      updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const found = Array.from(profiles.values()).find((p) => p.id === args.where.id);
        if (!found) return Promise.resolve({ count: 0 });
        const moneyCond = args.where.moneyBalance as { gte?: bigint } | undefined;
        if (moneyCond?.gte !== undefined && found.moneyBalance < moneyCond.gte) {
          return Promise.resolve({ count: 0 });
        }
        applyData(found, args.data);
        return Promise.resolve({ count: 1 });
      },
      findUniqueOrThrow: (args: { where: Record<string, unknown> }) => {
        const found = Array.from(profiles.values()).find((p) => p.id === args.where.id);
        if (!found) return Promise.reject(new Error("Profile not found"));
        return Promise.resolve(found);
      },
    },
  };

  const db = {
    $transaction: <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
    tenantGroup: tenantGroupMock,
  };

  const profileRepo = {
    findOrCreate: (groupJid: string, userJid: string) => {
      const existing = profiles.get(userJid);
      if (existing) return Promise.resolve({ ...existing });
      return Promise.resolve({ ...seedProfile(userJid, { groupJid }) });
    },
    findByGroupAndUser: (_g: string, userJid: string) => {
      const existing = profiles.get(userJid);
      return Promise.resolve(existing ? { ...existing } : null);
    },
  };

  const txRepo = {
    create: () => Promise.resolve({}),
  };

  return { profiles, seedProfile, db, profileRepo, txRepo, getTenant: () => tenant };
}

void describe("Rebalance Ekonomi Anti-Exploit & Anti-Spam Crate", () => {
  void it("Pengali level dibatasi maks 3.0x (Lv.1=1x, Lv.21=2x, Lv.41+=3x)", () => {
    assert.equal(computeLevelMoneyMultiplier(1), 1);
    assert.equal(computeLevelMoneyMultiplier(21), 2);
    assert.equal(computeLevelMoneyMultiplier(41), 3);
    assert.equal(computeLevelMoneyMultiplier(99), 3);
  });

  void it("Semua Crate mustahil jadi mesin cetak uang: bahkan di Lv.99 & MAX roll, uang + nilai jual item < harga beli", async () => {
    const h = createTestHarness();
    h.seedProfile(USER_A, { level: 99, moneyBalance: 50_000_000_000n });

    // Random selalu mengembalikan nilai MAKSIMUM (skenario terburuk exploit)
    const maxRollRandom = {
      intBetween: (_min: number, max: number) => max,
      chance: () => true,
    };
    const rpg = new RpgInfiniteService(h.profileRepo, h.txRepo, maxRollRandom, h.db);

    for (const crateKey of ["common", "uncommon", "mythic", "legendary"] as const) {
      const shopSpec = SHOP_ITEM_MAP.get(crateKey);
      const lootSpec = CRATE_LOOT_SPECS[crateKey];
      assert.ok(shopSpec?.buyPrice);

      // Verifikasi matematis max roll
      let maxItemSellValue = 0n;
      for (const item of lootSpec.itemPool) {
        const itemSpec = SHOP_ITEM_MAP.get(item.id);
        const val = (itemSpec?.sellPrice ?? 0n) * BigInt(item.max);
        if (val > maxItemSellValue) maxItemSellValue = val;
      }
      assert.ok(
        BigInt(lootSpec.maxMoney) + maxItemSellValue < shopSpec.buyPrice,
        `${crateKey} max cash + max item sell harus lebih kecil dari buyPrice`,
      );

      // Verifikasi langsung via shopBuy + openCrate pada Lv.99
      const buy = await rpg.shopBuy(GROUP_JID, USER_A, crateKey, 1, new Date("2026-11-28T05:00:00Z"));
      const opened = await rpg.openCrate(GROUP_JID, USER_A, crateKey, 1);
      assert.ok(
        opened.moneyGained < buy.totalMoney,
        `${crateKey} uang hasil buka (${String(opened.moneyGained)}) harus < harga beli (${String(buy.totalMoney)})`,
      );
      assert.equal(opened.moneyGained, BigInt(lootSpec.maxMoney));
    }

    // Verifikasi tidak ada arbitrase lewat .tukar -> .belicrate
    for (const crateKey of ["common", "uncommon", "mythic"] as const) {
      const shopPrice = SHOP_ITEM_MAP.get(crateKey)?.buyPrice ?? 0n;
      const pointShopEquivalent = BigInt(POINT_SHOP_CRATE_PRICES[crateKey]) * EXCHANGE_MONEY_PER_POINT;
      assert.ok(pointShopEquivalent >= shopPrice);
    }
  });

  void it("Kuota beli peti harian di toko membatasi spam sultan (maks 10 peti/hari WIB)", async () => {
    const h = createTestHarness();
    h.seedProfile(USER_A, { moneyBalance: 50_000_000_000n });
    const rpg = new RpgInfiniteService(
      h.profileRepo,
      h.txRepo,
      { intBetween: (min) => min, chance: () => false },
      h.db,
    );

    const day1 = new Date("2026-11-28T05:00:00Z");
    await rpg.shopBuy(GROUP_JID, USER_A, "common", MAX_DAILY_SHOP_CRATE_BUY, day1);
    await assert.rejects(
      () => rpg.shopBuy(GROUP_JID, USER_A, "common", 1, day1),
      /Batas pembelian peti di toko hari ini sudah habis/i,
    );

    // Besok (hari WIB baru) kuota reset otomatis
    const day2 = new Date("2026-11-29T05:00:00Z");
    const boughtNextDay = await rpg.shopBuy(GROUP_JID, USER_A, "common", 2, day2);
    assert.equal(boughtNextDay.quantity, 2);
  });

  void it("Properti memiliki ROI sehat (>= 72 jam) dan Deposito dibatasi 2%/hari + maks pokok Rp 50 Miliar", async () => {
    for (const prop of PROPERTY_CATALOG) {
      const roiHours = Number(prop.price / prop.incomePerHour);
      assert.ok(roiHours >= 72, `ROI properti ${prop.id} (${String(roiHours)}j) harus >= 72 jam`);
    }

    assert.equal(DEPOSITO_DAILY_INTEREST_PERCENT, 2);
    const h = createTestHarness();
    h.seedProfile(USER_A, { moneyBalance: 100_000_000_000n });
    const exp = new RpgExpansionService(
      h.profileRepo as never,
      h.txRepo as never,
      {} as never,
      {} as never,
      h.db as never,
    );
    await assert.rejects(
      () => exp.openDeposito(GROUP_JID, USER_A, DEPOSITO_MAX_PRINCIPAL + 1n),
      /Maksimal pokok deposito/i,
    );
    const depAll = await exp.openDeposito(GROUP_JID, USER_A, "all");
    assert.equal(depAll.principal, DEPOSITO_MAX_PRINCIPAL);
  });
});

void describe("Sistem Kecocokan, Pacaran & Nikah Karakter Anime/Game (NPC)", () => {
  void it("Katalog Game kurasi bekerja & roll gacha memakai cooldown + klaim eksklusif + harem slot + nikah", async () => {
    const h = createTestHarness();
    h.seedProfile(USER_A, { moneyBalance: 5_000_000_000n });
    h.seedProfile(USER_B, { moneyBalance: 5_000_000_000n });

    assert.ok(CURATED_GAME_CHARACTERS.length >= 35);
    assert.equal(findCuratedGameCharacter("raiden")?.key, "game:raiden-shogun");

    const mockLookup = {
      searchAniListCharacter: (q: string) =>
        Promise.resolve({
          id: q.toLowerCase().includes("frieren") ? 176754 : 999001,
          nameFull: q.toLowerCase().includes("frieren") ? "Frieren" : q,
          nameNative: null,
          gender: "Female",
          favourites: 45000,
          appearances: ["Sousou no Frieren"],
          description: "Penyihir elf pengembara.",
          siteUrl: "https://anilist.co/character/176754",
          imageUrl: null,
          imageBuffer: null,
        }),
    };

    const luckyRandom = {
      intBetween: (_min: number, max: number) => max, // 100% score!
      chance: () => true,
    };

    const npc1 = new NpcRomanceService(h.profileRepo, h.txRepo, mockLookup, luckyRandom, h.db);
    const t0 = new Date("2026-11-28T08:00:00Z");

    // 1. Roll Frieren -> 100% (>=90%) -> dapat tiket tembak!
    const roll1 = await npc1.rollCompatibility(GROUP_JID, USER_A, "Frieren", t0);
    assert.equal(roll1.score, 100);
    assert.equal(roll1.canPropose, true);
    assert.ok(roll1.score >= NPC_COMPAT_THRESHOLD);

    // Cooldown 5 menit ditegakkan
    await assert.rejects(
      () => npc1.rollCompatibility(GROUP_JID, USER_A, "Furina", new Date(t0.getTime() + 60_000)),
      /Tunggu/i,
    );

    // 2. Tembak Frieren -> Resmi jadi Pacar & eksklusif di grup!
    const proposed = await npc1.proposeToNpc(GROUP_JID, USER_A, undefined, new Date(t0.getTime() + 10_000));
    assert.equal(proposed.accepted, true);
    assert.equal(proposed.characterName, "Frieren");
    assert.equal(proposed.costPaid, NPC_PROPOSE_COST);

    // 3. Simulasi Restart -> Klaim Eksklusif (Opsi A) tetap mengunci USER_B!
    const npc2 = new NpcRomanceService(h.profileRepo, h.txRepo, mockLookup, luckyRandom, h.db);
    const rollB = await npc2.rollCompatibility(GROUP_JID, USER_B, "Frieren", t0);
    assert.equal(rollB.claimedByOtherJid, USER_A);
    assert.equal(rollB.canPropose, false);

    // 4. Harem Terbatas (Opsi B): Slot 1 penuh -> tolak tembak karakter ke-2 sebelum beli slot!
    const tAfterCd = new Date(t0.getTime() + NPC_ROLL_COOLDOWN_MS + 10_000);
    const roll2 = await npc2.rollCompatibility(GROUP_JID, USER_A, "Furina", tAfterCd);
    assert.equal(roll2.canPropose, true);
    await assert.rejects(
      () => npc2.proposeToNpc(GROUP_JID, USER_A, "Furina", new Date(tAfterCd.getTime() + 5_000)),
      /Slot pasangan NPC kamu penuh/i,
    );

    // Beli Slot ke-2 -> berhasil tembak Furina & ganti Pasangan Utama!
    const slotBuy = await npc2.buyExtraSlot(GROUP_JID, USER_A);
    assert.equal(slotBuy.newSlots, 2);
    assert.equal(slotBuy.costPaid, NPC_SLOT_UPGRADE_COSTS[2]);
    const prop2 = await npc2.proposeToNpc(GROUP_JID, USER_A, "Furina", new Date(tAfterCd.getTime() + 10_000));
    assert.equal(prop2.accepted, true);
    assert.equal(prop2.partnerCount, 2);

    await npc2.setPrimaryPartner(GROUP_JID, USER_A, "Furina");
    const primaryAfter = getPrimaryNpcPartner(parseRpgState(h.profiles.get(USER_A)?.rpgState));
    assert.equal(primaryAfter?.name, "Furina de Fontaine");

    // 5. Kencan sampai Cinta Lv.3 lalu Nikah (.nikahnpc)!
    let dateTime = new Date(tAfterCd.getTime() + 20_000);
    for (let i = 0; i < 3; i += 1) {
      await npc2.dateNpcPartner(GROUP_JID, USER_A, "Frieren", dateTime);
      dateTime = new Date(dateTime.getTime() + NPC_DATE_COOLDOWN_MS + 1_000);
    }
    const married = await npc2.marryNpcPartner(GROUP_JID, USER_A, "Frieren", undefined, dateTime);
    assert.equal(married.partner.relation, "istri");
    assert.equal(married.costPaid, NPC_MARRY_COST);

    // 6. Putus/Cerai melepaskan klaim sehingga USER_B bisa merebut Frieren!
    await npc2.breakupNpcPartner(GROUP_JID, USER_A, "Frieren");
    const claimsAfterBreakup = await npc2.listGroupClaims(GROUP_JID);
    assert.equal(
      claimsAfterBreakup.some((c) => c.characterKey === "anilist:176754"),
      false,
    );
  });

  void it("Sistem saling mengunci antara Pasangan NPC dan Pasangan/Nikah Member Asli", async () => {
    const h = createTestHarness();
    h.seedProfile(USER_A, { moneyBalance: 5_000_000_000n });
    h.seedProfile(USER_B, { moneyBalance: 5_000_000_000n });

    const mockLookup = {
      searchAniListCharacter: () =>
        Promise.resolve({
          id: 176754,
          nameFull: "Frieren",
          nameNative: null,
          gender: "Female",
          favourites: 45000,
          appearances: ["Sousou no Frieren"],
          description: "Elf",
          siteUrl: "",
          imageUrl: null,
          imageBuffer: null,
        }),
    };
    const luckyRandom = { intBetween: (_min: number, max: number) => max, chance: () => true };

    const npc = new NpcRomanceService(h.profileRepo, h.txRepo, mockLookup, luckyRandom, h.db);
    const couple = new CoupleService(h.profileRepo, h.db);
    const social = new SocialEconomyService(h.profileRepo, h.txRepo, {} as never, h.db);

    const t0 = new Date("2026-11-28T08:00:00Z");
    await npc.rollCompatibility(GROUP_JID, USER_A, "Frieren", t0);
    await npc.proposeToNpc(GROUP_JID, USER_A, undefined, t0);

    // USER_A punya pacar NPC -> DITOLAK menembak atau melamar member asli!
    await assert.rejects(
      () => couple.propose(GROUP_JID, USER_A, USER_B, t0.getTime()),
      /pasangan karakter anime\/game/i,
    );
    await assert.rejects(
      () => couple.propose(GROUP_JID, USER_B, USER_A, t0.getTime()),
      /pasangan karakter anime\/game/i,
    );
    await assert.rejects(
      () => social.proposeMarriage(GROUP_JID, USER_A, USER_B, 100_000_000n, t0.getTime()),
      /pasangan karakter anime\/game/i,
    );

    // Putus NPC -> lalu jadian dengan USER_B -> sekarang USER_A DITOLAK menembak NPC!
    await npc.breakupNpcPartner(GROUP_JID, USER_A, "Frieren");
    await couple.propose(GROUP_JID, USER_A, USER_B, t0.getTime());
    await couple.acceptProposal(GROUP_JID, USER_B, USER_A, t0);

    const rollWhenTaken = await npc.rollCompatibility(
      GROUP_JID,
      USER_A,
      "Frieren",
      new Date(t0.getTime() + NPC_ROLL_COOLDOWN_MS + 10_000),
    );
    assert.equal(rollWhenTaken.lockedByMemberPartner, true);
    assert.equal(rollWhenTaken.canPropose, false);
    await assert.rejects(
      () => npc.proposeToNpc(GROUP_JID, USER_A, undefined, new Date(t0.getTime() + NPC_ROLL_COOLDOWN_MS + 20_000)),
      /member asli/i,
    );
  });

  void it("Semua command NPC Romance terdaftar di commandRouter dan ditemukan lewat .carifitur", () => {
    for (const cmd of [
      "cocoknpc",
      "shipnpc",
      "tembaknpc",
      "kencan",
      "nikahnpc",
      "waifuku",
      "waifuslot",
      "putusnpc",
      "waifugrup",
      "kataloggame",
    ]) {
      assert.equal(commandRouter.has(cmd), true, `Command .${cmd} harus terdaftar`);
    }

    const search = featureSearchService.search("waifu", commandRouter.listCommandEntries());
    assert.ok(search.matches.some((m) => m.primaryCommand === "cocoknpc"));
    assert.ok(search.matches.some((m) => m.primaryCommand === "waifuku"));
  });
});
