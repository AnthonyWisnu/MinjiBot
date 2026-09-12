import { existsSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import type { Request, Response } from "express";

import { env } from "../../config/env";
import { logger } from "../../config/logger";

const YOUTUBE_URL_REGEX =
  /^(https?:\/\/)?((www|m)\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)([\w-]{11})/;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export class YoutubeStreamService {
  /**
   * Validasi ketat untuk mencegah SSRF.
   * Hanya menerima URL YouTube resmi atau videoId 11 karakter.
   */
  isValidYoutubeUrl(url: string): boolean {
    if (!url || typeof url !== "string") return false;
    const trimmed = url.trim();
    if (/^[\w-]{11}$/.test(trimmed)) return true; // Direct videoId
    return YOUTUBE_URL_REGEX.test(trimmed);
  }

  normalizeYoutubeUrl(input: string): string {
    const trimmed = input.trim();
    if (/^[\w-]{11}$/.test(trimmed)) {
      return `https://www.youtube.com/watch?v=${trimmed}`;
    }
    const match = trimmed.match(YOUTUBE_URL_REGEX);
    if (match && match[6]) {
      return `https://www.youtube.com/watch?v=${match[6]}`;
    }
    return trimmed;
  }

  /**
   * Stream media YouTube secara langsung melalui stdout pipe yt-dlp ke HTTP Response.
   * Dilengkapi proteksi kill process otomatis jika client menutup koneksi.
   */
  async streamToResponse(videoUrl: string, req: Request, res: Response): Promise<void> {
    if (!this.isValidYoutubeUrl(videoUrl)) {
      res.status(400).json({ error: "URL YouTube tidak valid atau melanggar aturan keamanan." });
      return;
    }

    const targetUrl = this.normalizeYoutubeUrl(videoUrl);
    const cookiesPath = env.YOUTUBE_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;

    const args = [
      "-f",
      "best[ext=mp4]/best",
      "--no-playlist",
      "--no-warnings",
      "--user-agent",
      DEFAULT_USER_AGENT,
      "--extractor-args",
      "youtube:player_client=android,web,tv,ios",
      "-o",
      "-", // Output langsung ke stdout
    ];

    if (cookiesPath && existsSync(cookiesPath)) {
      args.push("--cookies", cookiesPath);
    }

    args.push(targetUrl);

    logger.info({ targetUrl }, "Memulai streaming media YouTube");

    let child: ChildProcess | null = null;
    let isTerminated = false;

    const cleanup = (): void => {
      if (isTerminated) return;
      isTerminated = true;
      if (child && !child.killed) {
        try {
          child.kill("SIGKILL");
          logger.debug({ targetUrl }, "Stream process dihentikan (client disconnect)");
        } catch (_) {}
      }
    };

    req.on("close", cleanup);
    res.on("finish", cleanup);
    res.on("error", cleanup);

    try {
      const proc = spawn(env.DOWNLOADER_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
      child = proc;

      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

      if (proc.stdout) {
        proc.stdout.pipe(res);
      }

      if (proc.stderr) {
        proc.stderr.on("data", (chunk: Buffer) => {
          const msg = chunk.toString();
          if (msg.includes("ERROR:")) {
            logger.warn({ targetUrl, err: msg.trim() }, "yt-dlp stream warning/error");
          }
        });
      }

      proc.on("error", (err) => {
        logger.error({ err: err.message, targetUrl }, "Gagal menjalankan child process yt-dlp");
        cleanup();
        if (!res.headersSent) {
          res.status(500).json({ error: "Gagal memproses stream video." });
        }
      });

      proc.on("exit", (code) => {
        logger.debug({ code, targetUrl }, "yt-dlp stream process exited");
        cleanup();
      });
    } catch (err: unknown) {
      cleanup();
      const message = err instanceof Error ? err.message : "Stream error";
      logger.error({ message }, "Exception saat inisialisasi stream");
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      }
    }
  }
}

export const youtubeStreamService = new YoutubeStreamService();
