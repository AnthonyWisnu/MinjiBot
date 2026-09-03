import { test } from "node:test";
import assert from "node:assert/strict";

import { GameService } from "../src/services/game/game.service";
import { GameRewardService } from "../src/services/game/gameReward.service";
import type { CommandContext } from "../src/types/command";

// Minimal no-op reward service so tests do not need a real DB.
function makeNoopRewardService(): GameRewardService {
  const noop = {
    creditPoints: (): Promise<unknown> => Promise.resolve(null),
    creditXp: (): Promise<unknown> => Promise.resolve(null),
    recordGameResult: (): Promise<unknown> => Promise.resolve(null),
  };
  return new GameRewardService(noop);
}

function createContext(groupJid: string, overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    socket: {} as never,
    message: {} as never,
    chatJid: groupJid,
    senderJid: "6281@s.whatsapp.net",
    senderUserJid: "6281@s.whatsapp.net",
    senderAltJids: ["6281@s.whatsapp.net"],
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

void test("GameService keeps active quiz scoped by groupJid", async () => {
  const service = new GameService(makeNoopRewardService());

  const firstGroupResult = await service.startOrAnswerQuiz(createContext("111@g.us"), "kuis");
  const secondGroupResult = await service.startOrAnswerQuiz(createContext("222@g.us"), "kuis");

  assert.match(firstGroupResult, /Game dimulai/);
  assert.match(secondGroupResult, /Game dimulai/);
});

void test("GameService: .nyerah clears only the active game in that group", async () => {
  const service = new GameService(makeNoopRewardService());

  await service.startOrAnswerQuiz(createContext("111@g.us"), "kuis");
  const result = await service.surrender(createContext("111@g.us"));
  assert.match(result, /Game dihentikan/);

  // No game in group 222.
  const noGameResult = await service.surrender(createContext("222@g.us"));
  assert.match(noGameResult, /Tidak ada game aktif/);
});

void test("GameService: cannot start two quizzes in same group", async () => {
  const service = new GameService(makeNoopRewardService());

  await service.startOrAnswerQuiz(createContext("111@g.us"), "kuis");
  const second = await service.startOrAnswerQuiz(createContext("111@g.us"), "tebakkata");
  assert.match(second, /Masih ada game aktif/);
});
