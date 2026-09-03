import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { createTempDir, removeTempDir } from "../../utils/tempFile";
import { videoNormalizeService } from "./videoNormalize.service";

const BYTES_PER_MB = 1024 * 1024;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MOBILE_SAFE_FORMAT =
  "bv*[vcodec^=avc1][height<=720][ext=mp4]+ba[ext=m4a]/" +
  "b[vcodec^=avc1][height<=720][ext=mp4]/" +
  "bv*[height<=720][ext=mp4]+ba[ext=m4a]/" +
  "b[height<=720][ext=mp4]/" +
  "best[height<=720][ext=mp4]/best[ext=mp4]/best";
const YT_VIDEO_FORMAT_SMART =
  // Prioritas 1: 720p 60 FPS (H.264 mp4) jika video approx <= 100MB
  "bv*[vcodec^=avc1][height<=720][fps>30][filesize_approx<=100M][ext=mp4]+ba[ext=m4a]/" +
  // Prioritas 2: 720p 30 FPS (H.264 mp4) jika video approx <= 100MB
  "bv*[vcodec^=avc1][height<=720][fps<=30][filesize_approx<=100M][ext=mp4]+ba[ext=m4a]/" +
  // Prioritas 3: 480p (H.264 mp4) untuk video panjang hingga 12 menit
  "bv*[vcodec^=avc1][height<=480][ext=mp4]+ba[ext=m4a]/" +
  // Fallback format jika avc1 tidak tersedia
  "bv*[height<=720][filesize_approx<=100M][ext=mp4]+ba[ext=m4a]/" +
  "b[height<=720][ext=mp4]/" +
  "best[height<=720]/best";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mkv", ".mov", ".avi"]);

export type DownloaderKind = "tiktok" | "instagram" | "youtube";
export type MediaType = "video" | "image";

export interface DownloadedMediaItem {
  buffer: Buffer;
  fileName: string;
  mimetype: string;
  mediaType: MediaType;
}

// Kept for backward-compat (used by .tt handler)
export interface DownloadedVideo {
  buffer: Buffer;
  fileName: string;
  mimetype: "video/mp4";
}

export type DownloadResult =
  | { type: "single"; item: DownloadedMediaItem }
  | { type: "multi"; items: DownloadedMediaItem[]; totalCount: number };

export interface ExtractedAudio {
  buffer: Buffer;
  mimetype: "audio/mpeg";
}

interface TikWmResponse {
  code: number;
  msg: string;
  data?: {
    play?: string;
    hdplay?: string;
    wmplay?: string;
    title?: string;
  };
}

async function downloadTikTokDirect(url: string): Promise<DownloadedVideo> {
  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
    },
    signal: AbortSignal.timeout(env.DOWNLOADER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`TikWM API error status: ${String(response.status)}`);
  }

  const json = (await response.json()) as TikWmResponse;
  if (json.code !== 0 || !json.data) {
    throw new Error(`TikWM API response error: ${json.msg || "Unknown error"}`);
  }

  const videoUrl = json.data.play ?? json.data.hdplay ?? json.data.wmplay;
  if (!videoUrl) {
    throw new Error("Link video TikTok tidak ditemukan dalam respon API.");
  }

  const videoRes = await fetch(videoUrl, {
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
      Referer: "https://www.tikwm.com/",
    },
    signal: AbortSignal.timeout(env.DOWNLOADER_TIMEOUT_MS),
  });

  if (!videoRes.ok) {
    throw new Error(`Gagal mengunduh stream video TikTok (${String(videoRes.status)})`);
  }

  const arrayBuffer = await videoRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const maxBytes = env.MAX_DOWNLOAD_FILE_MB * BYTES_PER_MB;
  if (buffer.byteLength > maxBytes) {
    throw new Error(`Ukuran video maksimal ${String(env.MAX_DOWNLOAD_FILE_MB)} MB.`);
  }

  return {
    buffer,
    fileName: "minjibot-tiktok.mp4",
    mimetype: "video/mp4",
  };
}

