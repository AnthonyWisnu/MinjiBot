import yts from "yt-search";

import { logger } from "../../config/logger";
import { AppUserError } from "../../errors/appUserError";

export interface YoutubeSearchResult {
  channelTitle: string;
  durationSeconds: number;
  durationText: string;
  title: string;
  url: string;
  videoId: string;
}

export function extractYoutubeVideoId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be") {
    return url.pathname.split("/").find(Boolean) ?? null;
  }

  const vParam = url.searchParams.get("v")?.trim();
  if (vParam) {
    return vParam;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if ((parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") && parts[1]) {
    return parts[1];
  }

  return null;
}

export class YoutubeSearchService {
  async searchVideos(query: string, limit: number): Promise<YoutubeSearchResult[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new Error("Judul lagu tidak boleh kosong.");
    }

    const startedAt = Date.now();
    const result = await yts(normalizedQuery);
    const videos = result.videos.slice(0, limit);
    if (videos.length === 0) {
      throw new Error("Video YouTube tidak ditemukan.");
    }

    logger.info(
      {
        elapsedMs: Date.now() - startedAt,
        query: normalizedQuery,
        resultCount: videos.length,
      },
      "Pencarian YouTube selesai",
    );

    return videos.map((video) => ({
      channelTitle: video.author.name,
      durationSeconds: video.seconds,
      durationText: video.timestamp,
      title: video.title,
      url: video.url,
      videoId: video.videoId,
    }));
  }

  async getVideoByUrl(url: URL): Promise<YoutubeSearchResult> {
    const videoId = extractYoutubeVideoId(url);
    if (!videoId) {
      throw new AppUserError("Link YouTube Music / YouTube tidak valid.");
    }

    const startedAt = Date.now();
    const video = await yts({ videoId });
    if (!video.videoId || !video.title) {
      throw new Error("Video YouTube tidak ditemukan.");
    }

    logger.info(
      {
        elapsedMs: Date.now() - startedAt,
        videoId,
      },
      "Lookup metadata YouTube selesai",
    );

    return {
      channelTitle: video.author.name,
      durationSeconds: video.seconds,
      durationText: video.timestamp,
      title: video.title,
      url: video.url,
      videoId: video.videoId,
    };
  }
}

export const youtubeSearchService = new YoutubeSearchService();
