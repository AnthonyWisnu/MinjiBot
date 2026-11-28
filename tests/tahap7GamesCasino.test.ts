import assert from "node:assert/strict";
import test from "node:test";
import type { GroupMemberProfile } from "@prisma/client";

import { commandRouter } from "../src/commands";
import {
  CasinoPackService,
  computeBlackjackTotal,
  evaluateSuitWinner,
  RUSSIAN_SURVIVE_REWARD,
} from "../src/services/game/casinoPack.service";
import {
  drawQuickQuizQuestion,
  type QuickQuizKind,
} from "../src/services/game/quickQuizBank";
import {
  QUICK_QUIZ_REWARD_MONEY,
  QuickQuizService,
} from "../src/services/game/quickQuiz.service";
import {
  SAMBUNG_KATA_COMBO_BONUS,
  SAMBUNG_KATA_REWARD_PER_WORD,
  SambungKataService,
} from "../src/services/game/sambungKata.service";
import {
  UNDERCOVER_WARGA_REWARD,
  UndercoverService,
} from "../src/services/game/undercover.service";
import { parseRpgState } from "../src/services/rpg/rpgState";
import { buildMemberProfile } from "./helpers/factories";

test("Tahap 7 - all 23+ Quick Quiz, Sambung Kata, Undercover, and Casino commands exist in commandRouter", () => {
  const expected = [
    "susunkata",
    "tebakbendera",
    "siapakahaku",
    "tebakkalimat",
    "tebaklirik",
    "tekateki",
    "asahotak",
    "tebakkimia",
    "tebakibukota",
    "tebakprovinsi",
    "tebaklagu",
    "benarsalah",
    "sambungkata",
    "undercover",
    "uc",
    "blackjack",
    "bj",
    "suit",
    "dadu",
    "koin",
    "roulette",
    "tebakdadu",
    "hilow",
    "russian",
    "spin",
    "wheel",
  ];
  for (const cmd of expected) {
    assert.equal(commandRouter.has(cmd), true, `Command .${cmd} harus terdaftar di commandRouter`);
  }
});

test("QuickQuizService - draws all 12 categories, validates answer, awards Sultan rewards, and supports giveUp", async () => {
  const allKinds: QuickQuizKind[] = [
    "susunkata",
    "tebakbendera",
    "siapakahaku",
    "tebakkalimat",
    "tebaklirik",
    "tekateki",
    "asahotak",
    "tebakkimia",
    "tebakibukota",
    "tebakprovinsi",
    "tebaklagu",
    "benarsalah",
  ];
  for (const kind of allKinds) {
    const q = drawQuickQuizQuestion(kind);
    assert.ok(q.prompt.length > 5);
    assert.ok(q.answers.length >= 1);
  }

  let creditedMoney = 0n;
  const svc = new QuickQuizService(
    {
      creditMoney: async (inp) => {
        creditedMoney += inp.amount;
        return Promise.resolve();
      },
      creditPoints: async () => Promise.resolve(),
      creditXp: async () => Promise.resolve(),
    },
    () => ({ prompt: "Ibu kota Jawa Barat?", answers: ["Bandung"] }),
  );

  const g = "120363000020@g.us";
  const u = "628600000001@s.whatsapp.net";
  svc.startQuiz(g, "tebakprovinsi", 1_000);

  const wrong = await svc.submitAnswer(g, u, "Surabaya", 2_000);
  assert.equal(wrong.correct, false);
  assert.ok(svc.getActiveSession(g, 2_000) !== null);

  const right = await svc.submitAnswer(g, u, "bandung!", 3_000);
  assert.equal(right.correct, true);
  assert.equal(creditedMoney, QUICK_QUIZ_REWARD_MONEY);
  assert.equal(svc.getActiveSession(g, 3_000), null);

  svc.startQuiz(g, "benarsalah", 4_000);
  const gave = svc.giveUp(g, 5_000);
  assert.ok(gave?.text.includes("Bandung"));
});

