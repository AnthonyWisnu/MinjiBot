import { HeavyFeatureType } from "@prisma/client";

/**
 * Biaya limit per fitur berat.
 * Fitur tanpa entry di sini tidak dicharge (contoh: .hd standar tanpa AI).
 */
export const HEAVY_FEATURE_COST: Partial<Record<HeavyFeatureType, number>> = {
  [HeavyFeatureType.TIKTOK_DOWNLOAD]: 1,
  [HeavyFeatureType.INSTAGRAM_REELS_DOWNLOAD]: 1,
  [HeavyFeatureType.INSTAGRAM_STORY_DOWNLOAD]: 1,
  [HeavyFeatureType.PLAY_SONG]: 1,
  [HeavyFeatureType.SONG_LYRICS]: 1,
  [HeavyFeatureType.HD_AI_PHOTO]: 2,
  [HeavyFeatureType.HD_AI_PHOTO_DOCUMENT]: 2,
};

export function getFeatureCost(feature: HeavyFeatureType): number {
  return HEAVY_FEATURE_COST[feature] ?? 0;
}
