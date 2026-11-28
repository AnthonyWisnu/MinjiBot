import type { MemberRank } from "../member/rank.service";

export type InsuranceType = "brankas" | "bpjs" | "pengacara";

export interface CareerSpec {
  id: string;
  title: string;
  minLevel: number;
  basePay: bigint;
  baseXp: number;
  basePoints: number;
  promoteCostPerLevel: bigint;
}

export const CAREER_CATALOG: readonly CareerSpec[] = [
  {
    id: "kurir",
    title: "Kurir Paket Express",
    minLevel: 1,
    basePay: 3_900_000n,
    baseXp: 42,
    basePoints: 11,
    promoteCostPerLevel: 15_000_000n,
  },
  {
    id: "barista",
    title: "Barista Kopi Specialty",
    minLevel: 2,
    basePay: 7_200_000n,
    baseXp: 57,
    basePoints: 15,
    promoteCostPerLevel: 30_000_000n,
  },
  {
    id: "programmer",
    title: "Senior Fullstack Engineer",
    minLevel: 4,
    basePay: 15_000_000n,
    baseXp: 84,
    basePoints: 21,
    promoteCostPerLevel: 65_000_000n,
  },
  {
    id: "dokter",
    title: "Dokter Spesialis Bedah",
    minLevel: 6,
    basePay: 28_800_000n,
    baseXp: 114,
    basePoints: 27,
    promoteCostPerLevel: 120_000_000n,
  },
  {
    id: "pilot",
    title: "Kapten Pilot Internasional",
    minLevel: 9,
    basePay: 51_000_000n,
    baseXp: 150,
    basePoints: 36,
    promoteCostPerLevel: 250_000_000n,
  },
  {
    id: "ceo",
    title: "CEO Perusahaan Unicorn",
    minLevel: 12,
    basePay: 99_000_000n,
    baseXp: 204,
    basePoints: 48,
    promoteCostPerLevel: 500_000_000n,
  },
  {
    id: "menteri",
    title: "Menteri Ekonomi Grup",
    minLevel: 16,
    basePay: 192_000_000n,
    baseXp: 276,
    basePoints: 66,
    promoteCostPerLevel: 1_200_000_000n,
  },
  {
    id: "konglomerat",
    title: "Konglomerat Multinasional",
    minLevel: 20,
    basePay: 390_000_000n,
    baseXp: 372,
    basePoints: 90,
    promoteCostPerLevel: 2_500_000_000n,
  },
] as const;

export const CAREER_MAP = new Map<string, CareerSpec>(
  CAREER_CATALOG.map((c) => [c.id, c]),
);

export const CAREER_SHIFT_COOLDOWN_MS = 30 * 60 * 1000;
export const CAREER_MAX_LEVEL = 5;

export const STARTUP_CREATE_COST = 150_000_000n;
export const STARTUP_RECRUIT_COST = 35_000_000n;
export const STARTUP_MAX_LEVEL = 10;
export const STARTUP_DIVIDEND_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export function getStartupUpgradeCost(currentLevel: number): bigint {
  return 200_000_000n * BigInt(currentLevel) * BigInt(currentLevel);
}

export function getStartupMaxEmployees(level: number): number {
  return level * 5;
}

export function getStartupValuation(level: number, employees: number): bigint {
  return STARTUP_CREATE_COST * BigInt(level) + STARTUP_RECRUIT_COST * BigInt(employees);
}

export function getStartupDividendPayout(level: number, employees: number): bigint {
  return 27_000_000n * BigInt(level) + 10_800_000n * BigInt(employees);
}

export const PINJOL_MAX_BY_RANK: Record<MemberRank, bigint> = {
  Warrior: 25_000_000n,
  Elite: 75_000_000n,
  Master: 200_000_000n,
  Grandmaster: 500_000_000n,
  Epic: 1_500_000_000n,
  Legend: 4_000_000_000n,
  Mythic: 10_000_000_000n,
  "Immortal [MAX]": 25_000_000_000n,
};

export const PINJOL_MIN_AMOUNT = 5_000_000n;
export const PINJOL_INTEREST_PERCENT = 15;
export const PINJOL_DUE_MS = 48 * 60 * 60 * 1000;

export interface InsuranceSpec {
  id: InsuranceType;
  name: string;
  price: bigint;
  durationMs: number;
  benefit: string;
}

export const INSURANCE_CATALOG: readonly InsuranceSpec[] = [
  {
    id: "brankas",
    name: "Asuransi Brankas Anti-Maling",
    price: 35_000_000n,
    durationMs: 24 * 60 * 60 * 1000,
    benefit: "Kebal dari aksi .maling dan penagihan .pajak selama 24 jam",
  },
  {
    id: "bpjs",
    name: "BPJS Sultan VIP",
    price: 25_000_000n,
    durationMs: 24 * 60 * 60 * 1000,
    benefit: "Keluar UGD gratis kapan saja pakai .bebasugd & pulihkan HP penuh",
  },
  {
    id: "pengacara",
    name: "Pengacara Elit 24 Jam",
    price: 40_000_000n,
    durationMs: 24 * 60 * 60 * 1000,
    benefit: "Langsung bebas penjara KPK/Ronda gratis pakai .bebaspenjara",
  },
] as const;

export const INSURANCE_MAP = new Map<InsuranceType, InsuranceSpec>(
  INSURANCE_CATALOG.map((item) => [item.id, item]),
);

export const JAIL_BAIL_COST = 15_000_000n;
export const UGD_VIP_RELEASE_COST = 10_000_000n;

export const PRESTIGE_MAX_LEVEL = 10;
export const PRESTIGE_MIN_PLAYER_LEVEL = 10;
export const PRESTIGE_BASE_COST = 10_000_000_000n; // Rp 10 Miliar untuk Prestige ★1
export const PRESTIGE_BONUS_PERCENT_PER_STAR = 25; // +25% uang & XP permanen per bintang
export const PRESTIGE_REWARD_LIMIT = 12;
export const PRESTIGE_REWARD_POINTS = 300;

export function getPrestigeCost(currentPrestige: number): bigint {
  return PRESTIGE_BASE_COST * BigInt(currentPrestige + 1);
}

export function applyPrestigeMoneyBoost(baseAmount: bigint, prestige: number): bigint {
  if (prestige <= 0 || baseAmount <= 0n) return baseAmount;
  const pct = 100 + prestige * PRESTIGE_BONUS_PERCENT_PER_STAR;
  return (baseAmount * BigInt(pct)) / 100n;
}

export function applyPrestigeXpBoost(baseXp: number, prestige: number): number {
  if (prestige <= 0 || baseXp <= 0) return baseXp;
  return Math.round(baseXp * (1 + (prestige * PRESTIGE_BONUS_PERCENT_PER_STAR) / 100));
}
