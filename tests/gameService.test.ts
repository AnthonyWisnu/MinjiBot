import { test } from "node:test";
import assert from "node:assert/strict";

import { GameService } from "../src/services/game/game.service";
import type { CommandContext } from "../src/types/command";

void test("GameService keeps active quiz scoped by groupJid", () => {
  const service = new GameService();

  const firstGroupResult = service.startOrAnswerQuiz(createContext("111@g.us"), "kuis");
  const secondGroupResult = service.startOrAnswerQuiz(createContext("222@g.us"), "kuis");

  assert.match(firstGroupResult, /Game dimulai/);
  assert.match(secondGroupResult, /Game dimulai/);
});

void test("GameService daily reward is scoped by groupJid", () => {
  const service = new GameService();
  const firstGroupContext = createContext("111@g.us");
  const secondGroupContext = createContext("222@g.us");

  const firstClaim = service.claimDaily(firstGroupContext);
  const repeatedClaim = service.claimDaily(firstGroupContext);
  const secondGroupClaim = service.claimDaily(secondGroupContext);

  assert.match(firstClaim, /berhasil/);
  assert.match(repeatedClaim, /sudah diambil/);
  assert.match(secondGroupClaim, /berhasil/);
});

function createContext(groupJid: string): CommandContext {
  return {
    socket: {},
    message: {},
    chatJid: groupJid,
    senderJid: "6281@s.whatsapp.net",
    isGroup: true,
    commandName: "kuis",
    args: [],
    argsText: "",
    text: ".kuis",
    role: "MEMBER",
    reply: () => Promise.resolve(undefined),
  } as CommandContext;
}
