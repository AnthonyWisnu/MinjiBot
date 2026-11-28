import assert from "node:assert/strict";
import { statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { GroupMemberProfile } from "@prisma/client";
import sharp from "sharp";

import { commandRouter } from "../src/commands";
import {
  eventBannerService,
  type EventBannerScene,
} from "../src/services/media/eventBanner.service";
import { CareerPrestigeService } from "../src/services/rpg/careerPrestige.service";
import { RpgExpansionService } from "../src/services/rpg/rpgExpansion.service";
import { createDefaultRpgState, parseRpgState, serializeRpgState } from "../src/services/rpg/rpgState";

function createHarness(initial: Partial<GroupMemberProfile>[] = []) {
  const profiles = new Map<string, GroupMemberProfile>();
  let seq = 1;

  const makeProfile = (p: Partial<GroupMemberProfile>): GroupMemberProfile => ({
    id: p.id ?? `p_${String(seq++)}`,
    groupJid: p.groupJid ?? "120@g.us",
    userJid: p.userJid ?? "6281@s.whatsapp.net",
    pointsBalance: p.pointsBalance ?? 0,
    limitBalance: p.limitBalance ?? 100,
    reservedLimit: p.reservedLimit ?? 0,
    experience: p.experience ?? 50_000,
    moneyBalance: p.moneyBalance ?? 50_000_000_000n,
    bankBalance: p.bankBalance ?? 5_000_000_000n,
    totalMoneyEarned: p.totalMoneyEarned ?? 50_000_000_000n,
    level: p.level ?? 15,
    totalPointsEarned: p.totalPointsEarned ?? 0,
    totalLimitsEarned: p.totalLimitsEarned ?? 100,
    totalGamesPlayed: p.totalGamesPlayed ?? 0,
    totalGamesWon: p.totalGamesWon ?? 0,
    currentStreak: p.currentStreak ?? 0,
    longestStreak: p.longestStreak ?? 0,
    lastDailyClaimAt: null,
    lastWeeklyClaimAt: null,
    lastMonthlyClaimAt: null,
    rpgState: p.rpgState ?? null,
    partnerJid: null,
    partnerSince: null,
    messageCount: p.messageCount ?? 0,
    lastActiveAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  for (const item of initial) {
    const built = makeProfile(item);
    profiles.set(built.id, built);
  }

  const findOrCreate = async (groupJid: string, userJid: string): Promise<GroupMemberProfile> => {
    for (const p of profiles.values()) {
      if (p.groupJid === groupJid && p.userJid === userJid) return p;
    }
    const built = makeProfile({ groupJid, userJid });
    profiles.set(built.id, built);
    return Promise.resolve(built);
  };

  const applyData = (target: GroupMemberProfile, data: Record<string, unknown>) => {
    const next = { ...target };
    for (const k of ["moneyBalance", "bankBalance", "totalMoneyEarned"] as const) {
      const val = data[k] as { increment?: bigint; decrement?: bigint } | bigint | undefined;
      if (typeof val === "bigint") next[k] = val;
      else if (val && typeof val === "object") {
        if (val.increment !== undefined) next[k] = next[k] + val.increment;
        if (val.decrement !== undefined) next[k] = next[k] - val.decrement;
      }
    }
    for (const k of [
      "limitBalance",
      "totalLimitsEarned",
      "experience",
      "pointsBalance",
      "totalPointsEarned",
    ] as const) {
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
    profiles.set(next.id, next);
    return next;
  };

  const tx = {
    groupMemberProfile: {
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const found = profiles.get(args.where.id as string);
        if (!found) return Promise.resolve({ count: 0 });
        const cond = args.where.moneyBalance as { gte?: bigint } | undefined;
        if (cond?.gte !== undefined && found.moneyBalance < cond.gte) {
          return Promise.resolve({ count: 0 });
        }
        applyData(found, args.data);
        return Promise.resolve({ count: 1 });
      },
      findUniqueOrThrow: async (args: { where: Record<string, unknown> }) => {
        const found = profiles.get(args.where.id as string);
        if (!found) throw new Error("Not found");
        return Promise.resolve(found);
      },
      update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const found = profiles.get(args.where.id as string);
        if (!found) throw new Error("Not found");
        return Promise.resolve(applyData(found, args.data));
      },
    },
  };

  const db = {
    $transaction: async <T,>(fn: (arg: typeof tx) => Promise<T>) => fn(tx),
    groupMemberProfile: {
      findMany: async (args: { where: Record<string, unknown> }) =>
        Promise.resolve(Array.from(profiles.values()).filter((p) => p.groupJid === args.where.groupJid)),
    },
  };

  const expansion = new RpgExpansionService(
    { findOrCreate },
    { create: () => Promise.resolve({}) },
    undefined,
    undefined,
    db,
  );

  const service = new CareerPrestigeService(
    {
      findOrCreate,
      getPositionByWealth: () => Promise.resolve(1),
    },
    { create: () => Promise.resolve({}) },
    expansion,
    db,
  );

  return { service, profiles };
}

void test("Tahap 12: all 23 new commands & aliases are registered in commandRouter", () => {
  const expected = [
    "karir",
    "career",
    "lamar",
    "apply",
    "shift",
    "kerjashift",
    "promosi",
    "resign",
    "startup",
    "perusahaan",
    "buatstartup",
    "rekruit",
    "upgradestartup",
    "dividen",
    "topstartup",
    "pinjam",
    "pinjol",
    "bayarutang",
    "lunasi",
    "cekutang",
    "utang",
    "asuransi",
    "beliasuransi",
    "bebaspenjara",
    "bebasugd",
    "prestige",
    "rebirth",
    "toprebirth",
    "flex",
    "sultancard",
    "blackcard",
    "networth",
    "cekaset",
  ];
  for (const cmd of expected) {
    assert.equal(commandRouter.has(cmd), true, `Command .${cmd} harus terdaftar`);
  }
});

void test("Tahap 12: all 8 event artwork assets exist (< 1 MB total) and EventBannerService renders banners & Black Card", async () => {
  const scenes: EventBannerScene[] = [
    "kpk_ott",
    "penjara_ronda",
    "masuk_ugd",
    "jackpot_sultan",
    "debt_collector",
    "dana_kaget",
    "world_boss",
    "istana_presiden",
  ];

  let totalBytes = 0;
  for (const scene of scenes) {
    const st = statSync(path.resolve(process.cwd(), "assets", "events", `${scene}.jpg`));
    assert.ok(st.size > 5_000, `Asset ${scene}.jpg terlalu kecil`);
    totalBytes += st.size;
  }
  assert.ok(totalBytes < 1_000_000, `Total aset event harus < 1 MB, didapat ${String(totalBytes)}`);

  // Create tiny synthetic avatar PNG
  const avatar = await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 56, g: 189, b: 248, alpha: 1 } },
  })
    .png()
    .toBuffer();

  const banner = await eventBannerService.renderEventBanner({
    scene: "kpk_ott",
    headline: "DITANGKAP KPK!",
    subjectName: "Budi Sultan",
    details: ["Denda: -Rp 50 Jt", "Penjara: 20 Menit"],
    avatarBuffer: avatar,
  });
  const bMeta = await sharp(banner).metadata();
  assert.equal(bMeta.format, "jpeg");
  assert.equal(bMeta.width, 720);
  assert.equal(bMeta.height, 450);

  const blackCard = await eventBannerService.renderSultanBlackCard({
    memberName: "Budi Sultan",
    customTitle: "Raja Bursa",
    rank: "Legend",
    level: 25,
    prestige: 3,
    netWorth: 25_500_000_000n,
    cashBalance: 10_000_000_000n,
    bankBalance: 5_000_000_000n,
    investAndAssetValue: 10_500_000_000n,
    wealthPosition: 1,
    avatarBuffer: avatar,
  });
  const cMeta = await sharp(blackCard).metadata();
  assert.equal(cMeta.format, "png");
  assert.equal(cMeta.width, 700);
  assert.equal(cMeta.height, 420);
});

