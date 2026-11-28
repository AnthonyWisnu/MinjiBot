import assert from "node:assert/strict";
import test from "node:test";
import { HeavyFeatureType, type GroupMemberProfile } from "@prisma/client";

import { commandRouter } from "../src/commands";
import { AppUserError } from "../src/errors/appUserError";
import { AI_MAX_PROMPT_CHARS, OpenRouterService } from "../src/services/ai/openRouter.service";
import { GameRewardService } from "../src/services/game/gameReward.service";
import { KUIS_REWARD, TICTACTOE_REWARD } from "../src/services/game/gameReward.constants";
import { getFeatureCost } from "../src/services/member/heavyFeatureCost";
import { MemberEconomyService } from "../src/services/member/memberEconomy.service";
import { MenuService } from "../src/services/menu/menu.service";
import {
  clampMoneyCredit,
  computeLevelMoneyMultiplier,
  formatCompactRupiah,
  formatRupiah,
  MAX_SAFE_MONEY_BIGINT,
  parseBigIntAmountOrAll,
  parsePositiveBigIntMoneyInput,
  scaleMoneyByLevel,
} from "../src/utils/currency";
import {
  buildCommandContext,
  buildMemberProfile,
  buildTenantFeatureSetting,
  buildTenantGroup,
} from "./helpers/factories";

void test("Tahap 1 Currency: BigInt formatting, compact Sultan units (Jt/M/T/Q), and suffix parser", () => {
  assert.equal(formatRupiah(12_500_000n), "Rp 12.500.000");
  assert.equal(formatRupiah(2_400_000_000_000n), "Rp 2.400.000.000.000");
  assert.equal(formatCompactRupiah(500_000n), "Rp 500.000");
  assert.equal(formatCompactRupiah(12_500_000n), "Rp 12,5 Jt");
  assert.equal(formatCompactRupiah(1_250_000_000n), "Rp 1,25 M");
  assert.equal(formatCompactRupiah(2_400_000_000_000n), "Rp 2,4 T");
  assert.equal(formatCompactRupiah(1_500_000_000_000_000n), "Rp 1,5 Q");

  assert.equal(parsePositiveBigIntMoneyInput("500k"), 500_000n);
  assert.equal(parsePositiveBigIntMoneyInput("12.5jt"), 12_500_000n);
  assert.equal(parsePositiveBigIntMoneyInput("2m"), 2_000_000n);
  assert.equal(parsePositiveBigIntMoneyInput("1.5b"), 1_500_000_000n);
  assert.equal(parsePositiveBigIntMoneyInput("3miliar"), 3_000_000_000n);
  assert.equal(parsePositiveBigIntMoneyInput("2.5t"), 2_500_000_000_000n);
  assert.equal(parseBigIntAmountOrAll("all"), "all");
  assert.equal(parsePositiveBigIntMoneyInput("99999999999999999999"), null);

  assert.equal(computeLevelMoneyMultiplier(1), 1);
  assert.equal(computeLevelMoneyMultiplier(11), 1.5);
  assert.equal(computeLevelMoneyMultiplier(99), 3);
  assert.equal(scaleMoneyByLevel(1_000_000n, 11), 1_500_000n);
  assert.equal(clampMoneyCredit(MAX_SAFE_MONEY_BIGINT - 10n, 100n), 10n);
});

