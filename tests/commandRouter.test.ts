import assert from "node:assert/strict";
import test from "node:test";

import { CommandRouter } from "../src/commands";
import type { CommandContext } from "../src/types/command";

test("CommandRouter: resolves command by primary name and executes handler", async () => {
  let executed = false;
  const mockContext = {
    commandName: "ping",
    chatJid: "123@g.us",
    senderJid: "caller@s.whatsapp.net",
    isGroup: true,
    reply: async () => {},
  } as unknown as CommandContext;

  const router = new CommandRouter([
    {
      name: "ping",
      execute: async () => {
        executed = true;
      },
    },
  ]);

  assert.equal(router.has("ping"), true);
  assert.equal(router.has("PING"), true);

  await router.handle(mockContext);
  assert.equal(executed, true);
});

test("CommandRouter: resolves command by alias case-insensitively", async () => {
  let executed = false;
  const mockContext = {
    commandName: "p",
    chatJid: "123@g.us",
    senderJid: "caller@s.whatsapp.net",
    isGroup: true,
    reply: async () => {},
  } as unknown as CommandContext;

  const router = new CommandRouter([
    {
      name: "ping",
      aliases: ["p", "pong"],
      execute: async () => {
        executed = true;
      },
    },
  ]);

  assert.equal(router.has("p"), true);
  assert.equal(router.has("PONG"), true);

  await router.handle(mockContext);
  assert.equal(executed, true);
});

test("CommandRouter: ignores unregistered command without throwing", async () => {
  let replied = false;
  const mockContext = {
    commandName: "unknowncmd",
    chatJid: "123@g.us",
    senderJid: "caller@s.whatsapp.net",
    isGroup: true,
    reply: async () => {
      replied = true;
    },
  } as unknown as CommandContext;

  const router = new CommandRouter([]);
  assert.equal(router.has("unknowncmd"), false);

  await router.handle(mockContext);
  assert.equal(replied, false);
});

test("CommandRouter: catches exception and returns user-safe error message", async () => {
  let replyText = "";
  const mockContext = {
    commandName: "fail",
    chatJid: "123@g.us",
    senderJid: "caller@s.whatsapp.net",
    isGroup: true,
    reply: async (text: string) => {
      replyText = text;
    },
  } as unknown as CommandContext;

  const router = new CommandRouter([
    {
      name: "fail",
      execute: async () => {
        throw new Error("connection to postgresql server failed: econnrefused");
      },
    },
  ]);

  await router.handle(mockContext);
  assert.ok(replyText.length > 0);
  assert.ok(!replyText.includes("postgresql"));
  assert.ok(!replyText.includes("econnrefused"));
});

test("CommandRouter: throws on duplicate command or alias registration", () => {
  assert.throws(
    () =>
      new CommandRouter([
        { name: "foo", execute: async () => {} },
        { name: "bar", aliases: ["foo"], execute: async () => {} },
      ]),
    /Command duplikat: foo/,
  );
});
