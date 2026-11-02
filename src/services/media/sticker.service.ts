import ffmpegStatic from "ffmpeg-static";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import webp from "node-webpmux";
import sharp from "sharp";

import { env } from "../../config/env";
import { AppUserError } from "../../errors/appUserError";
import { MAX_SAFE_ANIMATED_PAGES, MAX_SAFE_IMAGE_PIXELS } from "../../utils/imageSafety";
import { runExternalProcess } from "../../utils/processRunner";
import { createTempDir, removeTempDir } from "../../utils/tempFile";
import { clampAndWrapText, clampText, codePointLength, escapeXml } from "../../utils/xml";

export const DEFAULT_STICKER_PACK = "MinjiBot Official Pack";
export const DEFAULT_STICKER_AUTHOR = "MinjiBot";

const STICKER_SIZE = 512;
const ANIMATED_STICKER_SECONDS = 6;
const STICKER_FPS = 15;
const MEME_TEXT_MAX_LENGTH = 80;
const BRAT_TEXT_MAX_LENGTH = 250;
const BRAT_MAX_CHARS_PER_LINE = 16;
const BRAT_MAX_LINES = 8;

export type StickerSourceType = "image" | "video";

export interface StickerImageResult {
  type: "image";
  buffer: Buffer;
  mimetype: "image/png";
  fileName: string;
}

export interface StickerVideoResult {
  type: "video";
  buffer: Buffer;
  mimetype: "video/mp4";
  fileName: string;
}

export type StickerToMediaResult = StickerImageResult | StickerVideoResult;

export class StickerService {
  async createSticker(inputBuffer: Buffer, sourceType: StickerSourceType): Promise<Buffer> {
    const rawBuffer =
      sourceType === "image"
        ? await this.createStaticSticker(inputBuffer)
        : await this.createAnimatedSticker(inputBuffer);

    return addStickerMetadata(rawBuffer);
  }

  async stickerToMedia(inputBuffer: Buffer, isAnimated: boolean): Promise<StickerToMediaResult> {
    const detectedAnimated = await this.isAnimatedSticker(inputBuffer);
    if (!isAnimated && !detectedAnimated) {
      return {
        type: "image",
        buffer: await this.staticStickerToImage(inputBuffer),
        mimetype: "image/png",
        fileName: "minjibot-sticker.png",
      };
    }

    return {
      type: "video",
      buffer: await this.animatedStickerToVideo(inputBuffer),
      mimetype: "video/mp4",
      fileName: "minjibot-sticker.mp4",
    };
  }

  async createMemeSticker(
    inputBuffer: Buffer,
    topText: string,
    bottomText: string,
  ): Promise<Buffer> {
    const normalizedTopText = normalizeMemeText(topText);
    const normalizedBottomText = normalizeMemeText(bottomText);

    if (!normalizedTopText && !normalizedBottomText) {
      throw new AppUserError("Teks meme tidak boleh kosong.");
    }

    const baseImage = await sharp(inputBuffer, {
      animated: false,
      limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
    })
      .rotate()
      .resize(STICKER_SIZE, STICKER_SIZE, {
        fit: "cover",
        position: "center",
      })
      .png()
      .toBuffer();

    const memeWebp = await sharp(baseImage, {
      limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
    })
      .composite([
        {
          input: Buffer.from(createMemeTextSvg(normalizedTopText, normalizedBottomText)),
          top: 0,
          left: 0,
        },
      ])
      .webp({
        quality: 85,
        effort: 4,
      })
      .toBuffer();

    return addStickerMetadata(memeWebp);
  }

