import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";

import { env } from "../../config/env";
import { AppUserError } from "../../errors/appUserError";
import { mediaQueueService } from "../../utils/boundedQueue";
import { MAX_SAFE_IMAGE_PIXELS } from "../../utils/imageSafety";
import { runExternalProcess } from "../../utils/processRunner";
import { createTempDir, removeTempDir } from "../../utils/tempFile";
import { BoundedTtlCache } from "../../utils/ttlCache";
import { safeFetchExternal } from "../../utils/urlValidator";
import { clampText, escapeXml, stripInvalidXmlChars } from "../../utils/xml";
import { addStickerMetadata, DEFAULT_STICKER_AUTHOR } from "./sticker/stickerExif";

const STICKER_SIZE = 512;
const TAHTA_SIZE = 800;
const CARBON_WIDTH = 800;
const MAX_RESIZE_DIM = 2048;
const MIN_RESIZE_DIM = 16;

// Tanggal rilis resmi Google Emoji Kitchen pada gstatic.com (diurutkan terbaru dulu)
const EMOJI_KITCHEN_DATES = [
  "20240206",
  "20231113",
  "20230803",
  "20230418",
  "20230301",
  "20221101",
  "20220823",
  "20220506",
  "20220203",
  "20211115",
  "20210831",
  "20210521",
  "20210218",
  "20201001",
] as const;

export interface MediaResolutionInfo {
  mediaType: "image" | "sticker" | "video";
  width: number | null;
  height: number | null;
  format: string;
  sizeBytes: number;
  durationSec: number | null;
  isAnimated: boolean;
}

export interface StyledFontVariant {
  label: string;
  text: string;
}

export function emojiToKitchenCode(rawEmoji: string, keepVariationSelector = false): string {
  const parts: string[] = [];
  for (const ch of rawEmoji.trim()) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (!keepVariationSelector && cp === 0xfe0f) continue;
    parts.push(`u${cp.toString(16).toLowerCase()}`);
  }
  return parts.join("-");
}

export function parseEmojiMixPair(rawInput: string): [string, string] | null {
  const cleaned = rawInput.trim();
  if (!cleaned) return null;

  if (cleaned.includes("+")) {
    const [left, right] = cleaned.split("+").map((s) => s.trim());
    if (left && right) return [left, right];
    return null;
  }

  const spaceParts = cleaned.split(/\s+/).filter(Boolean);
  if (spaceParts.length >= 2 && spaceParts[0] && spaceParts[1]) {
    return [spaceParts[0], spaceParts[1]];
  }

  // Fallback jika 2 emoji ditulis menempel tanpa spasi (mis. 😂🔥)
  const segmenter = new Intl.Segmenter("id", { granularity: "grapheme" });
  const graphemes = Array.from(segmenter.segment(cleaned), (seg) => seg.segment).filter(
    (g) => g.trim().length > 0,
  );
  if (graphemes.length === 2 && graphemes[0] && graphemes[1]) {
    return [graphemes[0], graphemes[1]];
  }

  return null;
}

