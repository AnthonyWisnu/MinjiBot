import assert from "node:assert/strict";
import test from "node:test";
import webp from "node-webpmux";
import sharp from "sharp";

import {
  stickerService,
  addStickerMetadata,
  DEFAULT_STICKER_PACK,
  DEFAULT_STICKER_AUTHOR,
} from "../src/services/media/sticker.service";
import { createBratSvg, computeBratLayout } from "../src/services/media/sticker/bratRenderer";
import {
  extractPinterestImageUrlsFromHtml,
  executePinterestSearch,
} from "../src/services/media/downloaders/pinterestSearch";
import { audioEffectService } from "../src/services/media/audioEffect.service";
import { BoundedQueue } from "../src/utils/boundedQueue";

void test("Sticker Watermark: default pack and author match MinjiBot branding without personal names", () => {
  assert.equal(DEFAULT_STICKER_PACK, "MinjiBot Official Pack");
  assert.equal(DEFAULT_STICKER_AUTHOR, "MinjiBot");
  assert.ok(!DEFAULT_STICKER_AUTHOR.toLowerCase().includes("anthony"));
  assert.ok(!DEFAULT_STICKER_PACK.toLowerCase().includes("anthony"));
});

void test("Sticker Watermark: addStickerMetadata injects readable WhatsApp EXIF metadata into WebP", async () => {
  const blankWebp = await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 138, g: 206, b: 0, alpha: 1 },
    },
  })
    .webp()
    .toBuffer();

  const withMetadata = await addStickerMetadata(blankWebp);
  assert.ok(withMetadata.length > blankWebp.length, "Output buffer should include metadata chunk");

  const img = new webp.Image();
  await img.load(withMetadata);
  assert.ok(img.exif !== null, "EXIF chunk should exist");

  const rawExif = img.exif.toString("utf-8");
  assert.ok(rawExif.includes("MinjiBot Official Pack"));
  assert.ok(rawExif.includes("MinjiBot"));
  assert.ok(!rawExif.toLowerCase().includes("anthony"));
});

void test("Brat Sticker: createBratSticker generates valid WebP buffer with white background", async () => {
  const buffer = await stickerService.createBratSticker("halo semuanya");
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);

  const meta = await sharp(buffer).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);

  const raw = await sharp(buffer).ensureAlpha().raw().toBuffer();
  assert.ok(raw[0] >= 250 && raw[1] >= 250 && raw[2] >= 250, "Corner pixel should be white");

  const svg = createBratSvg("halo semuanya");
  assert.ok(svg.includes('fill="#FFFFFF"'));
  assert.ok(svg.includes('fill="#000000"'));

  // Check EXIF watermark is also attached to Brat sticker
  const img = new webp.Image();
  await img.load(buffer);
  assert.ok(img.exif !== null);
  const rawExif = img.exif.toString("utf-8");
  assert.ok(rawExif.includes("MinjiBot"));
});

void test("Brat Sticker: handles long and very long text with automatic word wrap and scaling", async () => {
  const longText =
    "ini adalah contoh kalimat panjang untuk menguji fitur word wrap otomatis pada stiker brat supaya tidak terpotong sama sekali di dalam kotak 512x512";
  const layout = computeBratLayout(longText);
  assert.ok(layout.lines.length > 1, "Long text should wrap into multiple lines");
  assert.ok(layout.fontSize < 64, "Long text should scale down font size");

  const bufferLong = await stickerService.createBratSticker(longText);
  const metaLong = await sharp(bufferLong).metadata();
  assert.equal(metaLong.width, 512);
  assert.equal(metaLong.height, 512);

  const veryLongText = Array.from({ length: 80 }, (_, idx) => `kata${String(idx + 1)}`).join(" ");
  const bufferVeryLong = await stickerService.createBratSticker(veryLongText);
  const metaVeryLong = await sharp(bufferVeryLong).metadata();
  assert.equal(metaVeryLong.width, 512);
  assert.equal(metaVeryLong.height, 512);
});

