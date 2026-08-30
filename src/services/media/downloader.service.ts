import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

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

export type DownloaderKind = "tiktok" | "instagram" | "instagram-story";

export interface DownloadedVideo {
  buffer: Buffer;
  fileName: string;
  mimetype: "video/mp4";
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

  const videoUrl = json.data.play || json.data.hdplay || json.data.wmplay;
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
      await this.runDownloader(parsedUrl.toString(), rawOutputTemplate, kind);
      const rawVideoPath = await findDownloadedFile(tempDir);
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

  private async runDownloader(
    url: string,
    outputTemplate: string,
    kind: DownloaderKind,
  ): Promise<void> {
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

    if (isInstagramDownloader(kind)) {
      const cookiesPath = env.INSTAGRAM_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;
      if (cookiesPath && existsSync(cookiesPath)) {
        args.push("--cookies", cookiesPath);
      }
    } else if (kind === "tiktok") {
      const cookiesPath = env.TIKTOK_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;
      if (cookiesPath && existsSync(cookiesPath)) {
        args.push("--cookies", cookiesPath);
      }
    }

    args.push(url);

    await runProcess(env.DOWNLOADER_BIN, args, env.DOWNLOADER_TIMEOUT_MS);
  }
}

function isInstagramDownloader(kind: DownloaderKind): boolean {
  return kind === "instagram" || kind === "instagram-story";
}

async function findDownloadedFile(tempDir: string): Promise<string> {
  const entries = await readdir(tempDir);
  const downloadedFile = entries.find(
    (entry) =>
      entry.startsWith("raw.") &&
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

  if ((kind === "instagram" || kind === "instagram-story") && !hostname.includes("instagram.com")) {
    throw new Error("Command ini hanya menerima link Instagram.");
  }

  return parsedUrl;
}

async function assertFileSizeAllowed(filePath: string): Promise<void> {
  const fileStat = await stat(filePath);
  const maxBytes = env.MAX_DOWNLOAD_FILE_MB * BYTES_PER_MB;

  if (fileStat.size > maxBytes) {
    throw new Error(`Ukuran video maksimal ${String(env.MAX_DOWNLOAD_FILE_MB)} MB.`);
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

export const downloaderService = new DownloaderService();
