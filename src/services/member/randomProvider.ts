export interface RandomProvider {
  /** Returns a random integer between min and max inclusive. */
  intBetween(min: number, max: number): number;
  /** Returns true with the given probability (0.0 to 1.0). */
  chance(probability: number): boolean;
}

/** Production implementation using Math.random(). */
export const defaultRandom: RandomProvider = {
  intBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },
  chance(probability: number): boolean {
    return Math.random() < probability;
  },
};
