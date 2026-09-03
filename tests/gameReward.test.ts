import { test } from "node:test";
import assert from "node:assert/strict";

import { GameService } from "../src/services/game/game.service";
import { GameRewardService } from "../src/services/game/gameReward.service";
import { DuplicateOperationError } from "../src/types/memberEconomy";
import {
  KUIS_REWARD,
  TEBAKKATA_REWARD,
  TEBAKEMOJI_REWARD,
  TEBAKANGKA_REWARD,
  FAMILY100_REWARD,
  TICTACTOE_REWARD,
  getTebakangkaReward,
} from "../src/services/game/gameReward.constants";
import type { CommandContext } from "../src/types/command";

// ---- Constants ----

void test("Reward constants: kuis correct is 100 pts / 40 XP", () => {
  assert.equal(KUIS_REWARD.CORRECT_POINTS, 100);
  assert.equal(KUIS_REWARD.CORRECT_XP, 40);
  assert.equal(KUIS_REWARD.WRONG_XP, 5);
});

void test("Reward constants: tebakkata correct is 125 pts / 50 XP", () => {
  assert.equal(TEBAKKATA_REWARD.CORRECT_POINTS, 125);
  assert.equal(TEBAKKATA_REWARD.CORRECT_XP, 50);
  assert.equal(TEBAKKATA_REWARD.SURRENDER_XP, 10);
});

void test("Reward constants: tebakemoji correct is 100 pts / 40 XP", () => {
  assert.equal(TEBAKEMOJI_REWARD.CORRECT_POINTS, 100);
  assert.equal(TEBAKEMOJI_REWARD.CORRECT_XP, 40);
  assert.equal(TEBAKEMOJI_REWARD.SURRENDER_XP, 10);
});

void test("Reward constants: tebakangka band 1-3 attempts is 200 pts / 80 XP", () => {
  const { points, xp } = getTebakangkaReward(1);
  assert.equal(points, TEBAKANGKA_REWARD.BAND_1_3.POINTS);
  assert.equal(xp, TEBAKANGKA_REWARD.BAND_1_3.XP);
});

void test("Reward constants: tebakangka attempt 3 is still band 1-3", () => {
  const { points } = getTebakangkaReward(3);
  assert.equal(points, 200);
});

void test("Reward constants: tebakangka attempt 4 is band 4-7 (150 pts / 60 XP)", () => {
  const { points, xp } = getTebakangkaReward(4);
  assert.equal(points, 150);
  assert.equal(xp, 60);
});

void test("Reward constants: tebakangka attempt 7 is still band 4-7", () => {
  const { points } = getTebakangkaReward(7);
  assert.equal(points, 150);
});

void test("Reward constants: tebakangka attempt 8+ is band 8+ (100 pts / 40 XP)", () => {
  const { points, xp } = getTebakangkaReward(8);
  assert.equal(points, 100);
  assert.equal(xp, 40);
});

void test("Reward constants: family100 cap is 450 pts / 180 XP", () => {
  assert.equal(FAMILY100_REWARD.CAP_POINTS, 450);
  assert.equal(FAMILY100_REWARD.CAP_XP, 180);
});

// ---- GameRewardService ----

interface RewardCall {
  method: string;
  groupJid: string;
  userJid: string;
  amount: number;
  idempotencyKey?: string;
}