void test("Tahap 1 Economy: MemberEconomyService.creditMoney & GameRewardService scale rewards by level", async () => {
  let storedProfile: GroupMemberProfile = buildMemberProfile({
    id: "prof-sultan",
    level: 11, // 1.5x multiplier (max 3x at Lv.41+)
    moneyBalance: 5_000_000_000n, // Rp 5 Miliar (BigInt!)
    totalMoneyEarned: 5_000_000_000n,
  });

  const ledger: { asset: string; amount: number | bigint }[] = [];
  const economy = new MemberEconomyService(
    {
      findOrCreate: () => Promise.resolve({ ...storedProfile }),
      findByGroupAndUser: () => Promise.resolve({ ...storedProfile }),
      findActiveByUser: () => Promise.resolve([{ ...storedProfile }]),
    },
    {
      create: (data) => {
        ledger.push({ asset: data.asset, amount: data.amount });
        return Promise.resolve(data);
      },
      findByIdempotencyKey: () => Promise.resolve(null),
    },
    {
      $transaction: <T>(fn: (tx: never) => Promise<T>) =>
        fn({
          groupMemberProfile: {
            update: (args: { data: Record<string, unknown> }) => {
              const incMoney =
                (args.data.moneyBalance as { increment?: bigint } | undefined)?.increment ?? 0n;
              const incPts =
                (args.data.pointsBalance as { increment?: number } | undefined)?.increment ?? 0;
              const incXp =
                (args.data.experience as { increment?: number } | undefined)?.increment ?? 0;
              storedProfile = {
                ...storedProfile,
                moneyBalance: storedProfile.moneyBalance + incMoney,
                totalMoneyEarned: storedProfile.totalMoneyEarned + incMoney,
                pointsBalance: storedProfile.pointsBalance + incPts,
                experience: storedProfile.experience + incXp,
              };
              return Promise.resolve({ ...storedProfile });
            },
            updateMany: () => Promise.resolve({ count: 1 }),
            findUniqueOrThrow: () => Promise.resolve({ ...storedProfile }),
          },
        } as never),
    },
  );

  const gameReward = new GameRewardService(economy);
  const kuisRes = await gameReward.awardKuisCorrect(
    "120@g.us",
    "628111@s.whatsapp.net",
    "r-1",
    "corr-1",
  );

  assert.equal(kuisRes.points, KUIS_REWARD.CORRECT_POINTS);
  assert.equal(kuisRes.xp, KUIS_REWARD.CORRECT_XP);
  assert.equal(kuisRes.levelMultiplier, 1.5);
  assert.equal(kuisRes.money, 900_000n); // Rp 600 Rb * 1.5x Lv.11 (max 3x rebalance)
  assert.equal(storedProfile.moneyBalance, 5_000_900_000n);

  const tttRes = await gameReward.awardTicTacToeWin(
    "120@g.us",
    "628111@s.whatsapp.net",
    "r-2",
    "corr-2",
  );
  assert.equal(tttRes.money, (TICTACTOE_REWARD.WIN_MONEY * 150n) / 100n);
  assert.ok(ledger.some((entry) => entry.asset === "MONEY" && entry.amount === 900_000n));
});

