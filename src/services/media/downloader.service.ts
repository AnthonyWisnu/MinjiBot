import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { AppUserError } from "../../errors/appUserError";
import { mediaQueueService } from "../../utils/boundedQueue";
import { fetchBufferWithLimit } from "../../utils/httpStream";
import { MAX_SAFE_IMAGE_PIXELS } from "../../utils/imageSafety";
import { runExternalProcess } from "../../utils/processRunner";
import { createTempDir, removeTempDir } from "../../utils/tempFile";
import {
  ALLOWED_DOWNLOADER_DOMAINS,
  assertSafeExternalUrl,
  isAllowedDomainUrl,
  parseAllowedDownloaderUrl,
  resolveRedirectUrl,
  safeFetchExternal,
} from "../../utils/urlValidator";
import { videoNormalizeService } from "./videoNormalize.service";

const BYTES_PER_MB = 1024 * 1024;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Agreed platform limits
const MAX_TIKTOK_DURATION_SEC = 4200; // 70 menit (1 jam 10 menit)
const MAX_TIKTOK_SLIDES = 25;
const MAX_INSTAGRAM_DURATION_SEC = 1800; // 30 menit
const MAX_INSTAGRAM_SLIDES = 15;
const MAX_YOUTUBE_DURATION_SEC = 3600; // 1 jam
const MAX_TWITTER_DURATION_SEC = 1800; // 30 menit
const MAX_TWITTER_ITEMS = 10;

export const TIKTOK_MEDIA_ALLOWED_DOMAINS = [
  "tikwm.com",
  "tiktok.com",
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "tiktokcdn-eu.com",
  "tiktokcdn-in.com",
  "tiktokv.com",
  "tiktokv.us",
  "tiktokv.eu",
  "byteoversea.com",
  "ibytedtos.com",
  "ipstatp.com",
  "muscdn.com",
  "musical.ly",
  "ttwstatic.com",
] as const;

export const TWITTER_MEDIA_ALLOWED_DOMAINS = [
  "twimg.com",
  "pbs.twimg.com",
  "video.twimg.com",
  "fxtwitter.com",
  "vxtwitter.com",
] as const;

const TWITTER_CANONICAL_DOMAINS = [
  "twitter.com",
  "x.com",
  "mobile.twitter.com",
  "m.twitter.com",
  "fxtwitter.com",
  "vxtwitter.com",
  "fixupx.com",
] as const;

const TIKTOK_SHORTLINK_HOSTS = new Set([
  "vt.tiktok.com",
  "vm.tiktok.com",
  "t.tiktok.com",
  "lite.tiktok.com",
]);

const MOBILE_SAFE_FORMAT =
  "bv*[vcodec^=avc1][height<=720][ext=mp4]+ba[ext=m4a]/" +
  "b[vcodec^=avc1][height<=720][ext=mp4]/" +
  "bv*[height<=720][ext=mp4]+ba[ext=m4a]/" +
  "b[height<=720][ext=mp4]/" +
  "best[height<=720][ext=mp4]/best[ext=mp4]/best";

const YT_VIDEO_FORMAT_SMART =
  // Prioritas 1: 720p 60 FPS (H.264 mp4) jika video approx <= 100MB
  "bv*[vcodec^=avc1][height<=720][fps>30][filesize_approx<=100M][ext=mp4]+ba[ext=m4a]/" +
  // Prioritas 2: 720p 30 FPS (H.264 mp4) jika video approx <= 100MB
  "bv*[vcodec^=avc1][height<=720][fps<=30][filesize_approx<=100M][ext=mp4]+ba[ext=m4a]/" +
  // Prioritas 3: 720p (H.264 mp4) untuk video panjang hingga 1 jam
  "bv*[vcodec^=avc1][height<=720][ext=mp4]+ba[ext=m4a]/" +
  // Prioritas 4: 480p (H.264 mp4) jika 720p terlalu besar atau fallback
  "bv*[vcodec^=avc1][height<=480][ext=mp4]+ba[ext=m4a]/" +
  // Fallback format jika avc1 tidak tersedia
  "bv*[height<=720][ext=mp4]+ba[ext=m4a]/" +
  "b[height<=720][ext=mp4]/" +
  "best[height<=720]/best";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mkv", ".mov", ".avi"]);

export type DownloaderKind = "tiktok" | "instagram" | "youtube" | "twitter" | "pinterest";
export type MediaType = "video" | "image";

export interface DownloadedMediaItem {
  buffer: Buffer;
  fileName: string;
  mimetype: string;
  mediaType: MediaType;
}

// Kept for backward-compat (used by .tt handler)
export interface DownloadedVideo {
  buffer: Buffer;
  fileName: string;
  mimetype: "video/mp4";
}

export type DownloadResult =
  | { type: "single"; item: DownloadedMediaItem }
  | { type: "multi"; items: DownloadedMediaItem[]; totalCount: number };

export interface ExtractedAudio {
  buffer: Buffer;
  mimetype: "audio/mpeg";
}

export type TikTokDownloadResult =
  | { type: "video"; video: DownloadedVideo; audio?: ExtractedAudio }
  | { type: "images"; items: DownloadedMediaItem[]; totalCount: number; audio?: ExtractedAudio };

interface TikWmResponse {
  code: number;
  msg: string;
  data?: {
    duration?: number;
    play?: string;
    hdplay?: string;
    wmplay?: string;
    title?: string;
    images?: string[];
    music?: string;
    music_info?: {
      id?: string;
      title?: string;
      play?: string;
      author?: string;
    };
  };
}

interface FxTwitterMediaEntry {
  type?: string;
  url?: string;
  duration?: number;
}

interface FxTwitterResponse {
  code?: number;
  tweet?: {
    media?: {
      all?: FxTwitterMediaEntry[];
    };
  } | null;
}

function resolveTikWmMediaUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith("/")) {
    return new URL(trimmed, "https://www.tikwm.com").toString();
  }
  return trimmed;
}

function isPolicyLimitError(error: unknown): boolean {
  if (!(error instanceof AppUserError)) {
    return false;
  }
  const lower = error.message.toLowerCase();
  return lower.includes("durasi") || lower.includes("maksimal");
}

