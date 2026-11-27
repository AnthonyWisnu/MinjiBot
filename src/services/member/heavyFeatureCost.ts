import { HeavyFeatureType } from "@prisma/client";

/**
 * Biaya limit per fitur berat (LOG-03 & LOG-04).
 * Seluruh 8 fitur berat didefinisikan secara eksplisit tanpa Partial<>.
 */
export const HEAVY_FEATURE_COST: Record<HeavyFeatureType, number> = {
  [HeavyFeatureType.TIKTOK_DOWNLOAD]: 1,
  [HeavyFeatureType.INSTAGRAM_REELS_DOWNLOAD]: 1,
  [HeavyFeatureType.INSTAGRAM_STORY_DOWNLOAD]: 1,
  [HeavyFeatureType.YOUTUBE_VIDEO_DOWNLOAD]: 1,
  [HeavyFeatureType.HD_AI_PHOTO]: 1,
  [HeavyFeatureType.HD_AI_PHOTO_DOCUMENT]: 1,
  [HeavyFeatureType.PLAY_SONG]: 1,
  [HeavyFeatureType.SONG_LYRICS]: 1,
  [HeavyFeatureType.TWITTER_DOWNLOAD]: 1,
  [HeavyFeatureType.PINTEREST_DOWNLOAD]: 1,
};

export function getFeatureCost(feature: HeavyFeatureType): number {
  return HEAVY_FEATURE_COST[feature];
}