void test("Static Sticker (.s): preserves non-1:1 aspect ratio with transparent padding (contain)", async () => {
  const landscapePng = await sharp({
    create: {
      width: 800,
      height: 400,
      channels: 4,
      background: { r: 220, g: 30, b: 30, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const stickerBuf = await stickerService.createSticker(landscapePng, false);

  const { data, info } = await sharp(stickerBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 512);
  assert.equal(info.height, 512);
  assert.equal(data[3], 0, "Top-left padding pixel must be transparent (alpha = 0)");

  const centerIdx = (256 * 512 + 256) * 4;
  assert.ok(data[centerIdx + 3] > 200, "Center pixel must be opaque");
});

void test("Meme Sticker (.smeme): preserves non-1:1 aspect ratio and renders emoji text without error", async () => {
  const portraitPng = await sharp({
    create: {
      width: 400,
      height: 800,
      channels: 4,
      background: { r: 30, g: 80, b: 200, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const memeBuf = await stickerService.createMemeSticker(
    portraitPng,
    "HALO \uD83D\uDE02\uD83D\uDD25",
    "MANTAP \u2764\uFE0F",
  );

  const { data, info } = await sharp(memeBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 512);
  assert.equal(info.height, 512);
  assert.equal(data[3], 0, "Top-left pillarbox pixel must be transparent (alpha = 0)");
});

void test("BoundedQueue: triggers onQueued callback with queue position when concurrency is full", async () => {
  const queue = new BoundedQueue({ concurrency: 1, maxQueueSize: 5, name: "test-queue" });
  const queuedPositions: number[] = [];

  let releaseFirst!: () => void;
  const firstBlocker = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const task1 = queue.run(async () => {
    await firstBlocker;
    return "first";
  });

  const task2 = queue.run(
    async () => {
      return "second";
    },
    {
      onQueued: (pos) => {
        queuedPositions.push(pos);
      },
    },
  );

  releaseFirst();
  const [res1, res2] = await Promise.all([task1, task2]);
  assert.equal(res1, "first");
  assert.equal(res2, "second");
  assert.deepEqual(queuedPositions, [1]);
});

void test("Brat Sticker: rejects empty text", async () => {
  await assert.rejects(
    async () => {
      await stickerService.createBratSticker("   ");
    },
    {
      message: "Teks stiker brat tidak boleh kosong.",
    },
  );
});

void test("Audio Effect Service: exists and exports singleton", () => {
  assert.ok(audioEffectService);
  assert.equal(typeof audioEffectService.applyEffect, "function");
});

void test("Pinterest Search: extractPinterestImageUrlsFromHtml extracts unique pinimg URLs and prefers originals", () => {
  const sampleHtml = [
    "murl&quot;:&quot;https://i.pinimg.com/736x/aa/bb/cc/aabbcc112233.jpg&quot;",
    "murl&quot;:&quot;https://i.pinimg.com/originals/aa/bb/cc/aabbcc112233.jpg?nii=t&quot;",
    "murl&quot;:&quot;https://i.pinimg.com/originals/dd/ee/ff/ddeeff445566.png&quot;",
    "murl&quot;:&quot;https://example.com/not-pinterest.jpg&quot;",
  ].join(" ");

  const urls = extractPinterestImageUrlsFromHtml(sampleHtml);
  assert.deepEqual(urls, [
    "https://i.pinimg.com/originals/aa/bb/cc/aabbcc112233.jpg",
    "https://i.pinimg.com/originals/dd/ee/ff/ddeeff445566.png",
  ]);
});

void test("Pinterest Search: executePinterestSearch rejects empty or overly long queries", async () => {
  await assert.rejects(
    async () => {
      await executePinterestSearch("   ");
    },
    {
      message: "Kata kunci pencarian Pinterest tidak boleh kosong.",
    },
  );

  await assert.rejects(
    async () => {
      await executePinterestSearch("a".repeat(101));
    },
    {
      message: "Kata kunci pencarian Pinterest terlalu panjang (maks. 100 karakter).",
    },
  );
});