function makeEconomy(opts: { throwDuplicate?: boolean } = {}) {
  const calls: RewardCall[] = [];

  return {
    economy: {
      creditPoints: (input: { groupJid: string; userJid: string; amount: number; idempotencyKey?: string }): Promise<unknown> => {
        if (opts.throwDuplicate) return Promise.reject(new DuplicateOperationError());
        calls.push({ method: "creditPoints", groupJid: input.groupJid, userJid: input.userJid, amount: input.amount, idempotencyKey: input.idempotencyKey });
        return Promise.resolve(null);
      },
      creditXp: (input: { groupJid: string; userJid: string; amount: number; idempotencyKey?: string }): Promise<unknown> => {
        if (opts.throwDuplicate) return Promise.reject(new DuplicateOperationError());
        calls.push({ method: "creditXp", groupJid: input.groupJid, userJid: input.userJid, amount: input.amount, idempotencyKey: input.idempotencyKey });
        return Promise.resolve(null);
      },
      recordGameResult: (input: { groupJid: string; userJid: string; won: boolean; idempotencyKey?: string }): Promise<unknown> => {
        if (opts.throwDuplicate) return Promise.reject(new DuplicateOperationError());
        calls.push({ method: "recordGameResult", groupJid: input.groupJid, userJid: input.userJid, amount: input.won ? 1 : 0 });
        return Promise.resolve(null);
      },
    },
    calls,
  };
}

void test("GameRewardService: awardKuisCorrect credits points, XP, and game stat", async () => {
  const { economy, calls } = makeEconomy();
  const service = new GameRewardService(economy);
  const result = await service.awardKuisCorrect("g@g.us", "u@s.whatsapp.net", "round-1", "corr-1");
  assert.equal(result.points, 100);
  assert.equal(result.xp, 40);
  assert.equal(calls.filter(c => c.method === "creditPoints").length, 1);
  assert.equal(calls.filter(c => c.method === "creditXp").length, 1);
  assert.equal(calls.filter(c => c.method === "recordGameResult").length, 1);
});

void test("GameRewardService: awardKuisWrongParticipation only credits XP", async () => {
  const { economy, calls } = makeEconomy();
  const service = new GameRewardService(economy);
  const awarded = await service.awardKuisWrongParticipation("g@g.us", "u@s.whatsapp.net", "round-1", "corr-1");
  assert.ok(awarded);
  assert.equal(calls.filter(c => c.method === "creditPoints").length, 0);
  assert.equal(calls.filter(c => c.method === "creditXp").length, 1);
  assert.equal(calls[0]?.amount, KUIS_REWARD.WRONG_XP);
});

void test("GameRewardService: duplicate key is swallowed and returns false", async () => {
  const { economy } = makeEconomy({ throwDuplicate: true });
  const service = new GameRewardService(economy);
  const awarded = await service.awardKuisWrongParticipation("g@g.us", "u@s.whatsapp.net", "round-1", "corr-1");
  assert.equal(awarded, false);
});

void test("GameRewardService: awardTebakAngkaCorrect uses tiered reward", async () => {
  const { economy, calls } = makeEconomy();
  const service = new GameRewardService(economy);
  const result = await service.awardTebakAngkaCorrect("g@g.us", "u@s.whatsapp.net", "round-1", 2, "corr-1");
  assert.equal(result.points, 200);
  assert.equal(result.xp, 80);
  assert.equal(calls.find(c => c.method === "creditPoints")?.amount, 200);
});

void test("GameRewardService: awardFamily100Answer respects cap", async () => {
  const { economy, calls } = makeEconomy();
  const service = new GameRewardService(economy);
  // User already at cap.
  const result = await service.awardFamily100Answer(
    "g@g.us", "u@s.whatsapp.net", "round-1", "kompor", "corr-1",
    FAMILY100_REWARD.CAP_POINTS, FAMILY100_REWARD.CAP_XP,
  );
  assert.ok(result.capped);
  assert.equal(result.points, 0);
  assert.equal(calls.length, 0);
});

void test("GameRewardService: awardFamily100Answer awards partial when near cap", async () => {
  const { economy, calls } = makeEconomy();
  const service = new GameRewardService(economy);
  // User has 440 pts earned (cap is 450), so can only get 10 more pts.
  const result = await service.awardFamily100Answer(
    "g@g.us", "u@s.whatsapp.net", "round-1", "panci", "corr-1",
    440, 0,
  );
  assert.ok(!result.capped);
  assert.equal(result.points, 10); // min(75, 450-440) = 10
  assert.ok(calls.some(c => c.method === "creditPoints" && c.amount === 10));
});

// ---- GameService (integration via fake reward service) ----

