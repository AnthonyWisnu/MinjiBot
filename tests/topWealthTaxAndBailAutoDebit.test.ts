import assert from "node:assert/strict";
import test from "node:test";
import { TenantStatus, type GroupMemberProfile, type TenantGroup } from "@prisma/client";

import { commandRouter } from "../src/commands";
import { CareerPrestigeService } from "../src/services/rpg/careerPrestige.service";
import {
  INSURANCE_MAP,
  JAIL_BAIL_COST,
  UGD_VIP_RELEASE_COST,
} from "../src/services/rpg/careerPrestigeCatalog";
import { SKILL_RESET_COST } from "../src/services/rpg/raidFarmBuffBounty.service";
import {
  DEFAULT_GROUP_TREASURY,
  RpgEconomyService,
} from "../src/services/rpg/rpgEconomy.service";
import {
  createDefaultRpgState,
  parseRpgState,
  serializeRpgState,
  withInsuranceUntil,
} from "../src/services/rpg/rpgState";

function makeProfile(overrides: Partial<GroupMemberProfile> = {}): GroupMemberProfile {
  return {
    id: overrides.id ?? "p1",
    groupJid: overrides.groupJid ?? "120@g.us",
    userJid: overrides.userJid ?? "6281@s.whatsapp.net",
    pointsBalance: overrides.pointsBalance ?? 0,
    limitBalance: overrides.limitBalance ?? 100,
    reservedLimit: overrides.reservedLimit ?? 0,
    experience: overrides.experience ?? 1_000,
    moneyBalance: overrides.moneyBalance ?? 0n,
    bankBalance: overrides.bankBalance ?? 0n,
    totalMoneyEarned: overrides.totalMoneyEarned ?? 0n,
    level: overrides.level ?? 5,
    totalPointsEarned: overrides.totalPointsEarned ?? 0,
    totalLimitsEarned: overrides.totalLimitsEarned ?? 100,
    totalGamesPlayed: overrides.totalGamesPlayed ?? 0,
    totalGamesWon: overrides.totalGamesWon ?? 0,
    currentStreak: overrides.currentStreak ?? 0,
    longestStreak: overrides.longestStreak ?? 0,
    lastDailyClaimAt: null,
    lastWeeklyClaimAt: null,
    lastMonthlyClaimAt: null,
    rpgState: overrides.rpgState ?? null,
    partnerJid: null,
    partnerSince: null,
    messageCount: 0,
    lastActiveAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

void test("Economy rebalance sinks: Jail Bail, UGD VIP, 3 Insurances, and Skill Reset scaled consistently", () => {
  assert.equal(JAIL_BAIL_COST, 8_000_000n);
  assert.equal(UGD_VIP_RELEASE_COST, 6_000_000n);
  assert.equal(INSURANCE_MAP.get("brankas")?.price, 18_000_000n);
  assert.equal(INSURANCE_MAP.get("bpjs")?.price, 12_000_000n);
  assert.equal(INSURANCE_MAP.get("pengacara")?.price, 20_000_000n);
  assert.equal(SKILL_RESET_COST, 5_000_000n);
  assert.equal(commandRouter.has("pajaktop"), true);
  assert.equal(commandRouter.has("pajaksultan"), true);
  assert.equal(commandRouter.has("taxtop"), true);
});

void test("Auto-debit Dompet + ATM works for .bebaspenjara and .bebasugd when wallet is insufficient", async () => {
  const now = new Date("2026-11-28T06:00:00.000Z");
  const st = createDefaultRpgState();
  st.jailedUntil = now.getTime() + 600_000;
  st.ugdUntil = now.getTime() + 600_000;
  st.hp = 15;

  let profile = makeProfile({
    id: "p_auto",
    moneyBalance: 5_000_000n, // wallet only 5jt
    bankBalance: 12_000_000n, // bank has 12jt
    rpgState: serializeRpgState(st) as never,
  });
  const txLogs: { amount: bigint; note?: string }[] = [];

  const service = new CareerPrestigeService(
    {
      findOrCreate: () => Promise.resolve({ ...profile }),
      findByGroupAndUser: () => Promise.resolve({ ...profile }),
    },
    {
      create: (data) => {
        txLogs.push({ amount: BigInt(data.amount), note: data.note });
        return Promise.resolve({});
      },
    },
    undefined,
    {
      $transaction: async <T>(fn: (tx: never) => Promise<T>): Promise<T> =>
        fn({
          groupMemberProfile: {
            updateMany: (args: {
              where: {
                id: string;
                moneyBalance?: { gte?: bigint };
                bankBalance?: { gte?: bigint };
              };
              data: Record<string, unknown>;
            }) => {
              if (
                args.where.moneyBalance?.gte !== undefined &&
                profile.moneyBalance < args.where.moneyBalance.gte
              ) {
                return Promise.resolve({ count: 0 });
              }
              if (
                args.where.bankBalance?.gte !== undefined &&
                profile.bankBalance < args.where.bankBalance.gte
              ) {
                return Promise.resolve({ count: 0 });
              }
              const decMoney =
                (args.data.moneyBalance as { decrement?: bigint } | undefined)?.decrement ?? 0n;
              const decBank =
                (args.data.bankBalance as { decrement?: bigint } | undefined)?.decrement ?? 0n;
              profile = {
                ...profile,
                moneyBalance: profile.moneyBalance - decMoney,
                bankBalance: profile.bankBalance - decBank,
                rpgState: (args.data.rpgState as GroupMemberProfile["rpgState"]) ?? profile.rpgState,
              };
              return Promise.resolve({ count: 1 });
            },
            findUniqueOrThrow: () => Promise.resolve({ ...profile }),
            update: (args: { data: Record<string, unknown> }) => {
              profile = {
                ...profile,
                rpgState: (args.data.rpgState as GroupMemberProfile["rpgState"]) ?? profile.rpgState,
              };
              return Promise.resolve({ ...profile });
            },
          },
        } as never),
    },
  );

  // 1. Jail bail = 8jt -> takes 5jt from wallet + 3jt auto-debit from bank!
  const jailRes = await service.releaseFromJail("120@g.us", "6281@s.whatsapp.net", now);
  assert.equal(jailRes.coveredByInsurance, false);
  assert.equal(jailRes.costPaid, 8_000_000n);
  assert.equal(jailRes.walletPaid, 5_000_000n);
  assert.equal(jailRes.bankPaid, 3_000_000n);
  assert.equal(jailRes.currentMoney, 0n);
  assert.equal(jailRes.currentBank, 9_000_000n);
  assert.equal(parseRpgState(profile.rpgState).jailedUntil, 0);

  // 2. UGD VIP = 6jt -> wallet is 0, takes full 6jt from bank!
  const ugdRes = await service.releaseFromUgd("120@g.us", "6281@s.whatsapp.net", now);
  assert.equal(ugdRes.coveredByInsurance, false);
  assert.equal(ugdRes.costPaid, 6_000_000n);
  assert.equal(ugdRes.walletPaid, 0n);
  assert.equal(ugdRes.bankPaid, 6_000_000n);
  assert.equal(ugdRes.currentMoney, 0n);
  assert.equal(ugdRes.currentBank, 3_000_000n);
  assert.equal(parseRpgState(profile.rpgState).ugdUntil, 0);
  assert.equal(parseRpgState(profile.rpgState).hp, 100);
  assert.ok(txLogs.some((t) => t.note === "jail_bail_bank_autodebit" && t.amount === -3_000_000n));
  assert.ok(txLogs.some((t) => t.note === "ugd_vip_release_bank_autodebit" && t.amount === -6_000_000n));

  // 3. Put back in jail with only 3jt combined -> must reject (< 8jt)
  const st2 = parseRpgState(profile.rpgState);
  st2.jailedUntil = now.getTime() + 600_000;
  profile = { ...profile, rpgState: serializeRpgState(st2) as never };
  await assert.rejects(
    () => service.releaseFromJail("120@g.us", "6281@s.whatsapp.net", now),
    /total saldo/,
  );
});

void test("RpgEconomyService.collectTopWealthTax taxes Top 10 wallet+bank, bypasses Brankas, and credits Kas Negara", async () => {
  const nowMs = Date.now();
  const shieldedState = withInsuranceUntil(createDefaultRpgState(), "brankas", nowMs + 86_400_000);
  const profiles = new Map<string, GroupMemberProfile>();

  // Create 12 members (richness descending) so only top 10 are taxed!
  for (let i = 1; i <= 12; i += 1) {
    const id = `p${String(i)}`;
    const wallet = BigInt(13 - i) * 10_000_000n;
    const bank = BigInt(13 - i) * 20_000_000n;
    profiles.set(
      id,
      makeProfile({
        id,
        userJid: `628000000${String(i).padStart(2, "0")}@s.whatsapp.net`,
        moneyBalance: wallet,
        bankBalance: bank,
        // Give #1 active Brankas insurance to verify Top 10 state tax bypasses it!
        rpgState: i === 1 ? (serializeRpgState(shieldedState) as never) : null,
      }),
    );
  }

  let treasuryBalance = DEFAULT_GROUP_TREASURY;
  const ledger: { userJid: string; amount: bigint; note?: string }[] = [];

  const service = new RpgEconomyService(
    {
      findOrCreate: () => Promise.reject(new Error("unused")),
      findByGroupAndUser: () => Promise.resolve(null),
      listTopByWealth: (_g, limit = 25) => {
        const sorted = Array.from(profiles.values()).sort((a, b) => {
          const diff = b.moneyBalance + b.bankBalance - (a.moneyBalance + a.bankBalance);
          return diff > 0n ? 1 : diff < 0n ? -1 : 0;
        });
        return Promise.resolve(sorted.slice(0, limit));
      },
    },
    {
      create: (data) => {
        ledger.push({ userJid: data.userJid, amount: BigInt(data.amount), note: data.note });
        return Promise.resolve({});
      },
    },
    undefined,
    {
      $transaction: async <T>(fn: (tx: never) => Promise<T>): Promise<T> =>
        fn({
          groupMemberProfile: {
            findUniqueOrThrow: (args: { where: { id: string } }) => {
              const found = profiles.get(args.where.id);
              if (!found) throw new Error("not found");
              return Promise.resolve({ ...found });
            },
            updateMany: (args: {
              where: { id: string; moneyBalance?: { gte?: bigint }; bankBalance?: { gte?: bigint } };
              data: Record<string, unknown>;
            }) => {
              const found = profiles.get(args.where.id);
              if (!found) return Promise.resolve({ count: 0 });
              const decW =
                (args.data.moneyBalance as { decrement?: bigint } | undefined)?.decrement ?? 0n;
              const decB =
                (args.data.bankBalance as { decrement?: bigint } | undefined)?.decrement ?? 0n;
              profiles.set(args.where.id, {
                ...found,
                moneyBalance: found.moneyBalance - decW,
                bankBalance: found.bankBalance - decB,
              });
              return Promise.resolve({ count: 1 });
            },
            update: () => Promise.reject(new Error("unused")),
          },
          tenantGroup: {
            findUnique: () =>
              Promise.resolve({
                groupJid: "120@g.us",
                tenantCode: "GRP01",
                status: TenantStatus.ACTIVE,
                treasuryBalance,
              } as unknown as TenantGroup),
            update: (args: { data: { treasuryBalance: bigint } }) => {
              treasuryBalance = args.data.treasuryBalance;
              return Promise.resolve({
                groupJid: "120@g.us",
                treasuryBalance,
              } as unknown as TenantGroup);
            },
          },
        } as never),
      tenantGroup: {
        findUnique: () => Promise.resolve(null),
      },
    },
  );

  // Reject out-of-range percents
  await assert.rejects(
    () => service.collectTopWealthTax("120@g.us", 0, "628999@s.whatsapp.net"),
    /Persentase pajak/,
  );
  await assert.rejects(
    () => service.collectTopWealthTax("120@g.us", 60, "628999@s.whatsapp.net"),
    /Persentase pajak/,
  );

  // Apply 10% wealth tax to Top 10
  const res = await service.collectTopWealthTax("120@g.us", 10, "628999@s.whatsapp.net");
  assert.equal(res.percent, 10);
  assert.equal(res.taxedMembers.length, 10);

  // #1 (with Brankas) had 120jt wallet + 240jt bank = 360jt -> 10% = 12jt wallet + 24jt bank = 36jt!
  const first = res.taxedMembers[0];
  assert.ok(first);
  assert.equal(first.walletTax, 12_000_000n);
  assert.equal(first.bankTax, 24_000_000n);
  assert.equal(first.totalTax, 36_000_000n);
  assert.equal(profiles.get("p1")?.moneyBalance, 108_000_000n);
  assert.equal(profiles.get("p1")?.bankBalance, 216_000_000n);

  // #11 and #12 were NOT taxed!
  assert.equal(profiles.get("p11")?.moneyBalance, 20_000_000n);
  assert.equal(profiles.get("p11")?.bankBalance, 40_000_000n);
  assert.equal(profiles.get("p12")?.moneyBalance, 10_000_000n);
  assert.equal(profiles.get("p12")?.bankBalance, 20_000_000n);

  // Kas Negara increased by exact totalCollected
  assert.equal(res.treasuryBalance, DEFAULT_GROUP_TREASURY + res.totalCollected);
  assert.equal(treasuryBalance, res.treasuryBalance);
  assert.equal(ledger.length, 10);
});
