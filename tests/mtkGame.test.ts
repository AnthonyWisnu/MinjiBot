import assert from "node:assert/strict";
import { test } from "node:test";

import { MTK_REWARD } from "../src/services/game/gameReward.constants";
import { GameService } from "../src/services/game/game.service";
import { GameRewardService } from "../src/services/game/gameReward.service";
import type { CommandContext } from "../src/types/command";

void test("MTK: reward constants are correct", () => {
  assert.equal(MTK_REWARD.CORRECT_POINTS, 10);
  assert.equal(MTK_REWARD.CORRECT_XP, 40);
  assert.equal(MTK_REWARD.WRONG_XP, 5);
});

void test("MTK: startOrAnswerQuiz generates a math question", async () => {
  const spy: { creditedPoints: number; creditedXp: number } = { creditedPoints: 0, creditedXp: 0 };
  const mockEconomy = {
    creditPoints: (input: { amount: number }) => {
      spy.creditedPoints += input.amount;
      return Promise.resolve(null);
    },
    creditXp: (input: { amount: number }) => {
      spy.creditedXp += input.amount;
      return Promise.resolve(null);
    },
    recordGameResult: () => Promise.resolve(null),
  };

  const rewardService = new GameRewardService(mockEconomy);
  const gameService = new GameService(rewardService);

  const ctx: CommandContext = {
    socket: {} as never,
    message: {} as never,
    chatJid: "120@g.us",
    senderJid: "628@s.whatsapp.net",
    senderUserJid: "628@s.whatsapp.net",
    senderAltJids: ["628@s.whatsapp.net"],
    isGroup: true,
    commandName: "mtk",
    args: [],
    argsText: "",
    text: ".mtk",
    mentionedJids: [],
    role: "MEMBER",
    reply: () => Promise.resolve(undefined),
  };

  const startMsg = await gameService.startOrAnswerQuiz(ctx, "mtk");
  assert.match(startMsg, /matematika cepat/);
  assert.match(startMsg, /Berapa hasil dari/);

  // Surrender
  const surrenderMsg = await gameService.surrender(ctx);
  assert.match(surrenderMsg, /Game dihentikan/);
  assert.match(surrenderMsg, /Jawaban:/);
});