interface FakeRewardService {
  calls: string[];
  creditedPoints: { userJid: string; points: number }[];
  creditedXp: { userJid: string; xp: number }[];
}

// Fixed quiz banks for deterministic tests.
const FIXED_KUIS_BANK = [{ prompt: "Apa ibu kota Indonesia?", answers: ["jakarta"] }];
const FIXED_FAMILY100_BANK = [{
  prompt: "Sebutkan benda di dapur.",
  answers: ["kompor", "panci", "wajan", "pisau", "sendok", "piring"],
}];
const FIXED_TEBAKKATA_BANK = [{ prompt: "Tebak kata.", answers: ["keyboard"] }];
const FIXED_TEBAKEMOJI_BANK = [{ prompt: "Tebak emoji.", answers: ["rumah sakit"] }];
const DETERMINISTIC_BANK = {
  kuis: FIXED_KUIS_BANK,
  family100: FIXED_FAMILY100_BANK,
  tebakkata: FIXED_TEBAKKATA_BANK,
  tebakemoji: FIXED_TEBAKEMOJI_BANK,
};

function makeFakeRewardService(): { service: GameRewardService; spy: FakeRewardService } {
  const spy: FakeRewardService = { calls: [], creditedPoints: [], creditedXp: [] };

  const fakeMethods = {
    creditPoints: (input: { groupJid: string; userJid: string; amount: number }): Promise<unknown> => {
      spy.creditedPoints.push({ userJid: input.userJid, points: input.amount });
      return Promise.resolve(null);
    },
    creditXp: (input: { groupJid: string; userJid: string; amount: number }): Promise<unknown> => {
      spy.creditedXp.push({ userJid: input.userJid, xp: input.amount });
      return Promise.resolve(null);
    },
    recordGameResult: (): Promise<unknown> => {
      spy.calls.push("recordGameResult");
      return Promise.resolve(null);
    },
  };

  const rewardService = new GameRewardService(fakeMethods);
  return { service: rewardService, spy };
}

function makeGameContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    socket: {} as never,
    message: {} as never,
    chatJid: "120@g.us",
    senderJid: "628@s.whatsapp.net",
    senderUserJid: "628@s.whatsapp.net",
    senderAltJids: ["628@s.whatsapp.net"],
    isGroup: true,
    commandName: "kuis",
    args: [],
    argsText: "",
    text: ".kuis",
    mentionedJids: [],
    role: "MEMBER",
    reply: () => Promise.resolve(undefined),
    ...overrides,
  };
}

void test("GameService: kuis correct answer awards points and XP", async () => {
  const { service, spy } = makeFakeRewardService();
  const gameService = new GameService(service, () => 10, DETERMINISTIC_BANK);
  const ctx = makeGameContext();

  // Start game.
  await gameService.startOrAnswerQuiz(ctx, "kuis");

  // Answer correctly.
  const answerCtx = makeGameContext({ argsText: "jakarta" });
  const result = await gameService.startOrAnswerQuiz(answerCtx, "kuis");

  assert.match(result, /Benar/);
  assert.match(result, /100/);
  assert.ok(spy.creditedPoints.some(c => c.points === 100));
  assert.ok(spy.creditedXp.some(c => c.xp === 40));
});

void test("GameService: kuis wrong answer awards wrong XP once per user", async () => {
  const { service, spy } = makeFakeRewardService();
  const gameService = new GameService(service, () => 10, DETERMINISTIC_BANK);
  const ctx = makeGameContext();

  await gameService.startOrAnswerQuiz(ctx, "kuis");

  // First wrong answer.
  const wrong1 = makeGameContext({ argsText: "bandung" });
  await gameService.startOrAnswerQuiz(wrong1, "kuis");

  // Second wrong answer from same user.
  const wrong2 = makeGameContext({ argsText: "surabaya" });
  await gameService.startOrAnswerQuiz(wrong2, "kuis");

  // Only 1 wrong XP credited.
  const wrongXpCalls = spy.creditedXp.filter(c => c.xp === KUIS_REWARD.WRONG_XP);
  assert.equal(wrongXpCalls.length, 1);
});