export class DownloaderService {
  /**
   * Download TikTok video (unchanged from original).
   */
  async downloadVideo(url: string, kind: DownloaderKind): Promise<DownloadedVideo> {
    const parsedUrl = parseSupportedUrl(url, kind);
    const startedAt = Date.now();

    if (kind === "tiktok") {
      try {
        const directResult = await downloadTikTokDirect(parsedUrl.toString());
        logger.info(
          {
            kind,
            elapsedMs: Date.now() - startedAt,
            sizeBytes: directResult.buffer.byteLength,
            mode: "tikwm-direct",
          },
          "Downloader selesai",
        );
        return directResult;
      } catch (error: unknown) {
        logger.warn({ error }, "TikTok direct API gagal, mencoba fallback yt-dlp");
      }
    }

    const tempDir = await createTempDir("download");
    const rawOutputTemplate = path.join(tempDir, "raw.%(ext)s");
    const remuxedOutputPath = path.join(tempDir, "remuxed.mp4");
    const normalizedOutputPath = path.join(tempDir, "normalized.mp4");

    try {
      await this.runTikTokArgs(parsedUrl.toString(), rawOutputTemplate);
      const rawVideoPath = await findFirstDownloadedFile(tempDir, "raw.");
      const outputPath = await prepareMobileVideo(
        rawVideoPath,
        remuxedOutputPath,
        normalizedOutputPath,
      );
      await assertFileSizeAllowed(outputPath);
      const buffer = await readFile(outputPath);

      logger.info(
        {
          kind,
          elapsedMs: Date.now() - startedAt,
          sizeBytes: buffer.byteLength,
          mode: outputPath === rawVideoPath ? "direct" : path.basename(outputPath, ".mp4"),
        },
        "Downloader selesai",
      );

      return {
        buffer,
        fileName: "minjibot-video.mp4",
        mimetype: "video/mp4",
      };
    } finally {
      await removeTempDir(tempDir);
    }
  }

  /**
   * Download Instagram content — unified handler for reel, photo, story, carousel.
   * Returns single item or multi items (carousel up to 10).
   */
  async downloadInstagram(url: string): Promise<DownloadResult> {
    const startedAt = Date.now();
    const tempDir = await createTempDir("ig-download");

    try {
      let items: DownloadedMediaItem[] = [];
      const isReel = url.toLowerCase().includes("/reel/");

      if (isReel) {
        // Reels diproses via yt-dlp terlebih dahulu
        try {
          await this.runYtDlpInstagram(url, tempDir);
          items = await scanDownloadedMediaFiles(tempDir);
        } catch (ytErr) {
          logger.warn({ ytErr, url }, "yt-dlp gagal download reel, mencoba fallback gallery-dl");
          await this.runGalleryDl(url, tempDir);
          items = await scanDownloadedMediaFiles(tempDir);
        }
      } else {
        // Foto tunggal, carousel slide, atau post foto/video:
        // Gunakan gallery-dl terlebih dahulu karena yt-dlp tidak men-download foto
        try {
          await this.runGalleryDl(url, tempDir);
          items = await scanDownloadedMediaFiles(tempDir);
        } catch (gdlErr) {
          logger.warn({ gdlErr, url }, "gallery-dl gagal, mencoba fallback yt-dlp");
        }

        // Jika gallery-dl tidak menghasilkan media (misal video post), coba yt-dlp
        if (items.length === 0) {
          try {
            await this.runYtDlpInstagram(url, tempDir);
            items = await scanDownloadedMediaFiles(tempDir);
          } catch (ytErr) {
            logger.warn({ ytErr, url }, "yt-dlp fallback juga gagal");
          }
        }
      }

      if (items.length === 0) {
        throw new Error("Tidak ada media yang berhasil diunduh.");
      }

      logger.info(
        { elapsedMs: Date.now() - startedAt, itemCount: items.length },
        "Instagram download selesai",
      );

      return items.length === 1
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        ? { type: "single", item: items[0]! }
        : { type: "multi", items, totalCount: items.length };
    } finally {
      await removeTempDir(tempDir);
    }
  }

