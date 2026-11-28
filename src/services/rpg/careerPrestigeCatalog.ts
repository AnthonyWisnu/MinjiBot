import type { MemberRank } from "../member/rank.service";
import { CAREER_SHIFT_COOLDOWN_MS, STARTUP_DIVIDEND_COOLDOWN_MS } from "./cooldownCatalog";

export { CAREER_SHIFT_COOLDOWN_MS, STARTUP_DIVIDEND_COOLDOWN_MS };

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
    basePay: 600_000n,
    baseXp: 70,
    basePoints: 18,
    promoteCostPerLevel: 3_000_000n,
  },
  {
    id: "barista",
    title: "Barista Kopi Specialty",
    minLevel: 6,
    basePay: 1_100_000n,
    baseXp: 95,
    basePoints: 25,
    promoteCostPerLevel: 6_000_000n,
  },
  {
    id: "programmer",
    title: "Senior Fullstack Engineer",
    minLevel: 12,
    basePay: 2_200_000n,
    baseXp: 140,
    basePoints: 35,
    promoteCostPerLevel: 12_000_000n,
  },
  {
    id: "dokter",
    title: "Dokter Spesialis Bedah",
    minLevel: 18,
    basePay: 3_800_000n,
    baseXp: 190,
    basePoints: 45,
    promoteCostPerLevel: 24_000_000n,
  },
  {
    id: "pilot",
    title: "Kapten Pilot Internasional",
    minLevel: 26,
    basePay: 6_000_000n,
    baseXp: 250,
    basePoints: 60,
    promoteCostPerLevel: 45_000_000n,
  },
  {
    id: "ceo",
    title: "CEO Perusahaan Unicorn",
    minLevel: 35,
    basePay: 9_000_000n,
    baseXp: 340,
    basePoints: 80,
    promoteCostPerLevel: 90_000_000n,
  },
  {
    id: "menteri",
    title: "Menteri Ekonomi Grup",
    minLevel: 45,
    basePay: 14_000_000n,
    baseXp: 460,
    basePoints: 110,
    promoteCostPerLevel: 180_000_000n,
  },
  {
    id: "konglomerat",
    title: "Konglomerat Multinasional",
    minLevel: 60,
    basePay: 22_000_000n,
    baseXp: 620,
    basePoints: 150,
    promoteCostPerLevel: 350_000_000n,
  },
] as const;

export const CAREER_MAP = new Map<string, CareerSpec>(
  CAREER_CATALOG.map((c) => [c.id, c]),
);

export const CAREER_MAX_LEVEL = 5;

export const STARTUP_MIN_PLAYER_LEVEL = 20;
export const STARTUP_CREATE_COST = 80_000_000n;
export const STARTUP_RECRUIT_COST = 20_000_000n;
export const STARTUP_MAX_LEVEL = 10;

export function getStartupUpgradeCost(currentLevel: number): bigint {
  return 80_000_000n * BigInt(currentLevel) * BigInt(currentLevel);
}

export function getStartupMaxEmployees(level: number): number {
  return level * 5;
}

export function getStartupValuation(level: number, employees: number): bigint {
  return STARTUP_CREATE_COST * BigInt(level) + STARTUP_RECRUIT_COST * BigInt(employees);
}

export function getStartupDividendPayout(level: number, employees: number): bigint {
  return 3_500_000n * BigInt(level) + 1_200_000n * BigInt(employees);
}

export const PINJOL_MAX_BY_RANK: Record<MemberRank, bigint> = {
  Warrior: 5_000_000n,
  Elite: 12_000_000n,
  Master: 30_000_000n,
  Grandmaster: 75_000_000n,
  Epic: 180_000_000n,
  Legend: 400_000_000n,
  Mythic: 800_000_000n,
  "Immortal [MAX]": 1_500_000_000n,
};

export const PINJOL_MIN_AMOUNT = 1_000_000n;
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
    price: 18_000_000n,
    durationMs: 24 * 60 * 60 * 1000,
    benefit: "Kebal dari aksi .maling dan penagihan .pajak @user selama 24 jam",
  },
  {
    id: "bpjs",
    name: "BPJS Sultan VIP",
    price: 12_000_000n,
    durationMs: 24 * 60 * 60 * 1000,
    benefit: "Keluar UGD gratis kapan saja pakai .bebasugd & pulihkan HP penuh",
  },
  {
    id: "pengacara",
    name: "Pengacara Elit 24 Jam",
    price: 20_000_000n,
    durationMs: 24 * 60 * 60 * 1000,
    benefit: "Langsung bebas penjara KPK/Ronda gratis pakai .bebaspenjara",
  },
] as const;

export const INSURANCE_MAP = new Map<InsuranceType, InsuranceSpec>(
  INSURANCE_CATALOG.map((item) => [item.id, item]),
);

export const JAIL_BAIL_COST = 8_000_000n;
export const UGD_VIP_RELEASE_COST = 6_000_000n;

export const PRESTIGE_MAX_LEVEL = 10;
export const PRESTIGE_MIN_PLAYER_LEVEL = 30;
export const PRESTIGE_BASE_COST = 500_000_000n; // Rp 500 Juta untuk Prestige ★1
export const PRESTIGE_BONUS_PERCENT_PER_STAR = 8; // +8% uang & XP permanen per bintang (★10 = +80%)
export const PRESTIGE_REWARD_LIMIT = 20;
export const PRESTIGE_REWARD_POINTS = 500;

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
