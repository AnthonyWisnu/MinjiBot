import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DATA_DIR = path.resolve(process.cwd(), "src/data/games");
const DRAFT_NOISE_REGEX =
  /bukan—|ganti:|tunggu:|->|pakai kata|pakai valid|tidak pakai|sudah ada|bukan itu—/i;

function readJson(fileName: string): unknown {
  const raw = fs.readFileSync(path.join(DATA_DIR, fileName), "utf-8");
  return JSON.parse(raw) as unknown;
}

void test("GameDataIntegrity: kuis.json memiliki >= 300 soal bersih tanpa duplikat", () => {
  const items = readJson("kuis.json") as { prompt: string; answers: string[] }[];
  assert.ok(items.length >= 300, `Expected >= 300 kuis, got ${String(items.length)}`);

  const seenPrompts = new Set<string>();
  const seenAnswers = new Set<string>();
  for (const item of items) {
    assert.ok(item.prompt.trim().length >= 10);
    assert.ok(Array.isArray(item.answers) && item.answers.length >= 1);
    assert.ok(!DRAFT_NOISE_REGEX.test(item.prompt), `Noise in prompt: ${item.prompt}`);
    const pKey = item.prompt.trim().toLowerCase();
    assert.ok(!seenPrompts.has(pKey), `Duplicate kuis prompt: ${item.prompt}`);
    seenPrompts.add(pKey);
    const aKey = (item.answers[0] ?? "").trim().toLowerCase();
    assert.ok(!seenAnswers.has(aKey), `Duplicate kuis primary answer: ${aKey}`);
    seenAnswers.add(aKey);
  }
});

void test("GameDataIntegrity: family100.json memiliki >= 200 topik dengan 4-8 slot beralias", () => {
  const items = readJson("family100.json") as {
    prompt: string;
    answers: { text: string; aliases: string[] }[];
  }[];
  assert.ok(items.length >= 200, `Expected >= 200 family100 topics, got ${String(items.length)}`);

  const seenPrompts = new Set<string>();
  for (const item of items) {
    assert.ok(item.prompt.trim().length >= 8);
    assert.ok(!DRAFT_NOISE_REGEX.test(item.prompt), `Noise in family100: ${item.prompt}`);
    assert.ok(
      item.answers.length >= 4 && item.answers.length <= 8,
      `Expected 4-8 answers in "${item.prompt}", got ${String(item.answers.length)}`,
    );
    for (const slot of item.answers) {
      assert.ok(slot.text.trim().length > 0);
      assert.ok(Array.isArray(slot.aliases) && slot.aliases.length >= 1);
    }
    const pKey = item.prompt.trim().toLowerCase();
    assert.ok(!seenPrompts.has(pKey), `Duplicate family100 prompt: ${item.prompt}`);
    seenPrompts.add(pKey);
  }
});

void test("GameDataIntegrity: tebakkata.json >= 280 soal bersih dan anagram akurat", () => {
  const items = readJson("tebakkata.json") as { prompt: string; answers: string[] }[];
  assert.ok(items.length >= 280, `Expected >= 280 tebakkata, got ${String(items.length)}`);

  const seenPrompts = new Set<string>();
  for (const item of items) {
    assert.ok(item.prompt.trim().length >= 10);
    assert.ok(Array.isArray(item.answers) && item.answers.length >= 1);
    assert.ok(!DRAFT_NOISE_REGEX.test(item.prompt), `Noise in tebakkata: ${item.prompt}`);
    assert.ok(!item.answers.includes("lemaribuan"), "Typo 'lemaribuan' must be removed");

    if (/Huruf acak/i.test(item.prompt)) {
      const match = /:\s*([A-Z\s]+)\./.exec(item.prompt);
      assert.ok(match?.[1], `Anagram prompt missing pattern: ${item.prompt}`);
      const sortedPromptLetters = match[1]
        .replace(/\s+/g, "")
        .toLowerCase()
        .split("")
        .sort()
        .join("");
      const sortedAnswerLetters = (item.answers[0] ?? "")
        .replace(/[^a-z]/gi, "")
        .toLowerCase()
        .split("")
        .sort()
        .join("");
      assert.equal(
        sortedPromptLetters,
        sortedAnswerLetters,
        `Anagram mismatch on prompt: ${item.prompt}`,
      );
    }

    const pKey = item.prompt.trim().toLowerCase();
    assert.ok(!seenPrompts.has(pKey), `Duplicate tebakkata prompt: ${item.prompt}`);
    seenPrompts.add(pKey);
  }
});

