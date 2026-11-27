import sharp, { type OverlayOptions } from "sharp";

import { MAX_SAFE_IMAGE_PIXELS } from "../../../utils/imageSafety";
import { clampText, codePointLength, escapeXml } from "../../../utils/xml";

const STICKER_SIZE = 512;
const MEME_TEXT_MAX_LENGTH = 100;
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

function selectMemeFontPointSize(
  topText: string,
  bottomText: string,
  canvasWidth: number,
  canvasHeight: number,
): number {
  const maxLen = Math.max(codePointLength(topText), codePointLength(bottomText));
  let basePt = 19;
  if (maxLen <= 20) {
    basePt = 34;
  } else if (maxLen <= 45) {
    basePt = 28;
  } else if (maxLen <= 70) {
    basePt = 23;
  }

  const minDim = Math.min(canvasWidth, canvasHeight);
  const scale = Math.max(0.65, Math.min(1, minDim / STICKER_SIZE));
  return Math.max(14, Math.round(basePt * scale));
}

async function renderOutlinedTextBlock(
  text: string,
  fontPt: number,
  maxTextWidth: number,
  maxBlockHeight: number,
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
      width: maxTextWidth,
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

  if (width > maxTextWidth || height > maxBlockHeight) {
    fgBuffer = await sharp(fgBuffer, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
      .resize(maxTextWidth, maxBlockHeight, {
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
  canvasWidth: number,
  canvasHeight: number,
): OverlayOptions[] {
  const overlays: OverlayOptions[] = [];
  const maxLeft = Math.max(0, canvasWidth - block.width);
  const maxTop = Math.max(0, canvasHeight - block.height);

  for (const [dx, dy] of OUTLINE_OFFSETS) {
    const left = Math.max(0, Math.min(maxLeft, baseLeft + dx));
    const top = Math.max(0, Math.min(maxTop, baseTop + dy));
    overlays.push({
      input: block.outlineBuffer,
      left,
      top,
    });
  }

  overlays.push({
    input: block.fgBuffer,
    left: Math.max(0, Math.min(maxLeft, baseLeft)),
    top: Math.max(0, Math.min(maxTop, baseTop)),
  });

  return overlays;
}

export async function buildMemeOverlays(
  topText: string,
  bottomText: string,
  canvasWidth = STICKER_SIZE,
  canvasHeight = STICKER_SIZE,
): Promise<OverlayOptions[]> {
  const safeWidth = Math.max(64, canvasWidth);
  const safeHeight = Math.max(64, canvasHeight);
  const maxTextWidth = Math.max(48, safeWidth - 28);
  const maxBlockHeight = Math.max(32, Math.round(safeHeight * 0.36));
  const paddingY = Math.max(10, Math.round(safeHeight * 0.045));
  const fontPt = selectMemeFontPointSize(topText, bottomText, safeWidth, safeHeight);
  const overlays: OverlayOptions[] = [];

  if (topText) {
    const topBlock = await renderOutlinedTextBlock(topText, fontPt, maxTextWidth, maxBlockHeight);
    const left = Math.round((safeWidth - topBlock.width) / 2);
    const top = paddingY;
    overlays.push(...buildBlockOverlays(topBlock, left, top, safeWidth, safeHeight));
  }

  if (bottomText) {
    const bottomBlock = await renderOutlinedTextBlock(
      bottomText,
      fontPt,
      maxTextWidth,
      maxBlockHeight,
    );
    const left = Math.round((safeWidth - bottomBlock.width) / 2);
    const top = Math.max(paddingY, safeHeight - bottomBlock.height - paddingY);
    overlays.push(...buildBlockOverlays(bottomBlock, left, top, safeWidth, safeHeight));
  }

  return overlays;
}
