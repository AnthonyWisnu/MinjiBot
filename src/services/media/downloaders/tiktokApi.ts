import sharp from "sharp";

import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import { AppUserError } from "../../../errors/appUserError";
import { fetchBufferWithLimit } from "../../../utils/httpStream";
import { MAX_SAFE_IMAGE_PIXELS } from "../../../utils/imageSafety";
import { safeFetchExternal } from "../../../utils/urlValidator";
import {
  BYTES_PER_MB,
  DEFAULT_USER_AGENT,
  MAX_TIKTOK_DURATION_SEC,
  MAX_TIKTOK_SLIDES,
  TIKTOK_MEDIA_ALLOWED_DOMAINS,
  type DownloadedMediaItem,
  type ExtractedAudio,
  type TikTokDownloadResult,
} from "./downloader.types";

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

function resolveTikWmMediaUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith("/")) {
    return new URL(trimmed, "https://www.tikwm.com").toString();
  }
  return trimmed;
}

export async function downloadTikTokDirect(url: string): Promise<TikTokDownloadResult> {
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
