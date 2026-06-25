import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { createTempDir, removeTempDir } from "../../utils/tempFile";

const BYTES_PER_MB = 1024 * 1024;
const MAX_PLAY_DURATION_SECONDS = 10 * 60;
const MAX_PLAY_FILE_MB = 15;

export interface PlayAudioResult {
  buffer: Buffer;
  fileName: string;
  mimetype: "audio/mpeg";
}

export class AudioPlayService {
  async searchAndDownloadMp3(query: string): Promise<PlayAudioResult> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
      throw new Error("Judul lagu tidak boleh kosong.");
    }

    const tempDir = await createTempDir("play");
    const rawOutputTemplate = path.join(tempDir, "audio.%(ext)s");
    const outputPath = path.join(tempDir, "audio.mp3");
    const startedAt = Date.now();

    try {
      await this.runAudioDownloader(normalizedQuery, rawOutputTemplate);
      const rawAudioPath = await findDownloadedFile(tempDir);
      await this.convertToMp3(rawAudioPath, outputPath);
      await assertAudioSizeAllowed(outputPath);
      const buffer = await readFile(outputPath);

      logger.info(
        {
          elapsedMs: Date.now() - startedAt,
          sizeBytes: buffer.byteLength,
          query: normalizedQuery,
        },
        "Play audio selesai",
      );

      return {
        buffer,
        fileName: "minjibot-play.mp3",
        mimetype: "audio/mpeg",
      };
    } finally {
      await removeTempDir(tempDir);
    }
  }

  private async runAudioDownloader(query: string, outputTemplate: string): Promise<void> {
    const args = [
      "--no-playlist",
      "--max-downloads",
      "1",
      "--match-filter",
      `duration <= ${String(MAX_PLAY_DURATION_SECONDS)}`,
      "-f",
      "ba[ext=m4a]/ba/bestaudio",
      "-o",
      outputTemplate,
      `ytsearch1:${query}`,
    ];

    await runProcess(env.DOWNLOADER_BIN, args, env.DOWNLOADER_TIMEOUT_MS, "Downloader audio gagal");
  }

  private async convertToMp3(inputPath: string, outputPath: string): Promise<void> {
    const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";
    const args = [
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "2",
      "-ar",
      "44100",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      outputPath,
    ];

    await runProcess(ffmpegPath, args, env.DOWNLOADER_TIMEOUT_MS, "Konversi audio gagal");
  }
}

async function findDownloadedFile(tempDir: string): Promise<string> {
  const entries = await readdir(tempDir);
  const downloadedFile = entries.find(
    (entry) =>
      entry.startsWith("audio.") &&
      !entry.endsWith(".part") &&
      !entry.endsWith(".ytdl") &&
      !entry.endsWith(".json"),
  );

  if (!downloadedFile) {
    throw new Error("Audio tidak ditemukan.");
  }

  return path.join(tempDir, downloadedFile);
}

async function assertAudioSizeAllowed(filePath: string): Promise<void> {
  const fileStat = await stat(filePath);
  const maxBytes = MAX_PLAY_FILE_MB * BYTES_PER_MB;

  if (fileStat.size > maxBytes) {
    throw new Error(`Ukuran audio maksimal ${String(MAX_PLAY_FILE_MB)} MB.`);
  }
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  errorPrefix: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${errorPrefix}: proses melewati batas waktu.`));
    }, timeoutMs);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`${errorPrefix}: ${error.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${errorPrefix}: ${stderr.slice(-500)}`));
    });
  });
}

export const audioPlayService = new AudioPlayService();
