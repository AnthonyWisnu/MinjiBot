import ffmpegStatic from "ffmpeg-static";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { createTempDir, removeTempDir } from "../../utils/tempFile";

export interface PreparedPlayAudio {
  buffer: Buffer;
  tempDir: string;
}

export class PlayAudioService {
  async prepareOpusAudio(url: string): Promise<PreparedPlayAudio> {
    const tempDir = await createTempDir("play");
    const rawOutputTemplate = path.join(tempDir, "raw.%(ext)s");
    const opusOutputPath = path.join(tempDir, "audio.opus");

    try {
      await this.downloadAudio(url, rawOutputTemplate);
      const inputPath = await findDownloadedFile(tempDir);
      await this.convertToOpus(inputPath, opusOutputPath);

      return {
        buffer: await readFile(opusOutputPath),
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
    await runProcess(
      env.DOWNLOADER_BIN,
      [
        "--no-playlist",
        "-f",
        "bestaudio/best",
        "-o",
        outputTemplate,
        url,
      ],
      env.DOWNLOADER_TIMEOUT_MS,
      "Download audio melewati batas waktu.",
      "yt-dlp gagal dijalankan",
    );
  }

  private async convertToOpus(inputPath: string, outputPath: string): Promise<void> {
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
        "48000",
        "-c:a",
        "libopus",
        "-b:a",
        "64k",
        outputPath,
      ],
      env.DOWNLOADER_TIMEOUT_MS,
      "Convert audio melewati batas waktu.",
      "ffmpeg gagal dijalankan",
    );
  }
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

export const playAudioService = new PlayAudioService();