export function generateStyledFonts(rawText: string): StyledFontVariant[] {
  const input = rawText.trim();
  if (!input) {
    throw new AppUserError("Masukkan teks yang ingin diubah gayanya. Contoh: *.style MinjiBot*");
  }
  if (input.length > 150) {
    throw new AppUserError("Teks terlalu panjang (maksimal 150 karakter).");
  }

  const mapRange = (
    text: string,
    upperStart: number,
    lowerStart: number,
    digitStart?: number,
    exceptions?: Record<string, string>,
  ): string => {
    let out = "";
    for (const ch of text) {
      if (exceptions && ch in exceptions) {
        out += exceptions[ch] ?? ch;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code >= 65 && code <= 90) {
        out += String.fromCodePoint(upperStart + (code - 65));
      } else if (code >= 97 && code <= 122) {
        out += String.fromCodePoint(lowerStart + (code - 97));
      } else if (digitStart !== undefined && code >= 48 && code <= 57) {
        out += String.fromCodePoint(digitStart + (code - 48));
      } else {
        out += ch;
      }
    }
    return out;
  };

  const smallCapsMap: Record<string, string> = {
    a: "ᴀ",
    b: "ʙ",
    c: "ᴄ",
    d: "ᴅ",
    e: "ᴇ",
    f: "ꜰ",
    g: "ɢ",
    h: "ʜ",
    i: "ɪ",
    j: "ᴊ",
    k: "ᴋ",
    l: "ʟ",
    m: "ᴍ",
    n: "ɴ",
    o: "ᴏ",
    p: "ᴘ",
    q: "ǫ",
    r: "ʀ",
    s: "ꜱ",
    t: "ᴛ",
    u: "ᴜ",
    v: "ᴠ",
    w: "ᴡ",
    x: "x",
    y: "ʏ",
    z: "ᴢ",
  };

  const upsideDownMap: Record<string, string> = {
    a: "ɐ",
    b: "q",
    c: "ɔ",
    d: "p",
    e: "ǝ",
    f: "ɟ",
    g: "ƃ",
    h: "ɥ",
    i: "ᴉ",
    j: "ɾ",
    k: "ʞ",
    l: "l",
    m: "ɯ",
    n: "u",
    o: "o",
    p: "d",
    q: "b",
    r: "ɹ",
    s: "s",
    t: "ʇ",
    u: "n",
    v: "ʌ",
    w: "ʍ",
    x: "x",
    y: "ʎ",
    z: "z",
    A: "∀",
    B: "𐐒",
    C: "Ɔ",
    D: "ᗡ",
    E: "Ǝ",
    F: "Ⅎ",
    G: "פ",
    H: "H",
    I: "I",
    J: "ſ",
    K: "ʞ",
    L: "˥",
    M: "W",
    N: "N",
    O: "O",
    P: "Ԁ",
    Q: "Q",
    R: "ɹ",
    S: "S",
    T: "┴",
    U: "∩",
    V: "Λ",
    W: "M",
    X: "X",
    Y: "⅄",
    Z: "Z",
    "1": "Ɩ",
    "2": "ᄅ",
    "3": "Ɛ",
    "4": "ㄣ",
    "5": "ϛ",
    "6": "9",
    "7": "ㄥ",
    "8": "8",
    "9": "6",
    "0": "0",
    "!": "¡",
    "?": "¿",
  };

  const toSmallCaps = (s: string): string =>
    Array.from(s, (ch) => smallCapsMap[ch.toLowerCase()] ?? ch).join("");

  const toFullwidth = (s: string): string =>
    Array.from(s, (ch) => {
      const code = ch.charCodeAt(0);
      if (code === 32) return "\u3000";
      if (code >= 33 && code <= 126) return String.fromCodePoint(code + 0xfee0);
      return ch;
    }).join("");

  const toUpsideDown = (s: string): string =>
    Array.from(s, (ch) => upsideDownMap[ch] ?? ch)
      .reverse()
      .join("");

  const toSquared = (s: string): string =>
    Array.from(s.toUpperCase(), (ch) => {
      const code = ch.charCodeAt(0);
      if (code >= 65 && code <= 90) return String.fromCodePoint(0x1f130 + (code - 65));
      return ch;
    }).join("");

  return [
    { label: "Bold Serif", text: mapRange(input, 0x1d400, 0x1d41a, 0x1d7ce) },
    { label: "Bold Sans", text: mapRange(input, 0x1d5d4, 0x1d5ee, 0x1d7ec) },
    {
      label: "Italic",
      text: mapRange(input, 0x1d434, 0x1d44e, undefined, { h: "ℎ" }),
    },
    { label: "Bold Italic", text: mapRange(input, 0x1d468, 0x1d482) },
    {
      label: "Script",
      text: mapRange(input, 0x1d4d0, 0x1d4ea),
    },
    {
      label: "Fraktur",
      text: mapRange(input, 0x1d56c, 0x1d586),
    },
    {
      label: "Double Struck",
      text: mapRange(input, 0x1d538, 0x1d552, 0x1d7d8, {
        C: "ℂ",
        H: "ℍ",
        N: "ℕ",
        P: "ℙ",
        Q: "ℚ",
        R: "ℝ",
        Z: "ℤ",
      }),
    },
    { label: "Monospace", text: mapRange(input, 0x1d670, 0x1d68a, 0x1d7f6) },
    { label: "Circled", text: mapRange(input, 0x24b6, 0x24d0) },
    { label: "Squared", text: toSquared(input) },
    { label: "Small Caps", text: toSmallCaps(input) },
    { label: "Fullwidth", text: toFullwidth(input) },
    { label: "Terbalik", text: toUpsideDown(input) },
  ];
}