void test("GameService: tebakangka tracks attempts and rewards correct tier", async () => {
  const { service, spy } = makeFakeRewardService();
  // Fix random to target = 5.
  const gameService = new GameService(service, () => 5, DETERMINISTIC_BANK);
  const ctx = makeGameContext({ commandName: "tebakangka" });

  await gameService.startOrAnswerQuiz(ctx, "tebakangka");

  // Wrong attempt 1.
  await gameService.startOrAnswerQuiz(makeGameContext({ argsText: "3", commandName: "tebakangka" }), "tebakangka");
  // Wrong attempt 2.
  await gameService.startOrAnswerQuiz(makeGameContext({ argsText: "4", commandName: "tebakangka" }), "tebakangka");
  // Correct on attempt 3 (band 1-3 = 200 pts).
  const result = await gameService.startOrAnswerQuiz(makeGameContext({ argsText: "5", commandName: "tebakangka" }), "tebakangka");

  assert.match(result, /Benar/);
  assert.match(result, /200/);
  assert.ok(spy.creditedPoints.some(c => c.points === 200));
});

void test("GameService: tebakangka attempt 4 yields band 4-7 reward", async () => {
  const { service, spy } = makeFakeRewardService();
  const gameService = new GameService(service, () => 10, DETERMINISTIC_BANK);
  const ctx = makeGameContext({ commandName: "tebakangka" });

  await gameService.startOrAnswerQuiz(ctx, "tebakangka");
  // 3 wrong attempts.
  for (const n of [1, 2, 3]) {
    await gameService.startOrAnswerQuiz(makeGameContext({ argsText: String(n), commandName: "tebakangka" }), "tebakangka");
  }
  // Correct on attempt 4.
  const result = await gameService.startOrAnswerQuiz(makeGameContext({ argsText: "10", commandName: "tebakangka" }), "tebakangka");
  assert.match(result, /150/);
  assert.ok(spy.creditedPoints.some(c => c.points === 150));
});

void test("GameService: family100 multiple users get independent rewards", async () => {
  const { service, spy } = makeFakeRewardService();
  const gameService = new GameService(service, () => 1, DETERMINISTIC_BANK);

  await gameService.startOrAnswerQuiz(makeGameContext({ commandName: "family100" }), "family100");

  // User A answers "kompor".
  const ctxA = makeGameContext({ senderUserJid: "userA@s.whatsapp.net", argsText: "kompor", commandName: "family100" });
  await gameService.startOrAnswerQuiz(ctxA, "family100");

  // User B answers "panci".
  const ctxB = makeGameContext({ senderUserJid: "userB@s.whatsapp.net", argsText: "panci", commandName: "family100" });
  await gameService.startOrAnswerQuiz(ctxB, "family100");

  // Both should have received points.
  assert.ok(spy.creditedPoints.some(c => c.userJid === "userA@s.whatsapp.net"));
  assert.ok(spy.creditedPoints.some(c => c.userJid === "userB@s.whatsapp.net"));
});

void test("GameService: family100 duplicate answer not rewarded again", async () => {
  const { service, spy } = makeFakeRewardService();
  const gameService = new GameService(service, () => 1, DETERMINISTIC_BANK);

  await gameService.startOrAnswerQuiz(makeGameContext({ commandName: "family100" }), "family100");

  const ctxA = makeGameContext({ senderUserJid: "userA@s.whatsapp.net", argsText: "kompor", commandName: "family100" });
  await gameService.startOrAnswerQuiz(ctxA, "family100");

  const pointsBefore = spy.creditedPoints.length;

  // Same answer again.
  const ctxA2 = makeGameContext({ senderUserJid: "userA@s.whatsapp.net", argsText: "kompor", commandName: "family100" });
  const dupResult = await gameService.startOrAnswerQuiz(ctxA2, "family100");
  assert.match(dupResult, /sudah ditemukan/);
  assert.equal(spy.creditedPoints.length, pointsBefore); // No new credits.
});

