import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import { AppUserError } from "../../../errors/appUserError";
import { fetchBufferWithLimit } from "../../../utils/httpStream";
import { MAX_SAFE_IMAGE_PIXELS } from "../../../utils/imageSafety";
import { createTempDir, removeTempDir } from "../../../utils/tempFile";
import {
  ALLOWED_DOWNLOADER_DOMAINS,
  assertSafeExternalUrl,
  isAllowedDomainUrl,
  resolveRedirectUrl,
  safeFetchExternal,
} from "../../../utils/urlValidator";
import {
  BYTES_PER_MB,
  DEFAULT_USER_AGENT,
  MAX_TWITTER_DURATION_SEC,
  MAX_TWITTER_ITEMS,
  MOBILE_SAFE_FORMAT,
  TWITTER_CANONICAL_DOMAINS,
  TWITTER_MEDIA_ALLOWED_DOMAINS,
  type DownloadedMediaItem,
  type DownloadResult,
  type ScanMediaOptions,
} from "./downloader.types";
import {
  assertFileSizeAllowed,
  assertVideoDurationAllowed,
  isPolicyLimitError,
  parseSupportedUrl,
  prepareMobileVideo,
  runProcess,
  scanDownloadedMediaFiles,
} from "./downloader.utils";

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

export async function executeTwitterDownload(url: string): Promise<DownloadResult> {
  const preParsed = parseSupportedUrl(url, "twitter");
  let parsedUrl = await assertSafeExternalUrl(preParsed.toString(), {
    allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.twitter,
  });

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
          "2",
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
