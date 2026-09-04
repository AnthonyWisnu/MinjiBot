import { test } from "node:test";
import assert from "node:assert/strict";

import { MessagePipeline } from "../src/bot/pipeline/messagePipeline";
import { createDefaultMessagePipeline } from "../src/bot/pipeline";
import type { IncomingPipelineContext, MessageInterceptor } from "../src/bot/pipeline/types";

function createMockContext(overrides: Partial<IncomingPipelineContext> = {}): IncomingPipelineContext {
  return {
    socket: {} as unknown as IncomingPipelineContext["socket"],
    message: {
      key: { remoteJid: "12345@g.us", id: "MSG_1" },
    },
    remoteJid: "12345@g.us",
    isGroup: true,
    ...overrides,
  };
}

void test("MessagePipeline: executes interceptors ordered by priority", async () => {
  const executionOrder: string[] = [];

  const interceptorLow: MessageInterceptor = {
    name: "LowPriority",
    priority: 50,
    intercept: async () => {
      await Promise.resolve();
      executionOrder.push("low");
      return null;
    },
  };

  const interceptorHigh: MessageInterceptor = {
    name: "HighPriority",
    priority: 10,
    intercept: async () => {
      await Promise.resolve();
      executionOrder.push("high");
      return null;
    },
  };

  const interceptorMedium: MessageInterceptor = {
    name: "MediumPriority",
    priority: 30,
    intercept: async () => {
      await Promise.resolve();
      executionOrder.push("medium");
      return null;
    },
  };

  // Add in random order
  const pipeline = new MessagePipeline([interceptorLow, interceptorHigh, interceptorMedium]);
  const halted = await pipeline.execute(createMockContext());

  assert.equal(halted, false);
  assert.deepEqual(executionOrder, ["high", "medium", "low"]);
});

void test("MessagePipeline: halts execution when an interceptor returns halt: true", async () => {
  const executed: string[] = [];

  const first: MessageInterceptor = {
    name: "First",
    priority: 10,
    intercept: async () => {
      await Promise.resolve();
      executed.push("first");
      return null;
    },
  };

  const haltingInterceptor: MessageInterceptor = {
    name: "Halting",
    priority: 20,
    intercept: async () => {
      await Promise.resolve();
      executed.push("halting");
      return { halt: true };
    },
  };

  const third: MessageInterceptor = {
    name: "Third",
    priority: 30,
    intercept: async () => {
      await Promise.resolve();
      executed.push("third");
      return null;
    },
  };

  const pipeline = new MessagePipeline([first, haltingInterceptor, third]);
  const halted = await pipeline.execute(createMockContext());

  assert.equal(halted, true);
  assert.deepEqual(executed, ["first", "halting"]);
  assert.equal(executed.includes("third"), false);
});

void test("MessagePipeline: continues execution even if an interceptor throws an error", async () => {
  const executed: string[] = [];

  const failingInterceptor: MessageInterceptor = {
    name: "Failing",
    priority: 10,
    intercept: async () => {
      await Promise.resolve();
      executed.push("failing");
      throw new Error("Simulated interceptor crash");
    },
  };

  const survivingInterceptor: MessageInterceptor = {
    name: "Surviving",
    priority: 20,
    intercept: async () => {
      await Promise.resolve();
      executed.push("surviving");
      return null;
    },
  };

  const pipeline = new MessagePipeline([failingInterceptor, survivingInterceptor]);
  const halted = await pipeline.execute(createMockContext());

  assert.equal(halted, false);
  assert.deepEqual(executed, ["failing", "surviving"]);
});

void test("createDefaultMessagePipeline: registers all standard interceptors in correct order", () => {
  const pipeline = createDefaultMessagePipeline();
  const interceptors = pipeline.getInterceptors();

  assert.equal(interceptors.length, 8);

  const priorities = interceptors.map((i) => i.priority);
  const sortedPriorities = [...priorities].sort((a, b) => a - b);
  assert.deepEqual(priorities, sortedPriorities);

  const names = interceptors.map((i) => i.name);
  assert.deepEqual(names, [
    "PendingTenantInterceptor",
    "AntiDeleteInterceptor",
    "AntiViewOnceInterceptor",
    "ActivityTrackerInterceptor",
    "AfkInterceptor",
    "AntiLinkInterceptor",
    "AntiSpamInterceptor",
    "InteractiveReplyInterceptor",
  ]);
});