void test("GameService: family100 surrender preserves prior rewards (no refund)", async () => {
  const { service, spy } = makeFakeRewardService();
  const gameService = new GameService(service, () => 1, DETERMINISTIC_BANK);

  await gameService.startOrAnswerQuiz(makeGameContext({ commandName: "family100" }), "family100");

  const ctxA = makeGameContext({ senderUserJid: "userA@s.whatsapp.net", argsText: "kompor", commandName: "family100" });
  await gameService.startOrAnswerQuiz(ctxA, "family100");

  const pointsAfterAnswer = spy.creditedPoints.length;
  assert.ok(pointsAfterAnswer > 0);

  // Surrender — rewards already committed, no deduction.
  await gameService.surrender(makeGameContext());
  // Points remain the same.
  assert.equal(spy.creditedPoints.length, pointsAfterAnswer);
});

void test("GameService: tebakkata surrender awards XP only to wrong participants", async () => {
  const { service, spy } = makeFakeRewardService();
  const gameService = new GameService(service, () => 1, DETERMINISTIC_BANK);

  await gameService.startOrAnswerQuiz(makeGameContext({ commandName: "tebakkata" }), "tebakkata");

  // User A answers wrong.
  const ctxA = makeGameContext({ senderUserJid: "userA@s.whatsapp.net", argsText: "salah", commandName: "tebakkata" });
  await gameService.startOrAnswerQuiz(ctxA, "tebakkata");

  spy.creditedXp.length = 0; // Reset to track only surrender credits.

  // Surrender.
  await gameService.surrender(makeGameContext({ senderUserJid: "userA@s.whatsapp.net" }));

  // UserA should get surrender XP.
  assert.ok(spy.creditedXp.some(c => c.userJid === "userA@s.whatsapp.net" && c.xp === TEBAKKATA_REWARD.SURRENDER_XP));
});

void test("GameService: .nyerah with no wrong participants gives no XP", async () => {
  const { service, spy } = makeFakeRewardService();
  const gameService = new GameService(service, () => 1, DETERMINISTIC_BANK);

  await gameService.startOrAnswerQuiz(makeGameContext({ commandName: "tebakkata" }), "tebakkata");
  spy.creditedXp.length = 0;

  // Surrender without anyone having answered.
  await gameService.surrender(makeGameContext());
  assert.equal(spy.creditedXp.length, 0);
});

void test("GameService: game not stored in memory after correct answer", async () => {
  const { service } = makeFakeRewardService();
  const gameService = new GameService(service, () => 1, DETERMINISTIC_BANK);
  const ctx = makeGameContext();

  await gameService.startOrAnswerQuiz(ctx, "kuis");
  await gameService.startOrAnswerQuiz(makeGameContext({ argsText: "jakarta" }), "kuis");

  // After correct answer, no active game session.
  const afterResult = await gameService.startOrAnswerQuiz(makeGameContext({ argsText: "x" }), "kuis");
  assert.match(afterResult, /Belum ada/);
});

void test("GameService: different groups have isolated sessions", async () => {
  const { service } = makeFakeRewardService();
  const gameService = new GameService(service, () => 1, DETERMINISTIC_BANK);

  const ctxGroup1 = makeGameContext({ chatJid: "group1@g.us" });
  const ctxGroup2 = makeGameContext({ chatJid: "group2@g.us" });

  await gameService.startOrAnswerQuiz(ctxGroup1, "kuis");

  // Group 2 has no session.
  const result = await gameService.startOrAnswerQuiz(
    makeGameContext({ chatJid: "group2@g.us", argsText: "jakarta" }),
    "kuis",
  );
  assert.match(result, /Belum ada/);

  // Group 2 starts its own.
  await gameService.startOrAnswerQuiz(ctxGroup2, "kuis");

  // Both groups independently active.
  const r1 = await gameService.startOrAnswerQuiz(
    makeGameContext({ chatJid: "group1@g.us", argsText: "bandung" }),
    "kuis",
  );
  const r2 = await gameService.startOrAnswerQuiz(
    makeGameContext({ chatJid: "group2@g.us", argsText: "bandung" }),
    "kuis",
  );
  assert.equal(r1, r2); // Both return wrong answer.
});

