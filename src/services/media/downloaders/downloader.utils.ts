import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";

import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import { AppUserError } from "../../../errors/appUserError";
import { MAX_SAFE_IMAGE_PIXELS } from "../../../utils/imageSafety";
import { runExternalProcess } from "../../../utils/processRunner";
import { createTempDir, removeTempDir } from "../../../utils/tempFile";
import { parseAllowedDownloaderUrl } from "../../../utils/urlValidator";
import { videoNormalizeService } from "../videoNormalize.service";
import {
  BYTES_PER_MB,
  IMAGE_EXTS,
  VIDEO_EXTS,
  type DownloadedMediaItem,
  type DownloaderKind,
  type ExtractedAudio,
  type ScanMediaOptions,
} from "./downloader.types";

export function isPolicyLimitError(error: unknown): boolean {
  if (!(error instanceof AppUserError)) {
    return false;
  }
  const lower = error.message.toLowerCase();
  return lower.includes("durasi") || lower.includes("maksimal");
}

export async function scanDownloadedMediaFiles(
  tempDir: string,
  defaultName = "minjibot-media",
  options?: ScanMediaOptions,
): Promise<DownloadedMediaItem[]> {
  const filePaths = await findMediaFilesRecursive(tempDir);
  const items: DownloadedMediaItem[] = [];

  for (const filePath of filePaths) {
    await assertFileSizeAllowed(filePath);
    const ext = path.extname(filePath).toLowerCase();

    if (VIDEO_EXTS.has(ext)) {
      if (options?.maxVideoDurationSec && options.durationErrorMessage) {
        await assertVideoDurationAllowed(
          filePath,
          options.maxVideoDurationSec,
          options.durationErrorMessage,
        );
      }

      const parentDir = path.dirname(filePath);
      const baseName = path.basename(filePath, ext);
      const remuxedPath = path.join(parentDir, `${baseName}.remuxed.mp4`);
      const normalizedPath = path.join(parentDir, `${baseName}.normalized.mp4`);
      const finalPath = await prepareMobileVideo(filePath, remuxedPath, normalizedPath);
      await assertFileSizeAllowed(finalPath);
      items.push({
        buffer: await readFile(finalPath),
        mediaType: "video",
        mimetype: "video/mp4",
        fileName: `${defaultName}.mp4`,
      });
    } else if (IMAGE_EXTS.has(ext)) {
      let imgBuffer = await readFile(filePath);
      let mime = "image/jpeg";
      let outExt = ".jpg";

      if (ext === ".webp") {
        imgBuffer = Buffer.from(
          await sharp(imgBuffer, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
            .jpeg({ quality: 95 })
            .toBuffer(),
        );
      } else if (ext === ".png") {
        mime = "image/png";
        outExt = ".png";
      }

      items.push({
        buffer: imgBuffer,
        mediaType: "image",
        mimetype: mime,
        fileName: `${defaultName}${outExt}`,
      });
    }
  }
  return items;
}

export async function findMediaFilesRecursive(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findMediaFilesRecursive(fullPath)));
    } else if (
      entry.isFile() &&
      !entry.name.endsWith(".part") &&
      !entry.name.endsWith(".ytdl") &&
      !entry.name.endsWith(".json") &&
      !entry.name.includes(".remuxed") &&
      !entry.name.includes(".normalized")
    ) {
      results.push(fullPath);
    }
  }

  return results.sort();
}

export async function findFirstDownloadedFile(tempDir: string, prefix: string): Promise<string> {
  const entries = await readdir(tempDir);
  const downloadedFile = entries.find(
    (entry) =>
      entry.startsWith(prefix) &&
      !entry.endsWith(".part") &&
      !entry.endsWith(".ytdl") &&
      !entry.endsWith(".json"),
  );

  if (!downloadedFile) {
    throw new Error("File hasil download tidak ditemukan.");
  }

  return path.join(tempDir, downloadedFile);
}

