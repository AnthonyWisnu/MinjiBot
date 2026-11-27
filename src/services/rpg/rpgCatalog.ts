import type { CrateType, PetType, ToolType } from "./rpgState";

export interface ShopItemSpec {
  id: string;
  label: string;
  category: "supply" | "crate" | "material" | "food";
  buyPrice: bigint | null; // null = hanya bisa didapat dari produksi/masak, tidak dijual di toko
  sellPrice: bigint;
  isCrate?: CrateType;
}

export const SHOP_CATALOG: readonly ShopItemSpec[] = [
  // Supplies
  { id: "potion", label: "Potion HP (+40 HP)", category: "supply", buyPrice: 350_000n, sellPrice: 150_000n },
  { id: "makananpet", label: "Pakan Pet", category: "supply", buyPrice: 500_000n, sellPrice: 200_000n },
  { id: "ramuanpet", label: "Ramuan Kuat Pet", category: "supply", buyPrice: 2_500_000n, sellPrice: 1_000_000n },
  // Crates
  { id: "common", label: "Common Crate", category: "crate", buyPrice: 2_000_000n, sellPrice: 800_000n, isCrate: "common" },
  { id: "uncommon", label: "Uncommon Crate", category: "crate", buyPrice: 6_000_000n, sellPrice: 2_500_000n, isCrate: "uncommon" },
  { id: "mythic", label: "Mythic Crate", category: "crate", buyPrice: 20_000_000n, sellPrice: 8_000_000n, isCrate: "mythic" },
  { id: "legendary", label: "Legendary Crate", category: "crate", buyPrice: 60_000_000n, sellPrice: 25_000_000n, isCrate: "legendary" },
  // Raw materials
  { id: "kayu", label: "Kayu", category: "material", buyPrice: 400_000n, sellPrice: 250_000n },
  { id: "batu", label: "Batu", category: "material", buyPrice: 450_000n, sellPrice: 280_000n },
  { id: "besi", label: "Bijih Besi", category: "material", buyPrice: 900_000n, sellPrice: 550_000n },
  { id: "emas", label: "Bongkahan Emas", category: "material", buyPrice: 2_500_000n, sellPrice: 1_600_000n },
  { id: "berlian", label: "Berlian", category: "material", buyPrice: 8_000_000n, sellPrice: 5_500_000n },
  // Farm & hunt raw food
  { id: "apel", label: "Apel", category: "food", buyPrice: null, sellPrice: 300_000n },
  { id: "pisang", label: "Pisang", category: "food", buyPrice: null, sellPrice: 300_000n },
  { id: "anggur", label: "Anggur", category: "food", buyPrice: null, sellPrice: 400_000n },
  { id: "mangga", label: "Mangga", category: "food", buyPrice: null, sellPrice: 450_000n },
  { id: "daging", label: "Daging Segar", category: "food", buyPrice: null, sellPrice: 650_000n },
  { id: "ikan", label: "Ikan Segar", category: "food", buyPrice: null, sellPrice: 600_000n },
  // Cooked luxury food (.masak)
  { id: "salad", label: "Salad Buah Sultan", category: "food", buyPrice: null, sellPrice: 3_500_000n },
  { id: "jus", label: "Jus Tropis Premium", category: "food", buyPrice: null, sellPrice: 3_800_000n },
  { id: "steak", label: "Steak Wagyu A5", category: "food", buyPrice: null, sellPrice: 5_500_000n },
  { id: "sup", label: "Sup Seafood Mewah", category: "food", buyPrice: null, sellPrice: 6_500_000n },
  { id: "nasigoreng", label: "Nasi Goreng Sultan", category: "food", buyPrice: null, sellPrice: 7_500_000n },
] as const;

export const SHOP_ITEM_MAP = new Map<string, ShopItemSpec>(
  SHOP_CATALOG.map((item) => [item.id, item]),
);

export interface CookRecipeSpec {
  id: string;
  label: string;
  ingredients: Record<string, number>;
  xp: number;
  sellPrice: bigint;
}

