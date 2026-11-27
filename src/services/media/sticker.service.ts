import ffmpegStatic from "ffmpeg-static";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { env } from "../../config/env";
import { AppUserError } from "../../errors/appUserError";
import { mediaQueueService } from "../../utils/boundedQueue";
import { MAX_SAFE_ANIMATED_PAGES, MAX_SAFE_IMAGE_PIXELS } from "../../utils/imageSafety";
import { runExternalProcess } from "../../utils/processRunner";
import { createTempDir, removeTempDir } from "../../utils/tempFile";
import { computeBratLayout, createBratSvg, renderBratStickerWebp } from "./sticker/bratRenderer";
import { buildMemeOverlays, normalizeMemeText } from "./sticker/memeRenderer";
import {
  addStickerMetadata,
  DEFAULT_STICKER_AUTHOR,
  DEFAULT_STICKER_PACK,
} from "./sticker/stickerExif";

export {
  addStickerMetadata,
  computeBratLayout,
  createBratSvg,
  DEFAULT_STICKER_AUTHOR,
  DEFAULT_STICKER_PACK,
};

const STICKER_SIZE = 512;
const ANIMATED_STICKER_SECONDS = 6;
const ANIMATED_STICKER_MAX_BYTES = 850 * 1024;
const SOUND_STICKER_AUDIO_MAX_BYTES = 500 * 1024;

export type VideoStickerWithSoundResult =
  | {
      webpBuffer: Buffer;
      hasAudio: false;
    }
  | {
      webpBuffer: Buffer;
      hasAudio: true;
      audioBuffer: Buffer;
      durationSeconds: number;
    };

interface AnimatedStickerPreset {
  seconds: number;
  fps: number;
  quality: number;
}

const ANIMATED_STICKER_PRESETS: readonly AnimatedStickerPreset[] = [
  { seconds: 6, fps: 15, quality: 55 },
  { seconds: 6, fps: 12, quality: 38 },
  { seconds: 4, fps: 10, quality: 25 },
];

