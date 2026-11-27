import { readFile } from "node:fs/promises";
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
  MOBILE_SAFE_FORMAT,
  type DownloadedMediaItem,
} from "./downloader.types";
import {
  assertFileSizeAllowed,
  findFirstDownloadedFile,
  isPolicyLimitError,
  parseSupportedUrl,
  prepareMobileVideo,
  runProcess,
  scanDownloadedMediaFiles,
} from "./downloader.utils";

export async function executePinterestDownload(url: string): Promise<DownloadedMediaItem> {
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

    try {
      const args = ["--no-mtime", "-D", tempDir, "--", canonicalUrl];
      await runProcess(env.GALLERY_DL_BIN, args, env.DOWNLOADER_TIMEOUT_MS);
      items = await scanDownloadedMediaFiles(tempDir, "minjibot-pinterest");
    } catch (gdlErr: unknown) {
      if (isPolicyLimitError(gdlErr)) {
        throw gdlErr;
      }
      logger.warn({ err: gdlErr, url: canonicalUrl }, "gallery-dl Pinterest gagal, mencoba yt-dlp");
    }

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
}
