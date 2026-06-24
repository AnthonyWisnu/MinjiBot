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
    if (!isAnimated) {
      return {
        type: "image",
        buffer: await this.staticStickerToImage(inputBuffer),
        mimetype: "image/png",
        fileName: "minjibot-sticker.png",
      };
    }

    try {
      return {
        type: "video",
        buffer: await this.animatedStickerToVideo(inputBuffer),
        mimetype: "video/mp4",
        fileName: "minjibot-sticker.mp4",
      };
    } catch {
      return {
        type: "image",
        buffer: await this.staticStickerToImage(inputBuffer),
        mimetype: "image/png",
        fileName: "minjibot-sticker.png",
      };
    }
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
    const outputPath = path.join(tempDir, "sticker.mp4");

    try {
      await writeFile(inputPath, inputBuffer);
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

      return await readFile(outputPath);
    } finally {
      await removeTempDir(tempDir);
    }
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

export const stickerService = new StickerService();
