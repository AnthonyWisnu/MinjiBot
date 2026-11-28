export type ProfileThemeId =
  | "midnight"
  | "sakura"
  | "emerald"
  | "cyberpunk"
  | "crimson"
  | "gold"
  | "celestial";

export const PROFILE_THEME_IDS: readonly ProfileThemeId[] = [
  "midnight",
  "sakura",
  "emerald",
  "cyberpunk",
  "crimson",
  "gold",
  "celestial",
] as const;

export interface ProfileThemeSpec {
  id: ProfileThemeId;
  name: string;
  tagline: string;
  price: bigint;
  bgStart: string;
  bgMid: string;
  bgEnd: string;
  accentPrimary: string;
  accentSecondary: string;
  borderColor: string;
  boxStart: string;
  boxEnd: string;
  boxStroke: string;
  glowColor: string;
  cardLabel: string;
}

const DEFAULT_PROFILE_THEME: ProfileThemeSpec = {
  id: "midnight",
  name: "Midnight Glass",
  tagline: "Tema bawaan elegan biru gelap & glassmorphism modern",
  price: 0n,
  bgStart: "#0B0F19",
  bgMid: "#111827",
  bgEnd: "#1E293B",
  accentPrimary: "#38BDF8",
  accentSecondary: "#60A5FA",
  borderColor: "#38BDF8",
  boxStart: "#1E293B",
  boxEnd: "#0F172A",
  boxStroke: "#334155",
  glowColor: "#38BDF8",
  cardLabel: "MINJIBOT BLACK CARD",
};

export const PROFILE_THEME_CATALOG: readonly ProfileThemeSpec[] = [
  DEFAULT_PROFILE_THEME,
  {
    id: "sakura",
    name: "Sakura Blossom",
    tagline: "Nuansa kelopak sakura gelap dengan kilau merah muda lembut",
    price: 80_000_000n,
    bgStart: "#1F0A1D",
    bgMid: "#2B1028",
    bgEnd: "#1B1228",
    accentPrimary: "#F472B6",
    accentSecondary: "#FBCFE8",
    borderColor: "#EC4899",
    boxStart: "#3B1535",
    boxEnd: "#1E0B1D",
    boxStroke: "#831843",
    glowColor: "#F472B6",
    cardLabel: "SAKURA EDITION CARD",
  },
  {
    id: "emerald",
    name: "Emerald Vault",
    tagline: "Brankas zamrud hijau mewah khas investor elit",
    price: 200_000_000n,
    bgStart: "#051914",
    bgMid: "#0A2820",
    bgEnd: "#0F1F1D",
    accentPrimary: "#10B981",
    accentSecondary: "#6EE7B7",
    borderColor: "#34D399",
    boxStart: "#0F342A",
    boxEnd: "#071E18",
    boxStroke: "#065F46",
    glowColor: "#10B981",
    cardLabel: "EMERALD VAULT CARD",
  },
  {
    id: "cyberpunk",
    name: "Cyber Neon",
    tagline: "Atmosfer futuristik neon sian & ungu magenta",
    price: 450_000_000n,
    bgStart: "#0E0725",
    bgMid: "#1B0E3F",
    bgEnd: "#0B1633",
    accentPrimary: "#22D3EE",
    accentSecondary: "#E879F9",
    borderColor: "#22D3EE",
    boxStart: "#241352",
    boxEnd: "#120B30",
    boxStroke: "#6D28D9",
    glowColor: "#E879F9",
    cardLabel: "CYBER NEON CARD",
  },
  {
    id: "crimson",
    name: "Crimson Emperor",
    tagline: "Obsidian merah darah dengan aksen bara kaisar",
    price: 900_000_000n,
    bgStart: "#1C070A",
    bgMid: "#2E0C12",
    bgEnd: "#180B14",
    accentPrimary: "#EF4444",
    accentSecondary: "#F59E0B",
    borderColor: "#F87171",
    boxStart: "#3F1219",
    boxEnd: "#20090D",
    boxStroke: "#991B1B",
    glowColor: "#EF4444",
    cardLabel: "CRIMSON EMPEROR CARD",
  },
  {
    id: "gold",
    name: "Royal Gold",
    tagline: "Emas murni sultan berbingkai obsidian premium",
    price: 2_000_000_000n,
    bgStart: "#171104",
    bgMid: "#261B07",
    bgEnd: "#14110B",
    accentPrimary: "#FDE047",
    accentSecondary: "#F59E0B",
    borderColor: "#FACC15",
    boxStart: "#35260B",
    boxEnd: "#1C1406",
    boxStroke: "#A16207",
    glowColor: "#FDE047",
    cardLabel: "ROYAL GOLD BLACK CARD",
  },
  {
    id: "celestial",
    name: "Celestial Aurora",
    tagline: "Tema kasta tertinggi kosmik aurora prismatik",
    price: 6_000_000_000n,
    bgStart: "#070B24",
    bgMid: "#161242",
    bgEnd: "#0B2438",
    accentPrimary: "#C084FC",
    accentSecondary: "#38BDF8",
    borderColor: "#E879F9",
    boxStart: "#1E1A4D",
    boxEnd: "#0C1430",
    boxStroke: "#7E22CE",
    glowColor: "#C084FC",
    cardLabel: "CELESTIAL AURORA CARD",
  },
] as const;

export const PROFILE_THEME_MAP = new Map<ProfileThemeId, ProfileThemeSpec>(
  PROFILE_THEME_CATALOG.map((spec) => [spec.id, spec]),
);

export function normalizeProfileThemeId(raw: string | undefined): ProfileThemeId | null {
  const val = (raw ?? "").trim().toLowerCase();
  if (val === "default" || val === "midnight") return "midnight";
  if (val === "sakura" || val === "pink") return "sakura";
  if (val === "emerald" || val === "hijau") return "emerald";
  if (val === "cyberpunk" || val === "cyber" || val === "neon") return "cyberpunk";
  if (val === "crimson" || val === "merah") return "crimson";
  if (val === "gold" || val === "emas" || val === "royal") return "gold";
  if (val === "celestial" || val === "aurora" || val === "kosmik") return "celestial";
  return null;
}

export function getProfileThemeSpec(themeId: string | null | undefined): ProfileThemeSpec {
  const norm = typeof themeId === "string" ? normalizeProfileThemeId(themeId) : null;
  return (norm ? PROFILE_THEME_MAP.get(norm) : undefined) ?? DEFAULT_PROFILE_THEME;
}
