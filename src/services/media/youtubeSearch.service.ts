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
  async searchVideo(query: string): Promise<YoutubeSearchResult> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new Error("Judul lagu tidak boleh kosong.");
    }

    const startedAt = Date.now();
    const result = await yts(normalizedQuery);
    const video = result.videos[0];
    if (!video) {
      throw new Error("Video YouTube tidak ditemukan.");
    }

    logger.info(
      {
        elapsedMs: Date.now() - startedAt,
        query: normalizedQuery,
        videoId: video.videoId,
      },
      "Pencarian YouTube selesai",
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
