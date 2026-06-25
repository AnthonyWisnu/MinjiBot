import ffmpegStatic from "ffmpeg-static";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import play from "play-dl";

import { env } from "../../config/env";
import { logger } from "../../config/logger";

export interface PreparedPlayAudio {
  buffer: Buffer;
  mimetype: "audio/ogg; codecs=opus";
}

export class PlayAudioService {
  async prepareOpusAudio(videoUrl: string): Promise<PreparedPlayAudio> {
    const inputStream = await this.createAudioStream(videoUrl);

    try {
      const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";
      const output = await runFfmpeg(inputStream, ffmpegPath);

      return {
        buffer: output,
        mimetype: "audio/ogg; codecs=opus",
      };
    } finally {
      inputStream.destroy();
    }
  }

  private async createAudioStream(videoUrl: string): Promise<Readable> {
    try {
      const stream = await play.stream(videoUrl);
      return stream.stream;
    } catch (error: unknown) {
      logger.warn({ error, videoUrl }, "play-dl stream langsung gagal, memakai direct URL");
      return createDirectAudioStream(videoUrl);
    }
  }
}

async function createDirectAudioStream(videoUrl: string): Promise<Readable> {
  const info = await play.video_info(videoUrl);
  const format = info.format
    .filter((item) => item.url && item.audioQuality)
    .sort((left, right) => getBitrate(right) - getBitrate(left))[0];

  if (!format?.url) {
    throw new Error("Stream audio YouTube tidak tersedia.");
  }

  const response = await fetch(format.url, {
    headers: {
      Origin: "https://www.youtube.com",
      Range: "bytes=0-",
      Referer: "https://www.youtube.com/",
      "User-Agent": "Mozilla/5.0",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Stream audio YouTube gagal dibuka: ${String(response.status)}`);
  }

  return Readable.fromWeb(response.body);
}

function getBitrate(format: { averageBitrate?: number; bitrate?: number }): number {
  return format.averageBitrate ?? format.bitrate ?? 0;
}

function runFfmpeg(inputStream: Readable, ffmpegPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, getFfmpegArgs(), {
      windowsHide: true,
    });
    const outputChunks: Buffer[] = [];
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Convert audio melewati batas waktu."));
    }, env.DOWNLOADER_TIMEOUT_MS);

    inputStream.pipe(child.stdin);

    child.stdout.on("data", (chunk: Buffer) => {
      outputChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    inputStream.on("error", (error) => {
      child.kill("SIGKILL");
      reject(error);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`ffmpeg gagal dijalankan: ${error.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(Buffer.concat(outputChunks));
        return;
      }

      reject(new Error(`ffmpeg gagal menjalankan convert audio: ${stderr.slice(-500)}`));
    });
  });
}

function getFfmpegArgs(): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    "pipe:0",
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
    "pipe:1",
  ];
}

export const playAudioService = new PlayAudioService();
