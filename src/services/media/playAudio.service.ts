import ffmpegStatic from "ffmpeg-static";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { AppUserError } from "../../errors/appUserError";
import { mediaQueueService } from "../../utils/boundedQueue";
import { runExternalProcess } from "../../utils/processRunner";
import { createTempDir, removeTempDir } from "../../utils/tempFile";

export interface PreparedPlayAudio {
  buffer: Buffer;
  mimetype: "audio/mpeg";
  tempDir: string;
}

export class PlayAudioService {
  async prepareMp3Audio(videoUrl: string): Promise<PreparedPlayAudio> {
    return mediaQueueService.heavySubprocessQueue.run(async () => {
      const tempDir = await createTempDir("play");
      const rawOutputTemplate = path.join(tempDir, "raw.%(ext)s");
      const outputPath = path.join(tempDir, "audio.mp3");

      try {
        await runYtDlp(videoUrl, rawOutputTemplate);
        const inputPath = await findDownloadedFile(tempDir);
        const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";
        await runFfmpeg(inputPath, outputPath, ffmpegPath);

        const fileStat = await stat(outputPath);
        const maxBytes = env.MAX_DOWNLOAD_FILE_MB * 1024 * 1024;
        if (fileStat.size > maxBytes) {
          throw new AppUserError(
            `Ukuran audio (${(fileStat.size / (1024 * 1024)).toFixed(1)} MB) melebihi batas maksimal ${String(env.MAX_DOWNLOAD_FILE_MB)} MB.`,
          );
        }

        return {
          buffer: await readFile(outputPath),
          mimetype: "audio/mpeg",
          tempDir,
        };
      } catch (error: unknown) {
        await removeTempDir(tempDir);
        throw error;
      }
    });
  }

  async cleanup(tempDir: string): Promise<void> {
    try {
      await removeTempDir(tempDir);
    } catch (error: unknown) {
      logger.warn({ err: error, tempDir }, "Cleanup temp audio gagal");
    }
  }
}

const DEFAULT_PLAY_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function runYtDlp(url: string, outputTemplate: string): Promise<void> {
  const binary = env.DOWNLOADER_BIN;
  if (!binary) {
    throw new Error("YT_DLP_PATH belum dikonfigurasi.");
  }

  const args: string[] = [
    "--no-warnings",
    "--no-playlist",
    "--ies",
    "youtube,youtube:clip",
    "--match-filter",
    "duration <=? 3600 & !is_live",
    "--extract-audio",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "--max-filesize",
    `${String(env.MAX_DOWNLOAD_FILE_MB)}M`,
    "--add-header",
    `User-Agent:${DEFAULT_PLAY_USER_AGENT}`,
    "-o",
    outputTemplate,
  ];

  const cookiesPath = env.YOUTUBE_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;
  if (cookiesPath && existsSync(cookiesPath)) {
    args.push("--cookies", cookiesPath);
  }

  args.push("--", url);

  await runProcess(
    binary,
    args,
    "Download audio YouTube melebihi batas waktu.",
    "yt-dlp tidak dapat digunakan",
  );
}

async function runFfmpeg(inputPath: string, outputPath: string, ffmpegPath: string): Promise<void> {
  const args: string[] = [
    "-y",
    "-threads",
    "1",
    "-i",
    inputPath,
    "-vn",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    outputPath,
  ];

  await runProcess(
    ffmpegPath,
    args,
    "Konversi audio melebihi batas waktu.",
    "FFmpeg tidak dapat digunakan",
  );
}

async function findDownloadedFile(tempDir: string): Promise<string> {
  const entries = await readdir(tempDir);
  const downloadedFile = entries.find((file) => {
    const fullPath = path.join(tempDir, file);
    return existsSync(fullPath) && file !== "audio.mp3";
  });

  if (!downloadedFile) {
    throw new Error("File hasil download audio tidak ditemukan.");
  }

  return path.join(tempDir, downloadedFile);
}

async function runProcess(
  command: string,
  args: string[],
  timeoutMessage: string,
  unavailableMessage: string,
): Promise<void> {
  try {
    await runExternalProcess(command, args, {
      timeoutMs: env.DOWNLOADER_TIMEOUT_MS,
      extraPathDirs: ["/usr/local/bin", "/usr/bin"],
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("melewati batas waktu")) {
      throw new Error(timeoutMessage);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${unavailableMessage}: ${msg}`);
  }
}

export const playAudioService = new PlayAudioService();
