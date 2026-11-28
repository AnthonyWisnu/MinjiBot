import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { commandRouter } from "../src/commands";
import {
  CHAT_MEMORY_MAX_PER_GROUP,
  ChatMemoryService,
} from "../src/services/ai/chatMemory.service";
import {
  OpenRouterService,
  prepareVisionImageDataUrl,
} from "../src/services/ai/openRouter.service";

test("Tahap 8 - all 14+ new AI Tongkrongan and Vision commands exist in commandRouter", () => {
  const expected = [
    "ai",
    "tanya",
    "gpt",
    "minji",
    "simi",
    "ringkas",
    "tldr",
    "tanyachat",
    "ocr",
    "baca",
    "jelaskanfoto",
    "roast",
    "puji",
    "pantunai",
    "cerpen",
    "curhat",
    "debat",
    "koding",
    "perbaiki",
    "summarize",
    "ide",
  ];
  for (const cmd of expected) {
    assert.equal(commandRouter.has(cmd), true, `Command .${cmd} harus terdaftar di commandRouter`);
  }
});

test("ChatMemoryService - bounded ring-buffer caps per group and formats transcript cleanly", () => {
  const mem = new ChatMemoryService();
  const groupJid = "120363000030@g.us";

  for (let i = 1; i <= 55; i += 1) {
    mem.recordMessage(groupJid, `User${String(i)}`, `Pesan ke-${String(i)} hari ini`);
  }

  const recent = mem.getRecentEntries(groupJid);
  assert.equal(recent.length, CHAT_MEMORY_MAX_PER_GROUP);
  assert.equal(recent[0]?.senderLabel, "User16");
  assert.equal(recent[recent.length - 1]?.senderLabel, "User55");

  const { transcript, messageCount } = mem.formatTranscript(groupJid, 10);
  assert.equal(messageCount, 10);
  assert.match(transcript, /User55: Pesan ke-55/);
  assert.equal(transcript.includes("User16:"), false);
});

test("OpenRouterService - multimodal Vision payload, JPEG compression, and extended personas", async () => {
  const tinyPng = await sharp({
    create: { width: 1000, height: 600, channels: 3, background: { r: 40, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();

  const dataUrl = await prepareVisionImageDataUrl(tinyPng);
  assert.ok(dataUrl.startsWith("data:image/jpeg;base64,"));
  const decoded = Buffer.from(dataUrl.replace("data:image/jpeg;base64,", ""), "base64");
  const meta = await sharp(decoded).metadata();
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.width, 800);

  let capturedBody: Record<string, unknown> | null = null;
  const mockFetch = async (_url: string, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return Response.json({
      choices: [{ message: { content: "Ini adalah gambar biru cerah." } }],
    });
  };

  const svc = new OpenRouterService({
    apiKey: "test-key",
    model: "google/gemini-2.5-flash-lite",
    dailyQuotaPerGroup: 80,
    fetchFn: mockFetch as typeof fetch,
  });

  const res = await svc.ask({
    groupJid: "120363000031@g.us",
    userJid: "628700000001@s.whatsapp.net",
    prompt: "Jelaskan gambar ini",
    persona: "vision",
    imageDataUrl: dataUrl,
    bypassCooldown: true,
  });

  assert.equal(res.answer, "Ini adalah gambar biru cerah.");
  assert.ok(capturedBody !== null);
  const messages = (capturedBody as { messages: { role: string; content: unknown }[] }).messages;
  assert.equal(messages.length, 2);
  assert.ok(Array.isArray(messages[1]?.content));

  // Ringkas context allows > 600 chars up to AI_MAX_CONTEXT_CHARS
  const longTranscript = "UserA: Halo semua ayo bahas rencana nongkrong nanti malam.\n".repeat(20);
  const sumRes = await svc.ask({
    groupJid: "120363000031@g.us",
    userJid: "628700000001@s.whatsapp.net",
    prompt: longTranscript,
    persona: "ringkas",
    maxPromptChars: 2_400,
    bypassCooldown: true,
  });
  assert.ok(sumRes.answer.length > 0);
});
