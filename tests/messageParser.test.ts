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
  assert.deepEqual(context.senderAltJids, ["6281@s.whatsapp.net"]);
});

void test("parseCommandMessage includes phone alias when WhatsApp sends LID sender", () => {
  const socket = createSocket();
  const message = createTextMessage(".whoami", "95747856982103@lid", null);
  message.key.senderPn = "62895366009208@s.whatsapp.net";

  const context = parseCommandMessage(socket, message);

  assert.ok(context);
  assert.equal(context.senderJid, "95747856982103@lid");
  assert.deepEqual(context.senderAltJids, ["95747856982103@lid", "62895366009208@s.whatsapp.net"]);
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

function createTextMessage(text: string, remoteJid: string, participant: string | null): WAMessage {
  return {
    key: {
      remoteJid,
      participant: participant ?? undefined,
      fromMe: false,
    },
    message: {
      conversation: text,
    },
  };
}