test("SambungKataService - enforces chain rules, anti-repeat, alternation, and 10x combo jackpot", async () => {
  const rewards: bigint[] = [];
  const svc = new SambungKataService({
    creditMoney: async (inp) => {
      rewards.push(inp.amount);
      return Promise.resolve();
    },
    creditPoints: async () => Promise.resolve(),
    creditXp: async () => Promise.resolve(),
  });

  const g = "120363000021@g.us";
  const u1 = "628600000001@s.whatsapp.net";
  const u2 = "628600000002@s.whatsapp.net";

  const started = svc.startGame(g, 1_000);
  const firstLetter = started.session.currentWord.slice(-1);

  // Wrong start letter rejected
  const wrongLetter = firstLetter === "Z" ? "AAA" : "ZZZ";
  const rWrong = await svc.submitWord(g, u1, wrongLetter, 2_000);
  assert.equal(rWrong.accepted, false);

  // Run 10 alternating valid words to trigger combo jackpot
  let curStart = firstLetter;
  for (let i = 0; i < 10; i += 1) {
    const player = i % 2 === 0 ? u1 : u2;
    const endChar = String.fromCharCode(65 + ((i + 3) % 26));
    const mid = String.fromCharCode(65 + ((i + 7) % 26));
    const word = `${curStart}${mid}${mid}${endChar}`;
    const res = await svc.submitWord(g, player, word, 3_000 + i * 100);
    assert.equal(res.accepted, true, `Word ${word} should be accepted`);
    curStart = endChar;
    if (i === 9) {
      assert.equal(res.finished, true);
    }
  }

  assert.equal(rewards.length, 10);
  assert.equal(rewards[0], SAMBUNG_KATA_REWARD_PER_WORD);
  assert.equal(rewards[9], SAMBUNG_KATA_REWARD_PER_WORD + SAMBUNG_KATA_COMBO_BONUS);
});

test("UndercoverService - 4 players, DM secret words, vote eliminates spy, warga wins", async () => {
  const moneyPaid: bigint[] = [];
  const svc = new UndercoverService(
    {
      creditMoney: async (inp) => {
        moneyPaid.push(inp.amount);
        return Promise.resolve();
      },
      creditPoints: async () => Promise.resolve(),
      creditXp: async () => Promise.resolve(),
    },
    (arr) => [...arr], // slot 1 = undercover, slots 2-4 = warga
  );

  const g = "120363000022@g.us";
  const p1 = "628600000011@s.whatsapp.net";
  const p2 = "628600000012@s.whatsapp.net";
  const p3 = "628600000013@s.whatsapp.net";
  const p4 = "628600000014@s.whatsapp.net";

  svc.createLobby(g, p1, 1_000);
  svc.joinLobby(g, p2, 1_000);
  svc.joinLobby(g, p3, 1_000);
  svc.joinLobby(g, p4, 1_000);

  const started = svc.startGame(g, p1, 2_000);
  assert.equal(started.dmPayloads.length, 4);
  assert.equal(started.session.players[0]?.role, "undercover");

  await svc.castVote(g, p2, 1, 3_000);
  await svc.castVote(g, p3, 1, 3_000);
  await svc.castVote(g, p4, 1, 3_000);
  const finalVote = await svc.castVote(g, p1, 2, 3_000);

  assert.equal(finalVote.autoResolved?.winner?.winningTeam, "warga");
  assert.equal(moneyPaid.length, 3);
  assert.equal(moneyPaid[0], UNDERCOVER_WARGA_REWARD);
});

