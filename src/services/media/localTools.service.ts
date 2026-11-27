import sharp from "sharp";

import { AppUserError } from "../../errors/appUserError";
import { MAX_SAFE_IMAGE_PIXELS } from "../../utils/imageSafety";
import { escapeXml } from "../../utils/xml";
import { computeBratLayout } from "./sticker/bratRenderer";
import { addStickerMetadata } from "./sticker/stickerExif";

interface QrMatrixInstance {
  addData(data: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
}

type QrCodeConstructor = new (typeNumber: number, errorCorrectLevel: number) => QrMatrixInstance;

// Memanfaatkan encoder matriks QR bawaan `qrcode-terminal` (zero dependency tambahan)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QrCodeMatrix = require("qrcode-terminal/vendor/QRCode") as QrCodeConstructor;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QrErrorCorrectLevel = require("qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel") as {
  M: number;
};

const TTP_PALETTE = [
  "#FF3B30",
  "#FF9500",
  "#FFCC00",
  "#34C759",
  "#00C7BE",
  "#38BDF8",
  "#A855F7",
  "#EC4899",
] as const;

const MAX_QR_INPUT_LEN = 500;
const MAX_CALC_INPUT_LEN = 160;

/**
 * Menghasilkan gambar PNG QR Code 512x512 secara lokal tanpa API eksternal.
 */
