export const BYTES_PER_MB = 1024 * 1024;

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Batas kapasitas platform
export const MAX_TIKTOK_DURATION_SEC = 4200; // 70 menit (1 jam 10 menit)
export const MAX_TIKTOK_SLIDES = 25;
export const MAX_INSTAGRAM_DURATION_SEC = 1800; // 30 menit
export const MAX_INSTAGRAM_SLIDES = 15;
export const MAX_YOUTUBE_DURATION_SEC = 3600; // 1 jam
export const MAX_TWITTER_DURATION_SEC = 1800; // 30 menit
export const MAX_TWITTER_ITEMS = 10;

export const TIKTOK_MEDIA_ALLOWED_DOMAINS = [
  "tikwm.com",
  "tiktok.com",
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "tiktokcdn-eu.com",
  "tiktokcdn-in.com",
  "tiktokv.com",
  "tiktokv.us",
  "tiktokv.eu",
  "byteoversea.com",
  "ibytedtos.com",
  "ipstatp.com",
  "muscdn.com",
  "musical.ly",
  "ttwstatic.com",
] as const;

export const TWITTER_MEDIA_ALLOWED_DOMAINS = [
  "twimg.com",
  "pbs.twimg.com",
  "video.twimg.com",
  "fxtwitter.com",
  "vxtwitter.com",
] as const;

export const TWITTER_CANONICAL_DOMAINS = [
  "twitter.com",
  "x.com",
  "mobile.twitter.com",
  "m.twitter.com",
  "fxtwitter.com",
  "vxtwitter.com",
  "fixupx.com",
] as const;

export const TIKTOK_SHORTLINK_HOSTS = new Set([
  "vt.tiktok.com",
  "vm.tiktok.com",
  "t.tiktok.com",
  "lite.tiktok.com",
]);

export const MOBILE_SAFE_FORMAT =
  "bv*[vcodec^=avc1][height<=720][ext=mp4]+ba[ext=m4a]/" +
  "b[vcodec^=avc1][height<=720][ext=mp4]/" +
  "bv*[height<=720][ext=mp4]+ba[ext=m4a]/" +
  "b[height<=720][ext=mp4]/" +
  "best[height<=720][ext=mp4]/best[ext=mp4]/best";

export const YT_VIDEO_FORMAT_SMART =
  "bv*[vcodec^=avc1][height<=720][fps>30][filesize_approx<=100M][ext=mp4]+ba[ext=m4a]/" +
  "bv*[vcodec^=avc1][height<=720][fps<=30][filesize_approx<=100M][ext=mp4]+ba[ext=m4a]/" +
  "bv*[vcodec^=avc1][height<=720][ext=mp4]+ba[ext=m4a]/" +
  "bv*[vcodec^=avc1][height<=480][ext=mp4]+ba[ext=m4a]/" +
  "bv*[height<=720][ext=mp4]+ba[ext=m4a]/" +
  "b[height<=720][ext=mp4]/" +
  "best[height<=720]/best";

export const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
export const VIDEO_EXTS = new Set([".mp4", ".webm", ".mkv", ".mov", ".avi"]);

export type DownloaderKind = "tiktok" | "instagram" | "youtube" | "twitter" | "pinterest";
export type MediaType = "video" | "image";

export interface DownloadedMediaItem {
  buffer: Buffer;
  fileName: string;
  mimetype: string;
  mediaType: MediaType;
}

export interface DownloadedVideo {
  buffer: Buffer;
  fileName: string;
  mimetype: "video/mp4";
}

export type DownloadResult =
  | { type: "single"; item: DownloadedMediaItem }
  | { type: "multi"; items: DownloadedMediaItem[]; totalCount: number };

export interface ExtractedAudio {
  buffer: Buffer;
  mimetype: "audio/mpeg";
}

export type TikTokDownloadResult =
  | { type: "video"; video: DownloadedVideo; audio?: ExtractedAudio }
  | { type: "images"; items: DownloadedMediaItem[]; totalCount: number; audio?: ExtractedAudio };

export interface ScanMediaOptions {
  maxVideoDurationSec?: number;
  durationErrorMessage?: string;
}