void test("Tahap 12: Career, Startup, Pinjol Debt Collector, Insurance release, Rebirth Prestige, and AssetSummary", async () => {
  const t0 = new Date("2026-11-28T01:00:00.000Z");
  const tOverdue = new Date(t0.getTime() + 50 * 60 * 60 * 1000); // > 48h overdue
  const { service, profiles } = createHarness([
    {
      groupJid: "120@g.us",
      userJid: "6281@s.whatsapp.net",
      level: 15,
      experience: 50_000, // Epic
      moneyBalance: 25_000_000_000n,
    },
  ]);

  // 1. Rebirth Prestige ★1 (+25% permanent boost + 20 Limit + 500 Points)
  const rebirth = await service.performRebirth("120@g.us", "6281@s.whatsapp.net");
  assert.equal(rebirth.newPrestige, 1);
  assert.equal(rebirth.newBoostPercent, 25);
  assert.equal(rebirth.limitBonus, 20);
  assert.equal(rebirth.pointsBonus, 500);

  // 2. Career apply, shift, promote
  await service.applyCareer("120@g.us", "6281@s.whatsapp.net", "ceo");
  const shift1 = await service.workShift("120@g.us", "6281@s.whatsapp.net", t0);
  assert.ok(shift1.moneyEarned > 99_000_000n); // boosted +25% by Prestige ★1!
  assert.equal(shift1.debtSeized, 0n);

  const promo = await service.promoteCareer("120@g.us", "6281@s.whatsapp.net");
  assert.equal(promo.newLevel, 2);

  // 3. Startup create, recruit, upgrade, dividend
  await service.createStartup("120@g.us", "6281@s.whatsapp.net", "PT Minji Empire");
  await service.recruitEmployees("120@g.us", "6281@s.whatsapp.net", 2);
  await service.upgradeStartup("120@g.us", "6281@s.whatsapp.net");
  const div = await service.claimDividend("120@g.us", "6281@s.whatsapp.net", t0);
  assert.ok(div.dividendGross > 0n);

  // 4. Pinjol borrow -> overdue Debt Collector automatic seizure on shift -> full repay
  await service.borrowLoan("120@g.us", "6281@s.whatsapp.net", 500_000_000n, t0);
  const shiftOverdue = await service.workShift("120@g.us", "6281@s.whatsapp.net", tOverdue);
  assert.ok(shiftOverdue.debtSeized > 0n);
  assert.ok(shiftOverdue.remainingDebt > 0n);

  const paid = await service.repayLoan("120@g.us", "6281@s.whatsapp.net", "all");
  assert.equal(paid.totalDebtRemaining, 0n);

  // 5. Insurance Pengacara & BPJS free jail/UGD release
  await service.buyInsurance("120@g.us", "6281@s.whatsapp.net", "pengacara", tOverdue);
  await service.buyInsurance("120@g.us", "6281@s.whatsapp.net", "bpjs", tOverdue);

  // Put user in jail and UGD manually
  const prof = Array.from(profiles.values())[0];
  assert.ok(prof);
  const st = parseRpgState(prof.rpgState);
  st.jailedUntil = tOverdue.getTime() + 600_000;
  st.ugdUntil = tOverdue.getTime() + 600_000;
  st.hp = 10;
  prof.rpgState = serializeRpgState(st) as never;

  const jailOut = await service.releaseFromJail("120@g.us", "6281@s.whatsapp.net", tOverdue);
  assert.equal(jailOut.coveredByInsurance, true);
  assert.equal(jailOut.costPaid, 0n);

  const ugdOut = await service.releaseFromUgd("120@g.us", "6281@s.whatsapp.net", tOverdue);
  assert.equal(ugdOut.coveredByInsurance, true);
  assert.equal(ugdOut.costPaid, 0n);

  // 6. Top Prestige, Top Startup, and Net Worth Asset Summary
  const topP = await service.listTopPrestige("120@g.us");
  assert.equal(topP.length, 1);
  assert.equal(topP[0]?.prestige, 1);

  const topS = await service.listTopStartups("120@g.us");
  assert.equal(topS.length, 1);
  assert.equal(topS[0]?.startupName, "PT Minji Empire");

  const assets = await service.getAssetSummary("120@g.us", "6281@s.whatsapp.net", tOverdue);
  assert.equal(assets.prestige, 1);
  assert.equal(assets.startupName, "PT Minji Empire");
  assert.ok(assets.netWorth > 0n);

  // Verify default rpgState backward compatibility
  const fresh = parseRpgState(createDefaultRpgState());
  assert.equal(fresh.prestige, 0);
  assert.equal(fresh.career, null);
});
