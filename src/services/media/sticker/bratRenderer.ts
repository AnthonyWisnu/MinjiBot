import sharp from "sharp";

import { MAX_SAFE_IMAGE_PIXELS } from "../../../utils/imageSafety";
import {
  clampText,
  codePointLength,
  escapeXml,
  splitLongToken,
  stripInvalidXmlChars,
} from "../../../utils/xml";

const STICKER_SIZE = 512;
const BRAT_MARGIN = 40;
const BRAT_SAFE_BOX_SIZE = STICKER_SIZE - BRAT_MARGIN * 2; // 432x432 px
const BRAT_MAX_INPUT_CHARS = 1200;
const BRAT_MAX_FONT_SIZE = 64;
const BRAT_MIN_FONT_SIZE = 10;

export interface BratLayout {
  lines: string[];
  fontSize: number;
  lineHeight: number;
}

function wrapAllLinesForWidth(text: string, maxCharsPerLine: number): string[] {
  const safeMaxChars = Math.max(4, maxCharsPerLine);
  const paragraphs = text.split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .flatMap((w) => splitLongToken(w, safeMaxChars));

    if (words.length === 0) {
      continue;
    }

    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (codePointLength(candidate) <= safeMaxChars) {
        current = candidate;
      } else {
        if (current) {
          lines.push(current);
        }
        current = word;
      }
    }

    if (current) {
      lines.push(current);
    }
  }

  return lines.length > 0 ? lines : [clampText(text, safeMaxChars, "")];
}

export function computeBratLayout(rawText: string): BratLayout {
  const cleaned = stripInvalidXmlChars(rawText)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();

  const boundedText = clampText(cleaned, BRAT_MAX_INPUT_CHARS, "");

  for (let fontSize = BRAT_MAX_FONT_SIZE; fontSize >= BRAT_MIN_FONT_SIZE; fontSize -= 2) {
    // Faktor lebar karakter 0.62 memberikan margin horizontal yang aman untuk huruf kapital maupun kecil
    const maxCharsPerLine = Math.max(5, Math.floor(BRAT_SAFE_BOX_SIZE / (fontSize * 0.62)));
    const lineHeight = Math.round(fontSize * 1.22);
    const lines = wrapAllLinesForWidth(boundedText, maxCharsPerLine);
    const totalHeight = lines.length * lineHeight;

    if (totalHeight <= BRAT_SAFE_BOX_SIZE) {
      return {
        lines,
        fontSize,
        lineHeight,
      };
    }
  }

  // Fallback untuk teks sangat panjang pada batas ukuran font minimum
  const minFontSize = BRAT_MIN_FONT_SIZE;
  const maxCharsAtMin = Math.max(5, Math.floor(BRAT_SAFE_BOX_SIZE / (minFontSize * 0.62)));
  const minLineHeight = Math.round(minFontSize * 1.22);
  const maxLinesAtMin = Math.max(1, Math.floor(BRAT_SAFE_BOX_SIZE / minLineHeight));
  const allLines = wrapAllLinesForWidth(boundedText, maxCharsAtMin).slice(0, maxLinesAtMin);

  return {
    lines: allLines,
    fontSize: minFontSize,
    lineHeight: minLineHeight,
  };
}

export function createBratSvg(text: string): string {
  const { lines, fontSize, lineHeight } = computeBratLayout(text);
  const totalHeight = lines.length * lineHeight;
  const startY = (STICKER_SIZE - totalHeight) / 2 + fontSize * 0.82;

  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="256" y="${String(Math.round(startY + i * lineHeight))}">${escapeXml(line)}</tspan>`,
    )
    .join("");

  return [
    `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">`,
    `  <defs>`,
    `    <filter id="brat-blur" x="-10%" y="-10%" width="120%" height="120%">`,
    `      <feGaussianBlur in="SourceGraphic" stdDeviation="0.6"/>`,
    `    </filter>`,
    `  </defs>`,
    `  <rect width="512" height="512" fill="#FFFFFF"/>`,
    `  <text x="256" y="${String(Math.round(startY))}"`,
    `    font-family="Arial, Liberation Sans, DejaVu Sans, Helvetica, Noto Color Emoji, sans-serif"`,
    `    font-size="${String(fontSize)}"`,
    `    font-weight="bold"`,
    `    text-anchor="middle"`,
    `    fill="#000000"`,
    `    filter="url(#brat-blur)"`,
    `    letter-spacing="0">${tspans}</text>`,
    `</svg>`,
  ].join("\n");
}

export async function renderBratStickerWebp(text: string): Promise<Buffer> {
  const svgString = createBratSvg(text);
  return sharp(Buffer.from(svgString), {
    limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
  })
    .resize(STICKER_SIZE, STICKER_SIZE, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .webp({
      quality: 88,
      effort: 4,
    })
    .toBuffer();
}
