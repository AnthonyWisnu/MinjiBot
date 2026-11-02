import { test } from "node:test";
import assert from "node:assert/strict";

import { AntiDeleteService } from "../src/services/moderation/antiDelete.service";
import { resolveImageMediaTarget, resolveMediaTarget } from "../src/utils/mediaTarget";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import type { CommandContext } from "../src/types/command";

void test("AntiDeleteService: suppressModerationDelete prevents repost of moderation-deleted messages", async () => {
  const sentMessages: { jid: string; content: unknown }[] = [];
  const fakeSocket = {
    user: { id: "bot@s.whatsapp.net" },
    sendMessage: (jid: string, content: unknown) => {
      sentMessages.push({ jid, content });
      return Promise.resolve();
    },
  } as unknown as WASocket;

  const mockTenantGroup = {
    groupJid: "group-1@g.us",
    status: "ACTIVE",
    isBlocked: false,
    expiresAt: new Date(Date.now() + 86400000),
    ownerJid: "owner@s.whatsapp.net",
  };

  const service = new AntiDeleteService(
    { findByGroupJid: () => Promise.resolve(mockTenantGroup as never) } as never,
    { findByGroupJid: () => Promise.resolve({ antiDeleteEnabled: true } as never) } as never,
  );

  // 1. Incoming message from member
  const incomingMsg: WAMessage = {
    key: {
      remoteJid: "group-1@g.us",
      id: "BAD_LINK_MSG_1",
      participant: "spammer@s.whatsapp.net",
      fromMe: false,
    },
    message: {
      conversation: "Join group ini https://chat.whatsapp.com/invitelink",
    },
  };

  await service.cacheMessage(incomingMsg);

  // 2. AntiLink moderates and suppresses the message
  service.suppressModerationDelete("group-1@g.us", "BAD_LINK_MSG_1");

  // 3. WhatsApp revoke event triggers
  await service.handleMessageRevoke(fakeSocket, {
    remoteJid: "group-1@g.us",
    id: "BAD_LINK_MSG_1",
  });

  // Must NOT repost because it was suppressed by moderation!
  assert.equal(sentMessages.length, 0);
});

void test("AntiDeleteService: does not repost message revoked by an Admin instead of author", async () => {
  const sentMessages: { jid: string; content: unknown }[] = [];
  const fakeSocket = {
    user: { id: "bot@s.whatsapp.net" },
    sendMessage: (jid: string, content: unknown) => {
      sentMessages.push({ jid, content });
      return Promise.resolve();
    },
  } as unknown as WASocket;

  const mockTenantGroup = {
    groupJid: "group-1@g.us",
    status: "ACTIVE",
    isBlocked: false,
    expiresAt: new Date(Date.now() + 86400000),
    ownerJid: "owner@s.whatsapp.net",
  };

  const service = new AntiDeleteService(
    { findByGroupJid: () => Promise.resolve(mockTenantGroup as never) } as never,
    { findByGroupJid: () => Promise.resolve({ antiDeleteEnabled: true } as never) } as never,
  );

  const incomingMsg: WAMessage = {
    key: {
      remoteJid: "group-1@g.us",
      id: "OFFENSIVE_MSG_2",
      participant: "violator@s.whatsapp.net",
      fromMe: false,
    },
    message: {
      conversation: "Pesan melanggar aturan grup",
    },
  };

  await service.cacheMessage(incomingMsg);

  // Admin deletes the message (revoker !== author)
  await service.handleMessageRevoke(
    fakeSocket,
    {
      remoteJid: "group-1@g.us",
      id: "OFFENSIVE_MSG_2",
      participant: "violator@s.whatsapp.net",
    },
    "group_admin@s.whatsapp.net",
  );

  // Must NOT repost because it was an admin moderation deletion
  assert.equal(sentMessages.length, 0);
});

void test("ViewOnce privacy: AntiDelete ignores viewOnce messages and mediaTarget rejects them", async () => {
  const sentMessages: { jid: string; content: unknown }[] = [];
  const fakeSocket = {
    user: { id: "bot@s.whatsapp.net" },
    sendMessage: (jid: string, content: unknown) => {
      sentMessages.push({ jid, content });
      return Promise.resolve();
    },
  } as unknown as WASocket;

  const service = new AntiDeleteService(
    { findByGroupJid: () => Promise.resolve(null) } as never,
    { findByGroupJid: () => Promise.resolve(null) } as never,
  );

  const viewOnceMsg: WAMessage = {
    key: {
      remoteJid: "group-1@g.us",
      id: "SECRET_VO_1",
      participant: "user@s.whatsapp.net",
      fromMe: false,
    },
    message: {
      viewOnceMessageV2: {
        message: {
          imageMessage: {
            url: "https://example.com/secret.jpg",
            caption: "Top secret view once photo",
          },
        },
      },
    },
  };

  // 1. AntiDelete must not cache viewOnce messages
  await service.cacheMessage(viewOnceMsg);
  await service.handleMessageRevoke(fakeSocket, {
    remoteJid: "group-1@g.us",
    id: "SECRET_VO_1",
  });
  assert.equal(sentMessages.length, 0);

  // 2. mediaTarget must return null for viewOnce messages
  const fakeContext = {
    message: viewOnceMsg,
  } as unknown as CommandContext;

  const mediaTarget = resolveMediaTarget(fakeContext, ["image"]);
  assert.equal(mediaTarget, null);

  const imageTarget = resolveImageMediaTarget(fakeContext);
  assert.equal(imageTarget, null);
});