  /**
   * Download YouTube video — max 480p, max 12 minutes (720 seconds).
   */
  async downloadYoutube(url: string): Promise<DownloadedMediaItem> {
    const startedAt = Date.now();
    const tempDir = await createTempDir("yt-video");
    const rawOutputTemplate = path.join(tempDir, "raw.%(ext)s");
    const remuxedOutputPath = path.join(tempDir, "remuxed.mp4");
    const normalizedOutputPath = path.join(tempDir, "normalized.mp4");

    try {
      const args = [
        "--no-warnings",
        "--no-playlist",
        "--max-filesize",
        `${String(env.MAX_DOWNLOAD_FILE_MB)}M`,
        "--match-filter",
        "duration <= 720",
        "-f",
        YT_VIDEO_FORMAT_SMART,
        "--merge-output-format",
        "mp4",
        "--remux-video",
        "mp4",
        "--concurrent-fragments",
        "4",
        "--add-header",
        `User-Agent:${DEFAULT_USER_AGENT}`,
        "--extractor-args",
        "youtube:player_client=android,web,tv,ios",
        "-o",
        rawOutputTemplate,
      ];

      const cookiesPath = env.YOUTUBE_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;
      if (cookiesPath && existsSync(cookiesPath)) {
        args.push("--cookies", cookiesPath);
      }

      args.push(url);
      await runProcess(env.DOWNLOADER_BIN, args, env.DOWNLOADER_TIMEOUT_MS);

      const rawVideoPath = await findFirstDownloadedFile(tempDir, "raw.");
      const outputPath = await prepareMobileVideo(
        rawVideoPath,
        remuxedOutputPath,
        normalizedOutputPath,
      );
      await assertFileSizeAllowed(outputPath);
      const buffer = await readFile(outputPath);

      logger.info(
        { elapsedMs: Date.now() - startedAt, sizeBytes: buffer.byteLength },
        "YouTube video download selesai",
      );

      return {
        buffer,
        fileName: "minjibot-yt.mp4",
        mimetype: "video/mp4",
        mediaType: "video",
      };
    } finally {
      await removeTempDir(tempDir);
    }
  }

  private async runTikTokArgs(url: string, outputTemplate: string): Promise<void> {
    const args = [
      "--no-playlist",
      "--no-warnings",
      "--max-filesize",
      `${String(env.MAX_DOWNLOAD_FILE_MB)}M`,
      "-f",
      MOBILE_SAFE_FORMAT,
      "--merge-output-format",
      "mp4",
      "--remux-video",
      "mp4",
      "--concurrent-fragments",
      "4",
      "--add-header",
      `User-Agent:${DEFAULT_USER_AGENT}`,
      "-o",
      outputTemplate,
    ];

    const cookiesPath = env.TIKTOK_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;
    if (cookiesPath && existsSync(cookiesPath)) {
      args.push("--cookies", cookiesPath);
    }

    args.push(url);
    await runProcess(env.DOWNLOADER_BIN, args, env.DOWNLOADER_TIMEOUT_MS);
  }