export class LightMakerService {
  private readonly emojiMixUrlCache = new BoundedTtlCache<string>(250, 60 * 60 * 1000);

  constructor(private readonly fetchFn: typeof safeFetchExternal = safeFetchExternal) {}

  async renderTahtaImage(rawText: string): Promise<Buffer> {
    const cleaned = stripInvalidXmlChars(rawText).trim().toUpperCase();
    if (!cleaned) {
      throw new AppUserError("Masukkan teks untuk poster Harta Tahta. Contoh: *.tahta MINJI*");
    }
    const nameText = clampText(cleaned, 20, "");
    const nameFontSize = nameText.length <= 7 ? 128 : nameText.length <= 12 ? 96 : 68;

    const svg = [
      `<svg width="${String(TAHTA_SIZE)}" height="${String(TAHTA_SIZE)}" viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg">`,
      `  <defs>`,
      `    <linearGradient id="neon" x1="0%" y1="0%" x2="100%" y2="100%">`,
      `      <stop offset="0%" stop-color="#FF2E93"/>`,
      `      <stop offset="38%" stop-color="#FFE600"/>`,
      `      <stop offset="72%" stop-color="#00F5D4"/>`,
      `      <stop offset="100%" stop-color="#9B5DE5"/>`,
      `    </linearGradient>`,
      `    <radialGradient id="bg" cx="50%" cy="50%" r="65%">`,
      `      <stop offset="0%" stop-color="#191628"/>`,
      `      <stop offset="100%" stop-color="#050508"/>`,
      `    </radialGradient>`,
      `  </defs>`,
      `  <rect width="800" height="800" fill="url(#bg)"/>`,
      `  <rect x="28" y="28" width="744" height="744" rx="34" fill="none" stroke="url(#neon)" stroke-width="6" opacity="0.55"/>`,
      `  <text x="400" y="245" text-anchor="middle" font-family="Arial Black, DejaVu Sans, Liberation Sans, sans-serif" font-size="136" font-weight="900" fill="url(#neon)" letter-spacing="8">HARTA</text>`,
      `  <text x="400" y="425" text-anchor="middle" font-family="Arial Black, DejaVu Sans, Liberation Sans, sans-serif" font-size="136" font-weight="900" fill="url(#neon)" letter-spacing="8">TAHTA</text>`,
      `  <text x="400" y="610" text-anchor="middle" font-family="Arial Black, DejaVu Sans, Liberation Sans, sans-serif" font-size="${String(nameFontSize)}" font-weight="900" fill="url(#neon)" letter-spacing="4">${escapeXml(nameText)}</text>`,
      `  <text x="400" y="730" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="22" fill="#8888AA" letter-spacing="3">MINJIBOT STUDIO</text>`,
      `</svg>`,
    ].join("\n");

    return mediaQueueService.imageComputeQueue.run(async () =>
      sharp(Buffer.from(svg), { limitInputPixels: MAX_SAFE_IMAGE_PIXELS }).png().toBuffer(),
    );
  }