void test("Tahap 1 OpenRouter AI: enforces API key, prompt limit, cooldown, daily group quota, and safe errors", async () => {
  assert.equal(getFeatureCost(HeavyFeatureType.AI_CHAT), 1);

  const unconfigured = new OpenRouterService({
    apiKey: undefined,
    model: "google/gemini-2.5-flash-lite",
    dailyQuotaPerGroup: 5,
  });
  assert.equal(unconfigured.isConfigured(), false);
  await assert.rejects(
    () =>
      unconfigured.ask({
        groupJid: "120@g.us",
        userJid: "6281@s.whatsapp.net",
        prompt: "halo",
        persona: "assistant",
      }),
    /API Key OpenRouter belum diatur/,
  );

  let fetchCalls = 0;
  let nextStatus = 200;
  let nextContent = "Halo! Ini jawaban hemat dari Minji AI.";

  const service = new OpenRouterService({
    apiKey: "test-key-dummy",
    model: "google/gemini-2.5-flash-lite",
    dailyQuotaPerGroup: 2,
    fetchFn: () => {
      fetchCalls += 1;
      if (nextStatus !== 200) {
        return Promise.resolve(new Response("error", { status: nextStatus }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: nextContent } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    },
  });

  // 1. Prompt > 600 chars rejected before fetch
  await assert.rejects(
    () =>
      service.ask({
        groupJid: "120@g.us",
        userJid: "6281@s.whatsapp.net",
        prompt: "a".repeat(AI_MAX_PROMPT_CHARS + 1),
        persona: "assistant",
      }),
    AppUserError,
  );
  assert.equal(fetchCalls, 0);

  const t0 = new Date("2026-11-28T05:00:00Z");

  // 2. Failed HTTP 402 does NOT burn daily quota or cooldown
  nextStatus = 402;
  await assert.rejects(
    () =>
      service.ask({
        groupJid: "120@g.us",
        userJid: "6281@s.whatsapp.net",
        prompt: "tes saldo habis",
        persona: "assistant",
        now: t0,
      }),
    /saldo kredit AI bot sedang habis/,
  );
  assert.equal(service.getRemainingGroupQuota("120@g.us", t0), 2);

  // 3. Successful call consumes 1 group quota and triggers 15s cooldown
  nextStatus = 200;
  const res1 = await service.ask({
    groupJid: "120@g.us",
    userJid: "6281@s.whatsapp.net",
    prompt: "jelaskan apa itu nodejs",
    persona: "assistant",
    now: t0,
  });
  assert.equal(res1.answer, nextContent);
  assert.equal(res1.remainingGroupQuota, 1);

  // 4. Cooldown blocks immediate second ask for same user
  await assert.rejects(
    () =>
      service.ask({
        groupJid: "120@g.us",
        userJid: "6281@s.whatsapp.net",
        prompt: "lagi dong",
        persona: "simi",
        now: new Date(t0.getTime() + 5_000),
      }),
    /Tunggu/,
  );

  // 5. Another user can ask in simi mode (uses 2nd/final quota of group)
  nextContent = "Wkwk santai aja bro!";
  const res2 = await service.ask({
    groupJid: "120@g.us",
    userJid: "6282@s.whatsapp.net",
    prompt: "minji gabut nih",
    persona: "simi",
    now: new Date(t0.getTime() + 6_000),
  });
  assert.equal(res2.answer, "Wkwk santai aja bro!");
  assert.equal(res2.remainingGroupQuota, 0);

  // 6. Group quota exhausted -> rejected cleanly before hitting API
  await assert.rejects(
    () =>
      service.ask({
        groupJid: "120@g.us",
        userJid: "6283@s.whatsapp.net",
        prompt: "masih bisa gak?",
        persona: "assistant",
        now: new Date(t0.getTime() + 20_000),
      }),
    /Kuota AI harian grup ini sudah habis/,
  );
});

void test("Tahap 1 Mobile-First Menu: headers <= 28 chars, numbered full list, sub-menus, and AI commands registered", async () => {
  for (const cmd of ["ai", "tanya", "gpt", "minji", "simi", "simsimi"]) {
    assert.equal(commandRouter.has(cmd), true, `Command .${cmd} harus terdaftar di commandRouter`);
  }

  const menu = new MenuService({
    findByGroupJid: () => Promise.resolve(buildTenantFeatureSetting()),
  } as never);
  const tenantGroup = buildTenantGroup();

  const fullMenu = await menu.buildMenu(
    buildCommandContext({
      isGroup: true,
      tenantGroup,
      commandName: "menu",
      args: [],
    }),
  );

  // Check every boxed section header (*── [ ... ] ──*) is <= 28 characters (anti-wrap on mobile)
  const headerLines = fullMenu
    .split("\n")
    .filter((line) => line.startsWith("*── [") && line.endsWith("] ──*"));
  assert.ok(headerLines.length >= 8);
  for (const hdr of headerLines) {
    assert.ok(
      hdr.length <= 28,
      `Header menu melebihi 28 karakter (${String(hdr.length)}): ${hdr}`,
    );
  }

  // Check continuous numbering and rich feature count (100+ items)
  assert.match(fullMenu, /1\. \.ai <tanya\/foto> \(L\)/);
  assert.match(fullMenu, /100\. \./);
  assert.match(fullMenu, /\.menu ai \| \.menu rpg \| \.menu game/);

  // All 8 sub-menus render cleanly
  for (const sub of ["ai", "rpg", "game", "fun", "media", "grup", "islami", "info"]) {
    const out = await menu.buildMenu(
      buildCommandContext({
        isGroup: true,
        tenantGroup,
        commandName: "menu",
        args: [sub],
      }),
    );
    assert.match(out, /SUB-MENU/);
  }
});
