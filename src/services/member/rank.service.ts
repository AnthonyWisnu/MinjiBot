export type MemberRank =
  | "Warrior"
  | "Elite"
  | "Master"
  | "Grandmaster"
  | "Epic"
  | "Legend"
  | "Mythic"
  | "Immortal [MAX]";

// Ordered from highest to lowest for threshold scan
const RANK_THRESHOLDS: [MemberRank, number][] = [
  ["Mythic",      250_000],
  ["Legend",      100_000],
  ["Epic",         40_000],
  ["Grandmaster",  15_000],
  ["Master",        5_000],
  ["Elite",         1_000],
  ["Warrior",           0],
];

// Pure function - no database access.
// Rank is derived from XP. Spending points has no effect on rank.
export function resolveRank(experience: number): MemberRank {
  for (const [rank, threshold] of RANK_THRESHOLDS) {
    if (experience >= threshold) {
      return rank;
    }
  }
  return "Warrior";
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
