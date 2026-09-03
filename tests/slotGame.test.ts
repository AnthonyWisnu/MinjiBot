import assert from "node:assert/strict";
import { test } from "node:test";

import { SLOT_CONFIG } from "../src/services/game/gameReward.constants";
import { SlotGameService } from "../src/services/game/slotGame.service";
import type { CommandContext } from "../src/types/command";

function makeMockContext(pointsBalance: number, isGroup = true): CommandContext {
  return {
    socket: {} as never,
    message: {} as never,
    chatJid: "120@g.us",
    senderJid: "628@s.whatsapp.net",
    senderUserJid: "628@s.whatsapp.net",
    senderAltJids: ["628@s.whatsapp.net"],
    isGroup,
    commandName: "slot",
    args: [],
    argsText: "",
    text: ".slot",
    mentionedJids: [],
    role: "MEMBER",
    reply: () => Promise.resolve(undefined),
  };
}

void test("SlotGame: config constants are correct", () => {
  assert.equal(SLOT_CONFIG.BET_POINTS, 5);
  assert.equal(SLOT_CONFIG.MATCH_TWO_POINTS, 10);
  assert.equal(SLOT_CONFIG.MATCH_TWO_XP, 5);
  assert.equal(SLOT_CONFIG.JACKPOT_POINTS, 30);
  assert.equal(SLOT_CONFIG.SUPER_JACKPOT_POINTS, 50);
});

void test("SlotGame: rejects private chat", async () => {
  const service = new SlotGameService();
  const result = await service.play(makeMockContext(100, false));
  assert.match(result, /hanya bisa dimainkan di grup/);
});

void test("SlotGame: rejects if points balance is less than bet", async () => {
  const mockRepo = {
    findOrCreate: () => Promise.resolve({
      id: "profile-1",
      groupJid: "120@g.us",
      userJid: "628@s.whatsapp.net",
      pointsBalance: 2,
    } as never),
  };

  const service = new SlotGameService(mockRepo as never);
  const result = await service.play(makeMockContext(2));
  assert.match(result, /Poin kamu tidak cukup/);
  assert.match(result, /Minimal taruhan: 5 Poin/);
});
