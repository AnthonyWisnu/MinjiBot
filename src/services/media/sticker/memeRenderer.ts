import sharp, { type OverlayOptions } from "sharp";

import { MAX_SAFE_IMAGE_PIXELS } from "../../../utils/imageSafety";
import { clampText, codePointLength, escapeXml } from "../../../utils/xml";

const STICKER_SIZE = 512;
const MEME_TEXT_MAX_LENGTH = 100;
const MEME_MAX_WIDTH = 468;
const MEME_MAX_BLOCK_HEIGHT = 190;
const MEME_PADDING_Y = 16;
const MEME_FONT_STACK =
  "Arial Bold, Liberation Sans Bold, DejaVu Sans Bold, Segoe UI Emoji, Noto Color Emoji, Apple Color Emoji, sans-serif";

const OUTLINE_OFFSETS: readonly [number, number][] = [
  [-3, -3],
  [0, -3],
  [3, -3],
  [-3, 0],
  [3, 0],
  [-3, 3],
  [0, 3],
  [3, 3],
  [-2, -2],
  [2, -2],
  [-2, 2],
  [2, 2],
];

export function normalizeMemeText(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const clamped = clampText(collapsed, MEME_TEXT_MAX_LENGTH, "");
  // Hanya ubah huruf ASCII ke kapital agar urutan karakter Unicode/emoji tetap utuh
  return clamped.replace(/[a-z]/g, (ch) => ch.toUpperCase());
}

function selectMemeFontPointSize(topText: string, bottomText: string): number {
  const maxLen = Math.max(codePointLength(topText), codePointLength(bottomText));
  if (maxLen <= 20) {
    return 34;
  }
  if (maxLen <= 45) {
    return 28;
  }
  if (maxLen <= 70) {
    return 23;
  }
  return 19;
}

async function renderOutlinedTextBlock(
  text: string,
  fontPt: number,
): Promise<{
  fgBuffer: Buffer;
  outlineBuffer: Buffer;
  width: number;
  height: number;
}> {
  const pangoMarkup = `<span foreground="#ffffff" weight="heavy">${escapeXml(text)}</span>`;
  let fgBuffer = await sharp({
    text: {
      text: pangoMarkup,
      font: `${MEME_FONT_STACK} ${String(fontPt)}`,
      width: MEME_MAX_WIDTH,
      align: "centre",
      wrap: "word-char",
      rgba: true,
    },
  })
    .png()
    .toBuffer();

  let meta = await sharp(fgBuffer, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS }).metadata();
  let width = meta.width;
  let height = meta.height;

  if (width > MEME_MAX_WIDTH || height > MEME_MAX_BLOCK_HEIGHT) {
    fgBuffer = await sharp(fgBuffer, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
      .resize(MEME_MAX_WIDTH, MEME_MAX_BLOCK_HEIGHT, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    meta = await sharp(fgBuffer, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS }).metadata();
    width = meta.width;
    height = meta.height;
  }

  // Buat siluet hitam dari alpha channel teks/emoji untuk outline meme
  const outlineBuffer = await sharp(fgBuffer, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
    .recomb([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ])
    .png()
    .toBuffer();

  return {
    fgBuffer,
    outlineBuffer,
    width,
    height,
  };
}

function buildBlockOverlays(
  block: { fgBuffer: Buffer; outlineBuffer: Buffer; width: number; height: number },
  baseLeft: number,
  baseTop: number,
): OverlayOptions[] {
  const overlays: OverlayOptions[] = [];

  for (const [dx, dy] of OUTLINE_OFFSETS) {
    const left = Math.max(0, Math.min(STICKER_SIZE - block.width, baseLeft + dx));
    const top = Math.max(0, Math.min(STICKER_SIZE - block.height, baseTop + dy));
    overlays.push({
      input: block.outlineBuffer,
      left,
      top,
    });
  }

  overlays.push({
    input: block.fgBuffer,
    left: Math.max(0, Math.min(STICKER_SIZE - block.width, baseLeft)),
    top: Math.max(0, Math.min(STICKER_SIZE - block.height, baseTop)),
  });

  return overlays;
}

export async function buildMemeOverlays(
  topText: string,
  bottomText: string,
): Promise<OverlayOptions[]> {
  const fontPt = selectMemeFontPointSize(topText, bottomText);
  const overlays: OverlayOptions[] = [];

  if (topText) {
    const topBlock = await renderOutlinedTextBlock(topText, fontPt);
    const left = Math.round((STICKER_SIZE - topBlock.width) / 2);
    const top = MEME_PADDING_Y;
    overlays.push(...buildBlockOverlays(topBlock, left, top));
  }

  if (bottomText) {
    const bottomBlock = await renderOutlinedTextBlock(bottomText, fontPt);
    const left = Math.round((STICKER_SIZE - bottomBlock.width) / 2);
    const top = Math.max(MEME_PADDING_Y, STICKER_SIZE - bottomBlock.height - MEME_PADDING_Y);
    overlays.push(...buildBlockOverlays(bottomBlock, left, top));
  }

  return overlays;
}