export const COOK_RECIPES: readonly CookRecipeSpec[] = [
  {
    id: "salad",
    label: "Salad Buah Sultan",
    ingredients: { apel: 2, mangga: 2 },
    xp: 45,
    sellPrice: 3_500_000n,
  },
  {
    id: "jus",
    label: "Jus Tropis Premium",
    ingredients: { pisang: 2, anggur: 2 },
    xp: 45,
    sellPrice: 3_800_000n,
  },
  {
    id: "steak",
    label: "Steak Wagyu A5",
    ingredients: { daging: 2, kayu: 2 },
    xp: 65,
    sellPrice: 5_500_000n,
  },
  {
    id: "sup",
    label: "Sup Seafood Mewah",
    ingredients: { ikan: 2, apel: 2, kayu: 1 },
    xp: 75,
    sellPrice: 6_500_000n,
  },
  {
    id: "nasigoreng",
    label: "Nasi Goreng Sultan",
    ingredients: { daging: 1, ikan: 1, kayu: 2 },
    xp: 85,
    sellPrice: 7_500_000n,
  },
] as const;

export const COOK_RECIPE_MAP = new Map<string, CookRecipeSpec>(
  COOK_RECIPES.map((r) => [r.id, r]),
);

export interface ToolCraftSpec {
  id: ToolType;
  label: string;
  bonusDesc: string;
  craftCostMoney: bigint;
  craftMaterials: Record<string, number>;
  upgradeMoneyPerLevel: bigint;
  upgradeMaterials: Record<string, number>;
}

export const TOOL_SPECS: Record<ToolType, ToolCraftSpec> = {
  sword: {
    id: "sword",
    label: "Pedang",
    bonusDesc: "+Power saat .adventure, .dungeon, .fight*, & .serang",
    craftCostMoney: 3_000_000n,
    craftMaterials: { kayu: 4, besi: 3 },
    upgradeMoneyPerLevel: 5_000_000n,
    upgradeMaterials: { besi: 2, emas: 1 },
  },
  armor: {
    id: "armor",
    label: "Armor Zirah",
    bonusDesc: "Kurangi damage HP & lindungi dompet saat diserang",
    craftCostMoney: 3_500_000n,
    craftMaterials: { batu: 4, besi: 4 },
    upgradeMoneyPerLevel: 5_500_000n,
    upgradeMaterials: { besi: 3, emas: 1 },
  },
  pickaxe: {
    id: "pickaxe",
    label: "Pickaxe",
    bonusDesc: "+15%/level cuan .nebang & tambah drop mineral langka",
    craftCostMoney: 2_500_000n,
    craftMaterials: { kayu: 4, batu: 4 },
    upgradeMoneyPerLevel: 4_500_000n,
    upgradeMaterials: { kayu: 2, besi: 2 },
  },
  fishingrod: {
    id: "fishingrod",
    label: "Pancingan",
    bonusDesc: "+15%/level hasil .berkebon & bonus drop ikan/bahan",
    craftCostMoney: 2_500_000n,
    craftMaterials: { kayu: 5, besi: 1 },
    upgradeMoneyPerLevel: 4_500_000n,
    upgradeMaterials: { kayu: 3, emas: 1 },
  },
};

export interface BossFightSpec {
  id: PetType;
  label: string;
  bossName: string;
  power: number;
  hpDamageOnWin: number;
  hpDamageOnLose: number;
  minMoney: number;
  maxMoney: number;
  xp: number;
  crateDrop: CrateType;
  petDropChance: number;
}

export const BOSS_FIGHT_SPECS: Record<PetType, BossFightSpec> = {
  kucing: {
    id: "kucing",
    label: "Kucing",
    bossName: "Raja Kucing Oren",
    power: 45,
    hpDamageOnWin: 12,
    hpDamageOnLose: 25,
    minMoney: 12_000_000,
    maxMoney: 24_000_000,
    xp: 160,
    crateDrop: "common",
    petDropChance: 0.35,
  },
  kyubi: {
    id: "kyubi",
    label: "Kyubi",
    bossName: "Rubah Ekor Sembilan",
    power: 90,
    hpDamageOnWin: 16,
    hpDamageOnLose: 30,
    minMoney: 22_000_000,
    maxMoney: 42_000_000,
    xp: 260,
    crateDrop: "uncommon",
    petDropChance: 0.3,
  },
  centaur: {
    id: "centaur",
    label: "Centaur",
    bossName: "Panglima Centaur",
    power: 145,
    hpDamageOnWin: 20,
    hpDamageOnLose: 35,
    minMoney: 38_000_000,
    maxMoney: 70_000_000,
    xp: 380,
    crateDrop: "uncommon",
    petDropChance: 0.25,
  },
  griffin: {
    id: "griffin",
    label: "Griffin",
    bossName: "Griffin Langit Emas",
    power: 210,
    hpDamageOnWin: 22,
    hpDamageOnLose: 40,
    minMoney: 55_000_000,
    maxMoney: 105_000_000,
    xp: 520,
    crateDrop: "mythic",
    petDropChance: 0.22,
  },
  naga: {
    id: "naga",
    label: "Naga",
    bossName: "Naga Purba Kawah",
    power: 290,
    hpDamageOnWin: 26,
    hpDamageOnLose: 45,
    minMoney: 85_000_000,
    maxMoney: 160_000_000,
    xp: 720,
    crateDrop: "mythic",
    petDropChance: 0.18,
  },
  phonix: {
    id: "phonix",
    label: "Phonix",
    bossName: "Immortal Phoenix",
    power: 380,
    hpDamageOnWin: 30,
    hpDamageOnLose: 50,
    minMoney: 130_000_000,
    maxMoney: 250_000_000,
    xp: 1_000,
    crateDrop: "legendary",
    petDropChance: 0.15,
  },
};

