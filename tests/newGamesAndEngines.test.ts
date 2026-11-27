import assert from "node:assert/strict";
import test from "node:test";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";

import { commandRouter } from "../src/commands";
import { GameService } from "../src/services/game/game.service";
import { ShuffleDeckManager, generateMixedMtkQuestion } from "../src/services/game/gameBank";
import { BOM_REWARD, CAKLONTONG_REWARD, KATLA_REWARD } from "../src/services/game/gameReward.constants";
import { GameRewardService } from "../src/services/game/gameReward.service";
import { createBomState, pickBomCell } from "../src/services/game/bomEngine";
import {
  evaluateKatlaGuess,
  revealNextKatlaClueIndex,
  validateKatlaGuess,
} from "../src/services/game/katlaEngine";
import { InteractiveReplyService } from "../src/services/interactiveSession/interactiveReply.service";
import type { CommandContext } from "../src/types/command";

function makeSpyRewardService() {
  const pointsCredits: { groupJid: string; userJid: string; amount: number; note?: string }[] = [];
  const xpCredits: { groupJid: string; userJid: string; amount: number; note?: string }[] = [];
  const gameResults: { groupJid: string; userJid: string; won: boolean }[] = [];

  const economy = {
    creditPoints: (input: {
      groupJid: string;
      userJid: string;
      amount: number;
      note?: string;
    }): Promise<unknown> => {
      pointsCredits.push(input);
      return Promise.resolve(null);
    },
    creditXp: (input: {
      groupJid: string;
      userJid: string;
      amount: number;
      note?: string;
    }): Promise<unknown> => {
      xpCredits.push(input);
      return Promise.resolve(null);
    },
    recordGameResult: (input: {
      groupJid: string;
      userJid: string;
      won: boolean;
    }): Promise<unknown> => {
      gameResults.push(input);
      return Promise.resolve(null);
    },
  };

  return {
    service: new GameRewardService(economy),
    pointsCredits,
    xpCredits,
    gameResults,
  };
}

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    socket: {} as never,
    message: {} as never,
    chatJid: "12036300111222@g.us",
    senderJid: "628111222333@s.whatsapp.net",
    senderUserJid: "628111222333@s.whatsapp.net",
    senderAltJids: ["628111222333@s.whatsapp.net"],
    isGroup: true,
    commandName: "katla",
    args: [],
    argsText: "",
    text: ".katla",
    mentionedJids: [],
    role: "MEMBER",
    reply: () => Promise.resolve(undefined),
    ...overrides,
  };
}

void test("CommandRouter: commands .katla, .caklontong, .bom, .clue terpasang dengan baik", () => {
  assert.ok(commandRouter.has("katla"));
  assert.ok(commandRouter.has("caklontong"));
  assert.ok(commandRouter.has("cakl"));
  assert.ok(commandRouter.has("bom"));
  assert.ok(commandRouter.has("clue"));
  assert.ok(commandRouter.has("hint"));
});

void test("ShuffleDeckManager: tidak mengulang soal sampai seluruh isi dek habis per grup", () => {
  const manager = new ShuffleDeckManager();
  const sample = ["a", "b", "c", "d", "e"];

  const drawnGroup1: string[] = Array.from({ length: sample.length }, () =>
    manager.draw("g1:kuis", sample),
  );
  assert.equal(new Set(drawnGroup1).size, sample.length);

  // Setelah habis, grup 1 mengocok ulang dek baru dan item pertama tidak sama dengan item terakhir siklus sebelumnya
  const nextDraw = manager.draw("g1:kuis", sample);
  assert.notEqual(nextDraw, drawnGroup1[drawnGroup1.length - 1]);
});

void test("MixedMTK: menghasilkan operasi campuran valid dengan hasil integer", () => {
  for (let i = 0; i < 40; i++) {
    const q = generateMixedMtkQuestion();
    assert.match(q.prompt, /Berapa hasil dari:/);
    assert.ok(q.answers[0]);
    const numeric = Number(q.answers[0]);
    assert.ok(Number.isInteger(numeric));
  }
});

void test("KatlaEngine: evaluasi 2-pass menangani huruf kembar secara akurat", () => {
  assert.deepEqual(evaluateKatlaGuess("nanas", "makan"), ["Y", "G", "B", "G", "B"]);
  assert.deepEqual(evaluateKatlaGuess("kakak", "kabar"), ["G", "G", "B", "G", "B"]);
  assert.deepEqual(evaluateKatlaGuess("minum", "minum"), ["G", "G", "G", "G", "G"]);
});