export type StickerSourceType = "image" | "video" | "sticker";

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
    if (sourceType === "sticker") {
      const normalized = await this.normalizeExistingSticker(inputBuffer);
      return addStickerMetadata(normalized);
    }

    const rawBuffer =
      sourceType === "image"
        ? await this.createStaticSticker(inputBuffer)
        : await this.createAnimatedSticker(inputBuffer);

    return addStickerMetadata(rawBuffer);
  }

  /**
   * Membuat stiker animasi WebP berbranding dari video sekaligus mencoba mengekstrak
   * audio OGG/Opus mono. Jika video bisu atau tidak memiliki stream audio,
   * otomatis mengembalikan `{ hasAudio: false }` agar fallback mulus ke stiker biasa.
   */
  async createVideoStickerWithSound(inputBuffer: Buffer): Promise<VideoStickerWithSoundResult> {
    return mediaQueueService.imageComputeQueue.run(async () => {
      const tempDir = await createTempDir("sticker");
      const inputPath = path.join(tempDir, `input-${randomUUID()}.video`);
      const outputPath = path.join(tempDir, "sticker.webp");
      const audioOutputPath = path.join(tempDir, "sticker-audio.ogg");

      try {
        await writeFile(inputPath, inputBuffer);
        const { webpBuffer, usedSeconds } = await this.encodeAnimatedStickerInTempDir(
          inputPath,
          outputPath,
        );
        const brandedWebp = await addStickerMetadata(webpBuffer);

        const extractedAudio = await this.extractOpusAudioTrack(
          inputPath,
          audioOutputPath,
          usedSeconds,
        );

        if (!extractedAudio) {
          return {
            webpBuffer: brandedWebp,
            hasAudio: false,
          };
        }

        return {
          webpBuffer: brandedWebp,
          hasAudio: true,
          audioBuffer: extractedAudio,
          durationSeconds: usedSeconds,
        };
      } finally {
        await removeTempDir(tempDir);
      }
    });
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

    // 1. Kecilkan gambar sesuai rasio aslinya (fit: inside) tanpa padding transparan dulu
    const { data: fittedImage, info } = await sharp(inputBuffer, {
      animated: false,
      limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
    })
      .rotate()
      .resize(STICKER_SIZE, STICKER_SIZE, {
        fit: "inside",
      })
      .png()
      .toBuffer({ resolveWithObject: true });

    // 2. Tempelkan teks meme tepat di dalam area gambar asli (bukan di ruang kosong luar gambar)
    const overlays = await buildMemeOverlays(
      normalizedTopText,
      normalizedBottomText,
      info.width,
      info.height,
    );

    const compositedImage = await sharp(fittedImage, {
      limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
    })
      .composite(overlays)
      .png()
      .toBuffer();

    // 3. Tempatkan gambar yang sudah berisi teks ke kanvas stiker 512x512 transparan (fit: contain)
    const memeWebp = await sharp(compositedImage, {
      limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
    })
      .resize(STICKER_SIZE, STICKER_SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
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

    const bratWebp = await renderBratStickerWebp(trimmed);
    return addStickerMetadata(bratWebp);
  }

  private async normalizeExistingSticker(inputBuffer: Buffer): Promise<Buffer> {
    const metadata = await sharp(inputBuffer, {
      animated: true,
      limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
    }).metadata();

    const pages = metadata.pages ?? 1;
    if (pages > MAX_SAFE_ANIMATED_PAGES) {
      throw new AppUserError("Durasi/jumlah frame stiker terlalu panjang (maks 150 frame).");
    }

    const isAnimated =
      pages > 1 ||
      (metadata.delay?.length ?? 0) > 1 ||
      (metadata.pageHeight !== undefined && metadata.pageHeight < metadata.height);

    if (isAnimated && metadata.format === "webp") {
      return inputBuffer;
    }

    if (
      !isAnimated &&
      metadata.format === "webp" &&
      metadata.width === STICKER_SIZE &&
      metadata.height === STICKER_SIZE
    ) {
      return inputBuffer;
    }

    return this.createStaticSticker(inputBuffer);
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
    // Gunakan mode contain dengan latar transparan agar gambar landscape/portrait tetap utuh
    return sharp(inputBuffer, {
      animated: false,
      limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
    })
      .rotate()
      .resize(STICKER_SIZE, STICKER_SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
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
    return mediaQueueService.imageComputeQueue.run(async () => {
      const tempDir = await createTempDir("sticker");
      const inputPath = path.join(tempDir, `input-${randomUUID()}.video`);
      const outputPath = path.join(tempDir, "sticker.webp");

      try {
        await writeFile(inputPath, inputBuffer);
        const { webpBuffer } = await this.encodeAnimatedStickerInTempDir(inputPath, outputPath);
        return webpBuffer;
      } finally {
        await removeTempDir(tempDir);
      }
    });
  }

  private async encodeAnimatedStickerInTempDir(
    inputPath: string,
    outputPath: string,
  ): Promise<{ webpBuffer: Buffer; usedSeconds: number }> {
    let latestBuffer: Buffer | null = null;
    let latestSeconds = ANIMATED_STICKER_SECONDS;

    for (const preset of ANIMATED_STICKER_PRESETS) {
      await this.encodeAnimatedStickerPreset(inputPath, outputPath, preset);
      latestBuffer = await readFile(outputPath);
      latestSeconds = preset.seconds;
      if (latestBuffer.byteLength <= ANIMATED_STICKER_MAX_BYTES) {
        return {
          webpBuffer: latestBuffer,
          usedSeconds: latestSeconds,
        };
      }
    }

    if (latestBuffer) {
      return {
        webpBuffer: latestBuffer,
        usedSeconds: latestSeconds,
      };
    }

    throw new Error("Hasil konversi sticker video kosong.");
  }

  private async extractOpusAudioTrack(
    inputPath: string,
    audioOutputPath: string,
    durationSeconds: number,
  ): Promise<Buffer | null> {
    const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";

    try {
      await runExternalProcess(
        ffmpegPath,
        [
          "-y",
          "-threads",
          "1",
          "-t",
          String(durationSeconds),
          "-i",
          inputPath,
          "-vn",
          "-map",
          "0:a:0",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "libopus",
          "-b:a",
          "24k",
          "-f",
          "ogg",
          audioOutputPath,
        ],
        {
          timeoutMs: env.DOWNLOADER_TIMEOUT_MS,
          throwOnNonZeroExit: false,
        },
      );

      const audioBuffer = await readFile(audioOutputPath);
      if (
        audioBuffer.byteLength > 100 &&
        audioBuffer.byteLength <= SOUND_STICKER_AUDIO_MAX_BYTES &&
        audioBuffer.subarray(0, 4).toString("ascii") === "OggS"
      ) {
        return audioBuffer;
      }
    } catch {
      // Abaikan apabila video tidak memiliki trek audio atau ekstraksi tidak menghasilkan OGG
    }

    return null;
  }

  private async encodeAnimatedStickerPreset(
    inputPath: string,
    outputPath: string,
    preset: AnimatedStickerPreset,
  ): Promise<void> {
    await runFfmpeg([
      "-y",
      "-threads",
      "1",
      "-max_error_rate",
      "1.0",
      "-t",
      String(preset.seconds),
      "-i",
      inputPath,
      "-an",
      "-vf",
      `fps=${String(preset.fps)},scale=${String(STICKER_SIZE)}:${String(
        STICKER_SIZE,
      )}:force_original_aspect_ratio=decrease,pad=${String(STICKER_SIZE)}:${String(
        STICKER_SIZE,
      )}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba`,
      "-loop",
      "0",
      "-lossless",
      "0",
      "-q:v",
      String(preset.quality),
      "-preset",
      "default",
      outputPath,
    ]);
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
      "-threads",
      "1",
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

export const stickerService = new StickerService();
