import assert from "node:assert/strict";
import test from "node:test";
import { TenantStatus, type TenantGroup } from "@prisma/client";

import { commandRouter } from "../src/commands";
import { createProfileCommands } from "../src/commands/member/profile.command";
import type { CommandContext } from "../src/types/command";
import { isBotUserJid } from "../src/utils/jid";

function buildTenantGroup(overrides: Partial<TenantGroup> = {}): TenantGroup {
  return {
    id: "tg-1",
    groupJid: "120363999@g.us",
    tenantCode: "MINJI1",
    name: "Grup Uji Minji",
    status: TenantStatus.ACTIVE,
    ownerJid: "628111111111@s.whatsapp.net",
    expiresAt: null,
    isBlocked: false,
    treasuryBalance: 50_000_000n,
    approvedAt: new Date("2026-01-15T04:00:00.000Z"),
    activatedAt: new Date("2026-01-15T04:00:00.000Z"),
    createdAt: new Date("2026-01-15T04:00:00.000Z"),
    updatedAt: new Date("2026-01-15T04:00:00.000Z"),
    ...overrides,
  };
}

function buildCommandContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    socket: {} as never,
    message: { key: { remoteJid: "120363999@g.us", id: "msg-1" } } as never,
    chatJid: "120363999@g.us",
    senderJid: "628222222222@s.whatsapp.net",
    senderUserJid: "628222222222@s.whatsapp.net",
    senderAltJids: [],
    isGroup: true,
    commandName: "profile",
    args: [],
    argsText: "",
    text: ".profile",
    mentionedJids: [],
    role: "MEMBER",
    tenantGroup: buildTenantGroup(),
    reply: () => Promise.resolve(),
    ...overrides,
  };
}

void test("isBotUserJid: detects bot via Phone JID, LID, and device-suffixed JID", () => {
  const socket = {
    user: {
      id: "6281228142960:13@s.whatsapp.net",
      lid: "117218834669748:13@lid",
    },
  };

  assert.equal(isBotUserJid(socket, "6281228142960@s.whatsapp.net"), true);
  assert.equal(isBotUserJid(socket, "117218834669748@lid"), true);
  assert.equal(isBotUserJid(socket, "6281228142960:5@s.whatsapp.net"), true);
  assert.equal(isBotUserJid(socket, "6289999999999@s.whatsapp.net"), false);
  assert.equal(isBotUserJid(null, "6281228142960@s.whatsapp.net"), false);
});

void test(".profile @minji and .dompet @minji display virtual official MinjiBot profile without touching DB", async () => {
  let dbTargetCalled = false;
  let dbOwnCalled = false;

  const commands = createProfileCommands({
    getOwnProfile: () => {
      dbOwnCalled = true;
      throw new Error("Should not call getOwnProfile for bot target");
    },
    getTargetProfile: () => {
      dbTargetCalled = true;
      return Promise.resolve(null);
    },
  });

  const profileCmd = commands.find((c) => c.name === "profile");
  const walletCmd = commands.find((c) => c.name === "dompet");
  assert.ok(profileCmd);
  assert.ok(walletCmd);

  const replies: string[] = [];
  const tenantGroup = buildTenantGroup({
    treasuryBalance: 123_450_000n,
    createdAt: new Date("2026-01-15T04:00:00.000Z"),
  });

  const botSocket = {
    user: {
      id: "6281228142960:13@s.whatsapp.net",
      lid: "117218834669748:13@lid",
    },
  };

  // Test .profile @minji via LID mention
  await profileCmd.execute(
    buildCommandContext({
      socket: botSocket as never,
      tenantGroup,
      commandName: "profile",
      mentionedJids: ["117218834669748@lid"],
      reply: (text) => {
        replies.push(text);
        return Promise.resolve();
      },
    }),
  );

  assert.equal(dbTargetCalled, false);
  assert.equal(dbOwnCalled, false);
  assert.equal(replies.length, 1);
  assert.match(replies[0] ?? "", /PROFIL RESMI BOT/);
  assert.match(replies[0] ?? "", /Celestial Sovereign \[TOP\]/);
  assert.match(replies[0] ?? "", /Bank Sentral Tongkrongan/);
  assert.match(replies[0] ?? "", /88\.750\.420\.500\.000/);
  assert.match(replies[0] ?? "", /1\.250\.840\.915\.000\.000/);
  assert.match(replies[0] ?? "", /Kebal \.maling, \.pajak/);

  // Test .dompet @minji via Phone JID mention
  await walletCmd.execute(
    buildCommandContext({
      socket: botSocket as never,
      tenantGroup,
      commandName: "dompet",
      mentionedJids: ["6281228142960@s.whatsapp.net"],
      reply: (text) => {
        replies.push(text);
        return Promise.resolve();
      },
    }),
  );

  assert.equal(replies.length, 2);
  assert.match(replies[1] ?? "", /BRANKAS RESMI BOT/);
  assert.match(replies[1] ?? "", /1\.339\.591\.335\.500\.000/);
  assert.match(replies[1] ?? "", /Tidak bisa dimaling, dipajaki/);
});

void test(".nikah @minji and .suit @minji reject targeting the bot cleanly", async () => {
  const replies: string[] = [];
  const tenantGroup = buildTenantGroup();
  const botSocket = {
    user: {
      id: "6281228142960:13@s.whatsapp.net",
      lid: "117218834669748:13@lid",
    },
  };

  await commandRouter.handle(
    buildCommandContext({
      socket: botSocket as never,
      tenantGroup,
      commandName: "nikah",
      args: ["@117218834669748"],
      mentionedJids: ["117218834669748@lid"],
      reply: (text) => {
        replies.push(text);
        return Promise.resolve();
      },
    }),
  );

  await commandRouter.handle(
    buildCommandContext({
      socket: botSocket as never,
      tenantGroup,
      commandName: "suit",
      args: ["@6281228142960", "5000000"],
      mentionedJids: ["6281228142960@s.whatsapp.net"],
      reply: (text) => {
        replies.push(text);
        return Promise.resolve();
      },
    }),
  );

  assert.equal(replies.length, 2);
  assert.match(replies[0] ?? "", /Server VPS/);
  assert.match(replies[1] ?? "", /tanpa tag bot/);
});
