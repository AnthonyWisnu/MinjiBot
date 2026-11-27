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
  safeFetchExternal,
} from "../../../utils/urlValidator";
import {
  BYTES_PER_MB,
  DEFAULT_USER_AGENT,
  MOBILE_SAFE_FORMAT,
  type DownloadedMediaItem,
  type DownloadResult,
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

const MAX_THREADS_ITEMS = 10;

export interface GitCloneResult {
  buffer: Buffer;
  fileName: string;
  mimetype: "application/zip";
  repoFullName: string;
  branch: string;
}

export interface ParsedGithubRepo {
  owner: string;
  repo: string;
  branch?: string;
}

export function buildFriendlyFileTooLargeMessage(kindLabel = "file"): string {
  return `Maaf, ukuran ${kindLabel} ini terlalu besar (lebih dari ${String(env.MAX_DOWNLOAD_FILE_MB)} MB), jadi belum bisa dikirim lewat WhatsApp. Coba pilih yang lebih pendek atau lebih ringan ya!`;
}

export function parseGithubRepoUrl(rawUrl: string): ParsedGithubRepo | null {
  const parsed = parseSupportedUrl(rawUrl.trim(), "github");
  const segments = parsed.pathname
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);

  const owner = segments[0];
  const rawRepo = segments[1];
  if (!owner || !rawRepo) {
    return null;
  }
  const repo = rawRepo.replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo)) {
    return null;
  }

  let branch: string | undefined;
  if (segments[2] === "tree" && segments[3] && /^[A-Za-z0-9_./-]{1,80}$/.test(segments[3])) {
    branch = segments[3];
  }

  return { owner, repo, branch };
}

export async function executeFacebookDownload(url: string): Promise<DownloadedMediaItem> {
  const initialParsed = parseSupportedUrl(url.trim(), "facebook");
  let targetUrlStr = initialParsed.toString();

  if (initialParsed.hostname.toLowerCase() === "fb.watch" || initialParsed.hostname.toLowerCase() === "fb.com") {
    try {
      targetUrlStr = await resolveRedirectUrl(targetUrlStr, {
        allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.facebook,
      });
    } catch (err: unknown) {
      logger.warn({ err }, "Gagal resolve shortlink Facebook, lanjut dengan URL asli");
    }
  }

  const preParsed = parseSupportedUrl(targetUrlStr, "facebook");
  const parsedUrl = await assertSafeExternalUrl(preParsed.toString(), {
    allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.facebook,
  });
  const canonicalUrl = parsedUrl.toString();
  const tempDir = await createTempDir("fb-download");

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
    await assertFileSizeAllowed(rawVideoPath);
    const finalPath = await prepareMobileVideo(
      rawVideoPath,
      remuxedOutputPath,
      normalizedOutputPath,
    );
    await assertFileSizeAllowed(finalPath);

    return {
      buffer: await readFile(finalPath),
      fileName: "minjibot-facebook.mp4",
      mimetype: "video/mp4",
      mediaType: "video",
    };
  } finally {
    await removeTempDir(tempDir);
  }
}

export async function executeThreadsDownload(url: string): Promise<DownloadResult> {
  const initialParsed = parseSupportedUrl(url.trim(), "threads");
  const parsedUrl = await assertSafeExternalUrl(initialParsed.toString(), {
    allowedDomains: ALLOWED_DOWNLOADER_DOMAINS.threads,
  });
  const canonicalUrl = parsedUrl.toString();
  const tempDir = await createTempDir("threads-download");

  try {
    let items: DownloadedMediaItem[] = [];

    try {
      await runProcess(
        env.GALLERY_DL_BIN,
        ["--no-mtime", "-D", tempDir, "--", canonicalUrl],
        env.DOWNLOADER_TIMEOUT_MS,
      );
      items = await scanDownloadedMediaFiles(tempDir, "minjibot-threads");
    } catch (gdlErr: unknown) {
      if (isPolicyLimitError(gdlErr)) {
        throw gdlErr;
      }
      logger.warn({ err: gdlErr, url: canonicalUrl }, "gallery-dl Threads gagal, mencoba yt-dlp");
    }

    if (items.length === 0) {
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
      await assertFileSizeAllowed(rawVideoPath);
      const finalPath = await prepareMobileVideo(
        rawVideoPath,
        remuxedOutputPath,
        normalizedOutputPath,
      );
      await assertFileSizeAllowed(finalPath);
      items.push({
        buffer: await readFile(finalPath),
        fileName: "minjibot-threads.mp4",
        mimetype: "video/mp4",
        mediaType: "video",
      });
    }

    if (items.length === 0) {
      throw new AppUserError("Media Threads tidak ditemukan. Pastikan postingan bersifat publik.");
    }

    const totalCount = items.length;
    const bounded = items.slice(0, MAX_THREADS_ITEMS);
    if (bounded.length === 1 && bounded[0]) {
      return { type: "single", item: bounded[0] };
    }
    return { type: "multi", items: bounded, totalCount };
  } finally {
    await removeTempDir(tempDir);
  }
}

