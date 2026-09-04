import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { quoteCardService } from "../src/services/media/quoteCard.service";

void test("QuoteCardService: generateQuoteCard produces valid 800x440 PNG buffer", async () => {
  const cardBuffer = await quoteCardService.generateQuoteCard({
    text: "Pendidikan adalah senjata paling ampuh untuk mengubah dunia.",
    authorName: "Nelson Mandela",
    authorSub: "Tokoh Inspiratif Dunia",
  });

  assert.ok(Buffer.isBuffer(cardBuffer));
  assert.ok(cardBuffer.length > 0);

  const meta = await sharp(cardBuffer).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 800);
  assert.equal(meta.height, 440);
});

void test("QuoteCardService: generateQuoteCard handles long text with line wrapping", async () => {
  const longText =
    "Kesuksesan bukanlah akhir dari segalanya, kegagalan bukanlah hal yang fatal. Keberanian untuk terus melangkah adalah satu-satunya hal yang benar-benar diperhitungkan dalam perjalanan hidup manusia.";

  const cardBuffer = await quoteCardService.generateQuoteCard({
    text: longText,
    authorName: "Winston Churchill",
    authorSub: "MinjiBot Quotes",
  });

  const meta = await sharp(cardBuffer).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 800);
  assert.equal(meta.height, 440);
});

void test("QuoteCardService: generateQuoteSticker converts quote card to 512x512 WebP sticker", async () => {
  const cardBuffer = await quoteCardService.generateQuoteCard({
    text: "Stay hungry, stay foolish.",
    authorName: "Steve Jobs",
  });

  const stickerBuffer = await quoteCardService.generateQuoteSticker(cardBuffer);

  assert.ok(Buffer.isBuffer(stickerBuffer));
  assert.ok(stickerBuffer.length > 0);

  const meta = await sharp(stickerBuffer).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);
});

void test("QuoteCardService: generateTweetCard produces valid 800x440 Twitter mockup PNG", async () => {
  const tweetBuffer = await quoteCardService.generateTweetCard({
    text: "Building awesome products with Node.js and TypeScript! 🚀",
    authorName: "Anthony Wisnu",
    authorHandle: "anthony",
    dateStr: "10:30 AM · 5 Sep 2026",
  });

  assert.ok(Buffer.isBuffer(tweetBuffer));
  assert.ok(tweetBuffer.length > 0);

  const meta = await sharp(tweetBuffer).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 800);
  assert.equal(meta.height, 440);
});