void test("KatlaEngine: validateKatlaGuess memblokir spam huruf acak sambil tetap meloloskan kata Indonesia wajar", () => {
  const validSet = new Set(["audio", "rumah", "sepatu", "jendela"]);

  // Tolak spam & non-kata
  assert.equal(validateKatlaGuess("AEIOU", 5, validSet).valid, false);
  assert.equal(validateKatlaGuess("BCDFG", 5, validSet).valid, false);
  assert.equal(validateKatlaGuess("AIUEOK", 6, validSet).valid, false);
  assert.equal(validateKatlaGuess("AAABC", 5, validSet).valid, false);
  assert.equal(validateKatlaGuess("QWERT", 5, validSet).valid, false);
  assert.equal(validateKatlaGuess("dua kata", 6, validSet).valid, false);
  assert.equal(validateKatlaGuess("bola", 5, validSet).valid, false);

  // Lolos kata wajar (baik yang ada di whitelist maupun imbuhan baru)
  assert.deepEqual(validateKatlaGuess("AUDIO", 5, validSet), { valid: true, word: "audio" });
  assert.deepEqual(validateKatlaGuess("NGOPI", 5, validSet), { valid: true, word: "ngopi" });
  assert.deepEqual(validateKatlaGuess("MEMBACA", 7, validSet), { valid: true, word: "membaca" });
  assert.deepEqual(validateKatlaGuess("SANTAI", 6, validSet), { valid: true, word: "santai" });
});

void test("KatlaEngine: revealNextKatlaClueIndex membuka huruf tanpa membocorkan semua huruf", () => {
  const state = {
    target: "sepatu",
    length: 6,
    maxAttempts: 6,
    guesses: [],
    revealedIndices: [],
  };
  assert.notEqual(revealNextKatlaClueIndex(state), null);
  assert.notEqual(revealNextKatlaClueIndex(state), null);
  // Batas maksimal 2 clue
  assert.equal(revealNextKatlaClueIndex(state), null);
});

void test("BomEngine: 9 papan 1 bom, menandai kotak aman dan mendeteksi sapu bersih serta bom", () => {
  const state = createBomState(4); // index 4 = kotak nomor 5

  for (const safeCell of [1, 2, 3, 4, 6, 7, 8]) {
    const out = pickBomCell(state, safeCell, "u1");
    assert.equal(out.status, "safe");
    assert.equal(out.cleanSweep, false);
  }

  const dup = pickBomCell(state, 1, "u1");
  assert.equal(dup.status, "already_open");

  const cleanSweep = pickBomCell(state, 9, "u1");
  assert.equal(cleanSweep.status, "safe");
  assert.equal(cleanSweep.cleanSweep, true);

  const state2 = createBomState(4);
  const boom = pickBomCell(state2, 5, "u1");
  assert.equal(boom.status, "bomb");
});

void test("GameService Katla: menebak kata dengan panjang salah tidak menghabiskan kesempatan dan menang memberi reward penuh", async () => {
  const spy = makeSpyRewardService();
  const service = new GameService(
    spy.service,
    () => 1,
    undefined,
    {
      targets: ["rumah", "kantor", "jendela"],
      validWords: ["rumah", "kantor", "jendela", "makan"],
    },
  );

  const startRes = await service.startOrAnswerQuizRich(makeCtx(), "katla");
  assert.match(startRes.text, /Game dimulai: Katla/);

  const active = service.getActiveQuiz("12036300111222@g.us");
  assert.ok(active?.katlaState);
  const target = active.katlaState.target;
  const wrongLengthGuess = target.length === 5 ? "kantor" : "makan";

  // Panjang salah -> kesempatan tetap 0 terpakai
  const invalidRes = await service.startOrAnswerQuizRich(
    makeCtx({ argsText: wrongLengthGuess }),
    "katla",
  );
  assert.match(invalidRes.text, /Panjang kata harus tepat/);
  assert.equal(active.katlaState.guesses.length, 0);

  // Tebakan tepat -> menang + creditPoints & mentions
  const winRes = await service.startOrAnswerQuizRich(makeCtx({ argsText: target }), "katla");
  assert.match(winRes.text, /Benar/);
  assert.equal(winRes.mentions?.[0], "628111222333@s.whatsapp.net");
  assert.ok(spy.pointsCredits.some((c) => c.amount === KATLA_REWARD.WIN_1_3_POINTS));
  assert.equal(service.hasActiveQuiz("12036300111222@g.us"), false);
});

