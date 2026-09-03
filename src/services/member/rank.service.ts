export type MemberRank =
  | "Bronze"
  | "Silver"
  | "Gold"
  | "Platinum"
  | "Diamond"
  | "Master"
  | "Grandmaster";

// Ordered from highest to lowest for threshold scan
const RANK_THRESHOLDS: [MemberRank, number][] = [
  ["Grandmaster", 250_000],
  ["Master",      100_000],
  ["Diamond",      40_000],
  ["Platinum",     15_000],
  ["Gold",          5_000],
  ["Silver",        1_000],
  ["Bronze",            0],
];

// Pure function - no database access.
// Rank is derived from XP. Spending points has no effect on rank.
export function resolveRank(experience: number): MemberRank {
  for (const [rank, threshold] of RANK_THRESHOLDS) {
    if (experience >= threshold) {
      return rank;
    }
  }
  return "Bronze";
}

// Returns the minimum XP needed for the next rank tier.
// Returns null if the member is already at Grandmaster.
export function nextRankThreshold(experience: number): number | null {
  for (let i = RANK_THRESHOLDS.length - 1; i >= 0; i--) {
    const entry = RANK_THRESHOLDS[i];
    if (entry === undefined) continue;
    const [, threshold] = entry;
    if (experience < threshold) {
      return threshold;
    }
  }
  return null;
}

// Returns XP progress within the current rank tier (0 to tierRange).
export function rankProgress(
  experience: number,
): { current: number; threshold: number; next: number | null } {
  const rank = resolveRank(experience);
  const currentThreshold =
    RANK_THRESHOLDS.find(([r]) => r === rank)?.[1] ?? 0;
  const next = nextRankThreshold(experience);

  return {
    current: experience - currentThreshold,
    threshold: currentThreshold,
    next,
  };
}
