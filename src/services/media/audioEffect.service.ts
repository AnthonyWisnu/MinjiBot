import ffmpegStatic from "ffmpeg-static";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { createTempDir, removeTempDir } from "../../utils/tempFile";

export type AudioEffectType = "bass" | "chipmunk" | "slowed" | "nightcore" | "tovn";

export interface AudioEffectResult {
  buffer: Buffer;
  mimetype: string;
  fileName: string;
  ptt?: boolean;
}

const EFFECT_FILTERS: Record<Exclude<AudioEffectType, "tovn">, string> = {
  bass: "equalizer=f=60:width_type=h:width=50:g=15",
  chipmunk: "asetrate=44100*1.4,aresample=44100,atempo=1/1.05",
  slowed: "atempo=0.82,aecho=0.8:0.9:1000:0.3",
  nightcore: "asetrate=44100*1.25,aresample=44100",
};

export class AudioEffectService {
  async applyEffect(
    inputBuffer: Buffer,
    effect: AudioEffectType,
  ): Promise<AudioEffectResult> {
    const tempDir = await createTempDir("audio-fx");
    const inputPath = path.join(tempDir, `input-${randomUUID()}.bin`);
    const isVn = effect === "tovn";
    const outputPath = path.join(tempDir, isVn ? "output.ogg" : "output.mp3");

    try {
      await writeFile(inputPath, inputBuffer);
      const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";

      const args: string[] = [
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-t",
        "300",
      ];

      if (isVn) {
        args.push("-c:a", "libopus", "-b:a", "64k", "-ac", "1", outputPath);
      } else {
        const filter = EFFECT_FILTERS[effect];
        if (filter) {
          args.push("-af", filter);
        }
        args.push("-c:a", "libmp3lame", "-q:a", "2", outputPath);
      }

      await runProcess(ffmpegPath, args, env.DOWNLOADER_TIMEOUT_MS);
      const buffer = await readFile(outputPath);

      return {
        buffer,
        mimetype: isVn ? "audio/ogg; codecs=opus" : "audio/mpeg",
        fileName: isVn ? "minjibot-vn.ogg" : `minjibot-${effect}.mp3`,
        ptt: isVn,
      };
    } finally {
      await removeTempDir(tempDir);
    }
  }
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Pemrosesan audio melewati batas waktu."));
    }, timeoutMs);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`Gagal menjalankan FFmpeg: ${error.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      logger.warn({ stderr: stderr.slice(-300) }, "FFmpeg audio effect error");
      reject(new Error("Gagal memproses efek audio. Format media tidak didukung."));
    });
  });
}

export const audioEffectService = new AudioEffectService();
