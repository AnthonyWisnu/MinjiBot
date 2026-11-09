import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import { createTempDir, removeTempDir } from "../../../utils/tempFile";
import {
  ALLOWED_DOWNLOADER_DOMAINS,
  assertSafeExternalUrl,
  resolveRedirectUrl,
} from "../../../utils/urlValidator";
import {
  DEFAULT_USER_AGENT,
  MAX_TIKTOK_DURATION_SEC,
  MAX_TIKTOK_SLIDES,
  MOBILE_SAFE_FORMAT,
  TIKTOK_SHORTLINK_HOSTS,
  type ExtractedAudio,
  type ScanMediaOptions,
  type TikTokDownloadResult,
} from "./downloader.types";
import {
  assertFileSizeAllowed,
  assertVideoDurationAllowed,
  extractAudioFromVideoBuffer,
  findFirstDownloadedFile,
  findMediaFilesRecursive,
  isPolicyLimitError,
  parseSupportedUrl,
  prepareMobileVideo,
  runProcess,
  scanDownloadedMediaFiles,
} from "./downloader.utils";
import { downloadTikTokDirect } from "./tiktokApi";

export async function executeTikTokDownload(url: string): Promise<TikTokDownloadResult> {
  const preParsed = parseSupportedUrl(url, "tiktok");
  const parsedUrl = await assertSafeExternalUrl(preParsed.toString(), {
    allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.tiktok,
  });
  const startedAt = Date.now();

  try {
    const directResult = await downloadTikTokDirect(parsedUrl.toString());
    if (directResult.type === "video" && !directResult.audio) {
      try {
        directResult.audio = await extractAudioFromVideoBuffer(directResult.video.buffer);
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
    logger.warn({ err: error }, "TikTok direct API gagal, mencoba fallback gallery-dl / yt-dlp");
  }

  let fallbackUrl = parsedUrl.toString();
  if (TIKTOK_SHORTLINK_HOSTS.has(parsedUrl.hostname.toLowerCase())) {
    try {
      const resolved = await resolveRedirectUrl(fallbackUrl, {
        allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.tiktok,
      });
      const safeResolved = await assertSafeExternalUrl(resolved, {
        allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.tiktok,
      });
      fallbackUrl = safeResolved.toString();
    } catch (err: unknown) {
      logger.warn({ err, url: fallbackUrl }, "Gagal meresolusi shortlink TikTok");
    }
  }

  const isPhotoHint =
    fallbackUrl.toLowerCase().includes("/photo/") ||
    parsedUrl.pathname.toLowerCase().includes("/photo/");

  const scanOptions: ScanMediaOptions = {
    maxVideoDurationSec: MAX_TIKTOK_DURATION_SEC,
    durationErrorMessage: "Video TikTok melebihi batas durasi 70 menit (1 jam 10 menit).",
  };

  const tryGalleryDl = async (): Promise<TikTokDownloadResult | null> => {
    const gdlDir = await createTempDir("dl-tt-gdl");
    try {
      const gdlArgs = ["--range", `1-${String(MAX_TIKTOK_SLIDES + 1)}`, "--no-mtime", "-D", gdlDir];
      const cookiesPath = env.TIKTOK_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;
      if (cookiesPath && existsSync(cookiesPath)) {
        gdlArgs.push("--cookies", cookiesPath);
      }
      gdlArgs.push("--", fallbackUrl);

      await runProcess(env.GALLERY_DL_BIN, gdlArgs, env.DOWNLOADER_TIMEOUT_MS);
      const items = await scanDownloadedMediaFiles(gdlDir, "minjibot-tiktok", scanOptions);
      const allFiles = await findMediaFilesRecursive(gdlDir);
      const audioFiles = allFiles.filter((f) =>
        [".mp3", ".m4a", ".ogg", ".wav", ".opus", ".aac"].includes(path.extname(f).toLowerCase()),
      );

      let audio: ExtractedAudio | undefined;
      if (audioFiles[0]) {
        const audioBuf = await readFile(audioFiles[0]);
        if (audioBuf.byteLength > 0) {
          audio = {
            buffer: audioBuf,
            mimetype: "audio/mpeg",
          };
        }
      }

      const imageItems = items.filter((it) => it.mediaType === "image");
      const videoItems = items.filter((it) => it.mediaType === "video");

      if (imageItems.length > 0) {
        const targetImages = imageItems.slice(0, MAX_TIKTOK_SLIDES);
        logger.info(
          {
            elapsedMs: Date.now() - startedAt,
            itemCount: targetImages.length,
            hasAudio: !!audio,
            mode: "gallery-dl-tiktok",
          },
          "TikTok photo slide download selesai via gallery-dl",
        );
        return {
          type: "images",
          items: targetImages,
          totalCount: imageItems.length,
          audio,
        };
      }

      if (videoItems[0]) {
        const firstVideo = videoItems[0];
        if (!audio) {
          try {
            audio = await extractAudioFromVideoBuffer(firstVideo.buffer);
          } catch (err: unknown) {
            logger.warn({ err }, "Extract audio dari video TikTok gallery-dl gagal");
          }
        }
        return {
          type: "video",
          video: {
            buffer: firstVideo.buffer,
            fileName: firstVideo.fileName,
            mimetype: "video/mp4",
          },
          audio,
        };
      }

      return null;
    } finally {
      await removeTempDir(gdlDir);
    }
  };

  if (isPhotoHint) {
    try {
      const gdlResult = await tryGalleryDl();
      if (gdlResult) {
        return gdlResult;
      }
    } catch (error: unknown) {
      if (isPolicyLimitError(error)) {
        throw error;
      }
      logger.warn({ err: error }, "TikTok gallery-dl gagal pada link /photo/, mencoba yt-dlp");
    }
  }

  const tempDir = await createTempDir("dl-tt");
  const outputTemplate = path.join(tempDir, "tiktok.%(ext)s");
  const remuxedPath = path.join(tempDir, "tiktok-remuxed.mp4");
  const normalizedPath = path.join(tempDir, "tiktok-normalized.mp4");

  try {
    const args = [
      "--no-playlist",
      "--no-warnings",
      "--concurrent-fragments",
      "2",
      "--max-filesize",
      `${String(env.MAX_DOWNLOAD_FILE_MB)}M`,
      "--match-filter",
      `duration <=? ${String(MAX_TIKTOK_DURATION_SEC)} & !is_live`,
      "--add-header",
      `User-Agent:${DEFAULT_USER_AGENT}`,
      "--add-header",
      "Referer:https://www.tiktok.com/",
      "--merge-output-format",
      "mp4",
      "-f",
      MOBILE_SAFE_FORMAT,
    ];

    const cookiesPath = env.TIKTOK_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;
    if (cookiesPath && existsSync(cookiesPath)) {
      args.push("--cookies", cookiesPath);
    }

    args.push("-o", outputTemplate, "--", fallbackUrl);

    await runProcess(env.DOWNLOADER_BIN, args, env.DOWNLOADER_TIMEOUT_MS);

    const filePath = await findFirstDownloadedFile(tempDir, "tiktok");
    await assertFileSizeAllowed(filePath);
    await assertVideoDurationAllowed(
      filePath,
      MAX_TIKTOK_DURATION_SEC,
      "Video TikTok melebihi batas durasi 70 menit (1 jam 10 menit).",
    );

    const finalPath = await prepareMobileVideo(filePath, remuxedPath, normalizedPath);
    await assertFileSizeAllowed(finalPath);
    const buffer = await readFile(finalPath);

    let audio: ExtractedAudio | undefined;
    try {
      audio = await extractAudioFromVideoBuffer(buffer);
    } catch (err: unknown) {
      logger.warn({ err }, "Extract audio dari video TikTok fallback gagal");
    }

    logger.info(
      {
        elapsedMs: Date.now() - startedAt,
        sizeBytes: buffer.byteLength,
        hasAudio: !!audio,
        mode: "ytdlp-fallback",
      },
      "TikTok download selesai (fallback yt-dlp)",
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
  } catch (ytdlpError: unknown) {
    if (isPolicyLimitError(ytdlpError)) {
      throw ytdlpError;
    }
    if (!isPhotoHint) {
      try {
        const gdlResult = await tryGalleryDl();
        if (gdlResult) {
          return gdlResult;
        }
      } catch (gdlError: unknown) {
        if (isPolicyLimitError(gdlError)) {
          throw gdlError;
        }
        logger.warn({ err: gdlError }, "TikTok gallery-dl fallback kedua juga gagal");
      }
    }
    throw ytdlpError;
  } finally {
    await removeTempDir(tempDir);
  }
}