  async renderCarbonImage(rawCode: string): Promise<Buffer> {
    const cleaned = stripInvalidXmlChars(rawCode).replace(/\r\n?/g, "\n").trim();
    if (!cleaned) {
      throw new AppUserError("Masukkan kode untuk dibuat kartu Carbon. Contoh: *.carbon console.log('Halo')*");
    }

    const maxCharsPerLine = 54;
    const rawLines = cleaned.split("\n").slice(0, 28);
    const wrappedLines: string[] = [];

    for (const line of rawLines) {
      const expanded = line.replace(/\t/g, "  ");
      if (expanded.length <= maxCharsPerLine) {
        wrappedLines.push(expanded);
      } else {
        for (let i = 0; i < expanded.length && wrappedLines.length < 30; i += maxCharsPerLine) {
          wrappedLines.push(expanded.slice(i, i + maxCharsPerLine));
        }
      }
      if (wrappedLines.length >= 30) break;
    }

    const lineHeight = 28;
    const padOuter = 36;
    const titleBarHeight = 46;
    const codePadY = 24;
    const cardHeight = Math.max(
      180,
      titleBarHeight + codePadY * 2 + wrappedLines.length * lineHeight,
    );
    const totalHeight = Math.min(1100, cardHeight + padOuter * 2);

    const codeTspans = wrappedLines
      .map((line, idx) => {
        const y = padOuter + titleBarHeight + codePadY + 18 + idx * lineHeight;
        const lineNum = String(idx + 1).padStart(2, " ");
        return [
          `<text x="${String(padOuter + 24)}" y="${String(y)}" font-family="DejaVu Sans Mono, Liberation Mono, Consolas, monospace" font-size="18" fill="#585B70">${escapeXml(lineNum)}</text>`,
          `<text x="${String(padOuter + 66)}" y="${String(y)}" font-family="DejaVu Sans Mono, Liberation Mono, Consolas, monospace" font-size="18" fill="#CDD6F4" xml:space="preserve">${escapeXml(line || " ")}</text>`,
        ].join("\n");
      })
      .join("\n");

    const svg = [
      `<svg width="${String(CARBON_WIDTH)}" height="${String(totalHeight)}" viewBox="0 0 ${String(CARBON_WIDTH)} ${String(totalHeight)}" xmlns="http://www.w3.org/2000/svg">`,
      `  <defs>`,
      `    <linearGradient id="carbonBg" x1="0%" y1="0%" x2="100%" y2="100%">`,
      `      <stop offset="0%" stop-color="#6366F1"/>`,
      `      <stop offset="50%" stop-color="#8B5CF6"/>`,
      `      <stop offset="100%" stop-color="#EC4899"/>`,
      `    </linearGradient>`,
      `  </defs>`,
      `  <rect width="${String(CARBON_WIDTH)}" height="${String(totalHeight)}" fill="url(#carbonBg)"/>`,
      `  <rect x="${String(padOuter)}" y="${String(padOuter)}" width="${String(CARBON_WIDTH - padOuter * 2)}" height="${String(totalHeight - padOuter * 2)}" rx="16" fill="#1E1E2E"/>`,
      `  <circle cx="${String(padOuter + 24)}" cy="${String(padOuter + 22)}" r="7" fill="#F38BA8"/>`,
      `  <circle cx="${String(padOuter + 48)}" cy="${String(padOuter + 22)}" r="7" fill="#F9E2AF"/>`,
      `  <circle cx="${String(padOuter + 72)}" cy="${String(padOuter + 22)}" r="7" fill="#A6E3A1"/>`,
      `  <text x="${String(CARBON_WIDTH / 2)}" y="${String(padOuter + 27)}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="15" fill="#7F849C">minjibot-carbon.ts</text>`,
      `  <line x1="${String(padOuter)}" y1="${String(padOuter + titleBarHeight)}" x2="${String(CARBON_WIDTH - padOuter)}" y2="${String(padOuter + titleBarHeight)}" stroke="#313244" stroke-width="1"/>`,
      codeTspans,
      `</svg>`,
    ].join("\n");

    return mediaQueueService.imageComputeQueue.run(async () =>
      sharp(Buffer.from(svg), { limitInputPixels: MAX_SAFE_IMAGE_PIXELS }).png().toBuffer(),
    );
  }

