import assert from "node:assert/strict";
import test from "node:test";
import type { GroupClan, GroupMemberProfile } from "@prisma/client";
import sharp from "sharp";

import { commandRouter } from "../src/commands";
import {
  ANIME_ROLEPLAY_SPECS,
  AnimeRoleplayService,
} from "../src/services/fun/animeRoleplay.service";
import { SocialDramaService } from "../src/services/fun/socialDrama.service";
import {
  CLAN_CREATE_PRICE,
  CUSTOM_TITLE_PRICE,
  SocialEconomyService,
} from "../src/services/fun/socialEconomy.service";
import { PhotoMemeService } from "../src/services/media/photoMeme.service";
import { parseRpgState } from "../src/services/rpg/rpgState";
import { buildMemberProfile } from "./helpers/factories";

test("Tahap 6 - all ~60 Social, Economy, Photo Meme, and Anime RP commands exist in commandRouter", () => {
  const expected = [
    "siapa",
    "paling",
    "pick",
    "jodohgrup",
    "cekcocok",
    "ship",
    "fakta",
    "ramalan",
    "zodiak",
    "shio",
    "weton",
    "beligelar",
    "gelar",
    "hapusgelar",
    "nikah",
    "terimanikah",
    "tolaknikah",
    "bukunikah",
    "cerai",
    "geng",
    "clan",
    "lelang",
    "bid",
    "wanted",
    "jail",
    "rip",
    "triggered",
    "trash",
    "clown",
    "blur",
    "grayscale",
    "bw",
    "invert",
    "sepia",
    "pixelate",
    "mirror",
    "flip",
    "rotate",
    "circle",
    "polaroid",
    ...ANIME_ROLEPLAY_SPECS.map((s) => s.command),
  ];
  for (const cmd of expected) {
    assert.equal(commandRouter.has(cmd), true, `Command .${cmd} harus terdaftar di commandRouter`);
  }
});

test("SocialDramaService - Javanese Weton (17-08-1945 Jumat Legi), Shio, Zodiak, and Ship math", () => {
  const svc = new SocialDramaService();

  // Historical anchor: Indonesia Independence Day 17-08-1945 was Jumat Legi (Neptu 6 + 5 = 11)
  const ind = svc.calculateWeton("17-08-1945");
  assert.equal(ind.wetonLabel, "Jumat Legi");
  assert.equal(ind.totalNeptu, 11);

  // Epoch check: 01-01-1970 was Kamis Wage (Neptu 8 + 4 = 12)
  const epoch = svc.calculateWeton("01-01-1970");
  assert.equal(epoch.wetonLabel, "Kamis Wage");
  assert.equal(epoch.totalNeptu, 12);

  assert.throws(() => svc.calculateWeton("31-02-2000"), /tidak ada/);

  const shio2000 = svc.getShio(2000);
  assert.equal(shio2000.shio, "Naga");
  assert.equal(shio2000.element, "Logam");

  assert.equal(svc.getZodiak("leo").element, "Api");
  assert.throws(() => svc.getZodiak("unknown"), /tidak dikenali/);

  const c1 = svc.computeCompatibility("628111@s.whatsapp.net", "628222@s.whatsapp.net");
  const c2 = svc.computeCompatibility("628222@s.whatsapp.net", "628111@s.whatsapp.net");
  assert.equal(c1.percentage, c2.percentage);
  assert.ok(c1.percentage >= 1 && c1.percentage <= 100);

  const picked = svc.pickRandomMembers(["a", "b", "c", "d"], 2);
  assert.equal(picked.length, 2);
  assert.notEqual(picked[0], picked[1]);
});

