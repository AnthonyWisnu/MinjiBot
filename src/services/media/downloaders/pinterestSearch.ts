import sharp from "sharp";

import { env } from "../../../config/env";
import { logger } from "../../../config/logger";
import { AppUserError } from "../../../errors/appUserError";
import { fetchBufferWithLimit } from "../../../utils/httpStream";
import { MAX_SAFE_IMAGE_PIXELS } from "../../../utils/imageSafety";
import { safeFetchExternal } from "../../../utils/urlValidator";
import { BYTES_PER_MB, DEFAULT_USER_AGENT, type DownloadedMediaItem } from "./downloader.types";

const MAX_PINTEREST_QUERY_LENGTH = 100;
const DEFAULT_PINTEREST_SEARCH_COUNT = 3;
const TOP_CANDIDATE_POOL_SIZE = 15;
const PINIMG_ALLOWED_DOMAINS = ["pinimg.com"] as const;
const BING_SEARCH_ALLOWED_DOMAINS = ["bing.com"] as const;

export function extractPinterestImageUrlsFromHtml(html: string): string[] {
  const matches: string[] = [];
  const patterns = [
    /murl&quot;:&quot;(https?:\/\/i\.pinimg\.com\/[^&"'\s]+)&quot;/gi,
    /murl":"(https?:\/\/i\.pinimg\.com\/[^"'\s]+)"/gi,
  ];

  for (const regex of patterns) {
    for (const match of html.matchAll(regex)) {
      const candidate = match[1];
      if (candidate) {
        matches.push(candidate);
      }
    }
  }

  const byHash = new Map<string, string>();
  for (const rawUrl of matches) {
    const cleanUrl = rawUrl.split("?")[0]?.trim() ?? "";
    if (!/^https:\/\/i\.pinimg\.com\/.+\.(?:jpg|jpeg|png|webp)$/i.test(cleanUrl)) {
      continue;
    }

    const fileName = cleanUrl.split("/").pop()?.toLowerCase() ?? cleanUrl.toLowerCase();
    const existing = byHash.get(fileName);
    if (!existing || (cleanUrl.includes("/originals/") && !existing.includes("/originals/"))) {
      byHash.set(fileName, cleanUrl);
    }
  }

  return Array.from(byHash.values());
}

async function fetchBingPinterestCandidates(searchQuery: string): Promise<string[]> {
  const searchUrl = `https://www.bing.com/images/async?q=${encodeURIComponent(searchQuery)}&first=0&count=35&adlt=strict&mmasync=1`;
  const response = await safeFetchExternal(searchUrl, {
    allowedDomains: BING_SEARCH_ALLOWED_DOMAINS,
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(env.DOWNLOADER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Pencarian gambar mengembalikan status ${String(response.status)}`);
  }

  const html = await response.text();
  return extractPinterestImageUrlsFromHtml(html);
}

function shuffleTopCandidates(urls: string[]): string[] {
  const copy = [...urls];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = copy[i];
    const swapTarget = copy[j];
    if (temp !== undefined && swapTarget !== undefined) {
      copy[i] = swapTarget;
      copy[j] = temp;
    }
  }
  return copy;
}

async function downloadSinglePinimgBuffer(imageUrl: string): Promise<Buffer | null> {
  const maxBytes = env.MAX_DOWNLOAD_FILE_MB * BYTES_PER_MB;
  const urlsToTry = imageUrl.includes("/originals/")
    ? [imageUrl, imageUrl.replace("/originals/", "/736x/")]
    : [imageUrl];

  for (const targetUrl of urlsToTry) {
    try {
      const { buffer } = await fetchBufferWithLimit(targetUrl, {
        maxBytes,
        timeoutMs: env.DOWNLOADER_TIMEOUT_MS,
        allowedDomains: PINIMG_ALLOWED_DOMAINS,
        headers: {
          "User-Agent": DEFAULT_USER_AGENT,
          Referer: "https://www.pinterest.com/",
        },
      });
      if (buffer.byteLength > 0) {
        return buffer;
      }
    } catch (err: unknown) {
      logger.debug({ err, targetUrl }, "Gagal mengunduh kandidat gambar Pinterest");
    }
  }

  return null;
}

export async function executePinterestSearch(
  rawQuery: string,
  count = DEFAULT_PINTEREST_SEARCH_COUNT,
): Promise<DownloadedMediaItem[]> {
  const query = rawQuery.replace(/\s+/g, " ").trim();
  if (!query) {
    throw new AppUserError("Kata kunci pencarian Pinterest tidak boleh kosong.");
  }
  if (query.length > MAX_PINTEREST_QUERY_LENGTH) {
    throw new AppUserError("Kata kunci pencarian Pinterest terlalu panjang (maks. 100 karakter).");
  }

  const startedAt = Date.now();
  const targetCount = Math.max(1, Math.min(5, count));

  let candidates = await fetchBingPinterestCandidates(`${query} pinterest`);
  if (candidates.length < targetCount * 2) {
    try {
      const extra = await fetchBingPinterestCandidates(`${query} site:pinterest.com`);
      const merged = new Set([...candidates, ...extra]);
      candidates = Array.from(merged);
    } catch (err: unknown) {
      logger.debug({ err, query }, "Pencarian tambahan site:pinterest.com gagal");
    }
  }

  if (candidates.length === 0) {
    throw new AppUserError("Gambar Pinterest untuk kata kunci tersebut tidak ditemukan.");
  }

  const topPool = shuffleTopCandidates(candidates.slice(0, TOP_CANDIDATE_POOL_SIZE));
  const items: DownloadedMediaItem[] = [];

  for (const candidateUrl of topPool) {
    if (items.length >= targetCount) {
      break;
    }

    const rawBuf = await downloadSinglePinimgBuffer(candidateUrl);
    if (!rawBuf) {
      continue;
    }

    try {
      let imgBuffer = rawBuf;
      let mime = "image/jpeg";
      let ext = ".jpg";

      const meta = await sharp(imgBuffer, { limitInputPixels: MAX_SAFE_IMAGE_PIXELS }).metadata();
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

      items.push({
        buffer: imgBuffer,
        fileName: `minjibot-pin-${String(items.length + 1)}${ext}`,
        mimetype: mime,
        mediaType: "image",
      });
    } catch (err: unknown) {
      logger.debug({ err, candidateUrl }, "Kandidat gambar Pinterest tidak valid saat diproses");
    }
  }

  if (items.length === 0) {
    throw new AppUserError("Gagal mengambil gambar Pinterest untuk kata kunci tersebut.");
  }

  logger.info(
    {
      query,
      elapsedMs: Date.now() - startedAt,
      candidateCount: candidates.length,
      returnedCount: items.length,
    },
    "Pencarian foto Pinterest selesai",
  );

  return items;
}