  /**
   * Extract audio track from a video buffer using ffmpeg.
   * Returns MP3 audio — same format as .play command.
   */
  async extractAudioFromVideo(videoBuffer: Buffer): Promise<ExtractedAudio> {
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

  private async runYtDlpInstagram(url: string, tempDir: string): Promise<void> {
    const args = [
      "--no-warnings",
      "--max-filesize",
      `${String(env.MAX_DOWNLOAD_FILE_MB)}M`,
      "--playlist-items",
      "1-10",
      "--merge-output-format",
      "mp4",
      "--remux-video",
      "mp4",
      "--concurrent-fragments",
      "4",
      "--add-header",
      `User-Agent:${DEFAULT_USER_AGENT}`,
      "-f",
      MOBILE_SAFE_FORMAT,
      "-o",
      path.join(tempDir, "item-%(playlist_index)s.%(ext)s"),
    ];

    const cookiesPath = env.INSTAGRAM_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;
    if (cookiesPath && existsSync(cookiesPath)) {
      args.push("--cookies", cookiesPath);
    }

    args.push(url);
    await runProcess(env.DOWNLOADER_BIN, args, env.DOWNLOADER_TIMEOUT_MS);
  }

  private async runGalleryDl(url: string, tempDir: string): Promise<void> {
    const args: string[] = [
      "--range",
      "1-10",
      "--no-mtime",
      "-D",
      tempDir,
    ];

    const cookiesPath = env.INSTAGRAM_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;
    if (cookiesPath && existsSync(cookiesPath)) {
      args.push("--cookies", cookiesPath);
    }

    args.push(url);
    await runProcess(env.GALLERY_DL_BIN, args, env.DOWNLOADER_TIMEOUT_MS);
  }
}

async function scanDownloadedMediaFiles(tempDir: string): Promise<DownloadedMediaItem[]> {
  const filePaths = await findMediaFilesRecursive(tempDir);
  const items: DownloadedMediaItem[] = [];

  for (const filePath of filePaths) {
    const ext = path.extname(filePath).toLowerCase();

    if (VIDEO_EXTS.has(ext)) {
      const parentDir = path.dirname(filePath);
      const baseName = path.basename(filePath, ext);
      const remuxedPath = path.join(parentDir, `${baseName}.remuxed.mp4`);
      const normalizedPath = path.join(parentDir, `${baseName}.normalized.mp4`);
      const finalPath = await prepareMobileVideo(filePath, remuxedPath, normalizedPath);
      items.push({
        buffer: await readFile(finalPath),
        mediaType: "video",
        mimetype: "video/mp4",
        fileName: "minjibot-ig.mp4",
      });
    } else if (IMAGE_EXTS.has(ext)) {
      let imgBuffer = await readFile(filePath);
      let mime = "image/jpeg";
      let outExt = ".jpg";

      if (ext === ".webp") {
        imgBuffer = Buffer.from(await sharp(imgBuffer).jpeg({ quality: 95 }).toBuffer());
      } else if (ext === ".png") {
        mime = "image/png";
        outExt = ".png";
      }

      items.push({
        buffer: imgBuffer,
        mediaType: "image",
        mimetype: mime,
        fileName: `minjibot-ig${outExt}`,
      });
    }
  }
  return items;
}

async function findMediaFilesRecursive(dir: string): Promise<string[]> {
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

async function findFirstDownloadedFile(tempDir: string, prefix: string): Promise<string> {
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

async function prepareMobileVideo(
  rawVideoPath: string,
  remuxedOutputPath: string,
  normalizedOutputPath: string,
): Promise<string> {
  if (path.extname(rawVideoPath).toLowerCase() === ".mp4") {
    return rawVideoPath;
  }

  try {
    await videoNormalizeService.remuxForWhatsApp(rawVideoPath, remuxedOutputPath);
    return remuxedOutputPath;
  } catch (error: unknown) {
    logger.warn({ error }, "Remux video gagal, memakai normalisasi penuh");
    await videoNormalizeService.normalizeForWhatsApp(rawVideoPath, normalizedOutputPath);
    return normalizedOutputPath;
  }
}

function parseSupportedUrl(url: string, kind: DownloaderKind): URL {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Link tidak valid.");
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (kind === "tiktok" && !hostname.includes("tiktok.com")) {
    throw new Error("Command .tt hanya menerima link TikTok.");
  }

  return parsedUrl;
}

async function assertFileSizeAllowed(filePath: string): Promise<void> {
  const fileStat = await stat(filePath);
  const maxBytes = env.MAX_DOWNLOAD_FILE_MB * BYTES_PER_MB;

  if (fileStat.size > maxBytes) {
    throw new Error(`Ukuran file maksimal ${String(env.MAX_DOWNLOAD_FILE_MB)} MB.`);
  }
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Downloader melewati batas waktu."));
    }, timeoutMs);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`Downloader tidak tersedia atau gagal dijalankan: ${error.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Downloader gagal: ${stderr.slice(-500)}`));
    });
  });
}

function runFfmpegAudio(
  inputPath: string,
  outputPath: string,
  ffmpegPath: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      [
        "-y",
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
      { windowsHide: true },
    );
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Extract audio melewati batas waktu."));
    }, timeoutMs);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`ffmpeg tidak tersedia: ${error.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Extract audio gagal: ${stderr.slice(-300)}`));
    });
  });
}

export const downloaderService = new DownloaderService();