export async function generateQrCodePng(rawText: string): Promise<Buffer> {
  const text = rawText.trim();
  if (!text) {
    throw new AppUserError("Teks atau URL untuk QR Code tidak boleh kosong.");
  }
  if (text.length > MAX_QR_INPUT_LEN) {
    throw new AppUserError(`Teks QR Code maksimal ${String(MAX_QR_INPUT_LEN)} karakter.`);
  }

  const qr = new QrCodeMatrix(-1, QrErrorCorrectLevel.M);
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const quietZone = 4;
  const totalModules = count + quietZone * 2;
  const rects: string[] = [];

  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) {
        rects.push(
          `<rect x="${String(col + quietZone)}" y="${String(row + quietZone)}" width="1" height="1" fill="#0F172A"/>`,
        );
      }
    }
  }

  const svg = [
    `<svg width="512" height="512" viewBox="0 0 ${String(totalModules)} ${String(totalModules)}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">`,
    `<rect width="100%" height="100%" fill="#FFFFFF"/>`,
    ...rects,
    `</svg>`,
  ].join("");

  return sharp(Buffer.from(svg), { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
    .resize(512, 512, { kernel: "nearest" })
    .png()
    .toBuffer();
}

/**
 * Menghasilkan stiker teks transparan warna-warni (.ttp) ber-EXIF MinjiBot.
 */
export async function createTtpSticker(rawText: string): Promise<Buffer> {
  const text = rawText.trim();
  if (!text) {
    throw new AppUserError("Teks untuk stiker .ttp tidak boleh kosong.");
  }

  const { lines, fontSize, lineHeight } = computeBratLayout(text);
  const totalHeight = lines.length * lineHeight;
  const startY = (512 - totalHeight) / 2 + fontSize * 0.82;
  const strokeWidth = Math.max(4, Math.round(fontSize * 0.14));

  const tspans = lines
    .map((line, i) => {
      const color = TTP_PALETTE[i % TTP_PALETTE.length] ?? "#FFCC00";
      return `<tspan x="256" y="${String(Math.round(startY + i * lineHeight))}" fill="${color}">${escapeXml(line)}</tspan>`;
    })
    .join("");

  const svg = [
    `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">`,
    `  <text x="256" y="${String(Math.round(startY))}"`,
    `    font-family="Arial, Liberation Sans, DejaVu Sans, Helvetica, sans-serif"`,
    `    font-size="${String(fontSize)}"`,
    `    font-weight="900"`,
    `    text-anchor="middle"`,
    `    stroke="#000000"`,
    `    stroke-width="${String(strokeWidth)}"`,
    `    paint-order="stroke fill"`,
    `    stroke-linejoin="round">${tspans}</text>`,
    `</svg>`,
  ].join("\n");

  const webpBuffer = await sharp(Buffer.from(svg), { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
    .resize(512, 512, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 90, effort: 4 })
    .toBuffer();

  return addStickerMetadata(webpBuffer);
}

type CalcToken =
  | { kind: "num"; value: number }
  | { kind: "op"; op: "+" | "-" | "*" | "/" | "%" | "^" }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "fn"; name: "sqrt" };

/**
 * Parser & evaluator ekspresi matematika aman (tanpa eval / Function).
 * Mendukung +, -, *, x, /, :, %, ^, (), sqrt(), dan pi.
 */
export function evaluateSafeMathExpression(rawExpression: string): number {
  const input = rawExpression.trim();
  if (!input || input.length > MAX_CALC_INPUT_LEN) {
    throw new AppUserError("Ekspresi matematika tidak valid atau terlalu panjang.");
  }

  const tokens = tokenizeMath(input);
  let cursor = 0;

  const peek = (): CalcToken | undefined => tokens[cursor];
  const consume = (): CalcToken | undefined => {
    const tok = tokens[cursor];
    cursor += 1;
    return tok;
  };

  function parseExpression(): number {
    let left = parseTerm();
    let next = peek();
    while (next?.kind === "op" && (next.op === "+" || next.op === "-")) {
      consume();
      const right = parseTerm();
      left = next.op === "+" ? left + right : left - right;
      next = peek();
    }
    return left;
  }

  function parseTerm(): number {
    let left = parsePower();
    let next = peek();
    while (next?.kind === "op" && (next.op === "*" || next.op === "/" || next.op === "%")) {
      consume();
      const right = parsePower();
      if ((next.op === "/" || next.op === "%") && right === 0) {
        throw new AppUserError("Tidak bisa membagi dengan nol (0).");
      }
      left = next.op === "*" ? left * right : next.op === "/" ? left / right : left % right;
      next = peek();
    }
    return left;
  }

  function parsePower(): number {
    const base = parseUnary();
    const next = peek();
    if (next?.kind === "op" && next.op === "^") {
      consume();
      const exp = parsePower();
      if (Math.abs(exp) > 1000) {
        throw new AppUserError("Pangkat terlalu besar.");
      }
      return Math.pow(base, exp);
    }
    return base;
  }

  function parseUnary(): number {
    const next = peek();
    if (next?.kind === "op" && (next.op === "+" || next.op === "-")) {
      consume();
      const val = parseUnary();
      return next.op === "-" ? -val : val;
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const tok = consume();
    if (!tok) {
      throw new AppUserError("Ekspresi matematika tidak lengkap.");
    }
    if (tok.kind === "num") {
      return tok.value;
    }
    if (tok.kind === "fn") {
      const lparen = consume();
      if (lparen?.kind !== "lparen") {
        throw new AppUserError("Gunakan tanda kurung untuk sqrt, contoh: sqrt(144).");
      }
      const inner = parseExpression();
      const rparen = consume();
      if (rparen?.kind !== "rparen") {
        throw new AppUserError("Tanda kurung tidak seimbang.");
      }
      if (inner < 0) {
        throw new AppUserError("Tidak bisa menghitung akar kuadrat dari angka negatif.");
      }
      return Math.sqrt(inner);
    }
    if (tok.kind === "lparen") {
      const inner = parseExpression();
      const rparen = consume();
      if (rparen?.kind !== "rparen") {
        throw new AppUserError("Tanda kurung tidak seimbang.");
      }
      return inner;
    }
    throw new AppUserError("Format ekspresi matematika tidak dikenali.");
  }

  const value = parseExpression();
  if (cursor < tokens.length) {
    throw new AppUserError("Ekspresi matematika memiliki karakter berlebih.");
  }
  if (!Number.isFinite(value)) {
    throw new AppUserError("Hasil perhitungan di luar batas angka.");
  }

  return Math.round(value * 1e10) / 1e10;
}

function tokenizeMath(raw: string): CalcToken[] {
  const normalized = raw
    .replace(/,/g, ".")
    .replace(/[×xX]/g, "*")
    .replace(/[÷:]/g, "/");
  const tokens: CalcToken[] = [];
  let i = 0;

  while (i < normalized.length) {
    const ch = normalized[i] ?? "";
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      let numStr = "";
      while (i < normalized.length && /[0-9.]/.test(normalized[i] ?? "")) {
        numStr += normalized[i] ?? "";
        i += 1;
      }
      const num = Number(numStr);
      if (!Number.isFinite(num)) {
        throw new AppUserError(`Angka tidak valid: "${numStr}".`);
      }
      tokens.push({ kind: "num", value: num });
      continue;
    }

    if (/[a-zA-Z]/.test(ch)) {
      let ident = "";
      while (i < normalized.length && /[a-zA-Z]/.test(normalized[i] ?? "")) {
        ident += normalized[i] ?? "";
        i += 1;
      }
      const lower = ident.toLowerCase();
      if (lower === "pi") {
        tokens.push({ kind: "num", value: Math.PI });
      } else if (lower === "sqrt") {
        tokens.push({ kind: "fn", name: "sqrt" });
      } else {
        throw new AppUserError(`Fungsi/simbol "${ident}" tidak didukung.`);
      }
      continue;
    }

    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "%" || ch === "^") {
      tokens.push({ kind: "op", op: ch });
      i += 1;
      continue;
    }

    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i += 1;
      continue;
    }

    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i += 1;
      continue;
    }

    throw new AppUserError(`Karakter tidak valid dalam kalkulator: "${ch}".`);
  }

  return tokens;
}
