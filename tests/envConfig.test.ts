import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import dotenv from "dotenv";

import { envSchema } from "../src/config/env";

test("envConfig - .env.example should parse and validate cleanly against envSchema", () => {
  const envExamplePath = path.resolve(__dirname, "../.env.example");
  assert.ok(fs.existsSync(envExamplePath), ".env.example must exist");

  const rawEnv = fs.readFileSync(envExamplePath, "utf8");
  const parsedEnv = dotenv.parse(rawEnv);

  const result = envSchema.safeParse(parsedEnv);
  assert.ok(
    result.success,
    `Validation errors: ${result.success ? "" : JSON.stringify(result.error.errors, null, 2)}`,
  );

  assert.equal(result.data.MAX_DOWNLOAD_FILE_MB, 300);
  assert.equal(result.data.OPENROUTER_MODEL, "google/gemini-2.5-flash-lite");
  assert.equal(result.data.AI_DAILY_QUOTA_PER_GROUP, 80);
  assert.equal(result.data.MAX_TIKTOK_DURATION_SEC, 4200);
  assert.equal(result.data.MAX_INSTAGRAM_DURATION_SEC, 4200);
  assert.equal(result.data.MAX_YOUTUBE_DURATION_SEC, 3600);
  assert.equal(result.data.MAX_YOUTUBE_MUSIC_DURATION_SEC, 5400);
  assert.equal(result.data.MAX_TWITTER_DURATION_SEC, 5400);
  assert.equal(result.data.DOWNLOADER_TIMEOUT_MS, 600000);
  assert.equal(result.data.HD_MAX_INPUT_MB, 10);
  assert.equal(result.data.GALLERY_DL_BIN, "gallery-dl");
  assert.ok(result.data.SUPER_OWNER_JIDS.length > 0);
});
