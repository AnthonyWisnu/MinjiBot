import assert from "node:assert/strict";
import test from "node:test";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";

import { InteractiveReplyService } from "../src/services/interactiveSession/interactiveReply.service";

test("InteractiveReplyService: ignores message from bot itself (fromMe)", async () => {
  const service = new InteractiveReplyService();
  const mockSocket = {} as WASocket;
  const mockMsg: WAMessage = {
    key: { fromMe: true, remoteJid: "123@g.us" },
  };

  const handled = await service.handleIncomingReply(mockSocket, mockMsg);
  assert.equal(handled, false);
});

test("InteractiveReplyService: ignores non-group chat", async () => {
  const service = new InteractiveReplyService();
  const mockSocket = {} as WASocket;
  const mockMsg: WAMessage = {
    key: { fromMe: false, remoteJid: "628111@s.whatsapp.net" },
  };

  const handled = await service.handleIncomingReply(mockSocket, mockMsg);
  assert.equal(handled, false);
});

test("InteractiveReplyService: ignores message starting with command prefix", async () => {
  const service = new InteractiveReplyService();
  const mockSocket = {} as WASocket;
  const mockMsg: WAMessage = {
    key: { fromMe: false, remoteJid: "123@g.us" },
    message: {
      conversation: ".menu",
    },
  };

  const handled = await service.handleIncomingReply(mockSocket, mockMsg);
  assert.equal(handled, false);
});

test("InteractiveReplyService: ignores reply when there is no active session", async () => {
  const mockGame = {
    getActiveQuiz: () => null,
    getActiveTicTacToe: () => null,
  };

  const service = new InteractiveReplyService(mockGame as any, {} as any, {} as any, {} as any);

  const mockSocket = {} as WASocket;
  const mockMsg: WAMessage = {
    key: { fromMe: false, remoteJid: "123@g.us" },
    message: {
      extendedTextMessage: {
        text: "jakarta",
        contextInfo: {
          stanzaId: "bot-msg-1",
          participant: "bot@s.whatsapp.net",
          quotedMessage: {
            conversation: "Menu bot",
          },
        },
      },
    },
  };

  const handled = await service.handleIncomingReply(mockSocket, mockMsg);
  assert.equal(handled, false);
});
