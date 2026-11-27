import { AppUserError } from "../../errors/appUserError";
import { mediaQueueService, type QueueRunOptions } from "../../utils/boundedQueue";
import {
  TIKTOK_MEDIA_ALLOWED_DOMAINS,
  TWITTER_MEDIA_ALLOWED_DOMAINS,
  type DownloadedMediaItem,
  type DownloadedVideo,
  type DownloaderKind,
  type DownloadResult,
  type ExtractedAudio,
  type MediaType,
  type TikTokDownloadResult,
} from "./downloaders/downloader.types";
import { extractAudioFromVideoBuffer } from "./downloaders/downloader.utils";
import { executeInstagramDownload } from "./downloaders/instagram.downloader";
import { executePinterestDownload } from "./downloaders/pinterest.downloader";
import { executePinterestSearch } from "./downloaders/pinterestSearch";
import { executeTikTokDownload } from "./downloaders/tiktok.downloader";
import { executeTwitterDownload } from "./downloaders/twitter.downloader";
import { executeYoutubeDownload } from "./downloaders/youtube.downloader";

export {
  TIKTOK_MEDIA_ALLOWED_DOMAINS,
  TWITTER_MEDIA_ALLOWED_DOMAINS,
  type DownloadedMediaItem,
  type DownloadedVideo,
  type DownloaderKind,
  type DownloadResult,
  type ExtractedAudio,
  type MediaType,
  type TikTokDownloadResult,
};

export class DownloaderService {
  async downloadTikTok(url: string, queueOptions?: QueueRunOptions): Promise<TikTokDownloadResult> {
    return mediaQueueService.heavySubprocessQueue.run(
      () => executeTikTokDownload(url),
      queueOptions,
    );
  }

  async downloadVideo(url: string, kind: DownloaderKind): Promise<DownloadedVideo> {
    if (kind === "tiktok") {
      const result = await this.downloadTikTok(url);
      if (result.type === "video") {
        return result.video;
      }
      throw new AppUserError(
        "Link TikTok merupakan slide foto. Gunakan command .tt untuk mengunduh foto slide.",
      );
    }

    throw new Error(`downloadVideo tidak mendukung kind: ${kind}`);
  }

  async downloadInstagram(url: string, queueOptions?: QueueRunOptions): Promise<DownloadResult> {
    return mediaQueueService.heavySubprocessQueue.run(
      () => executeInstagramDownload(url),
      queueOptions,
    );
  }

  async downloadYoutube(url: string, queueOptions?: QueueRunOptions): Promise<DownloadedMediaItem> {
    return mediaQueueService.heavySubprocessQueue.run(
      () => executeYoutubeDownload(url),
      queueOptions,
    );
  }

  async downloadTwitter(url: string, queueOptions?: QueueRunOptions): Promise<DownloadResult> {
    return mediaQueueService.heavySubprocessQueue.run(
      () => executeTwitterDownload(url),
      queueOptions,
    );
  }

  async downloadPinterest(
    url: string,
    queueOptions?: QueueRunOptions,
  ): Promise<DownloadedMediaItem> {
    return mediaQueueService.heavySubprocessQueue.run(
      () => executePinterestDownload(url),
      queueOptions,
    );
  }

  async searchPinterest(
    query: string,
    count = 3,
    queueOptions?: QueueRunOptions,
  ): Promise<DownloadedMediaItem[]> {
    return mediaQueueService.heavySubprocessQueue.run(
      () => executePinterestSearch(query, count),
      queueOptions,
    );
  }

  async extractAudioFromVideo(videoBuffer: Buffer): Promise<ExtractedAudio> {
    return extractAudioFromVideoBuffer(videoBuffer);
  }
}

export const downloaderService = new DownloaderService();
