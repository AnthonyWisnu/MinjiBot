import ffmpegStatic from "ffmpeg-static";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { createTempDir, removeTempDir } from "../../utils/tempFile";

const YTDLP_PATH = "/usr/local/bin/yt-dlp";
const YTDLP_BASE_ARGS = [
  "--no-playlist",
  "--no-warnings",
  "--sleep-interval",
  "1",
  "--max-sleep-interval",
  "3",
  "--user-agent",
  "Mozilla/5.0",
  "-f",
  "bestaudio/best",
];

export interface PreparedPlayAudio {
  buffer: Buffer;
  fileName: string;
  mimetype: "audio/mpeg";
  tempDir: string;
}

export class PlayAudioService {
  async prepareMp3Audio(url: string, title: string): Promise<PreparedPlayAudio> {
    const tempDir = await createTempDir("play");
    const rawOutputTemplate = path.join(tempDir, "raw.%(ext)s");
    const mp3OutputPath = path.join(tempDir, "audio.mp3");

    try {
      await this.downloadAudio(url, rawOutputTemplate);
      const inputPath = await findDownloadedFile(tempDir);
      await this.convertToMp3(inputPath, mp3OutputPath);

      return {
        buffer: await readFile(mp3OutputPath),
        fileName: `${sanitizeFileName(title)}.mp3`,
        mimetype: "audio/mpeg",
        tempDir,
      };
    } catch (error: unknown) {
      await removeTempDir(tempDir);
      throw error;
    }
  }

  async cleanup(tempDir: string): Promise<void> {
    try {
      await removeTempDir(tempDir);
    } catch (error: unknown) {
      logger.warn({ error, tempDir }, "Cleanup temp audio gagal");
    }
  }

  private async downloadAudio(url: string, outputTemplate: string): Promise<void> {
    const args = [...YTDLP_BASE_ARGS, "-o", outputTemplate, url];

    try {
      await runYtDlp(args);
    } catch {
      await runYtDlp([
        ...YTDLP_BASE_ARGS,
        "--extractor-retries",
        "3",
        "--fragment-retries",
        "3",
        "-o",
        outputTemplate,
        url,
      ]);
    }
  }

  private async convertToMp3(inputPath: string, outputPath: string): Promise<void> {
    const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";

    await runProcess(
      ffmpegPath,
      [
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "44100",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        outputPath,
      ],
      env.DOWNLOADER_TIMEOUT_MS,
      "Convert audio melewati batas waktu.",
      "ffmpeg gagal dijalankan",
    );
  }
}

function runYtDlp(args: string[]): Promise<void> {
  return runProcess(
    YTDLP_PATH,
    args,
    env.DOWNLOADER_TIMEOUT_MS,
    "Download audio melewati batas waktu.",
    "yt-dlp gagal dijalankan",
  );
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
    throw new Error("File hasil download audio tidak ditemukan.");
  }

  return path.join(tempDir, downloadedFile);
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  timeoutMessage: string,
  unavailableMessage: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`${unavailableMessage}: ${error.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${unavailableMessage}: ${stderr.slice(-500)}`));
    });
  });
}

function sanitizeFileName(value: string): string {
  const sanitized = value
    .split("")
    .filter((char) => char.charCodeAt(0) >= 32 && !isReservedFileNameChar(char))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  return sanitized.length > 0 ? sanitized : "minjibot-audio";
}

function isReservedFileNameChar(char: string): boolean {
  return '<>:"/\\|?*'.includes(char);
}

export const playAudioService = new PlayAudioService();
