import { test } from "node:test";
import assert from "node:assert/strict";

import type { WAMessage, WASocket } from "@whiskeysockets/baileys";

import { parseCommandMessage } from "../src/bot/messageParser";

void test("parseCommandMessage parses command name and args from group text", () => {
  const socket = createSocket();
  const message = createTextMessage(".TagAll rapat jam 9", "120@g.us", "6281@s.whatsapp.net");

  const context = parseCommandMessage(socket, message);

  assert.ok(context);
  assert.equal(context.commandName, "tagall");
  assert.deepEqual(context.args, ["rapat", "jam", "9"]);
  assert.equal(context.argsText, "rapat jam 9");
  assert.equal(context.isGroup, true);
  assert.equal(context.senderJid, "6281@s.whatsapp.net");
});

void test("parseCommandMessage ignores non-command text", () => {
  const context = parseCommandMessage(
    createSocket(),
    createTextMessage("halo", "120@g.us", "6281@s.whatsapp.net"),
  );

  assert.equal(context, null);
});

function createSocket(): WASocket {
  return {
    sendMessage: () => Promise.resolve(undefined),
  } as unknown as WASocket;
}

function createTextMessage(text: string, remoteJid: string, participant: string): WAMessage {
  return {
    key: {
      remoteJid,
      participant,
      fromMe: false,
    },
    message: {
      conversation: text,
    },
  };
}
