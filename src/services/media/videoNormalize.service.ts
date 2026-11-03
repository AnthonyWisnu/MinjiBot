import ffmpegStatic from "ffmpeg-static";

import { env } from "../../config/env";
import { runExternalProcess } from "../../utils/processRunner";

export class VideoNormalizeService {
  /**
   * Membaca durasi video dalam satuan detik menggunakan FFmpeg probe ringan.
   * Mengembalikan null apabila durasi tidak dapat dideteksi.
   */
  async getVideoDurationSeconds(inputPath: string): Promise<number | null> {
    const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";
    try {
      const result = await runExternalProcess(ffmpegPath, ["-hide_banner", "-i", inputPath], {
        timeoutMs: 8000,
        throwOnNonZeroExit: false,
      });

      const match = /Duration:\s*(\d{2,}):(\d{2}):(\d{2}(?:\.\d+)?)/i.exec(result.stderr);
      if (!match?.[1] || !match[2] || !match[3]) {
        return null;
      }

      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      const seconds = Number(match[3]);
      if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) {
        return null;
      }

      return hours * 3600 + minutes * 60 + seconds;
    } catch {
      return null;
    }
  }

  /**
   * Memeriksa apakah video berformat H.264 (avc1) yang aman untuk diputar
   * langsung pada perangkat WhatsApp (iOS & Android) tanpa transcode lambat.
   */
  async isH264Video(inputPath: string): Promise<boolean> {
    const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";
    try {
      const result = await runExternalProcess(ffmpegPath, ["-hide_banner", "-i", inputPath], {
        timeoutMs: 8000,
        throwOnNonZeroExit: false,
      });

      const stderr = result.stderr.toLowerCase();
      // Pastikan ada video stream dan menggunakan codec h264 / avc1
      const hasH264 = stderr.includes("video: h264") || stderr.includes("video: avc1");
      const hasIncompatibleCodec =
        stderr.includes("video: hevc") ||
        stderr.includes("video: hvc1") ||
        stderr.includes("video: vp9") ||
        stderr.includes("video: vp09") ||
        stderr.includes("video: av01") ||
        stderr.includes("video: av1");

      return hasH264 && !hasIncompatibleCodec;
    } catch {
      // Jika probe gagal, anggap butuh remux/normalisasi
      return false;
    }
  }

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

    await runExternalProcess(ffmpegPath, args, {
      timeoutMs: env.DOWNLOADER_TIMEOUT_MS,
    });
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

    await runExternalProcess(ffmpegPath, args, {
      timeoutMs: env.DOWNLOADER_TIMEOUT_MS,
    });
  }
}

export const videoNormalizeService = new VideoNormalizeService();
