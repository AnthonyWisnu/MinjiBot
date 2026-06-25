import ffmpegStatic from "ffmpeg-static";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { spawn } from "node:child_process";

import { env } from "../../config/env";
import { createTempDir, removeTempDir } from "../../utils/tempFile";

const STICKER_SIZE = 512;
const ANIMATED_STICKER_SECONDS = 6;
const STICKER_FPS = 15;
const MEME_TEXT_MAX_LENGTH = 160;

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
    if (sourceType === "image") {
      return this.createStaticSticker(inputBuffer);
    }

    return this.createAnimatedSticker(inputBuffer);
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
      throw new Error("Teks meme tidak boleh kosong.");
    }

    const baseImage = await sharp(inputBuffer, {
      animated: false,
      limitInputPixels: false,
    })
      .rotate()
      .resize(STICKER_SIZE, STICKER_SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();

    return sharp(baseImage)
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
  }

  private async isAnimatedSticker(inputBuffer: Buffer): Promise<boolean> {
    const metadata = await sharp(inputBuffer, {
      animated: true,
      limitInputPixels: false,
    }).metadata();

    const pages = metadata.pages ?? 1;
    const delayCount = metadata.delay?.length ?? 0;
    const height = metadata.height;
    const pageHeight = metadata.pageHeight;

    return pages > 1 || delayCount > 1 || (pageHeight !== undefined && pageHeight < height);
  }

  private async createStaticSticker(inputBuffer: Buffer): Promise<Buffer> {
    return sharp(inputBuffer, {
      animated: false,
      limitInputPixels: false,
    })
      .rotate()
      .resize(STICKER_SIZE, STICKER_SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: true,
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
      limitInputPixels: false,
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
          limitInputPixels: false,
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

function runFfmpeg(args: string[]): Promise<void> {
  const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Konversi sticker melewati batas waktu."));
    }, env.DOWNLOADER_TIMEOUT_MS);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`FFmpeg tidak tersedia: ${error.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Konversi sticker gagal: ${stderr.slice(-500)}`));
    });
  });
}

function normalizeMemeText(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, MEME_TEXT_MAX_LENGTH);
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
    .reduce((longest, word) => Math.max(longest, word.length), 0);

  if (longestText > 18) {
    return 34;
  }

  if (topText.length + bottomText.length > 80) {
    return 38;
  }

  return 44;
}

function wrapMemeLines(text: string, fontSize: number): string[] {
  if (!text) {
    return [];
  }

  const maxChars = Math.max(10, Math.floor(430 / (fontSize * 0.58)));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length <= maxChars) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    currentLine = word;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.slice(0, 4);
}

function createSvgTextLine(text: string, y: number, fontSize: number): string {
  return [
    `<text x="50%" y="${String(y)}" text-anchor="middle"`,
    ` font-family="Arial, Helvetica, sans-serif" font-weight="900"`,
    ` font-size="${String(fontSize)}" letter-spacing="0"`,
    ` fill="#ffffff" stroke="#000000" stroke-width="7" stroke-linejoin="round"`,
    ` paint-order="stroke fill">${escapeSvgText(text.toUpperCase())}</text>`,
  ].join("");
}

function escapeSvgText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const stickerService = new StickerService();
