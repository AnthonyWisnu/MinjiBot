import { existsSync } from "node:fs";
import path from "node:path";

import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import { AppUserError } from "../../../errors/appUserError";
import { createTempDir, removeTempDir } from "../../../utils/tempFile";
import {
  ALLOWED_DOWNLOADER_DOMAINS,
  assertSafeExternalUrl,
  resolveRedirectUrl,
} from "../../../utils/urlValidator";
import {
  DEFAULT_USER_AGENT,
  MAX_INSTAGRAM_DURATION_SEC,
  MAX_INSTAGRAM_SLIDES,
  MOBILE_SAFE_FORMAT,
  type DownloadedMediaItem,
  type DownloadResult,
  type ScanMediaOptions,
} from "./downloader.types";
import {
  isPolicyLimitError,
  parseSupportedUrl,
  runProcess,
  scanDownloadedMediaFiles,
} from "./downloader.utils";

export async function executeInstagramDownload(url: string): Promise<DownloadResult> {
  const preParsed = parseSupportedUrl(url, "instagram");
  let parsedUrl = await assertSafeExternalUrl(preParsed.toString(), {
    allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.instagram,
  });

  const lowerPathInitial = parsedUrl.pathname.toLowerCase();
  if (parsedUrl.hostname.toLowerCase() === "instagr.am" || lowerPathInitial.startsWith("/share/")) {
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
      try {
        await runYtDlpInstagram(targetUrl, tempDir);
        items = await scanDownloadedMediaFiles(tempDir, "minjibot-ig", scanOptions);
      } catch (ytErr: unknown) {
        if (isPolicyLimitError(ytErr)) {
          throw ytErr;
        }
        logger.warn(
          { err: ytErr, url: targetUrl },
          "yt-dlp gagal download IG video/story, mencoba fallback gallery-dl",
        );
        await runGalleryDlInstagram(targetUrl, tempDir);
        items = await scanDownloadedMediaFiles(tempDir, "minjibot-ig", scanOptions);
      }
    } else {
      try {
        await runGalleryDlInstagram(targetUrl, tempDir);
        items = await scanDownloadedMediaFiles(tempDir, "minjibot-ig", scanOptions);
      } catch (gdlErr: unknown) {
        if (isPolicyLimitError(gdlErr)) {
          throw gdlErr;
        }
        logger.warn({ err: gdlErr, url: targetUrl }, "gallery-dl gagal, mencoba fallback yt-dlp");
      }

      if (items.length === 0) {
        try {
          await runYtDlpInstagram(targetUrl, tempDir);
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
}

async function runYtDlpInstagram(url: string, tempDir: string): Promise<void> {
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
    "2",
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

async function runGalleryDlInstagram(url: string, tempDir: string): Promise<void> {
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