export interface CrateLootSpec {
  id: CrateType;
  label: string;
  minMoney: number;
  maxMoney: number;
  xp: number;
  petChance: number;
  petPool: readonly PetType[];
  itemPool: readonly { id: string; min: number; max: number }[];
}

export const CRATE_LOOT_SPECS: Record<CrateType, CrateLootSpec> = {
  common: {
    id: "common",
    label: "Common Crate",
    minMoney: 1_500_000,
    maxMoney: 4_500_000,
    xp: 50,
    petChance: 0.12,
    petPool: ["kucing", "kyubi"],
    itemPool: [
      { id: "potion", min: 1, max: 2 },
      { id: "kayu", min: 2, max: 5 },
      { id: "batu", min: 2, max: 5 },
      { id: "makananpet", min: 1, max: 2 },
    ],
  },
  uncommon: {
    id: "uncommon",
    label: "Uncommon Crate",
    minMoney: 5_000_000,
    maxMoney: 14_000_000,
    xp: 120,
    petChance: 0.2,
    petPool: ["kucing", "kyubi", "centaur"],
    itemPool: [
      { id: "potion", min: 2, max: 4 },
      { id: "besi", min: 2, max: 6 },
      { id: "emas", min: 1, max: 3 },
      { id: "makananpet", min: 2, max: 4 },
    ],
  },
  mythic: {
    id: "mythic",
    label: "Mythic Crate",
    minMoney: 18_000_000,
    maxMoney: 50_000_000,
    xp: 300,
    petChance: 0.32,
    petPool: ["centaur", "griffin", "naga"],
    itemPool: [
      { id: "emas", min: 2, max: 6 },
      { id: "berlian", min: 1, max: 3 },
      { id: "ramuanpet", min: 1, max: 2 },
      { id: "potion", min: 3, max: 6 },
    ],
  },
  legendary: {
    id: "legendary",
    label: "Legendary Crate",
    minMoney: 55_000_000,
    maxMoney: 180_000_000,
    xp: 650,
    petChance: 0.5,
    petPool: ["griffin", "naga", "phonix"],
    itemPool: [
      { id: "berlian", min: 3, max: 8 },
      { id: "emas", min: 4, max: 10 },
      { id: "ramuanpet", min: 2, max: 4 },
      { id: "potion", min: 5, max: 10 },
    ],
  },
};

export const PET_LABELS: Record<PetType, string> = {
  kucing: "Kucing",
  kyubi: "Kyubi",
  centaur: "Centaur",
  griffin: "Griffin",
  naga: "Naga",
  phonix: "Phonix",
};

export function normalizeCrateType(raw: string | undefined): CrateType | null {
  const val = (raw ?? "").trim().toLowerCase();
  if (val === "common" || val === "uncommon" || val === "mythic" || val === "legendary") {
    return val;
  }
  return null;
}

export function normalizeToolType(raw: string | undefined): ToolType | null {
  const val = (raw ?? "").trim().toLowerCase();
  if (val === "sword" || val === "pedang") return "sword";
  if (val === "armor" || val === "zirah") return "armor";
  if (val === "pickaxe" || val === "beliung") return "pickaxe";
  if (val === "fishingrod" || val === "pancing" || val === "pancingan" || val === "rod") {
    return "fishingrod";
  }
  return null;
}

export function normalizePetType(raw: string | undefined): PetType | null {
  const val = (raw ?? "").trim().toLowerCase();
  if (val === "kucing" || val === "cat") return "kucing";
  if (val === "kyubi" || val === "fox" || val === "rubah") return "kyubi";
  if (val === "centaur") return "centaur";
  if (val === "griffin") return "griffin";
  if (val === "naga" || val === "dragon") return "naga";
  if (val === "phonix" || val === "phoenix") return "phonix";
  return null;
}