export async function prepareMobileVideo(
  rawVideoPath: string,
  remuxedOutputPath: string,
  normalizedOutputPath: string,
): Promise<string> {
  if (path.extname(rawVideoPath).toLowerCase() === ".mp4") {
    const isH264 = await videoNormalizeService.isH264Video(rawVideoPath);
    if (isH264) {
      return rawVideoPath;
    }
  }

  try {
    await videoNormalizeService.remuxForWhatsApp(rawVideoPath, remuxedOutputPath);
    return remuxedOutputPath;
  } catch (error: unknown) {
    logger.warn({ err: error }, "Remux video gagal, memakai normalisasi penuh");
    await videoNormalizeService.normalizeForWhatsApp(rawVideoPath, normalizedOutputPath);
    return normalizedOutputPath;
  }
}

export function parseSupportedUrl(url: string, kind: DownloaderKind): URL {
  const parsedUrl = parseAllowedDownloaderUrl(url, kind);
  if (!parsedUrl) {
    if (kind === "tiktok") {
      throw new AppUserError("Command .tt hanya menerima link resmi TikTok.");
    }
    if (kind === "instagram") {
      throw new AppUserError("Command .ig hanya menerima link resmi Instagram.");
    }
    if (kind === "youtube") {
      throw new AppUserError("Command .yt hanya menerima link resmi YouTube.");
    }
    if (kind === "twitter") {
      throw new AppUserError("Command .x hanya menerima link resmi X (Twitter).");
    }
    throw new AppUserError("Command .pin hanya menerima link resmi Pinterest.");
  }

  return parsedUrl;
}

export async function assertFileSizeAllowed(filePath: string): Promise<void> {
  const fileStat = await stat(filePath);
  const maxBytes = env.MAX_DOWNLOAD_FILE_MB * BYTES_PER_MB;

  if (fileStat.size > maxBytes) {
    throw new AppUserError(`Ukuran file maksimal ${String(env.MAX_DOWNLOAD_FILE_MB)} MB.`);
  }
}

export async function assertVideoDurationAllowed(
  filePath: string,
  maxDurationSec: number,
  errorMessage: string,
): Promise<void> {
  const durationSec = await videoNormalizeService.getVideoDurationSeconds(filePath);
  if (durationSec !== null && durationSec > maxDurationSec) {
    throw new AppUserError(errorMessage);
  }
}

export async function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<void> {
  try {
    await runExternalProcess(command, args, {
      timeoutMs,
      extraPathDirs: ["/usr/local/bin", "/usr/bin"],
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("melewati batas waktu")) {
      throw new AppUserError("Downloader melewati batas waktu.");
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Downloader gagal: ${msg}`);
  }
}

export async function extractAudioFromVideoBuffer(videoBuffer: Buffer): Promise<ExtractedAudio> {
  const tempDir = await createTempDir("tt-audio");
  const inputPath = path.join(tempDir, "input.mp4");
  const outputPath = path.join(tempDir, "audio.mp3");

  try {
    await writeFile(inputPath, videoBuffer);
    const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";
    await runFfmpegAudio(inputPath, outputPath, ffmpegPath, env.DOWNLOADER_TIMEOUT_MS);

    const buffer = await readFile(outputPath);
    return { buffer, mimetype: "audio/mpeg" };
  } finally {
    await removeTempDir(tempDir);
  }
}

async function runFfmpegAudio(
  inputPath: string,
  outputPath: string,
  ffmpegPath: string,
  timeoutMs: number,
): Promise<void> {
  try {
    await runExternalProcess(
      ffmpegPath,
      [
        "-y",
        "-threads",
        "1",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        inputPath,
        "-vn",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        outputPath,
      ],
      { timeoutMs },
    );
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("melewati batas waktu")) {
      throw new Error("Extract audio melewati batas waktu.");
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Extract audio gagal: ${msg}`);
  }
}