void test("GameService CakLontong & Clue: menampilkan alasan kocak dan penyesuaian poin saat pakai .clue", async () => {
  const spy = makeSpyRewardService();
  const service = new GameService(spy.service, () => 1, {
    caklontong: [
      {
        prompt: "Kenapa motor rodanya dua?",
        answers: ["kalau empat mobil"],
        reason: "Kalau empat nanti jadi taksi!",
      },
    ],
  });

  const start = await service.startOrAnswerQuizRich(makeCtx({ commandName: "caklontong" }), "caklontong");
  assert.match(start.text, /cak lontong/);

  const clue = service.getClue(makeCtx({ commandName: "clue" }));
  assert.match(clue.text, /Petunjuk \(#1\):/);

  const win = await service.startOrAnswerQuizRich(
    makeCtx({ commandName: "caklontong", argsText: "kalau empat mobil" }),
    "caklontong",
  );
  assert.match(win.text, /Alasan: Kalau empat nanti jadi taksi!/);
  // 1 clue -> 15 - 2 = 13 pts
  assert.ok(spy.pointsCredits.some((c) => c.amount === CAKLONTONG_REWARD.CORRECT_POINTS - 2));
});

void test("GameService Bom: mengenai bom tidak mengurangi saldo poin (0 minus) dan hanya memberi +5 XP hiburan", async () => {
  const spy = makeSpyRewardService();
  // randomInt selalu kembalikan 4 -> bom di index 4 = kotak nomor 5
  const service = new GameService(spy.service, () => 4);

  const start = await service.startOrAnswerQuizRich(makeCtx({ commandName: "bom" }), "bom");
  assert.match(start.text, /Tebak Bom/);

  // Buka kotak aman #1
  const safeRes = await service.startOrAnswerQuizRich(
    makeCtx({ commandName: "bom", argsText: "1" }),
    "bom",
  );
  assert.match(safeRes.text, /Aman!/);
  assert.ok(spy.pointsCredits.some((c) => c.amount === BOM_REWARD.STEP_1_3_POINTS));

  const creditsBeforeBomb = spy.pointsCredits.length;

  // Buka kotak bom #5
  const boomRes = await service.startOrAnswerQuizRich(
    makeCtx({ commandName: "bom", argsText: "5" }),
    "bom",
  );
  assert.match(boomRes.text, /BOOM!/);
  assert.match(boomRes.text, /0 minus/);
  assert.equal(spy.pointsCredits.length, creditsBeforeBomb, "No negative debit on bomb hit");
  assert.ok(spy.xpCredits.some((c) => c.amount === BOM_REWARD.BOMB_CONSOLATION_XP));
  assert.equal(service.hasActiveQuiz("12036300111222@g.us"), false);
});

void test("InteractiveReplyService: mengabaikan chat biasa dan obrolan multi-kata saat mengutip papan .katla atau .bom", async () => {
  const spy = makeSpyRewardService();
  const game = new GameService(
    spy.service,
    () => 4,
    undefined,
    { targets: ["rumah"], validWords: ["rumah", "makan"] },
  );

  await game.startOrAnswerQuizRich(makeCtx({ commandName: "katla" }), "katla");
  game.setQuizMessageId("12036300111222@g.us", "BOT-KATLA-MSG");

  const sentMessages: string[] = [];
  const mockSocket = {
    sendMessage: (_jid: string, payload: { text?: string }) => {
      if (payload.text) sentMessages.push(payload.text);
      return Promise.resolve({ key: { id: "BOT-REPLY-2" } });
    },
  } as unknown as WASocket;

  const mockRole = { resolveRole: () => Promise.resolve("MEMBER") };
  const mockTenant = { checkGroupCommandAccess: () => Promise.resolve({ allowed: true }) };
  const mockFeature = { checkCommandFeature: () => Promise.resolve({ allowed: true }) };
  const replyService = new InteractiveReplyService(
    game,
    mockRole as never,
    mockTenant as never,
    mockFeature as never,
  );

  // 1. Chat biasa tanpa quote
  const plainMsg: WAMessage = {
    key: { fromMe: false, remoteJid: "12036300111222@g.us", participant: "6281@s.whatsapp.net" },
    message: { conversation: "rumah" },
  };
  assert.equal(await replyService.handleIncomingReply(mockSocket, plainMsg), false);

  // 2. Mengutip papan .katla tapi isinya komentar obrolan multi-kata
  const banterMsg: WAMessage = {
    key: { fromMe: false, remoteJid: "12036300111222@g.us", participant: "6281@s.whatsapp.net" },
    message: {
      extendedTextMessage: {
        text: "susah amat bang bentar mikir!",
        contextInfo: {
          stanzaId: "BOT-KATLA-MSG",
          participant: "bot@s.whatsapp.net",
          quotedMessage: { conversation: "Game dimulai: Katla." },
        },
      },
    },
  };
  assert.equal(await replyService.handleIncomingReply(mockSocket, banterMsg), false);
  assert.equal(sentMessages.length, 0);

  // 3. Mengutip papan .katla dengan 1 kata huruf A-Z -> diproses dan menang
  const validGuessMsg: WAMessage = {
    key: { fromMe: false, remoteJid: "12036300111222@g.us", participant: "6281@s.whatsapp.net" },
    message: {
      extendedTextMessage: {
        text: "rumah",
        contextInfo: {
          stanzaId: "BOT-KATLA-MSG",
          participant: "bot@s.whatsapp.net",
          quotedMessage: { conversation: "Game dimulai: Katla." },
        },
      },
    },
  };
  assert.equal(await replyService.handleIncomingReply(mockSocket, validGuessMsg), true);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0] ?? "", /Benar/);
});