test("SocialEconomyService - Gelar Sultan, Nikah atomic dowry, Geng/Clan, and Lelang settlement", async () => {
  const groupJid = "120363000010@g.us";
  const u1 = "628500000001@s.whatsapp.net";
  const u2 = "628500000002@s.whatsapp.net";

  const profiles = new Map<string, GroupMemberProfile>([
    [u1, buildMemberProfile({ id: "p1", groupJid, userJid: u1, moneyBalance: 500_000_000n })],
    [u2, buildMemberProfile({ id: "p2", groupJid, userJid: u2, moneyBalance: 300_000_000n })],
  ]);

  const clans = new Map<string, GroupClan>();
  const mockClanRepo = {
    findBySlug: async (_g: string, slug: string) =>
      Promise.resolve([...clans.values()].find((c) => c.slug === slug) ?? null),
    listByGroup: async () =>
      Promise.resolve(
        [...clans.values()].sort((a, b) => Number(b.treasuryBalance - a.treasuryBalance)),
      ),
    countByGroup: async () => Promise.resolve(clans.size),
    findByMember: async (_g: string, jid: string) =>
      Promise.resolve(
        [...clans.values()].find((c) => Array.isArray(c.memberJids) && c.memberJids.includes(jid)) ??
          null,
      ),
    create: async (data: {
      groupJid: string;
      name: string;
      slug: string;
      leaderJid: string;
      memberJids: string[];
    }) => {
      const row: GroupClan = {
        id: `clan-${String(clans.size + 1)}`,
        groupJid: data.groupJid,
        name: data.name,
        slug: data.slug,
        leaderJid: data.leaderJid,
        treasuryBalance: 0n,
        memberJids: data.memberJids,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      clans.set(row.id, row);
      return Promise.resolve(row);
    },
    update: async (
      id: string,
      data: {
        leaderJid?: string;
        memberJids?: string[];
        treasuryBalance?: bigint | { increment: bigint };
      },
    ) => {
      const row = clans.get(id);
      assert.ok(row);
      if (data.leaderJid !== undefined) row.leaderJid = data.leaderJid;
      if (data.memberJids !== undefined) row.memberJids = data.memberJids;
      if (typeof data.treasuryBalance === "bigint") {
        row.treasuryBalance = data.treasuryBalance;
      } else if (data.treasuryBalance && "increment" in data.treasuryBalance) {
        row.treasuryBalance += data.treasuryBalance.increment;
      }
      return Promise.resolve(row);
    },
    deleteById: async (id: string) => {
      clans.delete(id);
      return Promise.resolve();
    },
  };

  const mockProfileRepo = {
    findOrCreate: async (_g: string, userJid: string) => {
      const p = profiles.get(userJid);
      assert.ok(p);
      return Promise.resolve(p);
    },
    findByGroupAndUser: async (_g: string, userJid: string) =>
      Promise.resolve(profiles.get(userJid) ?? null),
  };

  const mockTxRepo = { create: async () => Promise.resolve() };
  const mockDb = {
    $transaction: async <T>(
      fn: (tx: {
        groupMemberProfile: {
          update(args: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }): Promise<GroupMemberProfile>;
        };
      }) => Promise<T>,
    ): Promise<T> =>
      fn({
        groupMemberProfile: {
          update: async ({ where, data }) => {
            const p = [...profiles.values()].find((item) => item.id === where.id);
            assert.ok(p);
            const moneyOp = data.moneyBalance as { increment?: bigint; decrement?: bigint } | undefined;
            if (moneyOp?.increment) p.moneyBalance += moneyOp.increment;
            if (moneyOp?.decrement) p.moneyBalance -= moneyOp.decrement;
            if ("rpgState" in data) p.rpgState = data.rpgState as GroupMemberProfile["rpgState"];
            if ("partnerJid" in data) p.partnerJid = data.partnerJid as string | null;
            return Promise.resolve(p);
          },
        },
      }),
  };

  const svc = new SocialEconomyService(mockProfileRepo, mockTxRepo, mockClanRepo, mockDb);

  // 1. Gelar Sultan
  const titleRes = await svc.buyCustomTitle(groupJid, u1, "Raja Korupsi");
  assert.equal(titleRes.title, "Raja Korupsi");
  assert.equal(titleRes.remainingMoney, 500_000_000n - CUSTOM_TITLE_PRICE);
  assert.equal(parseRpgState(profiles.get(u1)?.rpgState).customTitle, "Raja Korupsi");

  // 2. Nikah & Cerai
  await svc.proposeMarriage(groupJid, u1, u2, 50_000_000n, 1_000);
  const married = await svc.acceptMarriage(groupJid, u2, 2_000);
  assert.equal(married.userJid, u1);
  assert.equal(married.spouseJid, u2);
  assert.equal(profiles.get(u1)?.moneyBalance, 350_000_000n);
  assert.equal(profiles.get(u2)?.moneyBalance, 350_000_000n);
  assert.equal(parseRpgState(profiles.get(u1)?.rpgState).spouseJid, u2);

  await svc.divorce(groupJid, u1);
  assert.equal(parseRpgState(profiles.get(u1)?.rpgState).spouseJid, null);
  assert.equal(parseRpgState(profiles.get(u2)?.rpgState).spouseJid, null);

  // 3. Geng / Clan
  const clan = await svc.createClan(groupJid, u1, "Elit Grup");
  assert.equal(clan.slug, "elit-grup");
  assert.equal(profiles.get(u1)?.moneyBalance, 350_000_000n - CLAN_CREATE_PRICE);

  await svc.joinClan(groupJid, u2, "Elit Grup");
  const donated = await svc.donateToClan(groupJid, u2, 10_000_000n);
  assert.equal(donated.newTreasury, 10_000_000n);

  // 4. Lelang & Bid
  svc.openAuction(groupJid, u1, "Pedang Naga", 5_000_000n, 10_000);
  await svc.placeBid(groupJid, u2, 20_000_000n, 11_000);
  const closed = await svc.closeAuction(groupJid, u1, false, 12_000);
  assert.equal(closed.settled, true);
  assert.equal(profiles.get(u1)?.moneyBalance, 320_000_000n);
  assert.equal(profiles.get(u2)?.moneyBalance, 320_000_000n);
});