export async function executeGitCloneDownload(
  url: string,
  fetchFn: typeof safeFetchExternal = safeFetchExternal,
): Promise<GitCloneResult> {
  const parsed = parseGithubRepoUrl(url);
  if (!parsed) {
    throw new AppUserError(
      "Format link GitHub salah.\nContoh: *.gitclone https://github.com/owner/repo*",
    );
  }

  const maxBytes = env.MAX_DOWNLOAD_FILE_MB * BYTES_PER_MB;
  const metaResp = await fetchFn(
    `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`,
    {
      allowedDomains: ["api.github.com"],
      headers: { Accept: "application/vnd.github+json", "User-Agent": "MinjiBot-V2" },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (metaResp.status === 404) {
    throw new AppUserError(
      `Repository *${parsed.owner}/${parsed.repo}* tidak ditemukan atau bersifat private.`,
    );
  }
  if (!metaResp.ok) {
    throw new AppUserError("Gagal membaca info repository GitHub. Silakan coba lagi.");
  }

  const meta = (await metaResp.json()) as {
    full_name?: string;
    default_branch?: string;
    size?: number; // dalam KB
  };

  if (typeof meta.size === "number" && meta.size * 1024 > maxBytes) {
    throw new AppUserError(buildFriendlyFileTooLargeMessage("repository"));
  }

  const branch = parsed.branch ?? meta.default_branch ?? "main";
  const zipResp = await fetchFn(
    `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/zipball/${encodeURIComponent(branch)}`,
    {
      allowedDomains: ["api.github.com"],
      maxRedirects: 4,
      headers: { Accept: "application/vnd.github+json", "User-Agent": "MinjiBot-V2" },
      signal: AbortSignal.timeout(env.DOWNLOADER_TIMEOUT_MS),
    },
  );

  if (!zipResp.ok) {
    throw new AppUserError(
      `Gagal mengunduh ZIP repository *${parsed.owner}/${parsed.repo}* (branch: ${branch}).`,
    );
  }

  const contentLengthHeader = zipResp.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      await zipResp.body?.cancel();
      throw new AppUserError(buildFriendlyFileTooLargeMessage("repository"));
    }
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  if (zipResp.body) {
    const reader = zipResp.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    let reading = true;
    while (reading) {
      const chunk = await reader.read();
      if (chunk.done) {
        reading = false;
      } else {
        totalBytes += chunk.value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new AppUserError(buildFriendlyFileTooLargeMessage("repository"));
        }
        chunks.push(chunk.value);
      }
    }
  } else {
    const arrBuf = await zipResp.arrayBuffer();
    if (arrBuf.byteLength > maxBytes) {
      throw new AppUserError(buildFriendlyFileTooLargeMessage("repository"));
    }
    chunks.push(new Uint8Array(arrBuf));
  }

  const buffer = Buffer.concat(chunks);
  if (buffer.byteLength === 0) {
    throw new AppUserError("Arsip ZIP repository kosong atau gagal diunduh.");
  }

  return {
    buffer,
    fileName: `${parsed.owner}-${parsed.repo}-${branch}.zip`.replace(/[^A-Za-z0-9._-]/g, "_"),
    mimetype: "application/zip",
    repoFullName: meta.full_name ?? `${parsed.owner}/${parsed.repo}`,
    branch,
  };
}