async function downloadTikTokDirect(url: string): Promise<TikTokDownloadResult> {
  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`;
  const response = await safeFetchExternal(apiUrl, {
    allowedDomains: ["tikwm.com"],
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
    },
    signal: AbortSignal.timeout(env.DOWNLOADER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`TikWM API error status: ${String(response.status)}`);
  }

  const json = (await response.json()) as TikWmResponse;
  if (json.code !== 0 || !json.data) {
    throw new Error(`TikWM API response error: ${json.msg || "Unknown error"}`);
  }

  const isSlidePost = Array.isArray(json.data.images) && json.data.images.length > 0;
  if (
    !isSlidePost &&
    typeof json.data.duration === "number" &&
    json.data.duration > MAX_TIKTOK_DURATION_SEC
  ) {
    throw new AppUserError("Video TikTok melebihi batas durasi 70 menit (1 jam 10 menit).");
  }

  // Unduh audio / musik latar jika tersedia di respon API
  let audio: ExtractedAudio | undefined;
  const rawMusicUrl = json.data.music ?? json.data.music_info?.play;
  if (rawMusicUrl) {
    try {
      const musicUrl = resolveTikWmMediaUrl(rawMusicUrl);
      const maxBytes = env.MAX_DOWNLOAD_FILE_MB * BYTES_PER_MB;
      const { buffer: musicBuf } = await fetchBufferWithLimit(musicUrl, {
        maxBytes,
        timeoutMs: env.DOWNLOADER_TIMEOUT_MS,
        allowedDomains: TIKTOK_MEDIA_ALLOWED_DOMAINS,
        headers: {
          "User-Agent": DEFAULT_USER_AGENT,
          Referer: "https://www.tiktok.com/",
        },
      });
      if (musicBuf.byteLength > 0) {
        audio = {
          buffer: musicBuf,
          mimetype: "audio/mpeg",
        };
      }
    } catch (err: unknown) {
      logger.warn({ err }, "Gagal mengunduh audio TikWM langsung");
    }
  }

  // Deteksi jika konten adalah slide foto TikTok
  if (isSlidePost && json.data.images) {
    const totalCount = json.data.images.length;
    const targetUrls = json.data.images.slice(0, MAX_TIKTOK_SLIDES);

    const imageResults = await Promise.all(
      targetUrls.map(async (rawImgUrl, i): Promise<DownloadedMediaItem | null> => {
        const imgUrl = resolveTikWmMediaUrl(rawImgUrl);
        try {
          const maxBytes = env.MAX_DOWNLOAD_FILE_MB * BYTES_PER_MB;
          const { buffer: fetchedBuf } = await fetchBufferWithLimit(imgUrl, {
            maxBytes,
            timeoutMs: env.DOWNLOADER_TIMEOUT_MS,
            allowedDomains: TIKTOK_MEDIA_ALLOWED_DOMAINS,
            headers: {
              "User-Agent": DEFAULT_USER_AGENT,
              Referer: "https://www.tiktok.com/",
            },
          });
          if (fetchedBuf.byteLength <= 0) return null;

          let imgBuffer = fetchedBuf;
          let mime = "image/jpeg";
          let ext = ".jpg";

          try {
            const meta = await sharp(imgBuffer, {
              limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
            }).metadata();
            if (meta.format === "webp" || meta.format === "png") {
              imgBuffer = Buffer.from(
                await sharp(imgBuffer, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
                  .jpeg({ quality: 95 })
                  .toBuffer(),
              );
              mime = "image/jpeg";
              ext = ".jpg";
            }
          } catch {
            // Biarkan buffer asli jika sharp tidak mengenali
          }

          return {
            buffer: imgBuffer,
            fileName: `minjibot-tiktok-${String(i + 1)}${ext}`,
            mimetype: mime,
            mediaType: "image",
          };
        } catch (err: unknown) {
          logger.warn({ err, imgUrl }, "Gagal mengunduh slide gambar TikTok");
          return null;
        }
      }),
    );

    const items = imageResults.filter((item): item is DownloadedMediaItem => item !== null);
    if (items.length === 0) {
      throw new AppUserError("Gagal mengambil foto slide TikTok.");
    }

    return {
      type: "images",
      items,
      totalCount,
      audio,
    };
  }

  // Jika bukan slide foto, proses sebagai video
  const rawVideoUrl = json.data.play ?? json.data.hdplay ?? json.data.wmplay;
  if (!rawVideoUrl) {
    throw new Error("Link video TikTok tidak ditemukan dalam respon API.");
  }

  const videoUrl = resolveTikWmMediaUrl(rawVideoUrl);
  const maxBytes = env.MAX_DOWNLOAD_FILE_MB * BYTES_PER_MB;
  const { buffer } = await fetchBufferWithLimit(videoUrl, {
    maxBytes,
    timeoutMs: env.DOWNLOADER_TIMEOUT_MS,
    allowedDomains: TIKTOK_MEDIA_ALLOWED_DOMAINS,
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
      Referer: "https://www.tiktok.com/",
    },
  });

  return {
    type: "video",
    video: {
      buffer,
      fileName: "minjibot-tiktok.mp4",
      mimetype: "video/mp4",
    },
    audio,
  };
}

export class DownloaderService {
  /**
   * Download TikTok media — unified handler for video (max 70 min) and photo slides (max 25 items).
   * Also extracts/provides background audio (BGM) if available.
   */
  async downloadTikTok(url: string): Promise<TikTokDownloadResult> {
    return mediaQueueService.heavySubprocessQueue.run(async () => {
      const preParsed = parseSupportedUrl(url, "tiktok");
      const parsedUrl = await assertSafeExternalUrl(preParsed.toString(), {
        allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.tiktok,
      });
      const startedAt = Date.now();

      // 1. Direct TikWM API (Fast & watermark-free)
      try {
        const directResult = await downloadTikTokDirect(parsedUrl.toString());
        if (directResult.type === "video" && !directResult.audio) {
          try {
            directResult.audio = await this.extractAudioFromVideo(directResult.video.buffer);
          } catch (err: unknown) {
            logger.warn({ err }, "Extract audio dari video TikWM gagal");
          }
        }

        logger.info(
          {
            elapsedMs: Date.now() - startedAt,
            type: directResult.type,
            itemCount: directResult.type === "images" ? directResult.items.length : 1,
            hasAudio: !!directResult.audio,
            mode: "tikwm-direct",
          },
          "TikTok download selesai",
        );

        return directResult;
      } catch (error: unknown) {
        if (isPolicyLimitError(error)) {
          throw error;
        }
        logger.warn(
          { err: error },
          "TikTok direct API gagal, mencoba fallback gallery-dl / yt-dlp",
        );
      }

      // Resolve shortlink (vt.tiktok.com / vm.tiktok.com) sebelum fallback CLI
      let fallbackUrl = parsedUrl.toString();
      if (TIKTOK_SHORTLINK_HOSTS.has(parsedUrl.hostname.toLowerCase())) {
        try {
          const resolved = await resolveRedirectUrl(fallbackUrl, {
            allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.tiktok,
          });
          const verified = await assertSafeExternalUrl(resolved, {
            allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.tiktok,
          });
          fallbackUrl = verified.toString();
        } catch (err: unknown) {
          logger.warn({ err }, "Gagal resolve shortlink TikTok, lanjut memakai URL awal");
        }
      }

      // 2. Fallback using gallery-dl (supports photos & videos) and yt-dlp
      const tempDir = await createTempDir("tt-download");
      try {
        let items: DownloadedMediaItem[] = [];

        try {
          await this.runGalleryDlTikTok(fallbackUrl, tempDir);
          items = await scanDownloadedMediaFiles(tempDir, "minjibot-tiktok", {
            maxVideoDurationSec: MAX_TIKTOK_DURATION_SEC,
            durationErrorMessage: "Video TikTok melebihi batas durasi 70 menit (1 jam 10 menit).",
          });
        } catch (gdlErr: unknown) {
          if (isPolicyLimitError(gdlErr)) {
            throw gdlErr;
          }
          logger.warn({ err: gdlErr }, "gallery-dl TikTok gagal, mencoba yt-dlp");
        }

        if (items.length > 0) {
          const imageItems = items.filter((it) => it.mediaType === "image");
          if (imageItems.length > 0) {
            const targetItems = imageItems.slice(0, MAX_TIKTOK_SLIDES);
            let audio: ExtractedAudio | undefined;
            try {
              audio = await this.downloadTikTokAudioFallback(fallbackUrl);
            } catch (err: unknown) {
              logger.warn({ err }, "Fallback audio extraction untuk slide TikTok gagal");
            }

            logger.info(
              {
                elapsedMs: Date.now() - startedAt,
                type: "images",
                itemCount: targetItems.length,
                hasAudio: !!audio,
                mode: "gallery-dl",
              },
              "TikTok slide download selesai",
            );

            return {
              type: "images",
              items: targetItems,
              totalCount: imageItems.length,
              audio,
            };
          }

          const videoItem = items.find((it) => it.mediaType === "video") ?? items[0];
          if (videoItem) {
            let audio: ExtractedAudio | undefined;
            try {
              audio = await this.extractAudioFromVideo(videoItem.buffer);
            } catch (err: unknown) {
              logger.warn({ err }, "Extract audio fallback video gagal");
            }

            return {
              type: "video",
              video: {
                buffer: videoItem.buffer,
                fileName: "minjibot-tiktok.mp4",
                mimetype: "video/mp4",
              },
              audio,
            };
          }
        }

        // 3. Fallback terakhir: yt-dlp video download
        const rawOutputTemplate = path.join(tempDir, "raw.%(ext)s");
        const remuxedOutputPath = path.join(tempDir, "remuxed.mp4");
        const normalizedOutputPath = path.join(tempDir, "normalized.mp4");

        await this.runTikTokArgs(fallbackUrl, rawOutputTemplate);
        const rawVideoPath = await findFirstDownloadedFile(tempDir, "raw.");
        await assertVideoDurationAllowed(
          rawVideoPath,
          MAX_TIKTOK_DURATION_SEC,
          "Video TikTok melebihi batas durasi 70 menit (1 jam 10 menit).",
        );
        const outputPath = await prepareMobileVideo(
          rawVideoPath,
          remuxedOutputPath,
          normalizedOutputPath,
        );
        await assertFileSizeAllowed(outputPath);
        const buffer = await readFile(outputPath);

        let audio: ExtractedAudio | undefined;
        try {
          audio = await this.extractAudioFromVideo(buffer);
        } catch (err: unknown) {
          logger.warn({ err }, "Extract audio fallback yt-dlp gagal");
        }

        logger.info(
          {
            elapsedMs: Date.now() - startedAt,
            type: "video",
            sizeBytes: buffer.byteLength,
            hasAudio: !!audio,
            mode: "yt-dlp",
          },
          "TikTok download selesai",
        );

        return {
          type: "video",
          video: {
            buffer,
            fileName: "minjibot-tiktok.mp4",
            mimetype: "video/mp4",
          },
          audio,
        };
      } finally {
        await removeTempDir(tempDir);
      }
    });
  }

  /**
   * Download TikTok video (backward-compatible method).
   */
  async downloadVideo(url: string, kind: DownloaderKind): Promise<DownloadedVideo> {
    if (kind === "tiktok") {
      const result = await this.downloadTikTok(url);
      if (result.type === "video") {
        return result.video;
      }
      throw new AppUserError(
        "Link TikTok merupakan slide foto. Gunakan command .tt untuk mengunduh foto slide.",
      );
    }

    throw new Error(`downloadVideo tidak mendukung kind: ${kind}`);
  }

  /**
   * Download Instagram content — unified handler for reel, photo, story, carousel.
   * Max 15 items, max video duration 30 minutes (1800s).
   */
  async downloadInstagram(url: string): Promise<DownloadResult> {
    return mediaQueueService.heavySubprocessQueue.run(async () => {
      const preParsed = parseSupportedUrl(url, "instagram");
      let parsedUrl = await assertSafeExternalUrl(preParsed.toString(), {
        allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.instagram,
      });

      // Resolve shortlink instagr.am atau link share baru (/share/reel/..., /share/p/...)
      const lowerPathInitial = parsedUrl.pathname.toLowerCase();
      if (
        parsedUrl.hostname.toLowerCase() === "instagr.am" ||
        lowerPathInitial.startsWith("/share/")
      ) {
        try {
          const resolved = await resolveRedirectUrl(parsedUrl.toString(), {
            allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.instagram,
          });
          parsedUrl = await assertSafeExternalUrl(resolved, {
            allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.instagram,
          });
        } catch (err: unknown) {
          logger.warn({ err }, "Gagal resolve shortlink Instagram, lanjut memakai URL awal");
        }
      }

      const targetUrl = parsedUrl.toString();
      const startedAt = Date.now();
      const tempDir = await createTempDir("ig-download");
      const scanOptions: ScanMediaOptions = {
        maxVideoDurationSec: MAX_INSTAGRAM_DURATION_SEC,
        durationErrorMessage: "Video Instagram melebihi batas durasi 30 menit.",
      };

      try {
        let items: DownloadedMediaItem[] = [];
        const lowerPath = parsedUrl.pathname.toLowerCase();
        const preferYtDlp =
          lowerPath.includes("/reel/") ||
          lowerPath.includes("/reels/") ||
          lowerPath.includes("/tv/") ||
          lowerPath.includes("/stories/");

        if (preferYtDlp) {
          // Reels & Stories diproses via yt-dlp terlebih dahulu
          try {
            await this.runYtDlpInstagram(targetUrl, tempDir);
            items = await scanDownloadedMediaFiles(tempDir, "minjibot-ig", scanOptions);
          } catch (ytErr: unknown) {
            if (isPolicyLimitError(ytErr)) {
              throw ytErr;
            }
            logger.warn(
              { err: ytErr, url: targetUrl },
              "yt-dlp gagal download IG video/story, mencoba fallback gallery-dl",
            );
            await this.runGalleryDl(targetUrl, tempDir);
            items = await scanDownloadedMediaFiles(tempDir, "minjibot-ig", scanOptions);
          }
        } else {
          // Foto tunggal, carousel slide, atau post foto/video (/p/):
          // Gunakan gallery-dl terlebih dahulu karena yt-dlp tidak men-download foto
          try {
            await this.runGalleryDl(targetUrl, tempDir);
            items = await scanDownloadedMediaFiles(tempDir, "minjibot-ig", scanOptions);
          } catch (gdlErr: unknown) {
            if (isPolicyLimitError(gdlErr)) {
              throw gdlErr;
            }
            logger.warn(
              { err: gdlErr, url: targetUrl },
              "gallery-dl gagal, mencoba fallback yt-dlp",
            );
          }

          if (items.length === 0) {
            try {
              await this.runYtDlpInstagram(targetUrl, tempDir);
              items = await scanDownloadedMediaFiles(tempDir, "minjibot-ig", scanOptions);
            } catch (ytErr: unknown) {
              if (isPolicyLimitError(ytErr)) {
                throw ytErr;
              }
              logger.warn({ err: ytErr, url: targetUrl }, "yt-dlp fallback IG juga gagal");
            }
          }
        }

        if (items.length === 0) {
          throw new AppUserError("Tidak ada media yang berhasil diunduh.");
        }

        logger.info(
          { elapsedMs: Date.now() - startedAt, itemCount: items.length },
          "Instagram download selesai",
        );

        if (items.length === 1) {
          const first = items[0];
          if (!first) {
            throw new AppUserError("Tidak ada media yang berhasil diunduh.");
          }
          return { type: "single", item: first };
        }

        const targetItems = items.slice(0, MAX_INSTAGRAM_SLIDES);
        return { type: "multi", items: targetItems, totalCount: items.length };
      } finally {
        await removeTempDir(tempDir);
      }
    });
  }

  /**
   * Download YouTube video — max 720p, max 1 hour (3600 seconds).
   */
  async downloadYoutube(url: string): Promise<DownloadedMediaItem> {
    return mediaQueueService.heavySubprocessQueue.run(async () => {
      const preParsed = parseSupportedUrl(url, "youtube");
      const parsedUrl = await assertSafeExternalUrl(preParsed.toString(), {
        allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.youtube,
      });
      const targetUrl = parsedUrl.toString();
      const startedAt = Date.now();
      const tempDir = await createTempDir("yt-video");
      const rawOutputTemplate = path.join(tempDir, "raw.%(ext)s");
      const remuxedOutputPath = path.join(tempDir, "remuxed.mp4");
      const normalizedOutputPath = path.join(tempDir, "normalized.mp4");

      try {
        const args = [
          "--no-warnings",
          "--no-playlist",
          "--ies",
          "youtube,youtube:clip",
          "--max-filesize",
          `${String(env.MAX_DOWNLOAD_FILE_MB)}M`,
          "--match-filter",
          "duration <=? 3600 & !is_live",
          "-f",
          YT_VIDEO_FORMAT_SMART,
          "--merge-output-format",
          "mp4",
          "--remux-video",
          "mp4",
          "--concurrent-fragments",
          "4",
          "--add-header",
          `User-Agent:${DEFAULT_USER_AGENT}`,
          "-o",
          rawOutputTemplate,
        ];

        const cookiesPath = env.YOUTUBE_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;
        if (cookiesPath && existsSync(cookiesPath)) {
          args.push("--cookies", cookiesPath);
        }

        args.push("--", targetUrl);
        await runProcess(env.DOWNLOADER_BIN, args, env.DOWNLOADER_TIMEOUT_MS);

        const rawVideoPath = await findFirstDownloadedFile(tempDir, "raw.");
        await assertVideoDurationAllowed(
          rawVideoPath,
          MAX_YOUTUBE_DURATION_SEC,
          "Video YouTube melebihi batas durasi 1 jam.",
        );
        const outputPath = await prepareMobileVideo(
          rawVideoPath,
          remuxedOutputPath,
          normalizedOutputPath,
        );
        await assertFileSizeAllowed(outputPath);
        const buffer = await readFile(outputPath);

        logger.info(
          { elapsedMs: Date.now() - startedAt, sizeBytes: buffer.byteLength },
          "YouTube video download selesai",
        );

        return {
          buffer,
          fileName: "minjibot-yt.mp4",
          mimetype: "video/mp4",
          mediaType: "video",
        };
      } finally {
        await removeTempDir(tempDir);
      }
    });
  }

  /**
   * Download Twitter / X media — supports single/multi photos, single/multi videos,
   * and mixed-media posts (up to 10 items, max video duration 30 minutes / 1800s).
   */
  async downloadTwitter(url: string): Promise<DownloadResult> {
    return mediaQueueService.heavySubprocessQueue.run(async () => {
      const preParsed = parseSupportedUrl(url, "twitter");
      let parsedUrl = await assertSafeExternalUrl(preParsed.toString(), {
        allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.twitter,
      });

      // Jika shortlink t.co, resolve redirect dan pastikan tujuannya benar-benar domain X/Twitter
      if (parsedUrl.hostname.toLowerCase() === "t.co") {
        const resolved = await resolveRedirectUrl(parsedUrl.toString(), {
          allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.twitter,
        });
        const verifiedTwitter = isAllowedDomainUrl(resolved, TWITTER_CANONICAL_DOMAINS);
        if (!verifiedTwitter) {
          throw new AppUserError("Command .x hanya menerima link resmi X (Twitter).");
        }
        parsedUrl = await assertSafeExternalUrl(verifiedTwitter.toString(), {
          allowedDomains: TWITTER_CANONICAL_DOMAINS,
        });
      }

      // Normalisasi domain embed alternatif (fxtwitter/vxtwitter/fixupx) ke x.com untuk CLI
      const lowerHost = parsedUrl.hostname.toLowerCase();
      if (
        lowerHost.endsWith("fxtwitter.com") ||
        lowerHost.endsWith("vxtwitter.com") ||
        lowerHost.endsWith("fixupx.com")
      ) {
        parsedUrl.hostname = "x.com";
      }

      const targetUrl = parsedUrl.toString();
      const startedAt = Date.now();
      const tempDir = await createTempDir("x-download");
      const scanOptions: ScanMediaOptions = {
        maxVideoDurationSec: MAX_TWITTER_DURATION_SEC,
        durationErrorMessage: "Video X (Twitter) melebihi batas durasi 30 menit.",
      };

      try {
        let items: DownloadedMediaItem[] = [];
        const cookiesPath = env.TWITTER_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;

        // 1. Primary: gallery-dl (extracts ALL photos in full resolution and videos in highest bitrate)
        try {
          const args = ["--range", `1-${String(MAX_TWITTER_ITEMS)}`, "--no-mtime", "-D", tempDir];
          if (cookiesPath && existsSync(cookiesPath)) {
            args.push("--cookies", cookiesPath);
          }
          args.push("--", targetUrl);

          await runProcess(env.GALLERY_DL_BIN, args, env.DOWNLOADER_TIMEOUT_MS);
          items = await scanDownloadedMediaFiles(tempDir, "minjibot-x", scanOptions);
        } catch (gdlErr: unknown) {
          if (isPolicyLimitError(gdlErr)) {
            throw gdlErr;
          }
          logger.warn(
            { err: gdlErr, url: targetUrl },
            "gallery-dl Twitter gagal, mencoba fallback yt-dlp",
          );
        }

        // 2. Fallback: yt-dlp with --yes-playlist if gallery-dl produced no media
        if (items.length === 0) {
          try {
            const rawOutputTemplate = path.join(tempDir, "item-%(playlist_index)s.%(ext)s");
            const args = [
              "--no-warnings",
              "--yes-playlist",
              "--playlist-items",
              `1-${String(MAX_TWITTER_ITEMS)}`,
              "--ies",
              "twitter,twitter:amplify,twitter:card",
              "--max-filesize",
              `${String(env.MAX_DOWNLOAD_FILE_MB)}M`,
              "--match-filter",
              "duration <=? 1800 & !is_live",
              "-f",
              MOBILE_SAFE_FORMAT,
              "--merge-output-format",
              "mp4",
              "--remux-video",
              "mp4",
              "--concurrent-fragments",
              "4",
              "--add-header",
              `User-Agent:${DEFAULT_USER_AGENT}`,
              "-o",
              rawOutputTemplate,
            ];

            if (cookiesPath && existsSync(cookiesPath)) {
              args.push("--cookies", cookiesPath);
            }

            args.push("--", targetUrl);
            await runProcess(env.DOWNLOADER_BIN, args, env.DOWNLOADER_TIMEOUT_MS);
            items = await scanDownloadedMediaFiles(tempDir, "minjibot-x", scanOptions);
          } catch (ytErr: unknown) {
            if (isPolicyLimitError(ytErr)) {
              throw ytErr;
            }
            logger.warn(
              { err: ytErr, url: targetUrl },
              "yt-dlp Twitter fallback gagal, mencoba FxTwitter API",
            );
          }
        }

        // 3. Fallback terakhir: FxTwitter API (menangani postingan sensitif / age-gated tanpa cookies)
        if (items.length === 0) {
          try {
            items = await downloadTwitterFxFallback(parsedUrl, tempDir);
          } catch (fxErr: unknown) {
            if (isPolicyLimitError(fxErr)) {
              throw fxErr;
            }
            logger.warn({ err: fxErr, url: targetUrl }, "FxTwitter API fallback juga gagal");
          }
        }

        if (items.length === 0) {
          throw new AppUserError("Media X (Twitter) tidak ditemukan atau gagal diunduh.");
        }

        logger.info(
          { elapsedMs: Date.now() - startedAt, itemCount: items.length },
          "Twitter / X download selesai",
        );

        if (items.length === 1) {
          const first = items[0];
          if (!first) {
            throw new AppUserError("Media X (Twitter) tidak ditemukan.");
          }
          return { type: "single", item: first };
        }

        const targetItems = items.slice(0, MAX_TWITTER_ITEMS);
        return { type: "multi", items: targetItems, totalCount: items.length };
      } finally {
        await removeTempDir(tempDir);
      }
    });
  }

  /**
   * Download Pinterest photo or video — original resolution HD.
   * Supports pin.it shortlinks and regional pinterest.* domains.
   */
  async downloadPinterest(url: string): Promise<DownloadedMediaItem> {
    return mediaQueueService.heavySubprocessQueue.run(async () => {
      const initialParsed = parseSupportedUrl(url.trim(), "pinterest");
      let targetUrlStr = initialParsed.toString();

      if (initialParsed.hostname.toLowerCase() === "pin.it") {
        try {
          targetUrlStr = await resolveRedirectUrl(targetUrlStr, {
            allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.pinterest,
          });
        } catch (err: unknown) {
          logger.warn({ err }, "Gagal resolve shortlink pin.it, lanjut dengan URL asli");
        }
      }

      const preParsed = parseSupportedUrl(targetUrlStr, "pinterest");
      const parsedUrl = await assertSafeExternalUrl(preParsed.toString(), {
        allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.pinterest,
      });
      const canonicalUrl = parsedUrl.toString();
      const startedAt = Date.now();
      const tempDir = await createTempDir("pin-download");

      try {
        let items: DownloadedMediaItem[] = [];

        // 1. Coba gallery-dl terlebih dahulu (terbaik untuk resolusi asli foto & video Pinterest)
        try {
          const args = ["--no-mtime", "-D", tempDir, "--", canonicalUrl];
          await runProcess(env.GALLERY_DL_BIN, args, env.DOWNLOADER_TIMEOUT_MS);
          items = await scanDownloadedMediaFiles(tempDir, "minjibot-pinterest");
        } catch (gdlErr: unknown) {
          if (isPolicyLimitError(gdlErr)) {
            throw gdlErr;
          }
          logger.warn(
            { err: gdlErr, url: canonicalUrl },
            "gallery-dl Pinterest gagal, mencoba yt-dlp",
          );
        }

        // 2. Jika gallery-dl tidak menghasilkan file (misal pin video), coba yt-dlp
        if (items.length === 0) {
          try {
            const rawOutputTemplate = path.join(tempDir, "raw.%(ext)s");
            const remuxedOutputPath = path.join(tempDir, "remuxed.mp4");
            const normalizedOutputPath = path.join(tempDir, "normalized.mp4");

            const args = [
              "--no-warnings",
              "--no-playlist",
              "--ies",
              "pinterest,pinterestcollection",
              "--max-filesize",
              `${String(env.MAX_DOWNLOAD_FILE_MB)}M`,
              "-f",
              MOBILE_SAFE_FORMAT,
              "--merge-output-format",
              "mp4",
              "--remux-video",
              "mp4",
              "--add-header",
              `User-Agent:${DEFAULT_USER_AGENT}`,
              "-o",
              rawOutputTemplate,
              "--",
              canonicalUrl,
            ];

            await runProcess(env.DOWNLOADER_BIN, args, env.DOWNLOADER_TIMEOUT_MS);
            const rawVideoPath = await findFirstDownloadedFile(tempDir, "raw.");
            const outputPath = await prepareMobileVideo(
              rawVideoPath,
              remuxedOutputPath,
              normalizedOutputPath,
            );
            await assertFileSizeAllowed(outputPath);
            const buffer = await readFile(outputPath);
            items.push({
              buffer,
              fileName: "minjibot-pinterest.mp4",
              mimetype: "video/mp4",
              mediaType: "video",
            });
          } catch (ytErr: unknown) {
            if (isPolicyLimitError(ytErr)) {
              throw ytErr;
            }
            logger.warn({ err: ytErr, url: canonicalUrl }, "yt-dlp Pinterest juga gagal");
          }
        }

        const chosenItem = items[0];
        if (!chosenItem) {
          throw new AppUserError("Media Pinterest tidak ditemukan atau gagal diunduh.");
        }
        logger.info(
          { elapsedMs: Date.now() - startedAt, mediaType: chosenItem.mediaType },
          "Pinterest download selesai",
        );

        return chosenItem;
      } finally {
        await removeTempDir(tempDir);
      }
    });
  }

  private async runTikTokArgs(url: string, outputTemplate: string): Promise<void> {
    const args = [
      "--no-playlist",
      "--no-warnings",
      "--ies",
      "tiktok,vm.tiktok",
      "--max-filesize",
      `${String(env.MAX_DOWNLOAD_FILE_MB)}M`,
      "--match-filter",
      "duration <=? 4200 & !is_live",
      "-f",
      MOBILE_SAFE_FORMAT,
      "--merge-output-format",
      "mp4",
      "--remux-video",
      "mp4",
      "--concurrent-fragments",
      "4",
      "--add-header",
      `User-Agent:${DEFAULT_USER_AGENT}`,
      "-o",
      outputTemplate,
    ];

    const cookiesPath = env.TIKTOK_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;
    if (cookiesPath && existsSync(cookiesPath)) {
      args.push("--cookies", cookiesPath);
    }

    args.push("--", url);
    await runProcess(env.DOWNLOADER_BIN, args, env.DOWNLOADER_TIMEOUT_MS);
  }

  /**
   * Extract audio track from a video buffer using ffmpeg.
   * Returns MP3 audio — same format as .play command.
   */
  async extractAudioFromVideo(videoBuffer: Buffer): Promise<ExtractedAudio> {
    const tempDir = await createTempDir("tt-audio");
    const inputPath = path.join(tempDir, "input.mp4");
    const outputPath = path.join(tempDir, "audio.mp3");

    try {
      await writeFile(inputPath, videoBuffer);

      const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";
      await runFfmpegAudio(inputPath, outputPath, ffmpegPath, env.DOWNLOADER_TIMEOUT_MS);

      const buffer = await readFile(outputPath);
      return { buffer, mimetype: "audio/mpeg" };
    } finally {
      await removeTempDir(tempDir);
    }
  }

  private async runYtDlpInstagram(url: string, tempDir: string): Promise<void> {
    const args = [
      "--no-warnings",
      "--no-playlist",
      "--ies",
      "instagram,instagram:story",
      "--max-filesize",
      `${String(env.MAX_DOWNLOAD_FILE_MB)}M`,
      "--match-filter",
      "duration <=? 1800 & !is_live",
      "--playlist-items",
      `1-${String(MAX_INSTAGRAM_SLIDES)}`,
      "--merge-output-format",
      "mp4",
      "--remux-video",
      "mp4",
      "--concurrent-fragments",
      "4",
      "--add-header",
      `User-Agent:${DEFAULT_USER_AGENT}`,
      "-f",
      MOBILE_SAFE_FORMAT,
      "-o",
      path.join(tempDir, "item-%(playlist_index)s.%(ext)s"),
    ];

    const cookiesPath = env.INSTAGRAM_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;
    if (cookiesPath && existsSync(cookiesPath)) {
      args.push("--cookies", cookiesPath);
    }

    args.push("--", url);
    await runProcess(env.DOWNLOADER_BIN, args, env.DOWNLOADER_TIMEOUT_MS);
  }

  private async runGalleryDl(url: string, tempDir: string): Promise<void> {
    const args: string[] = [
      "--range",
      `1-${String(MAX_INSTAGRAM_SLIDES)}`,
      "--no-mtime",
      "-D",
      tempDir,
    ];

    const cookiesPath = env.INSTAGRAM_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;
    if (cookiesPath && existsSync(cookiesPath)) {
      args.push("--cookies", cookiesPath);
    }

    args.push("--", url);
    await runProcess(env.GALLERY_DL_BIN, args, env.DOWNLOADER_TIMEOUT_MS);
  }

  private async runGalleryDlTikTok(url: string, tempDir: string): Promise<void> {
    const args: string[] = [
      "--range",
      `1-${String(MAX_TIKTOK_SLIDES)}`,
      "--no-mtime",
      "-D",
      tempDir,
    ];

    const cookiesPath = env.TIKTOK_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;
    if (cookiesPath && existsSync(cookiesPath)) {
      args.push("--cookies", cookiesPath);
    }

    args.push("--", url);
    await runProcess(env.GALLERY_DL_BIN, args, env.DOWNLOADER_TIMEOUT_MS);
  }

  private async downloadTikTokAudioFallback(url: string): Promise<ExtractedAudio> {
    const tempDir = await createTempDir("tt-audio-fb");
    const outputPath = path.join(tempDir, "audio.mp3");

    try {
      const args = [
        "--no-warnings",
        "--no-playlist",
        "--ies",
        "tiktok,vm.tiktok",
        "-x",
        "--audio-format",
        "mp3",
        "-o",
        outputPath,
      ];

      const cookiesPath = env.TIKTOK_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;
      if (cookiesPath && existsSync(cookiesPath)) {
        args.push("--cookies", cookiesPath);
      }

      args.push("--", url);
      await runProcess(env.DOWNLOADER_BIN, args, env.DOWNLOADER_TIMEOUT_MS);

      const buffer = await readFile(outputPath);
      return {
        buffer,
        mimetype: "audio/mpeg",
      };
    } finally {
      await removeTempDir(tempDir);
    }
  }
}

async function downloadTwitterFxFallback(
  tweetUrl: URL,
  tempDir: string,
): Promise<DownloadedMediaItem[]> {
  const match = /\/status\/(\d+)/i.exec(tweetUrl.pathname);
  const tweetId = match?.[1];
  if (!tweetId) {
    return [];
  }

  const apiUrl = `https://api.fxtwitter.com/i/status/${tweetId}`;
  const response = await safeFetchExternal(apiUrl, {
    allowedDomains: ["fxtwitter.com"],
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(env.DOWNLOADER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`FxTwitter API status ${String(response.status)}`);
  }

  const json = (await response.json()) as FxTwitterResponse;
  const mediaList = json.tweet?.media?.all;
  if (!Array.isArray(mediaList) || mediaList.length === 0) {
    return [];
  }

  const targetEntries = mediaList.slice(0, MAX_TWITTER_ITEMS);
  const maxBytes = env.MAX_DOWNLOAD_FILE_MB * BYTES_PER_MB;
  const items: DownloadedMediaItem[] = [];

  for (let i = 0; i < targetEntries.length; i += 1) {
    const entry = targetEntries[i];
    if (!entry?.url) continue;

    const isVideo = entry.type === "video" || entry.type === "gif";
    if (
      isVideo &&
      typeof entry.duration === "number" &&
      entry.duration > MAX_TWITTER_DURATION_SEC
    ) {
      throw new AppUserError("Video X (Twitter) melebihi batas durasi 30 menit.");
    }

    const { buffer: rawBuf } = await fetchBufferWithLimit(entry.url, {
      maxBytes,
      timeoutMs: env.DOWNLOADER_TIMEOUT_MS,
      allowedDomains: TWITTER_MEDIA_ALLOWED_DOMAINS,
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
      },
    });
    if (rawBuf.byteLength <= 0) continue;

    if (isVideo) {
      const rawPath = path.join(tempDir, `fx-${String(i + 1)}.mp4`);
      const remuxedPath = path.join(tempDir, `fx-${String(i + 1)}.remuxed.mp4`);
      const normalizedPath = path.join(tempDir, `fx-${String(i + 1)}.normalized.mp4`);
      await writeFile(rawPath, rawBuf);
      await assertVideoDurationAllowed(
        rawPath,
        MAX_TWITTER_DURATION_SEC,
        "Video X (Twitter) melebihi batas durasi 30 menit.",
      );
      const finalPath = await prepareMobileVideo(rawPath, remuxedPath, normalizedPath);
      await assertFileSizeAllowed(finalPath);
      items.push({
        buffer: await readFile(finalPath),
        fileName: `minjibot-x-${String(i + 1)}.mp4`,
        mimetype: "video/mp4",
        mediaType: "video",
      });
    } else {
      let imgBuffer = rawBuf;
      let mime = "image/jpeg";
      let ext = ".jpg";
      try {
        const meta = await sharp(imgBuffer, {
          limitInputPixels: MAX_SAFE_IMAGE_PIXELS,
        }).metadata();
        if (meta.format === "webp") {
          imgBuffer = Buffer.from(
            await sharp(imgBuffer, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
              .jpeg({ quality: 95 })
              .toBuffer(),
          );
        } else if (meta.format === "png") {
          mime = "image/png";
          ext = ".png";
        }
      } catch {
        // Biarkan buffer asli apabila metadata tidak dikenali
      }
      items.push({
        buffer: imgBuffer,
        fileName: `minjibot-x-${String(i + 1)}${ext}`,
        mimetype: mime,
        mediaType: "image",
      });
    }
  }

  return items;
}

interface ScanMediaOptions {
  maxVideoDurationSec?: number;
  durationErrorMessage?: string;
}

async function scanDownloadedMediaFiles(
  tempDir: string,
  defaultName = "minjibot-media",
  options?: ScanMediaOptions,
): Promise<DownloadedMediaItem[]> {
  const filePaths = await findMediaFilesRecursive(tempDir);
  const items: DownloadedMediaItem[] = [];

  for (const filePath of filePaths) {
    await assertFileSizeAllowed(filePath);
    const ext = path.extname(filePath).toLowerCase();

    if (VIDEO_EXTS.has(ext)) {
      if (options?.maxVideoDurationSec && options.durationErrorMessage) {
        await assertVideoDurationAllowed(
          filePath,
          options.maxVideoDurationSec,
          options.durationErrorMessage,
        );
      }

      const parentDir = path.dirname(filePath);
      const baseName = path.basename(filePath, ext);
      const remuxedPath = path.join(parentDir, `${baseName}.remuxed.mp4`);
      const normalizedPath = path.join(parentDir, `${baseName}.normalized.mp4`);
      const finalPath = await prepareMobileVideo(filePath, remuxedPath, normalizedPath);
      await assertFileSizeAllowed(finalPath);
      items.push({
        buffer: await readFile(finalPath),
        mediaType: "video",
        mimetype: "video/mp4",
        fileName: `${defaultName}.mp4`,
      });
    } else if (IMAGE_EXTS.has(ext)) {
      let imgBuffer = await readFile(filePath);
      let mime = "image/jpeg";
      let outExt = ".jpg";

      if (ext === ".webp") {
        imgBuffer = Buffer.from(
          await sharp(imgBuffer, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS })
            .jpeg({ quality: 95 })
            .toBuffer(),
        );
      } else if (ext === ".png") {
        mime = "image/png";
        outExt = ".png";
      }

      items.push({
        buffer: imgBuffer,
        mediaType: "image",
        mimetype: mime,
        fileName: `${defaultName}${outExt}`,
      });
    }
  }
  return items;
}

