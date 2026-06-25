import ffmpegStatic from "ffmpeg-static";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { createTempDir, removeTempDir } from "../../utils/tempFile";

const SEARCH_ENDPOINT = "https://itunes.apple.com/search";
const MAX_PREVIEW_FILE_MB = 10;
const BYTES_PER_MB = 1024 * 1024;

interface ItunesSearchResponse {
  resultCount: number;
  results: ItunesSong[];
}

interface ItunesSong {
  artistName?: string;
  collectionName?: string;
  previewUrl?: string;
  trackName?: string;
}

export interface MusicPreviewResult {
  artist: string;
  buffer: Buffer;
  fileName: string;
  mimetype: "audio/mpeg";
  title: string;
}

export class MusicPreviewService {
  async searchPreview(query: string): Promise<MusicPreviewResult> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new Error("Judul lagu tidak boleh kosong.");
    }

    const song = await this.searchSong(normalizedQuery);
    if (!song?.previewUrl) {
      throw new Error("Preview lagu tidak ditemukan.");
    }

    const startedAt = Date.now();
    const previewBuffer = await this.downloadPreview(song.previewUrl);
    const mp3Buffer = await this.convertToMp3(previewBuffer);
    const title = song.trackName ?? normalizedQuery;
    const artist = song.artistName ?? "Unknown Artist";

    logger.info(
      {
        artist,
        elapsedMs: Date.now() - startedAt,
        sizeBytes: mp3Buffer.byteLength,
        title,
      },
      "Preview lagu selesai diproses",
    );

    return {
      artist,
      buffer: mp3Buffer,
      fileName: `${sanitizeFileName(artist)} - ${sanitizeFileName(title)}.mp3`,
      mimetype: "audio/mpeg",
      title,
    };
  }

  private async searchSong(query: string): Promise<ItunesSong | null> {
    const indonesiaResult = await searchItunes(query, "ID");
    if (indonesiaResult) {
      return indonesiaResult;
    }

    return searchItunes(query, "US");
  }

  private async downloadPreview(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Preview lagu gagal diambil: ${String(response.status)}`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_PREVIEW_FILE_MB * BYTES_PER_MB) {
      throw new Error("Ukuran preview lagu terlalu besar.");
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_PREVIEW_FILE_MB * BYTES_PER_MB) {
      throw new Error("Ukuran preview lagu terlalu besar.");
    }

    return buffer;
  }

  private async convertToMp3(inputBuffer: Buffer): Promise<Buffer> {
    const tempDir = await createTempDir("play");
    const inputPath = path.join(tempDir, `preview-${randomUUID()}.m4a`);
    const outputPath = path.join(tempDir, "preview.mp3");

    try {
      await writeFile(inputPath, inputBuffer);
      await runFfmpeg([
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-ac",
        "2",
        "-ar",
        "44100",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        outputPath,
      ]);

      return await readFile(outputPath);
    } finally {
      await removeTempDir(tempDir);
    }
  }
}

async function searchItunes(query: string, country: string): Promise<ItunesSong | null> {
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("term", query);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", "10");
  url.searchParams.set("country", country);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Pencarian lagu gagal: ${String(response.status)}`);
  }

  const data = (await response.json()) as ItunesSearchResponse;
  return data.results.find((song) => Boolean(song.previewUrl)) ?? null;
}

function runFfmpeg(args: string[]): Promise<void> {
  const ffmpegPath = env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Konversi audio melewati batas waktu."));
    }, env.DOWNLOADER_TIMEOUT_MS);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`FFmpeg tidak tersedia: ${error.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Konversi audio gagal: ${stderr.slice(-500)}`));
    });
  });
}

function sanitizeFileName(value: string): string {
  return value
    .split("")
    .map((char) => (isUnsafeFileNameChar(char) ? "-" : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function isUnsafeFileNameChar(char: string): boolean {
  return char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char);
}

export const musicPreviewService = new MusicPreviewService();