  async createBratSticker(text: string): Promise<Buffer> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new AppUserError("Teks stiker brat tidak boleh kosong.");
    }

    const svgString = createBratSvg(trimmed);
    const bratWebp = await sharp(Buffer.from(svgString), {
      limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
    })
      .resize(STICKER_SIZE, STICKER_SIZE)
      .webp({
        quality: 85,
        effort: 4,
      })
      .toBuffer();

    return addStickerMetadata(bratWebp);
  }

  private async isAnimatedSticker(inputBuffer: Buffer): Promise<boolean> {
    const metadata = await sharp(inputBuffer, {
      animated: true,
      limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
    }).metadata();

    const pages = metadata.pages ?? 1;
    if (pages > MAX_SAFE_ANIMATED_PAGES) {
      throw new AppUserError("Durasi/jumlah frame stiker terlalu panjang (maks 150 frame).");
    }

    const delayCount = metadata.delay?.length ?? 0;
    const height = metadata.height;
    const pageHeight = metadata.pageHeight;

    return pages > 1 || delayCount > 1 || (pageHeight !== undefined && pageHeight < height);
  }

  private async createStaticSticker(inputBuffer: Buffer): Promise<Buffer> {
    return sharp(inputBuffer, {
      animated: false,
      limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
    })
      .rotate()
      .resize(STICKER_SIZE, STICKER_SIZE, {
        fit: "cover",
        position: "center",
      })
      .webp({
        quality: 85,
        effort: 4,
      })
      .toBuffer();
  }

  private async staticStickerToImage(inputBuffer: Buffer): Promise<Buffer> {
    return sharp(inputBuffer, {
      animated: false,
      limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
    })
      .png()
      .toBuffer();
  }

  private async createAnimatedSticker(inputBuffer: Buffer): Promise<Buffer> {
    const tempDir = await createTempDir("sticker");
    const inputPath = path.join(tempDir, `input-${randomUUID()}.video`);
    const outputPath = path.join(tempDir, "sticker.webp");

    try {
      await writeFile(inputPath, inputBuffer);
      await runFfmpeg([
        "-y",
        "-max_error_rate",
        "1.0",
        "-t",
        String(ANIMATED_STICKER_SECONDS),
        "-i",
        inputPath,
        "-an",
        "-vf",
        `fps=${String(STICKER_FPS)},scale=${String(STICKER_SIZE)}:${String(
          STICKER_SIZE,
        )}:force_original_aspect_ratio=decrease,pad=${String(STICKER_SIZE)}:${String(
          STICKER_SIZE,
        )}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba`,
        "-loop",
        "0",
        "-lossless",
        "0",
        "-q:v",
        "55",
        "-preset",
        "default",
        outputPath,
      ]);

      return await readFile(outputPath);
    } finally {
      await removeTempDir(tempDir);
    }
  }

  private async animatedStickerToVideo(inputBuffer: Buffer): Promise<Buffer> {
    const metadata = await sharp(inputBuffer, {
      animated: true,
      limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
    }).metadata();

    if ((metadata.pages ?? 1) > MAX_SAFE_ANIMATED_PAGES) {
      throw new AppUserError("Durasi/jumlah frame stiker terlalu panjang (maks 150 frame).");
    }

    const tempDir = await createTempDir("sticker");
    const inputPath = path.join(tempDir, "sticker.webp");
    const gifPath = path.join(tempDir, "sticker.gif");
    const outputPath = path.join(tempDir, "sticker.mp4");

    try {
      await writeFile(inputPath, inputBuffer);
      try {
        await this.convertAnimatedInputToVideo(inputPath, outputPath);
      } catch {
        const gifBuffer = await sharp(inputBuffer, {
          animated: true,
          limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
        })
          .gif({
            effort: 4,
          })
          .toBuffer();

        await writeFile(gifPath, gifBuffer);
        await this.convertAnimatedInputToVideo(gifPath, outputPath);
      }

      return await readFile(outputPath);
    } finally {
      await removeTempDir(tempDir);
    }
  }

  private async convertAnimatedInputToVideo(inputPath: string, outputPath: string): Promise<void> {
    await runFfmpeg([
      "-y",
      "-t",
      String(ANIMATED_STICKER_SECONDS),
      "-i",
      inputPath,
      "-an",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
      "-c:v",
      "libx264",
      "-profile:v",
      "main",
      "-level",
      "4.1",
      "-preset",
      "veryfast",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
  }
}

async function runFfmpeg(args: string[]): Promise<void> {
  const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";

  try {
    await runExternalProcess(ffmpegPath, args, {
      timeoutMs: env.DOWNLOADER_TIMEOUT_MS,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("melewati batas waktu")) {
      throw new AppUserError("Konversi sticker melewati batas waktu.");
    }
    throw new Error(`Konversi sticker gagal: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function normalizeMemeText(text: string): string {
  return clampText(text.replace(/\s+/g, " "), MEME_TEXT_MAX_LENGTH, "");
}

function createMemeTextSvg(topText: string, bottomText: string): string {
  const fontSize = getMemeFontSize(topText, bottomText);
  const lineHeight = Math.round(fontSize * 1.14);
  const topLines = wrapMemeLines(topText, fontSize);
  const bottomLines = wrapMemeLines(bottomText, fontSize);
  const textElements = [
    ...topLines.map((line, index) => createSvgTextLine(line, 42 + index * lineHeight, fontSize)),
    ...bottomLines.map((line, index) =>
      createSvgTextLine(
        line,
        STICKER_SIZE - 26 - (bottomLines.length - 1 - index) * lineHeight,
        fontSize,
      ),
    ),
  ].join("");

  return [
    `<svg width="${String(STICKER_SIZE)}" height="${String(STICKER_SIZE)}" viewBox="0 0 ${String(
      STICKER_SIZE,
    )} ${String(STICKER_SIZE)}" xmlns="http://www.w3.org/2000/svg">`,
    `<rect width="100%" height="100%" fill="transparent"/>`,
    textElements,
    `</svg>`,
  ].join("");
}

function getMemeFontSize(topText: string, bottomText: string): number {
  const longestText = [topText, bottomText]
    .flatMap((text) => text.split(/\s+/))
    .reduce((longest, word) => Math.max(longest, codePointLength(word)), 0);

  if (longestText > 18) {
    return 34;
  }

  if (codePointLength(topText) + codePointLength(bottomText) > 80) {
    return 38;
  }

  return 44;
}

function wrapMemeLines(text: string, fontSize: number): string[] {
  if (!text) {
    return [];
  }

  const maxChars = Math.max(10, Math.floor(430 / (fontSize * 0.58)));
  return clampAndWrapText(text, MEME_TEXT_MAX_LENGTH, maxChars, 4);
}

function createSvgTextLine(text: string, y: number, fontSize: number): string {
  return [
    `<text x="50%" y="${String(y)}" text-anchor="middle"`,
    ` font-family="Arial, Helvetica, sans-serif" font-weight="900"`,
    ` font-size="${String(fontSize)}" letter-spacing="0"`,
    ` fill="#ffffff" stroke="#000000" stroke-width="7" stroke-linejoin="round"`,
    ` paint-order="stroke fill">${escapeXml(text.toUpperCase())}</text>`,
  ].join("");
}

function createBratSvg(text: string): string {
  const wrappedLines = clampAndWrapText(
    text,
    BRAT_TEXT_MAX_LENGTH,
    BRAT_MAX_CHARS_PER_LINE,
    BRAT_MAX_LINES,
  );
  const maxLines =
    wrappedLines.length > 0 ? wrappedLines : [clampText(text, BRAT_MAX_CHARS_PER_LINE)];
  const fontSize =
    maxLines.length <= 2 ? 62 : maxLines.length <= 4 ? 46 : maxLines.length <= 6 ? 36 : 28;
  const lineHeight = fontSize * 1.18;
  const totalHeight = maxLines.length * lineHeight;
  const startY = (STICKER_SIZE - totalHeight) / 2 + fontSize * 0.85;

  const tspans = maxLines
    .map(
      (line, i) =>
        `<tspan x="256" y="${String(Math.round(startY + i * lineHeight))}">${escapeXml(line)}</tspan>`,
    )
    .join("");

  return [
    `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">`,
    `  <defs>`,
    `    <filter id="brat-blur" x="-20%" y="-20%" width="140%" height="140%">`,
    `      <feGaussianBlur in="SourceGraphic" stdDeviation="0.7"/>`,
    `    </filter>`,
    `  </defs>`,
    `  <rect width="512" height="512" fill="#8ACE00"/>`,
    `  <text x="256" y="${String(Math.round(startY))}"`,
    `    font-family="Arial, Helvetica, sans-serif"`,
    `    font-size="${String(fontSize)}"`,
    `    font-weight="bold"`,
    `    text-anchor="middle"`,
    `    fill="#000000"`,
    `    filter="url(#brat-blur)"`,
    `    letter-spacing="-1">${tspans}</text>`,
    `</svg>`,
  ].join("\n");
}

export async function addStickerMetadata(
  webpBuffer: Buffer,
  packName: string = DEFAULT_STICKER_PACK,
  author: string = DEFAULT_STICKER_AUTHOR,
): Promise<Buffer> {
  try {
    const json = {
      "sticker-pack-id": "com.minjibot.sticker",
      "sticker-pack-name": packName,
      "sticker-pack-publisher": author,
      emojis: ["🤖", "✨"],
    };

    const exifHeader = Buffer.from([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00,
    ]);
    const jsonBuffer = Buffer.from(JSON.stringify(json), "utf-8");
    const jsonLen = jsonBuffer.length;
    const lenBuffer = Buffer.alloc(4);
    lenBuffer.writeUInt32LE(jsonLen, 0);
    const offsetBuffer = Buffer.alloc(4);
    offsetBuffer.writeUInt32LE(0x16, 0);

    const exifData = Buffer.concat([exifHeader, lenBuffer, offsetBuffer, jsonBuffer]);

    const img = new webp.Image();
    await img.load(webpBuffer);
    img.exif = exifData;
    return await img.save(null);
  } catch {
    return webpBuffer;
  }
}

export const stickerService = new StickerService();
