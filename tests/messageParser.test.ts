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
  const message = createTextMessage(".whoami", "10000000000101@lid", null);
  (message.key as { senderPn?: string }).senderPn = "628000000101@s.whatsapp.net";

  const context = parseCommandMessage(socket, message);

  assert.ok(context);
  assert.equal(context.senderJid, "10000000000101@lid");
  assert.deepEqual(context.senderAltJids, ["10000000000101@lid", "628000000101@s.whatsapp.net"]);
});

void test("parseCommandMessage supports Baileys v7 remoteJidAlt and participantAlt", () => {
  const socket = createSocket();
  const message = createTextMessage(".whoami", "120@g.us", "10000000000101@lid");
  message.key.participantAlt = "628000000101@s.whatsapp.net";

  const context = parseCommandMessage(socket, message);

  assert.ok(context);
  assert.equal(context.senderJid, "10000000000101@lid");
  assert.equal(context.senderUserJid, "628000000101@s.whatsapp.net");
  assert.deepEqual(context.senderAltJids, ["10000000000101@lid", "628000000101@s.whatsapp.net"]);
});

void test("parseCommandMessage reply resolves LID mentions cleanly when no phone JID exists", async () => {
  const sentPayloads: { content: { text?: string; mentions?: string[] } }[] = [];
  const socket = {
    sendMessage: (_jid: string, content: { text?: string; mentions?: string[] }) => {
      sentPayloads.push({ content });
      return Promise.resolve(undefined);
    },
  } as unknown as WASocket;

  const message = createTextMessage(".whoami", "120@g.us", "10000000000101@lid");
  const context = parseCommandMessage(socket, message);

  assert.ok(context);
  await context.reply("Halo @10000000000101");
  assert.deepEqual(sentPayloads[0]?.content.mentions, ["10000000000101@lid"]);
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
