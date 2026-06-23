import ffmpegStatic from "ffmpeg-static";
import { spawn } from "node:child_process";

import { env } from "../../config/env";

export class VideoNormalizeService {
  async remuxForWhatsApp(inputPath: string, outputPath: string): Promise<void> {
    const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";
    const args = [
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ];

    await runProcess(
      ffmpegPath,
      args,
      env.DOWNLOADER_TIMEOUT_MS,
      "Remux video melewati batas waktu.",
    );
  }

  async normalizeForWhatsApp(inputPath: string, outputPath: string): Promise<void> {
    const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";
    const args = [
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-profile:v",
      "main",
      "-level",
      "4.1",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outputPath,
    ];

    await runProcess(
      ffmpegPath,
      args,
      env.DOWNLOADER_TIMEOUT_MS,
      "Normalisasi video melewati batas waktu.",
    );
  }
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  timeoutMessage: string,
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
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Normalisasi video gagal: ${stderr.slice(-500)}`));
    });
  });
}

export const videoNormalizeService = new VideoNormalizeService();