// ---- TicTacToe PvP ----

void test("TicTacToe: challenge creates waiting session", async () => {
  const { service } = makeFakeRewardService();
  const gameService = new GameService(service, () => 1, DETERMINISTIC_BANK);

  const challenger = makeGameContext({ senderUserJid: "playerA@s.whatsapp.net", mentionedJids: ["playerB@s.whatsapp.net"] });
  const result = await gameService.playTicTacToe(challenger);
  assert.match(result, /Tantangan dikirim/);
  assert.match(result, /playerB/);
});

void test("TicTacToe: self-challenge is rejected", async () => {
  const { service } = makeFakeRewardService();
  const gameService = new GameService(service, () => 1, DETERMINISTIC_BANK);

  const ctx = makeGameContext({ senderUserJid: "playerA@s.whatsapp.net", mentionedJids: ["playerA@s.whatsapp.net"] });
  const result = await gameService.playTicTacToe(ctx);
  assert.match(result, /diri sendiri/);
});

void test("TicTacToe: only challenged player can accept", async () => {
  const { service } = makeFakeRewardService();
  const gameService = new GameService(service, () => 1, DETERMINISTIC_BANK);

  await gameService.playTicTacToe(makeGameContext({ senderUserJid: "playerA@s.whatsapp.net", mentionedJids: ["playerB@s.whatsapp.net"] }));

  // Stranger tries to accept.
  const stranger = makeGameContext({ senderUserJid: "playerC@s.whatsapp.net", mentionedJids: [] });
  const result = await gameService.playTicTacToe(stranger);
  assert.match(result, /bukan untukmu/);
});

void test("TicTacToe: accept starts game and player1 goes first", async () => {
  const { service } = makeFakeRewardService();
  const gameService = new GameService(service, () => 1, DETERMINISTIC_BANK);

  await gameService.playTicTacToe(makeGameContext({ senderUserJid: "playerA@s.whatsapp.net", mentionedJids: ["playerB@s.whatsapp.net"] }));

  const acceptCtx = makeGameContext({ senderUserJid: "playerB@s.whatsapp.net", mentionedJids: [] });
  const result = await gameService.playTicTacToe(acceptCtx);
  assert.match(result, /Game dimulai/);
  assert.match(result, /playerA.*X/);
});

void test("TicTacToe: wrong player turn is rejected", async () => {
  const { service } = makeFakeRewardService();
  const gameService = new GameService(service, () => 1, DETERMINISTIC_BANK);

  await gameService.playTicTacToe(makeGameContext({ senderUserJid: "playerA@s.whatsapp.net", mentionedJids: ["playerB@s.whatsapp.net"] }));
  await gameService.playTicTacToe(makeGameContext({ senderUserJid: "playerB@s.whatsapp.net", mentionedJids: [] }));

  // PlayerB tries to move first (should be playerA turn).
  const wrongTurn = makeGameContext({ senderUserJid: "playerB@s.whatsapp.net", args: ["1"] });
  const result = await gameService.playTicTacToe(wrongTurn);
  assert.match(result, /Bukan giliranmu/);
});

void test("TicTacToe: valid move advances turn to other player", async () => {
  const { service } = makeFakeRewardService();
  const gameService = new GameService(service, () => 1, DETERMINISTIC_BANK);

  await gameService.playTicTacToe(makeGameContext({ senderUserJid: "playerA@s.whatsapp.net", mentionedJids: ["playerB@s.whatsapp.net"] }));
  await gameService.playTicTacToe(makeGameContext({ senderUserJid: "playerB@s.whatsapp.net", mentionedJids: [] }));

  const moveCtx = makeGameContext({ senderUserJid: "playerA@s.whatsapp.net", args: ["1"] });
  const result = await gameService.playTicTacToe(moveCtx);
  assert.match(result, /Langkah diterima/);
  assert.match(result, /playerB.*O/);
});