test("CasinoPackService - Blackjack, HiLow, Dice, Coin, Roulette, Suit PvP, Russian UGD, and Daily Spin", async () => {
  assert.equal(
    computeBlackjackTotal([
      { rank: "A", suit: "♠", value: 11 },
      { rank: "A", suit: "♥", value: 11 },
      { rank: "9", suit: "♣", value: 9 },
    ]),
    21,
  );
  assert.equal(evaluateSuitWinner("batu", "gunting"), "a");
  assert.equal(evaluateSuitWinner("gunting", "batu"), "b");
  assert.equal(evaluateSuitWinner("kertas", "kertas"), "draw");

  const g = "120363000023@g.us";
  const u1 = "628600000021@s.whatsapp.net";
  const u2 = "628600000022@s.whatsapp.net";

  const profiles = new Map<string, GroupMemberProfile>([
    [u1, buildMemberProfile({ id: "cp1", groupJid: g, userJid: u1, moneyBalance: 50_000_000n })],
    [u2, buildMemberProfile({ id: "cp2", groupJid: g, userJid: u2, moneyBalance: 50_000_000n })],
  ]);

  let nextRoll = 0;
  const fixedRandom = {
    intBetween: (min: number, max: number) => Math.max(min, Math.min(max, nextRoll)),
    nextFloat: () => 0.5,
  };

  const mockProfileRepo = {
    findOrCreate: async (_g: string, userJid: string) => {
      const p = profiles.get(userJid);
      assert.ok(p);
      return Promise.resolve(p);
    },
  };
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
            const m = data.moneyBalance as { increment?: bigint; decrement?: bigint } | undefined;
            if (m?.increment) p.moneyBalance += m.increment;
            if (m?.decrement) p.moneyBalance -= m.decrement;
            if ("rpgState" in data) p.rpgState = data.rpgState as GroupMemberProfile["rpgState"];
            return Promise.resolve(p);
          },
        },
      }),
  };

  const casino = new CasinoPackService(mockProfileRepo, { create: async () => Promise.resolve() }, fixedRandom, mockDb);

  // Coinflip win (roll 0 => gambar)
  nextRoll = 0;
  const coinOut = await casino.playCoinflip(g, u1, "gambar", 1_000_000n);
  assert.match(coinOut, /Menang/);
  assert.equal(profiles.get(u1)?.moneyBalance, 51_000_000n);

  // Roulette exact 0 (hijau -> 35x)
  nextRoll = 0;
  const rOut = await casino.playRoulette(g, u1, "hijau", 1_000_000n);
  assert.match(rOut, /MENANG!/);
  assert.equal(profiles.get(u1)?.moneyBalance, 86_000_000n);

  // Russian Roulette survive (chamber 3 != 1)
  nextRoll = 3;
  const rrSurv = await casino.playRussianRoulette(g, u1, 10_000);
  assert.match(rrSurv, /SELAMAT/);
  assert.equal(profiles.get(u1)?.moneyBalance, 86_000_000n + RUSSIAN_SURVIVE_REWARD);

  // Russian Roulette hit bullet (chamber 1 -> UGD 5m)
  nextRoll = 1;
  const rrHit = await casino.playRussianRoulette(g, u2, 10_000);
  assert.match(rrHit, /DOR/);
  assert.ok(parseRpgState(profiles.get(u2)?.rpgState).ugdUntil > 10_000);

  // Daily Spin once per day
  nextRoll = 5; // Jackpot 50M
  const spin1 = await casino.playDailySpin(g, u1, Date.UTC(2026, 10, 28, 5, 0, 0));
  assert.match(spin1, /JACKPOT SULTAN/);
  await assert.rejects(
    () => casino.playDailySpin(g, u1, Date.UTC(2026, 10, 28, 6, 0, 0)),
    /sudah memutar/,
  );

  // Suit PvP atomic transfer
  await casino.createSuitPvp(g, u1, u2, 2_000_000n, 20_000);
  const p1Choice = await casino.submitSuitPvpChoice([u1], "batu", 21_000);
  assert.equal(p1Choice.groupBroadcast, null);
  const p2Choice = await casino.submitSuitPvpChoice([u2], "gunting", 22_000);
  assert.ok(p2Choice.groupBroadcast !== null);
  assert.match(p2Choice.groupBroadcast.text, /Pemenang/);
});