async function findMediaFilesRecursive(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findMediaFilesRecursive(fullPath)));
    } else if (
      entry.isFile() &&
      !entry.name.endsWith(".part") &&
      !entry.name.endsWith(".ytdl") &&
      !entry.name.endsWith(".json") &&
      !entry.name.includes(".remuxed") &&
      !entry.name.includes(".normalized")
    ) {
      results.push(fullPath);
    }
  }

  return results.sort();
}

async function findFirstDownloadedFile(tempDir: string, prefix: string): Promise<string> {
  const entries = await readdir(tempDir);
  const downloadedFile = entries.find(
    (entry) =>
      entry.startsWith(prefix) &&
      !entry.endsWith(".part") &&
      !entry.endsWith(".ytdl") &&
      !entry.endsWith(".json"),
  );

  if (!downloadedFile) {
    throw new Error("File hasil download tidak ditemukan.");
  }

  return path.join(tempDir, downloadedFile);
}

async function prepareMobileVideo(
  rawVideoPath: string,
  remuxedOutputPath: string,
  normalizedOutputPath: string,
): Promise<string> {
  if (path.extname(rawVideoPath).toLowerCase() === ".mp4") {
    const isH264 = await videoNormalizeService.isH264Video(rawVideoPath);
    if (isH264) {
      return rawVideoPath;
    }
  }

  try {
    await videoNormalizeService.remuxForWhatsApp(rawVideoPath, remuxedOutputPath);
    return remuxedOutputPath;
  } catch (error: unknown) {
    logger.warn({ err: error }, "Remux video gagal, memakai normalisasi penuh");
    await videoNormalizeService.normalizeForWhatsApp(rawVideoPath, normalizedOutputPath);
    return normalizedOutputPath;
  }
}

