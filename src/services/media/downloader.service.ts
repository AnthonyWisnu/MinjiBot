import { stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { env } from "../../config/env";
import { createTempDir, removeTempDir } from "../../utils/tempFile";
import { videoNormalizeService } from "./videoNormalize.service";

const BYTES_PER_MB = 1024 * 1024;

export type DownloaderKind = "tiktok" | "instagram" | "instagram-story";

export interface DownloadedVideo {
  buffer: Buffer;
  fileName: string;
  mimetype: "video/mp4";
}

export class DownloaderService {
  async downloadVideo(url: string, kind: DownloaderKind): Promise<DownloadedVideo> {
    const parsedUrl = parseSupportedUrl(url, kind);
    const tempDir = await createTempDir("download");
    const rawOutputTemplate = path.join(tempDir, "raw.%(ext)s");
    const normalizedOutputPath = path.join(tempDir, "normalized.mp4");

    try {
      await this.runDownloader(parsedUrl.toString(), rawOutputTemplate);
      const rawVideoPath = path.join(tempDir, "raw.mp4");
      await videoNormalizeService.normalizeForWhatsApp(rawVideoPath, normalizedOutputPath);
      await assertFileSizeAllowed(normalizedOutputPath);
      const buffer = await import("node:fs/promises").then((fs) =>
        fs.readFile(normalizedOutputPath),
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

  private async runDownloader(url: string, outputTemplate: string): Promise<void> {
    const args = [
      "--no-playlist",
      "--max-filesize",
      `${String(env.MAX_DOWNLOAD_FILE_MB)}M`,
      "-f",
      "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best[ext=mp4]/best",
      "--merge-output-format",
      "mp4",
      "-o",
      outputTemplate,
      url,
    ];

    await runProcess(env.DOWNLOADER_BIN, args, env.DOWNLOADER_TIMEOUT_MS);
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