  async createEmojiMixSticker(emoji1: string, emoji2: string): Promise<Buffer> {
    const c1 = emojiToKitchenCode(emoji1, false);
    const c2 = emojiToKitchenCode(emoji2, false);
    const c1v = emojiToKitchenCode(emoji1, true);
    const c2v = emojiToKitchenCode(emoji2, true);

    if (!c1 || !c2) {
      throw new AppUserError("Masukkan 2 emoji yang valid. Contoh: *.emojimix 😂+🔥*");
    }

    const cacheKey = `${c1}|${c2}`;
    let matchedUrl = this.emojiMixUrlCache.get(cacheKey);

    if (!matchedUrl) {
      const codePairs: [string, string][] = [
        [c1, c2],
        [c2, c1],
      ];
      if (c1v !== c1 || c2v !== c2) {
        codePairs.push([c1v, c2v], [c2v, c1v], [c1v, c2], [c1, c2v]);
      }

      const candidateUrls: string[] = [];
      const seen = new Set<string>();
      for (const date of EMOJI_KITCHEN_DATES) {
        for (const [a, b] of codePairs) {
          const url = `https://www.gstatic.com/android/keyboard/emojikitchen/${date}/${a}/${a}_${b}.png`;
          if (!seen.has(url)) {
            seen.add(url);
            candidateUrls.push(url);
          }
        }
      }

      // Cek dalam batch kecil (8 paralel) agar cepat dan hemat RAM/socket
      for (let i = 0; i < candidateUrls.length && !matchedUrl; i += 8) {
        const batch = candidateUrls.slice(i, i + 8);
        const checks = await Promise.allSettled(
          batch.map(async (url) => {
            const resp = await this.fetchFn(url, {
              method: "HEAD",
              allowedDomains: ["gstatic.com"],
              signal: AbortSignal.timeout(4_500),
            });
            await resp.body?.cancel();
            if (resp.ok) {
              return url;
            }
            return null;
          }),
        );
        for (const res of checks) {
          if (res.status === "fulfilled" && res.value) {
            matchedUrl = res.value;
            break;
          }
        }
      }

      if (!matchedUrl) {
        throw new AppUserError(
          "Kombinasi emoji tersebut belum tersedia di Emoji Kitchen. Coba kombinasi lain seperti *.emojimix 😂+🔥* atau *.emojimix 😍+👻*!",
        );
      }

      this.emojiMixUrlCache.set(cacheKey, matchedUrl);
    }

    const resp = await this.fetchFn(matchedUrl, {
      method: "GET",
      allowedDomains: ["gstatic.com"],
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      throw new AppUserError("Gagal mengunduh gambar EmojiMix. Silakan coba lagi.");
    }

    const pngBuffer = Buffer.from(await resp.arrayBuffer());
    const webpBuffer = await mediaQueueService.imageComputeQueue.run(async () =>
      sharp(pngBuffer, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
        .resize(STICKER_SIZE, STICKER_SIZE, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .webp({ quality: 90, effort: 4 })
        .toBuffer(),
    );

    return addStickerMetadata(webpBuffer, "MinjiBot EmojiMix", DEFAULT_STICKER_AUTHOR);
  }

  async rewatermarkSticker(
    stickerBuffer: Buffer,
    rawPack: string,
    rawAuthor: string,
  ): Promise<Buffer> {
    const pack = clampText(rawPack.trim(), 40, "");
    const author = clampText(rawAuthor.trim() || DEFAULT_STICKER_AUTHOR, 40, "");
    if (!pack) {
      throw new AppUserError(
        "Format salah. Reply stiker lalu ketik: *.wm NamaPack | NamaAuthor*\nContoh: *.wm Stiker Gacor | Minji*",
      );
    }
    return addStickerMetadata(stickerBuffer, pack, author);
  }

  async resizeImageBuffer(inputBuffer: Buffer, width: number, height: number): Promise<Buffer> {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < MIN_RESIZE_DIM ||
      height < MIN_RESIZE_DIM ||
      width > MAX_RESIZE_DIM ||
      height > MAX_RESIZE_DIM
    ) {
      throw new AppUserError(
        `Ukuran lebar dan tinggi harus antara ${String(MIN_RESIZE_DIM)} sampai ${String(MAX_RESIZE_DIM)} piksel.`,
      );
    }

    return mediaQueueService.imageComputeQueue.run(async () =>
      sharp(inputBuffer, { animated: false, limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
        .rotate()
        .resize(width, height, { fit: "fill" })
        .png()
        .toBuffer(),
    );
  }

  async inspectMediaResolution(
    inputBuffer: Buffer,
    mediaType: "image" | "sticker" | "video",
  ): Promise<MediaResolutionInfo> {
    if (mediaType === "image" || mediaType === "sticker") {
      const meta = await sharp(inputBuffer, {
        animated: true,
        limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
      }).metadata();
      const pages = meta.pages ?? 1;
      const height = meta.pageHeight ?? meta.height;
      return {
        mediaType,
        width: meta.width,
        height,
        format: meta.format.toUpperCase(),
        sizeBytes: inputBuffer.byteLength,
        durationSec: null,
        isAnimated: pages > 1,
      };
    }

    const tempDir = await createTempDir("cekreso");
    const videoPath = path.join(tempDir, `probe-${randomUUID()}.mp4`);
    try {
      await writeFile(videoPath, inputBuffer);
      const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";
      const result = await runExternalProcess(ffmpegPath, ["-hide_banner", "-i", videoPath], {
        timeoutMs: 8_000,
        throwOnNonZeroExit: false,
      });

      const dimMatch = /Video:.*?,\s*(\d{2,5})x(\d{2,5})/i.exec(result.stderr);
      const durMatch = /Duration:\s*(\d{2,}):(\d{2}):(\d{2}(?:\.\d+)?)/i.exec(result.stderr);

      const width = dimMatch?.[1] ? Number.parseInt(dimMatch[1], 10) : null;
      const height = dimMatch?.[2] ? Number.parseInt(dimMatch[2], 10) : null;
      let durationSec: number | null = null;
      if (durMatch?.[1] && durMatch[2] && durMatch[3]) {
        durationSec =
          Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3]);
      }

      return {
        mediaType: "video",
        width,
        height,
        format: "MP4 / VIDEO",
        sizeBytes: inputBuffer.byteLength,
        durationSec,
        isAnimated: true,
      };
    } finally {
      await removeTempDir(tempDir);
    }
  }

  async extractVideoFrame(videoBuffer: Buffer, seekSeconds: number): Promise<Buffer> {
    if (!Number.isFinite(seekSeconds) || seekSeconds < 0 || seekSeconds > 3600) {
      throw new AppUserError("Detik pengambilan frame harus antara 0 sampai 3600 detik.");
    }

    return mediaQueueService.imageComputeQueue.run(async () => {
      const tempDir = await createTempDir("getfoto");
      const inputPath = path.join(tempDir, `vid-${randomUUID()}.mp4`);
      const outputPath = path.join(tempDir, "frame.jpg");

      try {
        await writeFile(inputPath, videoBuffer);
        const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";
        await runExternalProcess(
          ffmpegPath,
          [
            "-y",
            "-threads",
            "1",
            "-ss",
            String(seekSeconds),
            "-i",
            inputPath,
            "-frames:v",
            "1",
            "-q:v",
            "2",
            outputPath,
          ],
          { timeoutMs: 15_000 },
        );
        return await readFile(outputPath);
      } catch {
        throw new AppUserError(
          `Gagal mengambil foto dari detik ke-${String(seekSeconds)}. Pastikan detik tidak melebihi durasi video.`,
        );
      } finally {
        await removeTempDir(tempDir);
      }
    });
  }
}

export const lightMakerService = new LightMakerService();
