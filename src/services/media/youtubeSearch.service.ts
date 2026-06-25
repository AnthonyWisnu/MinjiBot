import yts from "yt-search";

import { logger } from "../../config/logger";

export interface YoutubeSearchResult {
  channelTitle: string;
  durationSeconds: number;
  durationText: string;
  title: string;
  url: string;
  videoId: string;
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
}

export const youtubeSearchService = new YoutubeSearchService();
