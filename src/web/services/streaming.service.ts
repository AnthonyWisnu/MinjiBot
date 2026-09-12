import { existsSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import type { Request, Response } from "express";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { playerSessionService } from "./player-session.service";

const YOUTUBE_URL_REGEX =
  /^(https?:\/\/)?((www|m)\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)([\w-]{11})/;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export class StreamingService {
  isValidYoutubeUrl(url: string): boolean {
    if (!url || typeof url !== "string") return false;
    const trimmed = url.trim();
    if (/^[\w-]{11}$/.test(trimmed)) return true;
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
   * Stream media YouTube secara aman berdasarkan session ID tervalidasi.
   * Mendukung HTTP Range requests, headers video/mp4, dan kill child process saat disconnect.
   */
  async streamSession(sessionId: string, req: Request, res: Response): Promise<void> {
    const session = playerSessionService.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "Sesi streaming tidak valid atau sudah kadaluwarsa." });
      return;
    }

    const videoUrl = session.videoUrl;
    if (!this.isValidYoutubeUrl(videoUrl)) {
      res.status(400).json({ error: "Sumber media tidak valid." });
      return;
    }

    const targetUrl = this.normalizeYoutubeUrl(videoUrl);
    const cookiesPath = env.YOUTUBE_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;

    const args = [
      "-f",
      "best[ext=mp4]/bestaudio/best",
      "--no-playlist",
      "--no-warnings",
      "--user-agent",
      DEFAULT_USER_AGENT,
      "-o",
      "-",
    ];

    if (cookiesPath && existsSync(cookiesPath)) {
      args.push("--cookies", cookiesPath);
    }

    args.push(targetUrl);

    logger.info({ sessionId, targetUrl }, "Memulai HTTP media streaming session");

    let child: ChildProcess | null = null;
    let isTerminated = false;

    const cleanup = (): void => {
      if (isTerminated) return;
      isTerminated = true;
      if (child && !child.killed) {
        try {
          child.kill("SIGKILL");
          logger.debug({ sessionId }, "Stream process terminated (client disconnect)");
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
            logger.warn({ sessionId, err: msg.trim() }, "yt-dlp stream process warning/error");
          }
        });
      }

      proc.on("error", (err) => {
        logger.error({ err: err.message, sessionId }, "Gagal menjalankan child process streaming");
        cleanup();
        if (!res.headersSent) {
          res.status(500).json({ error: "Gagal memproses stream video." });
        }
      });

      proc.on("exit", (code) => {
        logger.debug({ code, sessionId }, "Streaming process exited");
        cleanup();
      });
    } catch (err: unknown) {
      cleanup();
      const msg = err instanceof Error ? err.message : "Internal stream error";
      logger.error({ err, sessionId }, "Streaming service exception");
      if (!res.headersSent) {
        res.status(500).json({ error: msg });
      }
    }
  }
}

export const streamingService = new StreamingService();
