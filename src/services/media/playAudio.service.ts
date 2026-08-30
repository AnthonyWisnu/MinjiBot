import ffmpegStatic from "ffmpeg-static";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { createTempDir, removeTempDir } from "../../utils/tempFile";

export interface PreparedPlayAudio {
  buffer: Buffer;
  mimetype: "audio/mpeg";
  tempDir: string;
}

export class PlayAudioService {
  async prepareMp3Audio(videoUrl: string): Promise<PreparedPlayAudio> {
    const tempDir = await createTempDir("play");
    const rawOutputTemplate = path.join(tempDir, "raw.%(ext)s");
    const outputPath = path.join(tempDir, "audio.mp3");

    try {
      await runYtDlp(videoUrl, rawOutputTemplate);
      const inputPath = await findDownloadedFile(tempDir);
      const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";
      await runFfmpeg(inputPath, outputPath, ffmpegPath);

      return {
        buffer: await readFile(outputPath),
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
}

function runYtDlp(videoUrl: string, outputTemplate: string): Promise<void> {
  const cookiesPath = env.YOUTUBE_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;
  const args = [
    "-f",
    "bestaudio/best",
    "--no-playlist",
    "--no-warnings",
    "-o",
    outputTemplate,
  ];

  if (cookiesPath && existsSync(cookiesPath)) {
    args.push("--cookies", cookiesPath);
  }

  args.push(videoUrl);

  return runProcess(
    env.DOWNLOADER_BIN,
    args,
    "Download audio melewati batas waktu.",
    "Download audio gagal dijalankan.",
  );
}

function runFfmpeg(inputPath: string, outputPath: string, ffmpegPath: string): Promise<void> {
  return runProcess(
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
    "Convert audio melewati batas waktu.",
    "Convert audio gagal dijalankan.",
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
    }, env.DOWNLOADER_TIMEOUT_MS);

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

export const playAudioService = new PlayAudioService();