void test("GameDataIntegrity: tebakemoji.json >= 200 soal tanpa huruf Latin di baris emoji", () => {
  const items = readJson("tebakemoji.json") as { prompt: string; answers: string[] }[];
  assert.ok(items.length >= 200, `Expected >= 200 tebakemoji, got ${String(items.length)}`);

  const seenPrompts = new Set<string>();
  for (const item of items) {
    const lines = item.prompt.split("\n");
    assert.ok(lines.length >= 2, `Emoji prompt must have 2 lines: ${item.prompt}`);
    const emojiLine = lines[1] ?? "";
    assert.ok(emojiLine.trim().length > 0);
    assert.ok(!/[a-zA-Z]/.test(emojiLine), `Latin character leaked in emoji line: ${emojiLine}`);
    assert.ok(Array.isArray(item.answers) && item.answers.length >= 1);

    const pKey = item.prompt.trim().toLowerCase();
    assert.ok(!seenPrompts.has(pKey), `Duplicate tebakemoji prompt: ${item.prompt}`);
    seenPrompts.add(pKey);
  }
});

void test("GameDataIntegrity: katla.json >= 360 target terdistribusi seimbang di 5, 6, dan 7 huruf", () => {
  const katla = readJson("katla.json") as { targets: string[]; validWords: string[] };
  assert.ok(katla.targets.length >= 360, `Expected >= 360 targets, got ${String(katla.targets.length)}`);

  const uniqueTargets = new Set<string>();
  const buckets = new Map<number, number>([
    [5, 0],
    [6, 0],
    [7, 0],
  ]);

  for (const raw of katla.targets) {
    const word = raw.trim().toLowerCase();
    assert.match(word, /^[a-z]{5,7}$/, `Invalid katla word length/chars: ${raw}`);
    assert.ok(!uniqueTargets.has(word), `Duplicate katla target: ${word}`);
    uniqueTargets.add(word);
    buckets.set(word.length, (buckets.get(word.length) ?? 0) + 1);
  }

  assert.ok((buckets.get(5) ?? 0) >= 100, "Must have >= 100 5-letter Katla words");
  assert.ok((buckets.get(6) ?? 0) >= 100, "Must have >= 100 6-letter Katla words");
  assert.ok((buckets.get(7) ?? 0) >= 100, "Must have >= 100 7-letter Katla words");
  assert.ok(katla.validWords.length >= katla.targets.length);
});

void test("GameDataIntegrity: caklontong.json >= 160 soal lengkap dengan jawaban dan alasan", () => {
  const items = readJson("caklontong.json") as {
    prompt: string;
    answers: string[];
    reason: string;
  }[];
  assert.ok(items.length >= 160, `Expected >= 160 caklontong, got ${String(items.length)}`);

  const seenPrompts = new Set<string>();
  for (const item of items) {
    assert.ok(item.prompt.trim().length >= 10);
    assert.ok(Array.isArray(item.answers) && item.answers.length >= 1);
    assert.ok(item.reason.trim().length >= 10, `Reason too short: ${item.prompt}`);
    assert.ok(!DRAFT_NOISE_REGEX.test(item.prompt + " " + item.reason));

    const pKey = item.prompt.trim().toLowerCase();
    assert.ok(!seenPrompts.has(pKey), `Duplicate caklontong prompt: ${item.prompt}`);
    seenPrompts.add(pKey);
  }
});
