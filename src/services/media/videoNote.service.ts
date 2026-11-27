import ffmpegStatic from "ffmpeg-static";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "../../config/env";
import { AppUserError } from "../../errors/appUserError";
import { mediaQueueService } from "../../utils/boundedQueue";
import { runExternalProcess } from "../../utils/processRunner";
import { createTempDir, removeTempDir } from "../../utils/tempFile";

const VIDEO_NOTE_SIZE = 480;
const VIDEO_NOTE_MAX_SECONDS = 60;

export interface VideoNoteResult {
  buffer: Buffer;
  mimetype: "video/mp4";
}

export class VideoNoteService {
  async createVideoNote(inputBuffer: Buffer): Promise<VideoNoteResult> {
    return mediaQueueService.heavySubprocessQueue.run(async () => {
      const tempDir = await createTempDir("ptv");
      const inputPath = path.join(tempDir, `input-${randomUUID()}.mp4`);
      const outputPath = path.join(tempDir, "output-ptv.mp4");

      try {
        await writeFile(inputPath, inputBuffer);
        const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";

        try {
          await runExternalProcess(
            ffmpegPath,
            [
              "-y",
              "-threads",
              "1",
              "-t",
              String(VIDEO_NOTE_MAX_SECONDS),
              "-i",
              inputPath,
              "-map",
              "0:v:0",
              "-map",
              "0:a?",
              "-vf",
              `scale=${String(VIDEO_NOTE_SIZE)}:${String(
                VIDEO_NOTE_SIZE,
              )}:force_original_aspect_ratio=decrease,pad=${String(VIDEO_NOTE_SIZE)}:${String(
                VIDEO_NOTE_SIZE,
              )}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p`,
              "-c:v",
              "libx264",
              "-profile:v",
              "baseline",
              "-level",
              "3.1",
              "-preset",
              "veryfast",
              "-crf",
              "26",
              "-c:a",
              "aac",
              "-b:a",
              "96k",
              "-movflags",
              "+faststart",
              outputPath,
            ],
            {
              timeoutMs: env.DOWNLOADER_TIMEOUT_MS,
            },
          );
        } catch (err: unknown) {
          if (err instanceof Error && err.message.includes("melewati batas waktu")) {
            throw new AppUserError("Konversi video note melewati batas waktu.");
          }
          throw new Error(
            `Konversi video note gagal: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        const buffer = await readFile(outputPath);
        return {
          buffer,
          mimetype: "video/mp4",
        };
      } finally {
        await removeTempDir(tempDir);
      }
    });
  }
}

export const videoNoteService = new VideoNoteService();
