import { test } from "node:test";
import assert from "node:assert/strict";

import { RateLimitGuard } from "../src/guards/rateLimitGuard";
import type { CommandContext } from "../src/types/command";

function createMockContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    socket: {} as never,
    message: {} as never,
    chatJid: "123@g.us",
    senderJid: "user1@s.whatsapp.net",
    senderUserJid: "user1@s.whatsapp.net",
    senderAltJids: [],
    isGroup: true,
    commandName: "menu",
    args: [],
    argsText: "",
    text: ".menu",
    mentionedJids: [],
    role: "MEMBER",
    reply: () => Promise.resolve(),
    ...overrides,
  };
}

void test("RateLimitGuard: allows commands within maxRequests threshold", () => {
  let currentTime = 10_000;
  const guard = new RateLimitGuard({
    windowMs: 5_000,
    maxRequests: 3,
    cooldownMs: 8_000,
    nowFn: () => currentTime,
  });

  const ctx = createMockContext();

  const r1 = guard.check(ctx);
  assert.equal(r1.allowed, true);
  assert.equal(r1.warnUser, false);

  currentTime += 1_000;
  const r2 = guard.check(ctx);
  assert.equal(r2.allowed, true);

  currentTime += 1_000;
  const r3 = guard.check(ctx);
  assert.equal(r3.allowed, true);
});

void test("RateLimitGuard: blocks and warns user on exceeding threshold", () => {
  let currentTime = 10_000;
  const guard = new RateLimitGuard({
    windowMs: 5_000,
    maxRequests: 2,
    cooldownMs: 8_000,
    nowFn: () => currentTime,
  });

  const ctx = createMockContext();

  guard.check(ctx); // 1
  currentTime += 500;
  guard.check(ctx); // 2

  currentTime += 500;
  const r3 = guard.check(ctx); // 3 (exceeded)
  assert.equal(r3.allowed, false);
  assert.equal(r3.warnUser, true);
  assert.match(r3.message ?? "", /terlalu cepat/);

  // Subsequent request while still in cooldown: silently blocked (warnUser = false)
  currentTime += 1_000;
  const r4 = guard.check(ctx);
  assert.equal(r4.allowed, false);
  assert.equal(r4.warnUser, false);
});

void test("RateLimitGuard: resets block after cooldown expires", () => {
  let currentTime = 10_000;
  const guard = new RateLimitGuard({
    windowMs: 5_000,
    maxRequests: 2,
    cooldownMs: 8_000,
    nowFn: () => currentTime,
  });

  const ctx = createMockContext();

  guard.check(ctx);
  guard.check(ctx);
  const blocked = guard.check(ctx);
  assert.equal(blocked.allowed, false);

  // Advance time past cooldown
  currentTime += 8_500;
  const recovered = guard.check(ctx);
  assert.equal(recovered.allowed, true);
  assert.equal(recovered.warnUser, false);
});

void test("RateLimitGuard: Super Owner always bypasses rate limit", () => {
  const currentTime = 10_000;
  const guard = new RateLimitGuard({
    windowMs: 5_000,
    maxRequests: 1,
    cooldownMs: 8_000,
    nowFn: () => currentTime,
  });

  const ctx = createMockContext({
    role: "SUPER_OWNER",
  });

  for (let i = 0; i < 10; i++) {
    const res = guard.check(ctx);
    assert.equal(res.allowed, true);
    assert.equal(res.warnUser, false);
  }
});
