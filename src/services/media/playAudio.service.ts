import ffmpegStatic from "ffmpeg-static";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { createTempDir, removeTempDir } from "../../utils/tempFile";

const COBALT_ENDPOINT = "http://localhost:9000/";

export interface PreparedPlayAudio {
  buffer: Buffer;
  mimetype: "audio/ogg; codecs=opus";
  tempDir: string;
}

export class PlayAudioService {
  async prepareOpusAudio(videoUrl: string): Promise<PreparedPlayAudio> {
    const tempDir = await createTempDir("play");
    const inputPath = path.join(tempDir, "cobalt-audio.mp3");
    const outputPath = path.join(tempDir, "audio.opus");

    try {
      const downloadUrl = await requestCobaltAudioUrl(videoUrl);
      await downloadAudio(downloadUrl, inputPath);
      const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";
      await runFfmpeg(inputPath, outputPath, ffmpegPath);

      return {
        buffer: await readFile(outputPath),
        mimetype: "audio/ogg; codecs=opus",
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

interface CobaltResponse {
  status?: string;
  url?: string;
  error?: {
    code?: string;
  };
}

async function requestCobaltAudioUrl(videoUrl: string): Promise<string> {
  const response = await fetch(COBALT_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: videoUrl,
      downloadMode: "audio",
      audioFormat: "mp3",
    }),
  });

  if (!response.ok) {
    throw new Error(`Cobalt tidak merespon dengan benar: ${String(response.status)}`);
  }

  const data = (await response.json()) as CobaltResponse;
  if (!isDownloadStatus(data.status) || !data.url) {
    throw new Error(`Cobalt gagal membuat link audio: ${data.error?.code ?? data.status ?? "-"}`);
  }

  return new URL(data.url, COBALT_ENDPOINT).toString();
}

function isDownloadStatus(status: string | undefined): boolean {
  return status === "stream" || status === "tunnel" || status === "redirect";
}

async function downloadAudio(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      Accept: "*/*",
      "User-Agent": "Mozilla/5.0",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Download audio dari Cobalt gagal: ${String(response.status)}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
}

function runFfmpeg(inputPath: string, outputPath: string, ffmpegPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, getFfmpegArgs(inputPath, outputPath), {
      windowsHide: true,
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Convert audio melewati batas waktu."));
    }, env.DOWNLOADER_TIMEOUT_MS);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`ffmpeg gagal dijalankan: ${error.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`ffmpeg gagal menjalankan convert audio: ${stderr.slice(-500)}`));
    });
  });
}

function getFfmpegArgs(inputPath: string, outputPath: string): string[] {
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
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
    "-f",
    "ogg",
    outputPath,
  ];
}

export const playAudioService = new PlayAudioService();
