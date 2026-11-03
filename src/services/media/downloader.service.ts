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
  parseAllowedDownloaderUrl,
  resolveRedirectUrl,
  safeFetchExternal,
} from "../../utils/urlValidator";
import { videoNormalizeService } from "./videoNormalize.service";

const BYTES_PER_MB = 1024 * 1024;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
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

  // Unduh audio / musik latar jika tersedia di respon API
  let audio: ExtractedAudio | undefined;
  const musicUrl = json.data.music ?? json.data.music_info?.play;
  if (musicUrl) {
    try {
      const maxBytes = env.MAX_DOWNLOAD_FILE_MB * BYTES_PER_MB;
      const { buffer: musicBuf } = await fetchBufferWithLimit(musicUrl, {
        maxBytes,
        timeoutMs: env.DOWNLOADER_TIMEOUT_MS,
        allowedDomains: ["tikwm.com"],
        headers: {
          "User-Agent": DEFAULT_USER_AGENT,
          Referer: "https://www.tikwm.com/",
        },
      });
      if (musicBuf.byteLength > 0) {
        audio = {
          buffer: musicBuf,
          mimetype: "audio/mpeg",
        };
      }
    } catch (err) {
      logger.warn({ err }, "Gagal mengunduh audio TikWM langsung");
    }
  }

  // Deteksi jika konten adalah slide foto TikTok
  if (Array.isArray(json.data.images) && json.data.images.length > 0) {
    const totalCount = json.data.images.length;
    const targetUrls = json.data.images.slice(0, 25);

    const imageResults = await Promise.all(
      targetUrls.map(async (imgUrl, i): Promise<DownloadedMediaItem | null> => {
        try {
          const maxBytes = env.MAX_DOWNLOAD_FILE_MB * BYTES_PER_MB;
          const { buffer: fetchedBuf } = await fetchBufferWithLimit(imgUrl, {
            maxBytes,
            timeoutMs: env.DOWNLOADER_TIMEOUT_MS,
            allowedDomains: ["tikwm.com"],
            headers: {
              "User-Agent": DEFAULT_USER_AGENT,
              Referer: "https://www.tikwm.com/",
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
        } catch (err) {
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
  const videoUrl = json.data.play ?? json.data.hdplay ?? json.data.wmplay;
  if (!videoUrl) {
    throw new Error("Link video TikTok tidak ditemukan dalam respon API.");
  }

  const maxBytes = env.MAX_DOWNLOAD_FILE_MB * BYTES_PER_MB;
  const { buffer } = await fetchBufferWithLimit(videoUrl, {
    maxBytes,
    timeoutMs: env.DOWNLOADER_TIMEOUT_MS,
    allowedDomains: ["tikwm.com"],
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
      Referer: "https://www.tikwm.com/",
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
   * Download TikTok media — unified handler for video and photo slides carousel (up to 12 items).
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
          } catch (err) {
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
        logger.warn({ error }, "TikTok direct API gagal, mencoba fallback gallery-dl / yt-dlp");
      }

      // 2. Fallback using gallery-dl (supports photos & videos) and yt-dlp
      const tempDir = await createTempDir("tt-download");
      try {
        let items: DownloadedMediaItem[] = [];

        try {
          await this.runGalleryDlTikTok(parsedUrl.toString(), tempDir);
          items = await scanDownloadedMediaFiles(tempDir, "minjibot-tiktok");
        } catch (gdlErr) {
          logger.warn({ gdlErr }, "gallery-dl TikTok gagal, mencoba yt-dlp");
        }

        if (items.length > 0) {
          const imageItems = items.filter((it) => it.mediaType === "image");
          if (imageItems.length > 0) {
            const targetItems = imageItems.slice(0, 25);
            let audio: ExtractedAudio | undefined;
            try {
              audio = await this.downloadTikTokAudioFallback(parsedUrl.toString());
            } catch (err) {
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
            } catch (err) {
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

        await this.runTikTokArgs(parsedUrl.toString(), rawOutputTemplate);
        const rawVideoPath = await findFirstDownloadedFile(tempDir, "raw.");
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
        } catch (err) {
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
   * Returns single item or multi items (carousel up to 10).
   */
  async downloadInstagram(url: string): Promise<DownloadResult> {
    return mediaQueueService.heavySubprocessQueue.run(async () => {
      const preParsed = parseSupportedUrl(url, "instagram");
      const parsedUrl = await assertSafeExternalUrl(preParsed.toString(), {
        allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.instagram,
      });
      const targetUrl = parsedUrl.toString();
      const startedAt = Date.now();
      const tempDir = await createTempDir("ig-download");

      try {
        let items: DownloadedMediaItem[] = [];
        const isReel = parsedUrl.pathname.toLowerCase().includes("/reel/");

        if (isReel) {
          // Reels diproses via yt-dlp terlebih dahulu
          try {
            await this.runYtDlpInstagram(targetUrl, tempDir);
            items = await scanDownloadedMediaFiles(tempDir, "minjibot-ig");
          } catch (ytErr) {
            logger.warn(
              { ytErr, url: targetUrl },
              "yt-dlp gagal download reel, mencoba fallback gallery-dl",
            );
            await this.runGalleryDl(targetUrl, tempDir);
            items = await scanDownloadedMediaFiles(tempDir, "minjibot-ig");
          }
        } else {
          // Foto tunggal, carousel slide, atau post foto/video:
          // Gunakan gallery-dl terlebih dahulu karena yt-dlp tidak men-download foto
          try {
            await this.runGalleryDl(targetUrl, tempDir);
            items = await scanDownloadedMediaFiles(tempDir, "minjibot-ig");
          } catch (gdlErr) {
            logger.warn({ gdlErr, url: targetUrl }, "gallery-dl gagal, mencoba fallback yt-dlp");
          }

          // Jika gallery-dl tidak menghasilkan media (misal video post), coba yt-dlp
          if (items.length === 0) {
            try {
              await this.runYtDlpInstagram(targetUrl, tempDir);
              items = await scanDownloadedMediaFiles(tempDir, "minjibot-ig");
            } catch (ytErr) {
              logger.warn({ ytErr, url: targetUrl }, "yt-dlp fallback juga gagal");
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

        return items.length === 1
          ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            { type: "single", item: items[0]! }
          : { type: "multi", items, totalCount: items.length };
      } finally {
        await removeTempDir(tempDir);
      }
    });
  }

  /**
   * Download YouTube video — max 720p, max 12 minutes (720 seconds).
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
          "youtube",
          "--max-filesize",
          `${String(env.MAX_DOWNLOAD_FILE_MB)}M`,
          "--match-filter",
          "duration <= 3600",
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
   * Download Twitter / X media — supports single/multi photos (1-4), single/multi videos (1-4),
   * and mixed-media posts (photos + videos). Returns DownloadResult.
   */
  async downloadTwitter(url: string): Promise<DownloadResult> {
    return mediaQueueService.heavySubprocessQueue.run(async () => {
      const preParsed = parseSupportedUrl(url, "twitter");
      const parsedUrl = await assertSafeExternalUrl(preParsed.toString(), {
        allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.twitter,
      });
      const targetUrl = parsedUrl.toString();
      const startedAt = Date.now();
      const tempDir = await createTempDir("x-download");

      try {
        let items: DownloadedMediaItem[] = [];

        // 1. Primary: gallery-dl (extracts ALL photos in full resolution and videos in highest bitrate)
        try {
          const args = ["--no-mtime", "-D", tempDir];
          const cookiesPath = env.DOWNLOADER_COOKIES_PATH;
          if (cookiesPath && existsSync(cookiesPath)) {
            args.push("--cookies", cookiesPath);
          }
          args.push("--", targetUrl);

          await runProcess(env.GALLERY_DL_BIN, args, env.DOWNLOADER_TIMEOUT_MS);
          items = await scanDownloadedMediaFiles(tempDir, "minjibot-x");
        } catch (gdlErr) {
          logger.warn(
            { gdlErr, url: targetUrl },
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
              "--ies",
              "twitter",
              "--max-filesize",
              `${String(env.MAX_DOWNLOAD_FILE_MB)}M`,
              "--match-filter",
              "duration <= 1800",
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

            const cookiesPath = env.DOWNLOADER_COOKIES_PATH;
            if (cookiesPath && existsSync(cookiesPath)) {
              args.push("--cookies", cookiesPath);
            }

            args.push("--", targetUrl);
            await runProcess(env.DOWNLOADER_BIN, args, env.DOWNLOADER_TIMEOUT_MS);
            items = await scanDownloadedMediaFiles(tempDir, "minjibot-x");
          } catch (ytErr) {
            logger.warn({ ytErr, url: targetUrl }, "yt-dlp Twitter fallback juga gagal");
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

        return { type: "multi", items, totalCount: items.length };
      } finally {
        await removeTempDir(tempDir);
      }
    });
  }

  /**
   * Download Pinterest photo or video — original resolution HD.
   * Supports pin.it shortlinks and full pinterest.com URLs.
   */
  async downloadPinterest(url: string): Promise<DownloadedMediaItem> {
    return mediaQueueService.heavySubprocessQueue.run(async () => {
      let targetUrlStr = url.trim();
      if (targetUrlStr.includes("pin.it")) {
        try {
          targetUrlStr = await resolveRedirectUrl(targetUrlStr, {
            allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.pinterest,
          });
        } catch (err) {
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
        } catch (gdlErr) {
          logger.warn({ gdlErr, url: canonicalUrl }, "gallery-dl Pinterest gagal, mencoba yt-dlp");
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
          } catch (ytErr) {
            logger.warn({ ytErr, url: canonicalUrl }, "yt-dlp Pinterest juga gagal");
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
      "tiktok",
      "--max-filesize",
      `${String(env.MAX_DOWNLOAD_FILE_MB)}M`,
      "--match-filter",
      "duration <= 4200",
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
      "instagram",
      "--max-filesize",
      `${String(env.MAX_DOWNLOAD_FILE_MB)}M`,
      "--match-filter",
      "duration <= 1800",
      "--playlist-items",
      "1-15",
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
    const args: string[] = ["--range", "1-15", "--no-mtime", "-D", tempDir];

    const cookiesPath = env.INSTAGRAM_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;
    if (cookiesPath && existsSync(cookiesPath)) {
      args.push("--cookies", cookiesPath);
    }

    args.push("--", url);
    await runProcess(env.GALLERY_DL_BIN, args, env.DOWNLOADER_TIMEOUT_MS);
  }

  private async runGalleryDlTikTok(url: string, tempDir: string): Promise<void> {
    const args: string[] = ["--range", "1-25", "--no-mtime", "-D", tempDir];

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
        "tiktok",
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

async function scanDownloadedMediaFiles(
  tempDir: string,
  defaultName = "minjibot-media",
): Promise<DownloadedMediaItem[]> {
  const filePaths = await findMediaFilesRecursive(tempDir);
  const items: DownloadedMediaItem[] = [];

  for (const filePath of filePaths) {
    await assertFileSizeAllowed(filePath);
    const ext = path.extname(filePath).toLowerCase();

    if (VIDEO_EXTS.has(ext)) {
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
    logger.warn({ error }, "Remux video gagal, memakai normalisasi penuh");
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
