import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import { createTempDir, removeTempDir } from "../../../utils/tempFile";
import { formatDurationLimitLabel } from "../../../utils/time";
import { ALLOWED_DOWNLOADER_DOMAINS, assertSafeExternalUrl } from "../../../utils/urlValidator";
import {
  DEFAULT_USER_AGENT,
  YT_VIDEO_FORMAT_SMART,
  type DownloadedMediaItem,
} from "./downloader.types";
import {
  assertFileSizeAllowed,
  assertVideoDurationAllowed,
  findFirstDownloadedFile,
  parseSupportedUrl,
  prepareMobileVideo,
  runProcess,
} from "./downloader.utils";

export async function executeYoutubeDownload(url: string): Promise<DownloadedMediaItem> {
  const preParsed = parseSupportedUrl(url, "youtube");
  const parsedUrl = await assertSafeExternalUrl(preParsed.toString(), {
    allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.youtube,
  });
  const targetUrl = parsedUrl.toString();
  const isYoutubeMusicUrl = parsedUrl.hostname.toLowerCase() === "music.youtube.com";
  const maxDurationSec = isYoutubeMusicUrl
    ? env.MAX_YOUTUBE_MUSIC_DURATION_SEC
    : env.MAX_YOUTUBE_DURATION_SEC;
  const durationLabel = formatDurationLimitLabel(maxDurationSec);
  const startedAt = Date.now();
  const tempDir = await createTempDir("yt-video");
  const rawOutputTemplate = path.join(tempDir, "raw.%(ext)s");
  const remuxedOutputPath = path.join(tempDir, "remuxed.mp4");
  const normalizedOutputPath = path.join(tempDir, "normalized.mp4");

  try {
    const args = [
      "--no-warnings",
      "--no-playlist",
      "--remote-components",
      "ejs:github",
      "--ies",
      "youtube,youtube:clip",
      "--max-filesize",
      `${String(env.MAX_DOWNLOAD_FILE_MB)}M`,
      "--match-filter",
      `duration <=? ${String(maxDurationSec)} & !is_live`,
      "-f",
      YT_VIDEO_FORMAT_SMART,
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

    const cookiesPath = env.YOUTUBE_COOKIES_PATH ?? env.DOWNLOADER_COOKIES_PATH;
    if (cookiesPath && existsSync(cookiesPath)) {
      args.push("--cookies", cookiesPath);
    }

    args.push("--", targetUrl);
    await runProcess(env.DOWNLOADER_BIN, args, env.DOWNLOADER_TIMEOUT_MS);

    const rawVideoPath = await findFirstDownloadedFile(tempDir, "raw.");
    await assertVideoDurationAllowed(
      rawVideoPath,
      maxDurationSec,
      isYoutubeMusicUrl
        ? `Video YouTube Music melebihi batas durasi ${durationLabel}.`
        : `Video YouTube melebihi batas durasi ${durationLabel}.`,
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
}