void test("TicTacToe: win awards winner and loser correctly", async () => {
  const { service, spy } = makeFakeRewardService();
  const gameService = new GameService(service, () => 1, DETERMINISTIC_BANK);

  await gameService.playTicTacToe(makeGameContext({ senderUserJid: "playerA@s.whatsapp.net", mentionedJids: ["playerB@s.whatsapp.net"] }));
  await gameService.playTicTacToe(makeGameContext({ senderUserJid: "playerB@s.whatsapp.net", mentionedJids: [] }));

  // PlayerA wins by filling top row: pos 1, 2, 3 (X).
  // PlayerA moves 1, PlayerB moves 4, PlayerA moves 2, PlayerB moves 5, PlayerA moves 3 = win.
  const move = (jid: string, pos: string) =>
    gameService.playTicTacToe(makeGameContext({ senderUserJid: jid, args: [pos] }));

  await move("playerA@s.whatsapp.net", "1");
  await move("playerB@s.whatsapp.net", "4");
  await move("playerA@s.whatsapp.net", "2");
  await move("playerB@s.whatsapp.net", "5");
  const result = await move("playerA@s.whatsapp.net", "3");

  assert.match(result, /menang/);
  assert.ok(spy.creditedPoints.some(c => c.userJid === "playerA@s.whatsapp.net" && c.points === 250));
  assert.ok(spy.creditedPoints.some(c => c.userJid === "playerB@s.whatsapp.net" && c.points === 50));
});

void test("TicTacToe: surrender awards opponent as winner", async () => {
  const { service, spy } = makeFakeRewardService();
  const gameService = new GameService(service, () => 1, DETERMINISTIC_BANK);

  await gameService.playTicTacToe(makeGameContext({ senderUserJid: "playerA@s.whatsapp.net", mentionedJids: ["playerB@s.whatsapp.net"] }));
  await gameService.playTicTacToe(makeGameContext({ senderUserJid: "playerB@s.whatsapp.net", mentionedJids: [] }));

  // PlayerA surrenders.
  const result = await gameService.surrender(makeGameContext({ senderUserJid: "playerA@s.whatsapp.net" }));
  assert.match(result, /Menyerah/);
  assert.ok(spy.creditedPoints.some(c => c.userJid === "playerB@s.whatsapp.net" && c.points === 250));
  assert.ok(spy.creditedPoints.some(c => c.userJid === "playerA@s.whatsapp.net" && c.points === 50));
});

void test("TicTacToe: draw awards both players via GameRewardService", async () => {
  const { economy, calls } = makeEconomy();
  const service = new GameRewardService(economy);
  const roundId = "round-draw-1";
  const correlationId = "corr-draw-1";

  const [r1, r2] = await Promise.all([
    service.awardTicTacToeDraw("g@g.us", "playerA@s.whatsapp.net", roundId, correlationId),
    service.awardTicTacToeDraw("g@g.us", "playerB@s.whatsapp.net", roundId, `${correlationId}-b`),
  ]);

  assert.equal(r1.points, 100);
  assert.equal(r2.points, 100);
  assert.ok(calls.some(c => c.method === "creditPoints" && c.userJid === "playerA@s.whatsapp.net" && c.amount === 100));
  assert.ok(calls.some(c => c.method === "creditPoints" && c.userJid === "playerB@s.whatsapp.net" && c.amount === 100));
});

void test("TicTacToe PvP: reward constants are correct", () => {
  assert.equal(TICTACTOE_REWARD.WIN_POINTS, 250);
  assert.equal(TICTACTOE_REWARD.WIN_XP, 100);
  assert.equal(TICTACTOE_REWARD.LOSS_POINTS, 50);
  assert.equal(TICTACTOE_REWARD.LOSS_XP, 25);
  assert.equal(TICTACTOE_REWARD.DRAW_POINTS, 100);
  assert.equal(TICTACTOE_REWARD.DRAW_XP, 50);
});