function parseSupportedUrl(url: string, kind: DownloaderKind): URL {
  const parsedUrl = parseAllowedDownloaderUrl(url, kind);
  if (!parsedUrl) {
    if (kind === "tiktok") {
      throw new AppUserError("Command .tt hanya menerima link resmi TikTok.");
    }
    if (kind === "instagram") {
      throw new AppUserError("Command .ig hanya menerima link resmi Instagram.");
    }
    if (kind === "youtube") {
      throw new AppUserError("Command .yt hanya menerima link resmi YouTube.");
    }
    if (kind === "twitter") {
      throw new AppUserError("Command .x hanya menerima link resmi X (Twitter).");
    }
    throw new AppUserError("Command .pin hanya menerima link resmi Pinterest.");
  }

  return parsedUrl;
}

async function assertFileSizeAllowed(filePath: string): Promise<void> {
  const fileStat = await stat(filePath);
  const maxBytes = env.MAX_DOWNLOAD_FILE_MB * BYTES_PER_MB;

  if (fileStat.size > maxBytes) {
    throw new AppUserError(`Ukuran file maksimal ${String(env.MAX_DOWNLOAD_FILE_MB)} MB.`);
  }
}

async function assertVideoDurationAllowed(
  filePath: string,
  maxDurationSec: number,
  errorMessage: string,
): Promise<void> {
  const durationSec = await videoNormalizeService.getVideoDurationSeconds(filePath);
  if (durationSec !== null && durationSec > maxDurationSec) {
    throw new AppUserError(errorMessage);
  }
}

async function runProcess(command: string, args: string[], timeoutMs: number): Promise<void> {
  try {
    await runExternalProcess(command, args, {
      timeoutMs,
      extraPathDirs: ["/usr/local/bin", "/usr/bin"],
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("melewati batas waktu")) {
      throw new AppUserError("Downloader melewati batas waktu.");
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Downloader gagal: ${msg}`);
  }
}

async function runFfmpegAudio(
  inputPath: string,
  outputPath: string,
  ffmpegPath: string,
  timeoutMs: number,
): Promise<void> {
  try {
    await runExternalProcess(
      ffmpegPath,
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        inputPath,
        "-vn",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        outputPath,
      ],
      { timeoutMs },
    );
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("melewati batas waktu")) {
      throw new Error("Extract audio melewati batas waktu.");
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Extract audio gagal: ${msg}`);
  }
}

export const downloaderService = new DownloaderService();