test("PhotoMemeService & AnimeRoleplayService - renders meme overlays, filters, circle sticker, ship/marriage cards, and mocked nekos.best", async () => {
  const sampleImg = await sharp({
    create: { width: 120, height: 120, channels: 4, background: { r: 60, g: 130, b: 220, alpha: 1 } },
  })
    .png()
    .toBuffer();

  const meme = new PhotoMemeService();
  for (const tpl of ["wanted", "jail", "rip", "triggered", "trash", "clown"] as const) {
    const out = await meme.renderMemeOverlay(sampleImg, tpl, "@628111");
    const meta = await sharp(out).metadata();
    assert.equal(meta.format, "png");
    assert.equal(meta.width, 600);
  }

  for (const flt of ["blur", "grayscale", "invert", "sepia", "pixelate", "mirror"] as const) {
    const out = await meme.applyFilter(sampleImg, flt);
    const meta = await sharp(out).metadata();
    assert.equal(meta.format, "png");
  }

  const circleWebp = await meme.createCircleSticker(sampleImg);
  assert.equal((await sharp(circleWebp).metadata()).format, "webp");

  const polaroid = await meme.renderPolaroid(sampleImg, "Momen Seru");
  assert.equal((await sharp(polaroid).metadata()).height, 720);

  const ship = await meme.renderShipCard({
    avatarA: sampleImg,
    avatarB: sampleImg,
    nameA: "@A",
    nameB: "@B",
    percentage: 92,
    verdict: "Jodoh Sejati!",
  });
  assert.equal((await sharp(ship).metadata()).width, 800);

  const marriage = await meme.renderMarriageCard({
    avatarA: sampleImg,
    avatarB: sampleImg,
    nameA: "@A",
    nameB: "@B",
    dowryLabel: "Rp 50.000.000",
    dateLabel: "28 Nov 2026",
  });
  assert.equal((await sharp(marriage).metadata()).height, 480);

  // AnimeRoleplayService mocked fetch returning PNG
  const rpSvc = new AnimeRoleplayService((async (url: string) => {
    if (url.endsWith("/api/v2/hug")) {
      return Response.json({
        results: [{ url: "https://nekos.best/api/v2/hug/sample.png", anime_name: "K-On!" }],
      });
    }
    return new Response(new Uint8Array(sampleImg), { status: 200 });
  }) as never);

  const rp = await rpSvc.fetchReactionMedia("hug");
  assert.equal(rp.kind, "image");
  assert.equal(rp.animeName, "K-On!");
  assert.equal(ANIME_ROLEPLAY_SPECS.length, 38);
});
