import { test } from "node:test";
import assert from "node:assert/strict";

import { WelcomeService, DEFAULT_WELCOME_MESSAGE } from "../src/services/welcome/welcome.service";
import { GameService } from "../src/services/game/game.service";
import { GameRewardService } from "../src/services/game/gameReward.service";
import type { TenantFeatureSetting, TenantGroup, TenantGroupSetting } from "@prisma/client";

function makeNoopRewardService(): GameRewardService {
  return new GameRewardService({
    creditPoints: () => Promise.resolve(null),
    creditXp: () => Promise.resolve(null),
    recordGameResult: () => Promise.resolve(null),
  });
}

void test("WelcomeService burst protection: sends single batch message if >3 participants join", async () => {
  const sentMessages: { jid: string; content: Record<string, unknown> }[] = [];

  const fakeSocket = {
    sendMessage: (jid: string, content: Record<string, unknown>) => {
      sentMessages.push({ jid, content });
      return Promise.resolve({ key: { id: "MSG_BATCH" } });
    },
    profilePictureUrl: () => Promise.reject(new Error("Should not be called during burst")),
  };

  const fakeTenantGroup: TenantGroup = {
    id: "tg_1",
    groupJid: "12345@g.us",
    tenantCode: "TG1234",
    name: "Grup Uji Coba",
    status: "ACTIVE",
    ownerJid: "6281@s.whatsapp.net",
    expiresAt: new Date(Date.now() + 86400000),
    isBlocked: false,
    approvedAt: new Date(),
    activatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const fakeFeatureSetting: TenantFeatureSetting = {
    id: "fs_1",
    groupJid: "12345@g.us",
    downloaderEnabled: true,
    hdEnabled: true,
    gameEnabled: true,
    welcomeEnabled: true,
    antiLinkEnabled: true,
    antiSpamEnabled: true,
    reminderEnabled: true,
    tagAllEnabled: true,
    antiDeleteEnabled: true,
    antiViewOnceEnabled: true,
    goodbyeEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const fakeGroupSetting: TenantGroupSetting = {
    id: "gs_1",
    groupJid: "12345@g.us",
    welcomeMessage: DEFAULT_WELCOME_MESSAGE,
    goodbyeMessage: null,
    antiLinkAutoKick: false,
    antiSpamMode: "NORMAL",
    tagAllCooldownSec: 600,
    remindAllCooldownSec: 600,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const welcomeService = new WelcomeService(
    { findByGroupJid: () => Promise.resolve(fakeTenantGroup) } as never,
    { findByGroupJid: () => Promise.resolve(fakeFeatureSetting) } as never,
    { ensureForGroup: () => Promise.resolve(fakeGroupSetting) } as never,
  );

  // 5 participants joining at once
  await welcomeService.handleParticipantsUpdate(fakeSocket as never, {
    id: "12345@g.us",
    action: "add",
    participants: [
      "62811@s.whatsapp.net",
      "62812@s.whatsapp.net",
      "62813@s.whatsapp.net",
      "62814@s.whatsapp.net",
      "62815@s.whatsapp.net",
    ],
  });

  // Must only send 1 bundled message, NOT 5 separate photo messages
  assert.equal(sentMessages.length, 1);
  const firstMsg = sentMessages[0];
  assert.ok(firstMsg);
  assert.equal(firstMsg.jid, "12345@g.us");
  const mentions = firstMsg.content.mentions as string[];
  assert.equal(mentions.length, 5);
});

void test("GameService: sweepExpiredSessions cleans up abandoned sessions", () => {
  const service = new GameService(makeNoopRewardService());

  // Manually start a quiz session
  const groupJid = "abandoned@g.us";
  void service.startOrAnswerQuiz(
    {
      chatJid: groupJid,
      senderUserJid: "6281@s.whatsapp.net",
      isGroup: true,
      argsText: "",
    } as never,
    "kuis",
  );

  assert.equal(service.hasActiveQuiz(groupJid), true);

  // Fast forward quiz createdAt to 15 minutes ago
  const activeQuiz = service.getActiveQuiz(groupJid);
  if (activeQuiz) {
    activeQuiz.createdAt = Date.now() - 15 * 60 * 1000;
  }

  // Run sweep
  service.sweepExpiredSessions();

  assert.equal(service.hasActiveQuiz(groupJid), false);
});
