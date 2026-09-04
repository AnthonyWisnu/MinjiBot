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
import { audioEffectService } from "../src/services/media/audioEffect.service";

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

void test("Brat Sticker: createBratSticker generates valid WebP buffer", async () => {
  const buffer = await stickerService.createBratSticker("halo semuanya");
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 0);

  const meta = await sharp(buffer).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);

  // Check EXIF watermark is also attached to Brat sticker
  const img = new webp.Image();
  await img.load(buffer);
  assert.ok(img.exif !== null);
  const rawExif = img.exif.toString("utf-8");
  assert.ok(rawExif.includes("MinjiBot"));
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
